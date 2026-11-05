use std::path::{Path, PathBuf};

use chrono::Local;
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat};
use rusqlite::{params, Connection};
use serde::{Deserialize, Deserializer, Serialize};
use tauri::{AppHandle, State};

use crate::db::{changed, new_id, now_iso, Db};
use crate::error::{AppError, AppResult};
use crate::tasks;

#[derive(Serialize, Clone, Debug)]
pub struct ShotLink {
    pub id: String,
    pub label: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Shot {
    pub id: String,
    pub title: String,
    pub file: String,
    pub thumb: String,
    pub taken_at: String,
    pub app: String,
    pub tag: Option<String>,
    pub width: i64,
    pub height: i64,
    pub bytes: i64,
    pub ocr_text: String,
    pub task: Option<ShotLink>,
    pub note: Option<ShotLink>,
}

#[derive(Clone, Debug)]
pub struct ShotDirs {
    pub pictures: PathBuf,
    pub thumbs: PathBuf,
}

impl ShotDirs {
    pub fn standard() -> Self {
        let pictures = dirs::picture_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Pictures")))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Daybook");
        let thumbs = crate::db::data_dir().join("thumbs");
        ShotDirs { pictures, thumbs }
    }

    pub fn ensure(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.pictures).map_err(io)?;
        std::fs::create_dir_all(&self.thumbs).map_err(io)?;
        Ok(())
    }
}

fn io(e: std::io::Error) -> AppError {
    AppError::Other(e.to_string())
}

