use chrono::Utc;
use rusqlite::{params, Connection};
use tauri::{AppHandle, State};

use crate::db::{changed, now_iso, parse_iso, Db};
use crate::error::AppResult;
use crate::tasks::{get, Task};

pub fn pause_one(conn: &Connection, task: &Task) -> AppResult<()> {
    if let Some(started) = task.timer_started_at.as_deref().and_then(parse_iso) {
        let elapsed = (Utc::now() - started).num_seconds().max(0);
        conn.execute(
            "UPDATE tasks SET tracked_seconds = tracked_seconds + ?1, timer_started_at = NULL, updated_at = ?2 WHERE id = ?3",
            params![elapsed, now_iso(), task.id],
        )?;
    }
    Ok(())
}

fn pause_all_except(conn: &Connection, keep: &str) -> AppResult<()> {
    let ids: Vec<String> = {
        let mut stmt =
            conn.prepare("SELECT id FROM tasks WHERE timer_started_at IS NOT NULL AND id != ?1")?;
        let rows = stmt.query_map([keep], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for id in ids {
        let t = get(conn, &id)?;
        pause_one(conn, &t)?;
    }
    Ok(())
}

pub fn start(conn: &Connection, id: &str) -> AppResult<Task> {
    let t = get(conn, id)?;
    pause_all_except(conn, id)?;
    if t.timer_started_at.is_none() {
        let status = if t.status == "todo" { "progress" } else { t.status.as_str() };
        conn.execute(
            "UPDATE tasks SET timer_started_at = ?1, status = ?2, updated_at = ?1 WHERE id = ?3",
            params![now_iso(), status, id],
        )?;
    }
    get(conn, id)
}

pub fn pause(conn: &Connection, id: &str) -> AppResult<Task> {
    let t = get(conn, id)?;
    pause_one(conn, &t)?;
    get(conn, id)
}

pub fn reset(conn: &Connection, id: &str) -> AppResult<Task> {
    get(conn, id)?;
    conn.execute(
        "UPDATE tasks SET tracked_seconds = 0, timer_started_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![now_iso(), id],
    )?;
    get(conn, id)
}

#[tauri::command]
pub fn timer_start(app: AppHandle, db: State<Db>, id: String) -> AppResult<Task> {
    let t = start(&db.conn(), &id)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn timer_pause(app: AppHandle, db: State<Db>, id: String) -> AppResult<Task> {
    let t = pause(&db.conn(), &id)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn timer_reset(app: AppHandle, db: State<Db>, id: String) -> AppResult<Task> {
    let t = reset(&db.conn(), &id)?;
    changed(&app, "tasks");
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{create, TaskInput};

    fn make(conn: &Connection, title: &str) -> Task {
        create(
            conn,
            TaskInput {
                title: title.into(),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn only_one_timer_runs_at_a_time() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let a = make(&conn, "A");
        let b = make(&conn, "B");
        start(&conn, &a.id).unwrap();
        start(&conn, &b.id).unwrap();
        assert!(get(&conn, &a.id).unwrap().timer_started_at.is_none());
        assert!(get(&conn, &b.id).unwrap().timer_started_at.is_some());
        assert_eq!(get(&conn, &b.id).unwrap().status, "progress");
    }

    #[test]
    fn pause_accumulates_and_reset_clears() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let a = make(&conn, "A");
        let past = crate::db::to_iso(Utc::now() - chrono::Duration::seconds(90));
        conn.execute("UPDATE tasks SET timer_started_at = ?1 WHERE id = ?2", params![past, a.id])
            .unwrap();
        let t = pause(&conn, &a.id).unwrap();
        assert!(t.tracked_seconds >= 90 && t.tracked_seconds < 95);
        assert!(t.timer_started_at.is_none());
        let t = reset(&conn, &a.id).unwrap();
        assert_eq!(t.tracked_seconds, 0);
    }
}
