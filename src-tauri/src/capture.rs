use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use image::DynamicImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::{changed, new_id, Db};
use crate::error::{AppError, AppResult};
use crate::{ocr, settings, shots};

#[derive(Default)]
pub struct CaptureState {
    pending: Mutex<Option<Pending>>,
    hidden: Mutex<Vec<String>>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
    busy: AtomicBool,
}

#[derive(Clone, Serialize)]
pub struct MonRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone)]
struct MonSpot {
    rect: MonRect,
    pos: (i32, i32),
}

struct Pending {
    path: PathBuf,
    width: u32,
    height: u32,
    mode: String,
    mons: Vec<MonSpot>,
    primary: usize,
}

#[derive(Serialize)]
pub struct Remembered {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize)]
pub struct CaptureInfo {
    pub width: u32,
    pub height: u32,
    pub mode: String,
    pub src: String,
    pub monitor: MonRect,
    pub index: usize,
    pub count: usize,
    pub primary: usize,
    pub remembered: Option<Remembered>,
}

#[derive(Deserialize, Debug)]
pub struct RectIn {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize, Debug)]
pub struct FinishReq {
    pub mode: String,
    pub monitor: usize,
    pub rect: Option<RectIn>,
}

struct Opts {
    copy: bool,
    edit: bool,
    ocr: bool,
    delay: u32,
    remember: bool,
}

fn load_opts(app: &AppHandle) -> Opts {
    let db = app.state::<Db>();
    let conn = db.conn();
    let flag = |key: &str, default: bool| match settings::get(&conn, key).as_deref() {
        Some("1") => true,
        Some("0") => false,
        _ => default,
    };
    Opts {
        copy: flag("shots.copy", true),
        edit: flag("shots.edit", false),
        ocr: flag("shots.ocr", true),
        delay: settings::get(&conn, "shots.delay").and_then(|v| v.parse().ok()).unwrap_or(0).min(10),
        remember: flag("shots.remember", false),
    }
}

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("trove")
}

fn other(e: impl std::fmt::Display) -> AppError {
    AppError::Other(e.to_string())
}

async fn grab(interactive: bool) -> AppResult<PathBuf> {
    use ashpd::desktop::screenshot::Screenshot;
    let resp = Screenshot::request()
        .interactive(interactive)
        .modal(true)
        .send()
        .await
        .map_err(|e| other(format!("Couldn't reach the screenshot service: {e}")))?
        .response()
        .map_err(|e| match e {
            ashpd::Error::Response(ashpd::desktop::ResponseError::Cancelled) => AppError::Cancelled,
            e => other(format!("Screenshot was not allowed: {e}")),
        })?;
    let src = resp
        .uri()
        .to_file_path()
        .map_err(|_| other("The screenshot service returned an unsupported location"))?;
    let dir = cache_dir();
    std::fs::create_dir_all(&dir).map_err(other)?;
    let dest = dir.join(format!("capture-{}.png", new_id()));
    if std::fs::rename(&src, &dest).is_err() {
        std::fs::copy(&src, &dest).map_err(other)?;
        let _ = std::fs::remove_file(&src);
    }
    Ok(dest)
}

fn hide_all(app: &AppHandle, state: &CaptureState) {
    let mut hidden = Vec::new();
    for (label, w) in app.webview_windows() {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            hidden.push(label);
        }
    }
    *state.hidden.lock().unwrap_or_else(|e| e.into_inner()) = hidden;
}

fn restore_all(app: &AppHandle) {
    let state = app.state::<CaptureState>();
    let labels = std::mem::take(&mut *state.hidden.lock().unwrap_or_else(|e| e.into_inner()));
    for l in labels {
        if let Some(w) = app.get_webview_window(&l) {
            let _ = w.show();
        }
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_focus();
    }
}

fn close_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
}

fn close_overlays(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("capture-") {
            let _ = w.close();
        }
    }
}