fn img_err(e: image::ImageError) -> AppError {
    AppError::Other(format!("Image error: {e}"))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

pub fn clamp_rect(x: f64, y: f64, w: f64, h: f64, iw: u32, ih: u32) -> Option<Rect> {
    let x0 = x.max(0.0).min(iw as f64);
    let y0 = y.max(0.0).min(ih as f64);
    let x1 = (x + w).max(0.0).min(iw as f64);
    let y1 = (y + h).max(0.0).min(ih as f64);
    let (rx, ry) = (x0.round() as u32, y0.round() as u32);
    let (rw, rh) = ((x1 - x0).round() as u32, (y1 - y0).round() as u32);
    if rw < 2 || rh < 2 {
        None
    } else {
        Some(Rect { x: rx, y: ry, w: rw, h: rh })
    }
}

pub fn crop(img: &DynamicImage, r: Rect) -> DynamicImage {
    img.crop_imm(r.x, r.y, r.w, r.h)
}

pub fn write_png(img: &DynamicImage, path: &Path) -> AppResult<i64> {
    img.save_with_format(path, ImageFormat::Png).map_err(img_err)?;
    Ok(std::fs::metadata(path).map_err(io)?.len() as i64)
}

pub fn write_thumb(img: &DynamicImage, path: &Path) -> AppResult<()> {
    let (w, h) = img.dimensions();
    let t = if w > 480 || h > 480 {
        img.resize(480, 480, FilterType::Triangle)
    } else {
        img.clone()
    };
    t.save_with_format(path, ImageFormat::Png).map_err(img_err)
}

pub fn default_title(ocr: &str, now: chrono::DateTime<Local>) -> String {
    for line in ocr.lines() {
        let l = line.trim();
        if l.chars().filter(|c| c.is_alphanumeric()).count() >= 4 {
            return l.chars().take(60).collect();
        }
    }
    format!("Screenshot {}", now.format("%Y-%m-%d %H:%M"))
}

pub struct NewShot {
    pub app: String,
    pub ocr: String,
    pub title: Option<String>,
    pub tag: Option<String>,
    pub task_id: Option<String>,
    pub note_id: Option<String>,
}

fn unique_name(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.png"));
    if !first.exists() {
        return first;
    }
    dir.join(format!("{stem} {}.png", &new_id()[24..]))
}

const COLS: &str =
    "id, title, file, thumb, taken_at, app, tag, width, height, bytes, ocr_text, task_id, note_id";

fn row(r: &rusqlite::Row) -> rusqlite::Result<(Shot, Option<String>, Option<String>)> {
    Ok((
        Shot {
            id: r.get(0)?,
            title: r.get(1)?,
            file: r.get(2)?,
            thumb: r.get(3)?,
            taken_at: r.get(4)?,
            app: r.get(5)?,
            tag: r.get(6)?,
            width: r.get(7)?,
            height: r.get(8)?,
            bytes: r.get(9)?,
            ocr_text: r.get(10)?,
            task: None,
            note: None,
        },
        r.get(11)?,
        r.get(12)?,
    ))
}

fn with_links(conn: &Connection, parts: (Shot, Option<String>, Option<String>)) -> Shot {
    let (mut s, task_id, note_id) = parts;
    if let Some(id) = task_id {
        if let Ok(t) = tasks::get(conn, &id) {
            s.task = Some(ShotLink {
                id,
                label: format!("TASK-{} \u{b7} {}", t.seq, t.title),
            });
        }
    }
    if let Some(id) = note_id {
        if let Ok(n) = crate::notes::get(conn, &id) {
            s.note = Some(ShotLink { id, label: n.title });
        }
    }
    s
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Shot> {
    let parts = conn
        .query_row(&format!("SELECT {COLS} FROM shots WHERE id = ?1"), [id], row)
        .map_err(|_| AppError::NotFound)?;
    Ok(with_links(conn, parts))
}

pub fn list(conn: &Connection, query: &str) -> AppResult<Vec<Shot>> {
    let q = query.trim();
    let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let mut sql = format!("SELECT {COLS} FROM shots");
    if !q.is_empty() {
        sql.push_str(
            " WHERE title LIKE ?1 ESCAPE '\\' OR ocr_text LIKE ?1 ESCAPE '\\' OR app LIKE ?1 ESCAPE '\\' OR tag LIKE ?1 ESCAPE '\\'",
        );
    }
    sql.push_str(" ORDER BY taken_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = if q.is_empty() {
        stmt.query_map([], row)?.collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([&like], row)?.collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows.into_iter().map(|p| with_links(conn, p)).collect())
}

pub fn create(conn: &Connection, dirs: &ShotDirs, img: &DynamicImage, meta: NewShot) -> AppResult<Shot> {
    dirs.ensure()?;
    let now = Local::now();
    let title = meta
        .title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| default_title(&meta.ocr, now));
    let id = new_id();
    let file = unique_name(&dirs.pictures, &format!("Daybook {}", now.format("%Y-%m-%d %H.%M.%S")));
    let bytes = write_png(img, &file)?;
    let thumb = dirs.thumbs.join(format!("{id}.png"));
    write_thumb(img, &thumb)?;
    let (w, h) = img.dimensions();
    let stamp = now_iso();
    conn.execute(
        "INSERT INTO shots (id, title, file, thumb, taken_at, app, tag, width, height, bytes, ocr_text, task_id, note_id, \
         created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?5, ?5)",
        params![
            id,
            title,
            file.to_string_lossy(),
            thumb.to_string_lossy(),
            stamp,
            meta.app,
            meta.tag,
            w,
            h,
            bytes,
            meta.ocr,
            meta.task_id,
            meta.note_id
        ],
    )?;
    get(conn, &id)
}

pub fn replace_image(conn: &Connection, id: &str, png: &[u8]) -> AppResult<Shot> {
    let shot = get(conn, id)?;
    let img = image::load_from_memory(png).map_err(img_err)?;
    let bytes = write_png(&img, Path::new(&shot.file))?;
    write_thumb(&img, Path::new(&shot.thumb))?;
    let (w, h) = img.dimensions();
    conn.execute(
        "UPDATE shots SET width = ?1, height = ?2, bytes = ?3, updated_at = ?4 WHERE id = ?5",
        params![w, h, bytes, now_iso(), id],
    )?;
    get(conn, id)
}

pub fn save_copy(conn: &Connection, dirs: &ShotDirs, id: &str, png: &[u8]) -> AppResult<Shot> {
    let src = get(conn, id)?;
    let img = image::load_from_memory(png).map_err(img_err)?;
    create(
        conn,
        dirs,
        &img,
        NewShot {
            app: src.app,
            ocr: src.ocr_text,
            title: Some(format!("{} copy", src.title)),
            tag: src.tag,
            task_id: src.task.map(|t| t.id),
            note_id: src.note.map(|n| n.id),
        },
    )
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    let shot = get(conn, id)?;
    let _ = std::fs::remove_file(&shot.file);
    let _ = std::fs::remove_file(&shot.thumb);
    conn.execute("DELETE FROM shots WHERE id = ?1", [id])?;
    Ok(())
}

fn double_option<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Deserialize, Default, Debug)]
pub struct ShotPatch {
    pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub tag: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub task_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub note_id: Option<Option<String>>,
}

