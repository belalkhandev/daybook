use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{changed, new_id, now_iso, Db};
use crate::error::{AppError, AppResult};

#[derive(Serialize, Clone, Debug)]
pub struct Comment {
    pub id: String,
    pub task_id: String,
    pub body_md: String,
    pub created_at: String,
    pub updated_at: String,
}

fn map(r: &rusqlite::Row) -> rusqlite::Result<Comment> {
    Ok(Comment {
        id: r.get(0)?,
        task_id: r.get(1)?,
        body_md: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

pub fn list(conn: &Connection, task_id: &str) -> AppResult<Vec<Comment>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, body_md, created_at, updated_at FROM comments WHERE task_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([task_id], map)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn get(conn: &Connection, id: &str) -> AppResult<Comment> {
    conn.query_row(
        "SELECT id, task_id, body_md, created_at, updated_at FROM comments WHERE id = ?1",
        [id],
        map,
    )
    .map_err(|_| AppError::NotFound)
}

pub fn add(conn: &Connection, task_id: &str, body: &str) -> AppResult<Comment> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Invalid("Comment is empty".into()));
    }
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO comments (id, task_id, body_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, task_id, body, now],
    )?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, body: &str) -> AppResult<Comment> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::Invalid("Comment is empty".into()));
    }
    let n = conn.execute(
        "UPDATE comments SET body_md = ?1, updated_at = ?2 WHERE id = ?3",
        params![body, now_iso(), id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

#[tauri::command]
pub fn list_comments(db: State<Db>, task_id: String) -> AppResult<Vec<Comment>> {
    list(&db.conn(), &task_id)
}

#[tauri::command]
pub fn add_comment(app: AppHandle, db: State<Db>, task_id: String, body_md: String) -> AppResult<Comment> {
    let c = add(&db.conn(), &task_id, &body_md)?;
    changed(&app, "comments");
    Ok(c)
}

#[tauri::command]
pub fn update_comment(app: AppHandle, db: State<Db>, id: String, body_md: String) -> AppResult<Comment> {
    let c = update(&db.conn(), &id, &body_md)?;
    changed(&app, "comments");
    Ok(c)
}

#[tauri::command]
pub fn delete_comment(app: AppHandle, db: State<Db>, id: String) -> AppResult<()> {
    db.conn().execute("DELETE FROM comments WHERE id = ?1", [&id])?;
    changed(&app, "comments");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{create, TaskInput};

    #[test]
    fn comment_lifecycle_and_cascade() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let t = create(&conn, TaskInput { title: "T".into(), ..Default::default() }).unwrap();
        let c = add(&conn, &t.id, "  hello **world**  ").unwrap();
        assert_eq!(c.body_md, "hello **world**");
        let c = update(&conn, &c.id, "edited").unwrap();
        assert_eq!(c.body_md, "edited");
        assert_eq!(list(&conn, &t.id).unwrap().len(), 1);
        assert!(add(&conn, &t.id, " ").is_err());
        conn.execute("DELETE FROM tasks WHERE id = ?1", [&t.id]).unwrap();
        assert_eq!(list(&conn, &t.id).unwrap().len(), 0);
    }
}