fn layout(app: &AppHandle, iw: u32, ih: u32) -> (Vec<MonSpot>, usize) {
    let full = MonSpot {
        rect: MonRect { x: 0.0, y: 0.0, w: iw as f64, h: ih as f64 },
        pos: (0, 0),
    };
    let mons = app.available_monitors().unwrap_or_default();
    if mons.is_empty() {
        return (vec![full], 0);
    }
    let min_x = mons.iter().map(|m| m.position().x).min().unwrap_or(0);
    let min_y = mons.iter().map(|m| m.position().y).min().unwrap_or(0);
    let max_x = mons.iter().map(|m| m.position().x + m.size().width as i32).max().unwrap_or(0);
    let max_y = mons.iter().map(|m| m.position().y + m.size().height as i32).max().unwrap_or(0);
    let (bw, bh) = ((max_x - min_x) as f64, (max_y - min_y) as f64);
    if bw <= 0.0 || bh <= 0.0 {
        return (vec![full], 0);
    }
    let (fx, fy) = (iw as f64 / bw, ih as f64 / bh);
    let spots: Vec<MonSpot> = mons
        .iter()
        .map(|m| {
            let x = ((m.position().x - min_x) as f64 * fx).max(0.0);
            let y = ((m.position().y - min_y) as f64 * fy).max(0.0);
            let w = (m.size().width as f64 * fx).min(iw as f64 - x);
            let h = (m.size().height as f64 * fy).min(ih as f64 - y);
            MonSpot {
                rect: MonRect { x, y, w, h },
                pos: (m.position().x, m.position().y),
            }
        })
        .collect();
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|p| spots.iter().position(|s| s.pos == (p.position().x, p.position().y)))
        .unwrap_or(0);
    (spots, primary)
}

fn copy_to_clipboard(state: &CaptureState, img: &DynamicImage) -> bool {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut guard = state.clipboard.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = arboard::Clipboard::new().ok();
    }
    match guard.as_mut() {
        Some(cb) => cb
            .set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(rgba.into_raw()),
            })
            .is_ok(),
        None => false,
    }
}

async fn open_toast(app: &AppHandle, id: &str, copied: bool) {
    close_window(app, "toast");
    let (w, h) = (412.0, 214.0);
    let mut builder = WebviewWindowBuilder::new(
        app,
        "toast",
        WebviewUrl::App(format!("index.html?view=toast&id={id}&copied={}", copied as u8).into()),
    )
    .title("Trove")
    .inner_size(w, h)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false);
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        builder = builder.position(pos.x + size.width - w - 28.0, pos.y + size.height - h - 28.0);
    }
    let _ = builder.build();
}

async fn process(app: &AppHandle, img: DynamicImage, mode: &str, opts: &Opts) -> AppResult<()> {
    let img = Arc::new(img);
    let copy_task = opts.copy.then(|| {
        let app = app.clone();
        let img = img.clone();
        tauri::async_runtime::spawn_blocking(move || copy_to_clipboard(&app.state::<CaptureState>(), &img))
    });
    let save_task = {
        let app = app.clone();
        let img = img.clone();
        let app_name = match mode {
            "window" => "Window",
            "screen" => "Screen",
            _ => "Desktop",
        }
        .to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let dirs = shots::ShotDirs::standard();
            dirs.ensure()?;
            let db = app.state::<Db>();
            let conn = db.conn();
            shots::create(
                &conn,
                &dirs,
                &img,
                shots::NewShot {
                    app: app_name,
                    ocr: String::new(),
                    title: None,
                    tag: None,
                    task_id: None,
                    note_id: None,
                },
            )
        })
    };
    let copied = match copy_task {
        Some(t) => t.await.unwrap_or(false),
        None => false,
    };
    let shot = save_task.await.map_err(other)??;
    changed(app, "shots");
    restore_all(app);
    if opts.edit {
        crate::windows::open_shot_editor_inner(app, &shot.id)?;
    } else {
        open_toast(app, &shot.id, copied).await;
    }
    if opts.ocr {
        let app = app.clone();
        let id = shot.id.clone();
        let file = PathBuf::from(&shot.file);
        tauri::async_runtime::spawn(async move {
            let text = tauri::async_runtime::spawn_blocking(move || ocr::read(&file))
                .await
                .ok()
                .flatten()
                .unwrap_or_default();
            if text.trim().is_empty() {
                return;
            }
            let db = app.state::<Db>();
            let saved = shots::set_ocr(&db.conn(), &id, &text).is_ok();
            if saved {
                changed(&app, "shots");
            }
        });
    }
    Ok(())
}

fn load(path: &Path) -> AppResult<DynamicImage> {
    image::open(path).map_err(|e| other(format!("Couldn't read the screenshot: {e}")))
}

async fn capture_direct(app: &AppHandle, mode: &str) -> AppResult<()> {
    let path = grab(true).await?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        let r = load(&path);
        let _ = std::fs::remove_file(&path);
        r
    })
    .await
    .map_err(other)??;
    let opts = load_opts(app);
    process(app, img, mode, &opts).await
}