pub fn update(conn: &Connection, id: &str, patch: ShotPatch) -> AppResult<Shot> {
    let cur = get(conn, id)?;
    let title = match patch.title {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        Some(_) => return Err(AppError::Invalid("Title is empty".into())),
        None => cur.title,
    };
    let tag = match patch.tag {
        Some(t) => t.and_then(|t| crate::tasks::normalize_tag(&t)),
        None => cur.tag,
    };
    let mut task_id = cur.task.map(|t| t.id);
    let mut note_id = cur.note.map(|n| n.id);
    if let Some(t) = patch.task_id {
        task_id = t;
        if task_id.is_some() {
            note_id = None;
        }
    }
    if let Some(n) = patch.note_id {
        note_id = n;
        if note_id.is_some() {
            task_id = None;
        }
    }
    conn.execute(
        "UPDATE shots SET title = ?1, tag = ?2, task_id = ?3, note_id = ?4, updated_at = ?5 WHERE id = ?6",
        params![title, tag, task_id, note_id, now_iso(), id],
    )?;
    get(conn, id)
}

#[tauri::command]
pub fn list_shots(db: State<Db>, query: String) -> AppResult<Vec<Shot>> {
    list(&db.conn(), &query)
}

#[tauri::command]
pub fn get_shot(db: State<Db>, id: String) -> AppResult<Shot> {
    get(&db.conn(), &id)
}

#[tauri::command]
pub fn update_shot(app: AppHandle, db: State<Db>, id: String, patch: ShotPatch) -> AppResult<Shot> {
    let s = update(&db.conn(), &id, patch)?;
    changed(&app, "shots");
    Ok(s)
}

#[tauri::command]
pub fn delete_shot(app: AppHandle, db: State<Db>, id: String) -> AppResult<()> {
    remove(&db.conn(), &id)?;
    changed(&app, "shots");
    Ok(())
}

