use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

const SCHEMA: &str = "
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('todo','progress','done')) DEFAULT 'todo',
  priority TEXT NOT NULL CHECK (priority IN ('low','med','high')) DEFAULT 'med',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  due_at TEXT,
  remind_before_min INTEGER,
  target_minutes INTEGER,
  tracked_seconds INTEGER NOT NULL DEFAULT 0,
  timer_started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  body_md TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL CHECK (folder IN ('work','personal','ideas')) DEFAULT 'personal',
  color TEXT NOT NULL DEFAULT 'violet',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE INDEX idx_tasks_due ON tasks(due_at);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
";

const SHOTS: &str = "
CREATE TABLE shots (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  app TEXT NOT NULL DEFAULT 'Desktop',
  tag TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  ocr_text TEXT NOT NULL DEFAULT '',
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_shots_taken ON shots(taken_at DESC);
";

const DEFAULT_PROJECTS: [(&str, &str); 4] = [
    ("Trove App", "#6366F1"),
    ("Client work", "#F59E0B"),
    ("Website", "#EC4899"),
    ("Personal", "#10B981"),
];

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn open() -> AppResult<Self> {
        let dir = data_dir();
        let moved = migrate_legacy(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| AppError::Other(e.to_string()))?;
        let db = Self::init(Connection::open(dir.join("trove.db"))?)?;
        if let Some((old_pictures, new_pictures)) = moved {
            db.conn().execute(
                "UPDATE shots SET file = replace(file, ?1, ?2), thumb = replace(thumb, ?3, ?4)",
                params![
                    old_pictures,
                    new_pictures,
                    dir.with_file_name("daybook").to_string_lossy().to_string(),
                    dir.to_string_lossy().to_string()
                ],
            )?;
        }
        Ok(db)
    }

    #[cfg(test)]
    pub fn memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> AppResult<Self> {
        conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0))?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        Migrations::new(vec![M::up(SCHEMA), M::up(SHOTS)])
            .to_latest(&mut conn)
            .map_err(|e| AppError::Other(e.to_string()))?;
        seed(&conn)?;
        Ok(Db(Mutex::new(conn)))
    }
}

fn seed(conn: &Connection) -> AppResult<()> {
    let seeded: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = 'seeded'", [], |r| r.get(0))
        .ok();
    if seeded.is_some() {
        return Ok(());
    }
    let now = now_iso();
    for (i, (name, color)) in DEFAULT_PROJECTS.iter().enumerate() {
        conn.execute(
            "INSERT OR IGNORE INTO projects (id, name, color, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![new_id(), name, color, i as i64, now],
        )?;
    }
    conn.execute("INSERT INTO settings (key, value) VALUES ('seeded', '1')", [])?;
    Ok(())
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trove")
}

fn migrate_legacy(dir: &std::path::Path) -> Option<(String, String)> {
    let old = dir.with_file_name("daybook");
    if dir.exists() || !old.exists() {
        return None;
    }
    std::fs::rename(&old, dir).ok()?;
    for suffix in ["", "-wal", "-shm"] {
        let from = dir.join(format!("daybook.db{suffix}"));
        if from.exists() {
            let _ = std::fs::rename(&from, dir.join(format!("trove.db{suffix}")));
        }
    }
    let pictures = dirs::picture_dir().or_else(|| dirs::home_dir().map(|h| h.join("Pictures")))?;
    let old_pictures = pictures.join("Daybook");
    let new_pictures = pictures.join("Trove");
    if old_pictures.exists() && !new_pictures.exists() {
        std::fs::rename(&old_pictures, &new_pictures).ok()?;
    }
    Some((old_pictures.to_string_lossy().to_string(), new_pictures.to_string_lossy().to_string()))
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn now_iso() -> String {
    to_iso(Utc::now())
}

pub fn to_iso(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

pub fn local_to_utc(naive: NaiveDateTime) -> DateTime<Utc> {
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&naive).latest())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|| Utc.from_utc_datetime(&naive))
}

pub fn utc_to_local(s: &str) -> Option<NaiveDateTime> {
    parse_iso(s).map(|d| d.with_timezone(&Local).naive_local())
}

pub fn parse_day(day: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(day, "%Y-%m-%d").map_err(|_| AppError::Invalid("Invalid date".into()))
}

pub fn day_bounds(day: NaiveDate) -> (String, String) {
    let start = local_to_utc(day.and_hms_opt(0, 0, 0).unwrap());
    let end = local_to_utc(day.succ_opt().unwrap_or(day).and_hms_opt(0, 0, 0).unwrap());
    (to_iso(start), to_iso(end))
}

pub fn changed(app: &AppHandle, kind: &str) {
    let _ = app.emit("data-changed", kind);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_seeds_four_projects_once() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 4);
        seed(&conn).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 4);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn local_utc_round_trip() {
        let naive = NaiveDate::from_ymd_opt(2026, 10, 29).unwrap().and_hms_opt(16, 0, 0).unwrap();
        let iso = to_iso(local_to_utc(naive));
        assert_eq!(utc_to_local(&iso).unwrap(), naive);
    }
}