fn build_overlays(app: &AppHandle, count: usize) -> AppResult<()> {
    for i in 0..count {
        WebviewWindowBuilder::new(app, format!("capture-{i}"), WebviewUrl::App(format!("index.html?view=capture&m={i}").into()))
            .title("Trove capture")
            .visible(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .build()
            .map_err(other)?;
    }
    Ok(())
}

fn finish_session(app: &AppHandle) {
    app.state::<CaptureState>().busy.store(false, Ordering::SeqCst);
}

fn fail(app: &AppHandle, e: &AppError) {
    if !matches!(e, AppError::Cancelled) {
        let _ = app.emit("capture-error", e.to_string());
    }
}

#[tauri::command]
pub async fn start_capture(app: AppHandle, state: State<'_, CaptureState>, mode: String) -> AppResult<()> {
    if !matches!(mode.as_str(), "area" | "window" | "screen") {
        return Err(AppError::Invalid("Invalid capture mode".into()));
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    hide_all(&app, &state);
    let overlay = mode != "window";
    let count = if overlay { app.available_monitors().map(|m| m.len().max(1)).unwrap_or(1) } else { 0 };
    if overlay {
        if let Err(e) = build_overlays(&app, count) {
            close_overlays(&app);
            restore_all(&app);
            finish_session(&app);
            return Err(e);
        }
    }
    tokio::time::sleep(Duration::from_millis(220)).await;
    let outcome: AppResult<bool> = async {
        if !overlay {
            capture_direct(&app, "window").await?;
            return Ok(false);
        }
        let path = match grab(false).await {
            Ok(p) => p,
            Err(AppError::Cancelled) => return Err(AppError::Cancelled),
            Err(_) => {
                close_overlays(&app);
                capture_direct(&app, &mode).await?;
                return Ok(false);
            }
        };
        let (width, height) = image::image_dimensions(&path).map_err(other)?;
        let (mons, primary) = layout(&app, width, height);
        *state.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pending {
            path,
            width,
            height,
            mode: mode.clone(),
            mons,
            primary,
        });
        let _ = app.emit("capture-ready", ());
        let guard = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(2500)).await;
            let state = guard.state::<CaptureState>();
            for i in 0..16 {
                if let Some(w) = guard.get_webview_window(&format!("capture-{i}")) {
                    if !w.is_visible().unwrap_or(true) {
                        show_overlay(&guard, &state, i);
                    }
                }
            }
        });
        Ok(true)
    }
    .await;
    match outcome {
        Ok(true) => Ok(()),
        Ok(false) => {
            finish_session(&app);
            Ok(())
        }
        Err(e) => {
            close_overlays(&app);
            restore_all(&app);
            finish_session(&app);
            fail(&app, &e);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn capture_info(app: AppHandle, state: State<CaptureState>, index: usize) -> AppResult<CaptureInfo> {
    let guard = state.pending.lock().unwrap_or_else(|e| e.into_inner());
    let p = guard.as_ref().ok_or(AppError::NotFound)?;
    let spot = p.mons.get(index).ok_or(AppError::NotFound)?;
    let opts = load_opts(&app);
    let remembered = if opts.remember {
        let db = app.state::<Db>();
        let raw = settings::get(&db.conn(), "shots.area");
        raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .filter(|v| v["m"].as_u64() == Some(index as u64))
            .and_then(|v| {
                Some(Remembered {
                    x: v["x"].as_f64()?,
                    y: v["y"].as_f64()?,
                    w: v["w"].as_f64()?,
                    h: v["h"].as_f64()?,
                })
            })
    } else {
        None
    };
    Ok(CaptureInfo {
        width: p.width,
        height: p.height,
        mode: p.mode.clone(),
        src: p.path.to_string_lossy().to_string(),
        monitor: spot.rect.clone(),
        index,
        count: p.mons.len(),
        primary: p.primary,
        remembered,
    })
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, state: State<CaptureState>, index: usize) {
    show_overlay(&app, &state, index);
}

fn show_overlay(app: &AppHandle, state: &CaptureState, index: usize) {
    let (pos, primary) = {
        let guard = state.pending.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(p) => (p.mons.get(index).map(|m| m.pos), p.primary),
            None => return,
        }
    };
    if let Some(w) = app.get_webview_window(&format!("capture-{index}")) {
        if let Some((x, y)) = pos {
            let _ = w.set_fullscreen_on_monitor(PhysicalPosition::new(x as f64 + 1.0, y as f64 + 1.0));
        }
        let _ = w.show();
        if index == primary {
            let _ = w.set_focus();
        }
    }
}

fn discard_pending(state: &CaptureState) -> Option<Pending> {
    state.pending.lock().unwrap_or_else(|e| e.into_inner()).take()
}

async fn run_finish(app: &AppHandle, pending: Pending, req: FinishReq) -> AppResult<()> {
    let opts = load_opts(app);
    let mut path = pending.path.clone();
    if opts.delay > 0 {
        tokio::time::sleep(Duration::from_millis(300 + opts.delay as u64 * 1000)).await;
        let fresh = grab(false).await;
        let _ = std::fs::remove_file(&path);
        path = fresh?;
    }
    let spot = pending.mons.get(req.monitor).cloned().ok_or(AppError::NotFound)?;
    let single = pending.mons.len() == 1;
    let user_rect = match (&req.rect, req.mode.as_str()) {
        (Some(r), "area") => Some(r),
        _ => None,
    };
    if opts.remember {
        if let Some(r) = user_rect {
            let value = serde_json::json!({
                "m": req.monitor,
                "x": r.x / spot.rect.w,
                "y": r.y / spot.rect.h,
                "w": r.w / spot.rect.w,
                "h": r.h / spot.rect.h,
            });
            let db = app.state::<Db>();
            let _ = db.conn().execute(
                "INSERT INTO settings (key, value) VALUES ('shots.area', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![value.to_string()],
            );
        }
    }
    let target = user_rect.map(|r| (spot.rect.x + r.x, spot.rect.y + r.y, r.w, r.h));
    let whole = (spot.rect.x, spot.rect.y, spot.rect.w, spot.rect.h);
    let img = tauri::async_runtime::spawn_blocking(move || -> AppResult<DynamicImage> {
        let img = load(&path)?;
        let _ = std::fs::remove_file(&path);
        let (iw, ih) = (img.width(), img.height());
        let (x, y, w, h) = match target {
            Some(t) => t,
            None if single => return Ok(img),
            None => whole,
        };
        let rect = shots::clamp_rect(x, y, w, h, iw, ih).ok_or_else(|| AppError::Invalid("Select a larger area".into()))?;
        Ok(shots::crop(&img, rect))
    })
    .await
    .map_err(other)??;
    process(app, img, &req.mode, &opts).await
}

#[tauri::command]
pub async fn finish_capture(app: AppHandle, state: State<'_, CaptureState>, req: FinishReq) -> AppResult<()> {
    let pending = discard_pending(&state).ok_or(AppError::NotFound)?;
    close_overlays(&app);
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_finish(&app, pending, req).await {
            restore_all(&app);
            fail(&app, &e);
        }
        finish_session(&app);
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle, state: State<CaptureState>) {
    if let Some(p) = discard_pending(&state) {
        let _ = std::fs::remove_file(&p.path);
    }
    close_overlays(&app);
    restore_all(&app);
    finish_session(&app);
}

#[tauri::command]
pub fn open_capture_settings(app: AppHandle, state: State<CaptureState>) {
    cancel_capture(app.clone(), state);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit_to("main", "go-settings", "shots");
}

#[tauri::command]
pub async fn switch_to_window_capture(app: AppHandle, state: State<'_, CaptureState>) -> AppResult<()> {
    if let Some(p) = discard_pending(&state) {
        let _ = std::fs::remove_file(&p.path);
    }
    close_overlays(&app);
    restore_all(&app);
    finish_session(&app);
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = h.state::<CaptureState>();
        let _ = start_capture(h.clone(), state, "window".to_string()).await;
    });
    Ok(())
}

#[tauri::command]
pub fn copy_shot_image(state: State<CaptureState>, db: State<Db>, id: String) -> AppResult<()> {
    let shot = shots::get(&db.conn(), &id)?;
    let img = load(Path::new(&shot.file))?;
    if copy_to_clipboard(&state, &img) {
        Ok(())
    } else {
        Err(AppError::Other("The system clipboard is not available".into()))
    }
}

#[tauri::command]
pub fn request_attach(app: AppHandle, id: String) {
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show();
        let _ = m.unminimize();
        let _ = m.set_focus();
    }
    let _ = app.emit_to("main", "shot-attach", id);
}

#[tauri::command]
pub fn copy_png_bytes(state: State<CaptureState>, request: tauri::ipc::Request) -> AppResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Invalid("Expected image data".into()));
    };
    let img = image::load_from_memory(bytes).map_err(|e| other(e.to_string()))?;
    if copy_to_clipboard(&state, &img) {
        Ok(())
    } else {
        Err(AppError::Other("The system clipboard is not available".into()))
    }
}
