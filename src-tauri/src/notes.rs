use chrono::Local;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::db::{changed, local_to_utc, new_id, now_iso, to_iso, Db};
use crate::error::{AppError, AppResult};
use crate::tasks::{self, Task, TaskInput};

#[derive(Serialize, Clone, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body_md: String,
    pub folder: String,
    pub color: String,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Default, Debug)]
pub struct NoteInput {
    pub title: String,
    #[serde(default)]
    pub body_md: String,
    pub folder: Option<String>,
    pub color: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Deserialize, Default, Debug)]
pub struct NotePatch {
    pub title: Option<String>,
    pub body_md: Option<String>,
    pub folder: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteCounts {
    pub all: i64,
    pub pinned: i64,
    pub work: i64,
    pub personal: i64,
    pub ideas: i64,
}

const COLORS: [&str; 6] = ["violet", "mint", "peach", "sky", "rose", "yellow"];
const COLS: &str = "id, title, body_md, folder, color, pinned, created_at, updated_at";

fn map(r: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        body_md: r.get(2)?,
        folder: r.get(3)?,
        color: r.get(4)?,
        pinned: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn check_folder(f: &str) -> AppResult<()> {
    match f {
        "work" | "personal" | "ideas" => Ok(()),
        _ => Err(AppError::Invalid("Invalid folder".into())),
    }
}

fn check_color(c: &str) -> AppResult<()> {
    if COLORS.contains(&c) {
        Ok(())
    } else {
        Err(AppError::Invalid("Invalid color".into()))
    }
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Note> {
    conn.query_row(&format!("SELECT {COLS} FROM notes WHERE id = ?1"), [id], map)
        .map_err(|_| AppError::NotFound)
}

pub fn list(conn: &Connection, filter: &str, query: &str) -> AppResult<Vec<Note>> {
    let mut sql = format!("SELECT {COLS} FROM notes WHERE 1 = 1");
    match filter {
        "all" | "" => {}
        "pinned" => sql.push_str(" AND pinned = 1"),
        f => {
            check_folder(f)?;
            sql.push_str(&format!(" AND folder = '{f}'"));
        }
    }
    let q = query.trim();
    let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    if !q.is_empty() {
        sql.push_str(" AND (title LIKE ?1 ESCAPE '\\' OR body_md LIKE ?1 ESCAPE '\\')");
    }
    sql.push_str(" ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = if q.is_empty() {
        stmt.query_map([], map)?.collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map([&like], map)?.collect::<Result<Vec<_>, _>>()?
    };
    Ok(rows)
}

pub fn counts(conn: &Connection) -> AppResult<NoteCounts> {
    let n = |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(NoteCounts {
        all: n("SELECT COUNT(*) FROM notes")?,
        pinned: n("SELECT COUNT(*) FROM notes WHERE pinned = 1")?,
        work: n("SELECT COUNT(*) FROM notes WHERE folder = 'work'")?,
        personal: n("SELECT COUNT(*) FROM notes WHERE folder = 'personal'")?,
        ideas: n("SELECT COUNT(*) FROM notes WHERE folder = 'ideas'")?,
    })
}

pub fn create(conn: &Connection, input: NoteInput) -> AppResult<Note> {
    let title = input.title.trim().to_string();
    let title = if title.is_empty() { "Untitled".to_string() } else { title };
    let folder = input.folder.unwrap_or_else(|| "personal".into());
    let color = input.color.unwrap_or_else(|| "violet".into());
    check_folder(&folder)?;
    check_color(&color)?;
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO notes (id, title, body_md, folder, color, pinned, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, title, input.body_md, folder, color, input.pinned as i64, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: NotePatch) -> AppResult<Note> {
    let mut n = get(conn, id)?;
    let mut edited = false;
    if let Some(t) = patch.title {
        let t = t.trim().to_string();
        n.title = if t.is_empty() { "Untitled".into() } else { t };
        edited = true;
    }
    if let Some(b) = patch.body_md {
        n.body_md = b;
        edited = true;
    }
    if let Some(f) = patch.folder {
        check_folder(&f)?;
        n.folder = f;
        edited = true;
    }
    if let Some(c) = patch.color {
        check_color(&c)?;
        n.color = c;
        edited = true;
    }
    if let Some(p) = patch.pinned {
        n.pinned = p;
    }
    let updated = if edited { now_iso() } else { n.updated_at.clone() };
    conn.execute(
        "UPDATE notes SET title = ?1, body_md = ?2, folder = ?3, color = ?4, pinned = ?5, updated_at = ?6 WHERE id = ?7",
        params![n.title, n.body_md, n.folder, n.color, n.pinned as i64, updated, id],
    )?;
    get(conn, id)
}

pub fn open_items(body: &str) -> Vec<String> {
    let re = Regex::new(r"^\s*[-*+]\s+\[ \]\s+(.+?)\s*$").unwrap();
    let mut in_fence = false;
    let mut out = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if let Some(c) = re.captures(line) {
            out.push(c[1].to_string());
        }
    }
    out
}

pub fn items_to_today(conn: &Connection, id: &str) -> AppResult<Vec<Task>> {
    let note = get(conn, id)?;
    let today = Local::now().date_naive().and_hms_opt(0, 0, 0).unwrap();
    let due = to_iso(local_to_utc(today));
    let mut created = Vec::new();
    for title in open_items(&note.body_md) {
        created.push(tasks::create(
            conn,
            TaskInput {
                title,
                due_at: Some(due.clone()),
                ..Default::default()
            },
        )?);
    }
    Ok(created)
}

#[tauri::command]
pub fn list_notes(db: State<Db>, filter: String, query: String) -> AppResult<Vec<Note>> {
    list(&db.conn(), &filter, &query)
}

#[tauri::command]
pub fn note_counts(db: State<Db>) -> AppResult<NoteCounts> {
    counts(&db.conn())
}

#[tauri::command]
pub fn get_note(db: State<Db>, id: String) -> AppResult<Note> {
    get(&db.conn(), &id)
}

#[tauri::command]
pub fn create_note(app: AppHandle, db: State<Db>, input: NoteInput) -> AppResult<Note> {
    let n = create(&db.conn(), input)?;
    changed(&app, "notes");
    Ok(n)
}

#[tauri::command]
pub fn update_note(app: AppHandle, db: State<Db>, id: String, patch: NotePatch) -> AppResult<Note> {
    let n = update(&db.conn(), &id, patch)?;
    changed(&app, "notes");
    Ok(n)
}

#[tauri::command]
pub fn delete_note(app: AppHandle, db: State<Db>, id: String) -> AppResult<()> {
    let n = db.conn().execute("DELETE FROM notes WHERE id = ?1", [&id])?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    changed(&app, "notes");
    Ok(())
}

#[tauri::command]
pub fn note_open_items_to_today(app: AppHandle, db: State<Db>, id: String) -> AppResult<Vec<Task>> {
    let created = items_to_today(&db.conn(), &id)?;
    changed(&app, "tasks");
    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(title: &str, body: &str, folder: &str, pinned: bool) -> NoteInput {
        NoteInput {
            title: title.into(),
            body_md: body.into(),
            folder: Some(folder.into()),
            color: None,
            pinned,
        }
    }

    #[test]
    fn filters_search_and_counts() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        create(&conn, note("Sprint ideas", "offline sync", "ideas", true)).unwrap();
        create(&conn, note("Groceries", "rice, eggs", "personal", true)).unwrap();
        create(&conn, note("Release", "bump version", "work", false)).unwrap();
        assert_eq!(list(&conn, "all", "").unwrap().len(), 3);
        assert_eq!(list(&conn, "pinned", "").unwrap().len(), 2);
        assert_eq!(list(&conn, "work", "").unwrap().len(), 1);
        assert_eq!(list(&conn, "all", "EGGS").unwrap().len(), 1);
        assert_eq!(list(&conn, "all", "100%").unwrap().len(), 0);
        assert!(list(&conn, "x'; DROP TABLE notes; --", "").is_err());
        let c = counts(&conn).unwrap();
        assert_eq!(c, NoteCounts { all: 3, pinned: 2, work: 1, personal: 1, ideas: 1 });
    }

    #[test]
    fn pin_does_not_change_edited_time() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let n = create(&conn, note("A", "", "work", false)).unwrap();
        conn.execute("UPDATE notes SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?1", [&n.id]).unwrap();
        let p = update(&conn, &n.id, NotePatch { pinned: Some(true), ..Default::default() }).unwrap();
        assert!(p.pinned);
        assert_eq!(p.updated_at, "2020-01-01T00:00:00Z");
        let e = update(&conn, &n.id, NotePatch { body_md: Some("x".into()), ..Default::default() }).unwrap();
        assert_ne!(e.updated_at, "2020-01-01T00:00:00Z");
    }

    #[test]
    fn open_items_skip_done_and_code() {
        let body = "- [ ] one\n- [x] two\n  * [ ] three\n```\n- [ ] hidden\n```\n- [ ] four";
        assert_eq!(open_items(body), vec!["one", "three", "four"]);
    }

    #[test]
    fn items_become_tasks_due_today() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let n = create(&conn, note("List", "- [ ] a\n- [ ] b", "work", false)).unwrap();
        let tasks = items_to_today(&conn, &n.id).unwrap();
        assert_eq!(tasks.len(), 2);
        assert!(tasks[0].due_at.is_some());
    }
}
