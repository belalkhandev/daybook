use std::{collections::HashSet, time::Duration};

use chrono::Utc;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{parse_iso, Db};

struct Due {
    id: String,
    title: String,
    due_at: String,
}

fn pending(conn: &rusqlite::Connection) -> Vec<(Due, i64)> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, due_at, remind_before_min FROM tasks \
         WHERE status != 'done' AND due_at IS NOT NULL AND remind_before_min IS NOT NULL",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            Due {
                id: r.get(0)?,
                title: r.get(1)?,
                due_at: r.get(2)?,
            },
            r.get::<_, i64>(3)?,
        ))
    }) else {
        return Vec::new();
    };
    rows.filter_map(Result::ok).collect()
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut sent: HashSet<(String, String)> = HashSet::new();
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let now = Utc::now();
            let items = {
                let db = app.state::<Db>();
                let conn = db.conn();
                pending(&conn)
            };
            for (task, before) in items {
                let Some(due) = parse_iso(&task.due_at) else { continue };
                let remind_at = due - chrono::Duration::minutes(before);
                let key = (task.id.clone(), task.due_at.clone());
                if now >= remind_at && now <= due && !sent.contains(&key) {
                    sent.insert(key);
                    let body = if before > 0 {
                        format!("Due in {before} minutes")
                    } else {
                        "Due now".to_string()
                    };
                    let _ = app.notification().builder().title(&task.title).body(&body).show();
                }
            }
        }
    });
}
