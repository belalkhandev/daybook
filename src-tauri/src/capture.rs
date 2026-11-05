use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use image::DynamicImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::db::{changed, new_id, Db};
use crate::error::{AppError, AppResult};
use crate::{ocr, shots};

#[derive(Default)]
pub struct CaptureState {
    pending: Mutex<Option<Pending>>,
    hidden: Mutex<Vec<String>>,
    clipboard: Mutex<Option<arboard::Clipboard>>,
}

struct Pending {
    path: PathBuf,
    width: u32,
    height: u32,
    mode: String,
}

#[derive(Serialize)]
pub struct CaptureInfo {
    pub width: u32,
    pub height: u32,
    pub mode: String,
    pub src: String,
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
    pub rect: Option<RectIn>,
    pub delay: u32,
    pub ocr: bool,
    pub edit: bool,
}

#[derive(Serialize)]
pub struct Captured {
    pub shot: shots::Shot,
    pub ocr_found: bool,
    pub copied: bool,
}

fn cache_dir() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("daybook")
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
    std::fs::copy(&src, &dest).map_err(other)?;
    let _ = std::fs::remove_file(&src);
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

fn active_app() -> String {
    "Desktop".to_string()
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

async fn open_toast(app: &AppHandle, id: &str, ocr_found: bool, copied: bool) {
    close_window(app, "toast");
    let (w, h) = (412.0, 214.0);
    let mut builder = WebviewWindowBuilder::new(
        app,
        "toast",
        WebviewUrl::App(format!("index.html?view=toast&id={id}&ocr={}&copied={}", ocr_found as u8, copied as u8).into()),
    )
    .title("Daybook")
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

async fn complete(app: &AppHandle, img: DynamicImage, mode: &str, run_ocr: bool, edit: bool) -> AppResult<Captured> {
    let dirs = shots::ShotDirs::standard();
    dirs.ensure()?;
    let state = app.state::<CaptureState>();
    let copied = copy_to_clipboard(&state, &img);
    let text = if run_ocr {
        let tmp = cache_dir().join(format!("ocr-{}.png", new_id()));
        std::fs::create_dir_all(cache_dir()).map_err(other)?;
        shots::write_png(&img, &tmp)?;
        let t = tauri::async_runtime::spawn_blocking({
            let tmp = tmp.clone();
            move || ocr::read(&tmp)
        })
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
        let _ = std::fs::remove_file(&tmp);
        t
    } else {
        String::new()
    };
    let app_name = match mode {
        "window" => "Window".to_string(),
        "screen" => "Screen".to_string(),
        _ => active_app(),
    };
    let found = !text.trim().is_empty();
    let shot = {
        let db = app.state::<Db>();
        let conn = db.conn();
        shots::create(
            &conn,
            &dirs,
            &img,
            shots::NewShot {
                app: app_name,
                ocr: text,
                title: None,
                tag: None,
                task_id: None,
                note_id: None,
            },
        )?
    };
    changed(app, "shots");
    restore_all(app);
    if edit {
        crate::windows::open_shot_editor_inner(app, &shot.id)?;
    } else {
        open_toast(app, &shot.id, found, copied).await;
    }
    Ok(Captured { shot, ocr_found: found, copied })
}

fn load(path: &Path) -> AppResult<DynamicImage> {
    image::open(path).map_err(|e| other(format!("Couldn't read the screenshot: {e}")))
}

#[tauri::command]
pub async fn start_capture(app: AppHandle, state: State<'_, CaptureState>, mode: String) -> AppResult<()> {
    if !matches!(mode.as_str(), "area" | "window" | "screen") {
        return Err(AppError::Invalid("Invalid capture mode".into()));
    }
    if app.get_webview_window("capture").is_some() {
        return Ok(());
    }
    hide_all(&app, &state);
    tokio::time::sleep(Duration::from_millis(450)).await;
    let result: AppResult<()> = async {
        if mode == "window" {
            let path = grab(true).await?;
            let img = load(&path)?;
            let _ = std::fs::remove_file(&path);
            complete(&app, img, "window", true, false).await?;
            return Ok(());
        }
        let path = match grab(false).await {
            Ok(p) => p,
            Err(AppError::Cancelled) => return Err(AppError::Cancelled),
            Err(_) => {
                let p = grab(true).await?;
                let img = load(&p)?;
                let _ = std::fs::remove_file(&p);
                complete(&app, img, &mode, true, false).await?;
                return Ok(());
            }
        };
        let (width, height) = image::image_dimensions(&path).map_err(|e| other(e.to_string()))?;
        *state.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pending {
            path,
            width,
            height,
            mode: mode.clone(),
        });
        WebviewWindowBuilder::new(&app, "capture", WebviewUrl::App("index.html?view=capture".into()))
            .title("Daybook capture")
            .fullscreen(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .build()
            .map_err(other)?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => Ok(()),
        Err(AppError::Cancelled) => {
            restore_all(&app);
            Ok(())
        }
        Err(e) => {
            restore_all(&app);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn capture_info(state: State<CaptureState>) -> AppResult<CaptureInfo> {
    let guard = state.pending.lock().unwrap_or_else(|e| e.into_inner());
    let p = guard.as_ref().ok_or(AppError::NotFound)?;
    Ok(CaptureInfo {
        width: p.width,
        height: p.height,
        mode: p.mode.clone(),
        src: p.path.to_string_lossy().to_string(),
    })
}

fn discard_pending(state: &CaptureState) -> Option<Pending> {
    let p = state.pending.lock().unwrap_or_else(|e| e.into_inner()).take();
    p
}

#[tauri::command]
pub async fn finish_capture(app: AppHandle, state: State<'_, CaptureState>, req: FinishReq) -> AppResult<()> {
    let pending = discard_pending(&state).ok_or(AppError::NotFound)?;
    let mut path = pending.path.clone();
    let delayed = req.delay > 0;
    if delayed {
        close_window(&app, "capture");
        tokio::time::sleep(Duration::from_millis(400 + req.delay as u64 * 1000)).await;
        match grab(false).await {
            Ok(p) => {
                let _ = std::fs::remove_file(&path);
                path = p;
            }
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                restore_all(&app);
                return Err(e);
            }
        }
    }
    let result = async {
        let img = load(&path)?;
        let (iw, ih) = (img.width(), img.height());
        let img = match (&req.rect, req.mode.as_str()) {
            (Some(r), "area") => {
                let rect = shots::clamp_rect(r.x, r.y, r.w, r.h, iw, ih)
                    .ok_or_else(|| AppError::Invalid("Select a larger area".into()))?;
                shots::crop(&img, rect)
            }
            _ => img,
        };
        complete(&app, img, &req.mode, req.ocr, req.edit).await
    }
    .await;
    let _ = std::fs::remove_file(&path);
    close_window(&app, "capture");
    result.map(|_| ())
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle, state: State<CaptureState>) {
    if let Some(p) = discard_pending(&state) {
        let _ = std::fs::remove_file(&p.path);
    }
    close_window(&app, "capture");
    restore_all(&app);
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
pub async fn switch_to_window_capture(app: AppHandle, state: State<'_, CaptureState>) -> AppResult<()> {
    if let Some(p) = discard_pending(&state) {
        let _ = std::fs::remove_file(&p.path);
    }
    close_window(&app, "capture");
    restore_all(&app);
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = h.state::<CaptureState>();
        let _ = start_capture(h.clone(), state, "window".to_string()).await;
    });
    Ok(())
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
