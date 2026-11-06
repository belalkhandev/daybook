use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, Row, ToSql};
use serde::{Deserialize, Deserializer, Serialize};
use tauri::{AppHandle, State};

use crate::db::{
    changed, day_bounds, local_to_utc, new_id, now_iso, parse_day, parse_iso, to_iso, utc_to_local, Db,
};
use crate::error::{AppError, AppResult};

#[derive(Serialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct Task {
    pub id: String,
    pub seq: i64,
    pub title: String,
    pub description_md: String,
    pub status: String,
    pub priority: String,
    pub project_id: Option<String>,
    pub project: Option<Project>,
    pub due_at: Option<String>,
    pub remind_before_min: Option<i64>,
    pub target_minutes: Option<i64>,
    pub tracked_seconds: i64,
    pub timer_started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
}

#[derive(Deserialize, Default, Debug)]
pub struct TaskInput {
    pub title: String,
    #[serde(default)]
    pub description_md: String,
    pub priority: Option<String>,
    pub project_id: Option<String>,
    pub due_at: Option<String>,
    pub remind_before_min: Option<i64>,
    pub target_minutes: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn double_option<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Deserialize, Default, Debug)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub description_md: Option<String>,
    pub priority: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_at: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub remind_before_min: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub target_minutes: Option<Option<i64>>,
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct DayCount {
    pub day: String,
    pub count: i64,
}

const SELECT: &str = "SELECT t.id, t.seq, t.title, t.description_md, t.status, t.priority, t.project_id, t.due_at, \
    t.remind_before_min, t.target_minutes, t.tracked_seconds, t.timer_started_at, t.completed_at, t.created_at, \
    t.updated_at, p.name, p.color, p.sort FROM tasks t LEFT JOIN projects p ON p.id = t.project_id";

fn row_to_task(r: &Row) -> rusqlite::Result<Task> {
    let project_id: Option<String> = r.get(6)?;
    let name: Option<String> = r.get(15)?;
    let color: Option<String> = r.get(16)?;
    let sort: Option<i64> = r.get(17)?;
    let project = match (&project_id, name, color, sort) {
        (Some(id), Some(name), Some(color), Some(sort)) => Some(Project {
            id: id.clone(),
            name,
            color,
            sort,
        }),
        _ => None,
    };
    Ok(Task {
        id: r.get(0)?,
        seq: r.get(1)?,
        title: r.get(2)?,
        description_md: r.get(3)?,
        status: r.get(4)?,
        priority: r.get(5)?,
        project_id,
        project,
        due_at: r.get(7)?,
        remind_before_min: r.get(8)?,
        target_minutes: r.get(9)?,
        tracked_seconds: r.get(10)?,
        timer_started_at: r.get(11)?,
        completed_at: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
        tags: Vec::new(),
    })
}

fn task_tags(conn: &Connection, id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT g.name FROM tags g JOIN task_tags tt ON tt.tag_id = g.id WHERE tt.task_id = ?1 ORDER BY g.name",
    )?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn query(conn: &Connection, tail: &str, args: &[&dyn ToSql]) -> AppResult<Vec<Task>> {
    let mut stmt = conn.prepare(&format!("{SELECT} {tail}"))?;
    let mut tasks = stmt
        .query_map(args, row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;
    for t in tasks.iter_mut() {
        t.tags = task_tags(conn, &t.id)?;
    }
    Ok(tasks)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Task> {
    query(conn, "WHERE t.id = ?1", &[&id])?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)
}

pub fn normalize_tag(raw: &str) -> Option<String> {
    let t = raw.trim().trim_start_matches('#').trim().to_lowercase();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn set_tags(conn: &Connection, task_id: &str, tags: &[String]) -> AppResult<()> {
    conn.execute("DELETE FROM task_tags WHERE task_id = ?1", [task_id])?;
    for raw in tags {
        let Some(name) = normalize_tag(raw) else { continue };
        conn.execute(
            "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
            params![new_id(), name],
        )?;
        let tag_id: String = conn.query_row("SELECT id FROM tags WHERE name = ?1", [&name], |r| r.get(0))?;
        conn.execute(
            "INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task_id, tag_id],
        )?;
    }
    Ok(())
}

fn check_priority(p: &str) -> AppResult<()> {
    match p {
        "low" | "med" | "high" => Ok(()),
        _ => Err(AppError::Invalid("Invalid priority".into())),
    }
}

fn canon_due(d: Option<String>) -> AppResult<Option<String>> {
    match d {
        Some(s) => {
            let dt = parse_iso(&s).ok_or_else(|| AppError::Invalid("Invalid due date".into()))?;
            Ok(Some(to_iso(dt)))
        }
        None => Ok(None),
    }
}

pub fn create(conn: &Connection, input: TaskInput) -> AppResult<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("Title is empty".into()));
    }
    let priority = input.priority.unwrap_or_else(|| "med".into());
    check_priority(&priority)?;
    let due_at = canon_due(input.due_at)?;
    let id = new_id();
    let now = now_iso();
    let seq: i64 = conn.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM tasks", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO tasks (id, seq, title, description_md, status, priority, project_id, due_at, remind_before_min, \
         target_minutes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'todo', ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
        params![
            id,
            seq,
            title,
            input.description_md,
            priority,
            input.project_id,
            due_at,
            input.remind_before_min,
            input.target_minutes,
            now
        ],
    )?;
    set_tags(conn, &id, &input.tags)?;
    get(conn, &id)
}