#[tauri::command]
pub fn read_shot_bytes(db: State<Db>, id: String) -> AppResult<tauri::ipc::Response> {
    let shot = get(&db.conn(), &id)?;
    let bytes = std::fs::read(&shot.file).map_err(io)?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn header(req: &tauri::ipc::Request, name: &str) -> Option<String> {
    req.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

fn body(req: &tauri::ipc::Request) -> AppResult<Vec<u8>> {
    match req.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err(AppError::Invalid("Expected image data".into())),
    }
}

#[tauri::command]
pub fn save_shot_image(app: AppHandle, db: State<Db>, request: tauri::ipc::Request) -> AppResult<Shot> {
    let id = header(&request, "x-shot-id").ok_or_else(|| AppError::Invalid("Missing shot id".into()))?;
    let as_copy = header(&request, "x-as-copy").as_deref() == Some("1");
    let png = body(&request)?;
    let dirs = ShotDirs::standard();
    let s = if as_copy {
        save_copy(&db.conn(), &dirs, &id, &png)?
    } else {
        replace_image(&db.conn(), &id, &png)?
    };
    changed(&app, "shots");
    Ok(s)
}

#[tauri::command]
pub fn reveal_shot(db: State<Db>, id: String) -> AppResult<()> {
    let shot = get(&db.conn(), &id)?;
    tauri_plugin_opener::reveal_item_in_dir(&shot.file).map_err(|e| AppError::Other(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use image::{ImageBuffer, Rgba};

    fn dirs(tag: &str) -> ShotDirs {
        let base = std::env::temp_dir().join(format!("daybook-test-{}-{}", tag, new_id()));
        ShotDirs {
            pictures: base.join("pics"),
            thumbs: base.join("thumbs"),
        }
    }

    fn sample(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_fn(w, h, |x, y| Rgba([(x % 255) as u8, (y % 255) as u8, 120, 255])))
    }

    fn meta(ocr: &str) -> NewShot {
        NewShot {
            app: "Screen".into(),
            ocr: ocr.into(),
            title: None,
            tag: None,
            task_id: None,
            note_id: None,
        }
    }

    #[test]
    fn rect_is_clamped_to_image() {
        assert_eq!(clamp_rect(-10.0, -10.0, 110.0, 60.0, 100, 50), Some(Rect { x: 0, y: 0, w: 100, h: 50 }));
        assert_eq!(clamp_rect(90.0, 40.0, 50.0, 50.0, 100, 50), Some(Rect { x: 90, y: 40, w: 10, h: 10 }));
        assert_eq!(clamp_rect(200.0, 10.0, 5.0, 5.0, 100, 50), None);
        assert_eq!(clamp_rect(10.0, 10.0, 1.0, 40.0, 100, 50), None);
    }

    #[test]
    fn crop_produces_requested_size() {
        let img = sample(200, 120);
        let c = crop(&img, Rect { x: 10, y: 20, w: 80, h: 50 });
        assert_eq!(c.dimensions(), (80, 50));
    }

    #[test]
    fn title_comes_from_ocr_or_timestamp() {
        let now = Local::now();
        assert_eq!(default_title("\n  \nSync bug in store.rs\nmore", now), "Sync bug in store.rs");
        assert!(default_title("-- \n{}", now).starts_with("Screenshot "));
        assert_eq!(default_title(&"x".repeat(200), now).chars().count(), 60);
    }

    #[test]
    fn create_list_search_update_delete() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let d = dirs("crud");
        let a = create(&conn, &d, &sample(640, 400), meta("Sync bug in store.rs")).unwrap();
        let b = create(&conn, &d, &sample(300, 200), meta("")).unwrap();
        assert_eq!((a.width, a.height), (640, 400));
        assert!(Path::new(&a.file).exists() && Path::new(&a.thumb).exists());
        assert!(a.bytes > 0);
        let thumb = image::open(&a.thumb).unwrap();
        assert!(thumb.width() <= 480 && thumb.height() <= 480);
        assert_eq!(list(&conn, "").unwrap().len(), 2);
        assert_eq!(list(&conn, "store.rs").unwrap().len(), 1);
        assert_eq!(list(&conn, "100%").unwrap().len(), 0);
        assert_eq!(list(&conn, "screen").unwrap().len(), 2);

        let u = update(&conn, &a.id, ShotPatch { tag: Some(Some("#Bug".into())), ..Default::default() }).unwrap();
        assert_eq!(u.tag.as_deref(), Some("bug"));
        let u = update(&conn, &a.id, ShotPatch { tag: Some(None), ..Default::default() }).unwrap();
        assert_eq!(u.tag, None);
        assert!(update(&conn, &a.id, ShotPatch { title: Some("  ".into()), ..Default::default() }).is_err());

        remove(&conn, &b.id).unwrap();
        assert!(!Path::new(&b.file).exists());
        assert!(get(&conn, &b.id).is_err());
        let _ = std::fs::remove_dir_all(d.pictures.parent().unwrap());
    }

    #[test]
    fn attach_to_task_clears_note_and_links_have_labels() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let d = dirs("attach");
        let s = create(&conn, &d, &sample(100, 80), meta("")).unwrap();
        let t = tasks::create(&conn, tasks::TaskInput { title: "Fix keyring".into(), ..Default::default() }).unwrap();
        let n = crate::notes::create(&conn, crate::notes::NoteInput { title: "Ideas".into(), ..Default::default() }).unwrap();
        let s = update(&conn, &s.id, ShotPatch { note_id: Some(Some(n.id.clone())), ..Default::default() }).unwrap();
        assert_eq!(s.note.as_ref().map(|x| x.label.as_str()), Some("Ideas"));
        let s = update(&conn, &s.id, ShotPatch { task_id: Some(Some(t.id.clone())), ..Default::default() }).unwrap();
        assert!(s.note.is_none());
        assert_eq!(s.task.as_ref().map(|x| x.label.as_str()), Some("TASK-1 \u{b7} Fix keyring"));
        conn.execute("DELETE FROM tasks WHERE id = ?1", [&t.id]).unwrap();
        assert!(get(&conn, &s.id).unwrap().task.is_none());
        let _ = std::fs::remove_dir_all(d.pictures.parent().unwrap());
    }

    #[test]
    fn replace_and_save_copy() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let d = dirs("replace");
        let s = create(&conn, &d, &sample(400, 300), meta("hello world")).unwrap();
        let mut png = Vec::new();
        sample(120, 90).write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png).unwrap();
        let r = replace_image(&conn, &s.id, &png).unwrap();
        assert_eq!((r.width, r.height), (120, 90));
        assert_eq!(image::open(&r.file).unwrap().dimensions(), (120, 90));
        let c = save_copy(&conn, &d, &s.id, &png).unwrap();
        assert_ne!(c.id, s.id);
        assert_ne!(c.file, s.file);
        assert!(c.title.ends_with(" copy"));
        assert_eq!(c.ocr_text, "hello world");
        assert_eq!(list(&conn, "").unwrap().len(), 2);
        assert!(replace_image(&conn, &s.id, b"not an image").is_err());
        let _ = std::fs::remove_dir_all(d.pictures.parent().unwrap());
    }
}