pub fn update(conn: &Connection, id: &str, patch: TaskPatch) -> AppResult<Task> {
    let mut t = get(conn, id)?;
    if let Some(title) = patch.title {
        let title = title.trim().to_string();
        if title.is_empty() {
            return Err(AppError::Invalid("Title is empty".into()));
        }
        t.title = title;
    }
    if let Some(d) = patch.description_md {
        t.description_md = d;
    }
    if let Some(p) = patch.priority {
        check_priority(&p)?;
        t.priority = p;
    }
    if let Some(p) = patch.project_id {
        t.project_id = p;
    }
    if let Some(d) = patch.due_at {
        t.due_at = canon_due(d)?;
    }
    if let Some(r) = patch.remind_before_min {
        t.remind_before_min = r;
    }
    if let Some(m) = patch.target_minutes {
        t.target_minutes = m;
    }
    conn.execute(
        "UPDATE tasks SET title = ?1, description_md = ?2, priority = ?3, project_id = ?4, due_at = ?5, \
         remind_before_min = ?6, target_minutes = ?7, updated_at = ?8 WHERE id = ?9",
        params![
            t.title,
            t.description_md,
            t.priority,
            t.project_id,
            t.due_at,
            t.remind_before_min,
            t.target_minutes,
            now_iso(),
            id
        ],
    )?;
    if let Some(tags) = patch.tags {
        set_tags(conn, id, &tags)?;
    }
    get(conn, id)
}

pub fn set_status(conn: &Connection, id: &str, status: &str) -> AppResult<Task> {
    if !matches!(status, "todo" | "progress" | "done") {
        return Err(AppError::Invalid("Invalid status".into()));
    }
    let t = get(conn, id)?;
    if status == "done" {
        crate::timer::pause_one(conn, &t)?;
    }
    let completed = if status == "done" { Some(now_iso()) } else { None };
    conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, completed, now_iso(), id],
    )?;
    get(conn, id)
}

pub fn move_to_tomorrow(conn: &Connection, id: &str) -> AppResult<Task> {
    let t = get(conn, id)?;
    let next = match t.due_at.as_deref().and_then(utc_to_local) {
        Some(local) => local + Duration::days(1),
        None => chrono::Local::now()
            .date_naive()
            .succ_opt()
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .ok_or_else(|| AppError::Invalid("Invalid date".into()))?,
    };
    conn.execute(
        "UPDATE tasks SET due_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![to_iso(local_to_utc(next)), now_iso(), id],
    )?;
    get(conn, id)
}

pub fn for_day(conn: &Connection, day: NaiveDate) -> AppResult<Vec<Task>> {
    let (start, end) = day_bounds(day);
    query(
        conn,
        "WHERE t.due_at >= ?1 AND t.due_at < ?2 ORDER BY t.due_at, t.seq",
        &[&start, &end],
    )
}

pub fn list_projects_inner(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare("SELECT id, name, color, sort FROM projects ORDER BY sort, name")?;
    let rows = stmt.query_map([], |r| {
        Ok(Project {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            sort: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn list_tasks(db: State<Db>, day: String) -> AppResult<Vec<Task>> {
    for_day(&db.conn(), parse_day(&day)?)
}

#[tauri::command]
pub fn list_upcoming(db: State<Db>, from: String, days: i64) -> AppResult<Vec<Task>> {
    let start = parse_day(&from)?;
    let (s, _) = day_bounds(start);
    let (e, _) = day_bounds(start + Duration::days(days.clamp(1, 90)));
    query(
        &db.conn(),
        "WHERE t.due_at >= ?1 AND t.due_at < ?2 ORDER BY t.due_at, t.seq",
        &[&s, &e],
    )
}

#[tauri::command]
pub fn list_week_counts(db: State<Db>, week_start: String) -> AppResult<Vec<DayCount>> {
    let start = parse_day(&week_start)?;
    let conn = db.conn();
    let mut out = Vec::new();
    for i in 0..7 {
        let day = start + Duration::days(i);
        let (s, e) = day_bounds(day);
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE due_at >= ?1 AND due_at < ?2",
            params![s, e],
            |r| r.get(0),
        )?;
        out.push(DayCount {
            day: day.format("%Y-%m-%d").to_string(),
            count,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn get_task(db: State<Db>, id: String) -> AppResult<Task> {
    get(&db.conn(), &id)
}

#[tauri::command]
pub fn create_task(app: AppHandle, db: State<Db>, input: TaskInput) -> AppResult<Task> {
    let t = create(&db.conn(), input)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn update_task(app: AppHandle, db: State<Db>, id: String, patch: TaskPatch) -> AppResult<Task> {
    let t = update(&db.conn(), &id, patch)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn set_task_status(app: AppHandle, db: State<Db>, id: String, status: String) -> AppResult<Task> {
    let t = set_status(&db.conn(), &id, &status)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, db: State<Db>, id: String) -> AppResult<()> {
    let n = db.conn().execute("DELETE FROM tasks WHERE id = ?1", [&id])?;
    if n == 0 {
        return Err(AppError::NotFound);
    }
    changed(&app, "tasks");
    Ok(())
}

#[tauri::command]
pub fn move_task_to_tomorrow(app: AppHandle, db: State<Db>, id: String) -> AppResult<Task> {
    let t = move_to_tomorrow(&db.conn(), &id)?;
    changed(&app, "tasks");
    Ok(t)
}

#[tauri::command]
pub fn search_tasks(db: State<Db>, query_text: String) -> AppResult<Vec<Task>> {
    let q = query_text.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    query(
        &db.conn(),
        "WHERE t.title LIKE ?1 ESCAPE '\\' OR t.description_md LIKE ?1 ESCAPE '\\' ORDER BY t.updated_at DESC LIMIT 20",
        &[&like],
    )
}

#[tauri::command]
pub fn list_projects(db: State<Db>) -> AppResult<Vec<Project>> {
    list_projects_inner(&db.conn())
}

#[tauri::command]
pub fn create_project(app: AppHandle, db: State<Db>, name: String, color: String) -> AppResult<Project> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("Name is empty".into()));
    }
    let conn = db.conn();
    let id = new_id();
    let sort: i64 = conn.query_row("SELECT COALESCE(MAX(sort), -1) + 1 FROM projects", [], |r| r.get(0))?;
    conn.execute(
        "INSERT INTO projects (id, name, color, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, name, color, sort, now_iso()],
    )?;
    changed(&app, "projects");
    Ok(Project { id, name, color, sort })
}

#[tauri::command]
pub fn list_tags(db: State<Db>) -> AppResult<Vec<String>> {
    let conn = db.conn();
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn due_dates_are_normalised_without_milliseconds() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let mut i = input("Ms");
        i.due_at = Some("2026-10-29T16:00:00.000Z".into());
        let t = create(&conn, i).unwrap();
        assert_eq!(t.due_at.as_deref(), Some("2026-10-29T16:00:00Z"));
        let mut bad = input("Bad");
        bad.due_at = Some("tomorrow".into());
        assert!(create(&conn, bad).is_err());
    }

    fn input(title: &str) -> TaskInput {
        TaskInput {
            title: title.into(),
            ..Default::default()
        }
    }

    #[test]
    fn create_assigns_sequential_ids_and_tags() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let mut a = input("First");
        a.tags = vec!["#Work".into(), "dev".into(), "  ".into()];
        let a = create(&conn, a).unwrap();
        let b = create(&conn, input("Second")).unwrap();
        assert_eq!(a.seq, 1);
        assert_eq!(b.seq, 2);
        assert_eq!(a.tags, vec!["dev", "work"]);
        assert_eq!(a.priority, "med");
        assert!(create(&conn, input("   ")).is_err());
    }

    #[test]
    fn status_done_sets_and_clears_completed_at() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let t = create(&conn, input("Ship")).unwrap();
        let done = set_status(&conn, &t.id, "done").unwrap();
        assert!(done.completed_at.is_some());
        let open = set_status(&conn, &t.id, "progress").unwrap();
        assert!(open.completed_at.is_none());
        assert!(set_status(&conn, &t.id, "bogus").is_err());
    }

    #[test]
    fn patch_distinguishes_null_from_absent() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let mut i = input("Task");
        i.target_minutes = Some(60);
        let t = create(&conn, i).unwrap();
        let keep: TaskPatch = serde_json::from_str(r#"{"title":"Renamed"}"#).unwrap();
        let t = update(&conn, &t.id, keep).unwrap();
        assert_eq!(t.target_minutes, Some(60));
        let clear: TaskPatch = serde_json::from_str(r#"{"target_minutes":null}"#).unwrap();
        let t = update(&conn, &t.id, clear).unwrap();
        assert_eq!(t.target_minutes, None);
        assert_eq!(t.title, "Renamed");
    }

    #[test]
    fn day_listing_and_move_to_tomorrow() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let day = NaiveDate::from_ymd_opt(2026, 10, 29).unwrap();
        let due = to_iso(local_to_utc(day.and_hms_opt(16, 0, 0).unwrap()));
        let mut i = input("Call Rafi");
        i.due_at = Some(due);
        let t = create(&conn, i).unwrap();
        assert_eq!(for_day(&conn, day).unwrap().len(), 1);
        move_to_tomorrow(&conn, &t.id).unwrap();
        assert_eq!(for_day(&conn, day).unwrap().len(), 0);
        assert_eq!(for_day(&conn, day.succ_opt().unwrap()).unwrap().len(), 1);
    }

    #[test]
    fn deleting_task_cascades_tags() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        let mut i = input("Tagged");
        i.tags = vec!["a".into()];
        let t = create(&conn, i).unwrap();
        conn.execute("DELETE FROM tasks WHERE id = ?1", [&t.id]).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        assert!(get(&conn, &t.id).is_err());
    }
}
