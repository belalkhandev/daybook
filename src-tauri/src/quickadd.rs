use std::sync::OnceLock;

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, NaiveTime, Weekday};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{changed, local_to_utc, to_iso, Db};
use crate::error::{AppError, AppResult};
use crate::notes::{self, NoteInput};
use crate::tasks::{self, Project, TaskInput};

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct QuickAddPreview {
    pub kind: String,
    pub title: String,
    pub body_md: String,
    pub tags: Vec<String>,
    pub project: Option<String>,
    pub project_id: Option<String>,
    pub priority: Option<String>,
    pub due_local: Option<String>,
    pub has_time: bool,
    pub target_minutes: Option<i64>,
}

#[derive(Serialize)]
pub struct QuickAddResult {
    pub kind: String,
    pub id: String,
}

struct Patterns {
    tag: Regex,
    clock: Regex,
    h24: Regex,
    bare: Regex,
    hm: Regex,
    mins: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        tag: Regex::new(r"^#([\p{L}\p{N}_-]+)$").unwrap(),
        clock: Regex::new(r"(?i)^(\d{1,2})(?::(\d{2}))?(am|pm)$").unwrap(),
        h24: Regex::new(r"^(\d{1,2}):(\d{2})$").unwrap(),
        bare: Regex::new(r"^(\d{1,2})(?::(\d{2}))?$").unwrap(),
        hm: Regex::new(r"(?i)^(\d+)h(?:(\d+)m)?$").unwrap(),
        mins: Regex::new(r"(?i)^(\d+)m$").unwrap(),
    })
}

fn clock_time(tok: &str) -> Option<NaiveTime> {
    let p = patterns();
    if let Some(c) = p.clock.captures(tok) {
        let h: u32 = c[1].parse().ok()?;
        let m: u32 = c.get(2).map_or(Some(0), |m| m.as_str().parse().ok())?;
        if !(1..=12).contains(&h) || m > 59 {
            return None;
        }
        let pm = c[3].eq_ignore_ascii_case("pm");
        let h24 = match (h, pm) {
            (12, false) => 0,
            (12, true) => 12,
            (h, true) => h + 12,
            (h, false) => h,
        };
        return NaiveTime::from_hms_opt(h24, m, 0);
    }
    if let Some(c) = p.h24.captures(tok) {
        let h: u32 = c[1].parse().ok()?;
        let m: u32 = c[2].parse().ok()?;
        return NaiveTime::from_hms_opt(h, m, 0);
    }
    None
}

fn bare_time(tok: &str) -> Option<NaiveTime> {
    let c = patterns().bare.captures(tok)?;
    let h: u32 = c[1].parse().ok()?;
    let m: u32 = c.get(2).map_or(Some(0), |m| m.as_str().parse().ok())?;
    if h > 23 || m > 59 {
        return None;
    }
    let h = if (1..=6).contains(&h) { h + 12 } else { h };
    NaiveTime::from_hms_opt(h, m, 0)
}

fn weekday(tok: &str) -> Option<Weekday> {
    match tok.to_lowercase().as_str() {
        "monday" => Some(Weekday::Mon),
        "tuesday" => Some(Weekday::Tue),
        "wednesday" => Some(Weekday::Wed),
        "thursday" => Some(Weekday::Thu),
        "friday" => Some(Weekday::Fri),
        "saturday" => Some(Weekday::Sat),
        "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

fn duration_minutes(tok: &str) -> Option<i64> {
    let p = patterns();
    if let Some(c) = p.hm.captures(tok) {
        let h: i64 = c[1].parse().ok()?;
        let m: i64 = c.get(2).map_or(Some(0), |m| m.as_str().parse().ok())?;
        return Some(h * 60 + m);
    }
    if let Some(c) = p.mins.captures(tok) {
        return c[1].parse().ok();
    }
    None
}

fn priority(tok: &str) -> Option<&'static str> {
    match tok.to_lowercase().as_str() {
        "!high" | "!h" => Some("high"),
        "!med" | "!m" => Some("med"),
        "!low" | "!l" => Some("low"),
        _ => None,
    }
}

fn match_project<'a>(tag: &str, projects: &'a [Project]) -> Option<&'a Project> {
    if let Some(p) = projects.iter().find(|p| p.name.to_lowercase() == tag) {
        return Some(p);
    }
    let by_word: Vec<&Project> = projects
        .iter()
        .filter(|p| p.name.to_lowercase().split_whitespace().any(|w| w == tag))
        .collect();
    if by_word.len() == 1 {
        Some(by_word[0])
    } else {
        None
    }
}

pub fn parse_task(text: &str, projects: &[Project], now: NaiveDateTime, default_day: NaiveDate) -> QuickAddPreview {
    let today = now.date();
    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut rest: Vec<&str> = Vec::new();
    let mut out = QuickAddPreview {
        kind: "task".into(),
        ..Default::default()
    };
    let mut date: Option<NaiveDate> = None;
    let mut time: Option<NaiveTime> = None;
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        if let Some(c) = patterns().tag.captures(tok) {
            let tag = c[1].to_lowercase();
            if out.project.is_none() {
                if let Some(p) = match_project(&tag, projects) {
                    out.project = Some(p.name.clone());
                    out.project_id = Some(p.id.clone());
                }
            }
            if !out.tags.contains(&tag) {
                out.tags.push(tag);
            }
        } else if let Some(p) = priority(tok) {
            out.priority = Some(p.into());
        } else if tok.eq_ignore_ascii_case("at")
            && tokens.get(i + 1).is_some_and(|n| clock_time(n).or_else(|| bare_time(n)).is_some())
        {
            let n = tokens[i + 1];
            time = clock_time(n).or_else(|| bare_time(n));
            i += 1;
        } else if let Some(t) = clock_time(tok) {
            time = Some(t);
        } else if tok.eq_ignore_ascii_case("today") {
            date = Some(today);
        } else if tok.eq_ignore_ascii_case("tomorrow") {
            date = Some(today + Duration::days(1));
        } else if let Some(w) = weekday(tok) {
            let delta = (w.num_days_from_monday() as i64 - today.weekday().num_days_from_monday() as i64 + 7) % 7;
            date = Some(today + Duration::days(if delta == 0 { 7 } else { delta }));
        } else if tok.eq_ignore_ascii_case("next") && tokens.get(i + 1).is_some_and(|n| n.eq_ignore_ascii_case("week")) {
            let to_monday = 7 - today.weekday().num_days_from_monday() as i64;
            date = Some(today + Duration::days(to_monday));
            i += 1;
        } else if let Some(m) = duration_minutes(tok) {
            out.target_minutes = Some(m);
        } else {
            rest.push(tok);
        }
        i += 1;
    }
    out.title = rest.join(" ");
    let day = date.unwrap_or(default_day);
    let t = time.unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    out.has_time = time.is_some();
    out.due_local = Some(day.and_time(t).format("%Y-%m-%dT%H:%M:%S").to_string());
    out
}

pub fn parse_note(text: &str) -> QuickAddPreview {
    let trimmed = text.trim();
    let mut lines = trimmed.lines();
    let title = lines.next().unwrap_or("").trim().to_string();
    let body = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    QuickAddPreview {
        kind: "note".into(),
        title,
        body_md: body,
        ..Default::default()
    }
}

fn resolve_day(day: Option<String>) -> NaiveDate {
    day.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Local::now().date_naive())
}

#[tauri::command]
pub fn parse_quick_add(db: State<Db>, text: String, kind: String, day: Option<String>) -> AppResult<QuickAddPreview> {
    if kind == "note" {
        return Ok(parse_note(&text));
    }
    let projects = tasks::list_projects_inner(&db.conn())?;
    Ok(parse_task(&text, &projects, Local::now().naive_local(), resolve_day(day)))
}

#[tauri::command]
pub fn create_from_quick_add(
    app: AppHandle,
    db: State<Db>,
    text: String,
    kind: String,
    day: Option<String>,
) -> AppResult<QuickAddResult> {
    let conn = db.conn();
    if kind == "note" {
        let p = parse_note(&text);
        if p.title.is_empty() {
            return Err(AppError::Invalid("Title is empty".into()));
        }
        let n = notes::create(
            &conn,
            NoteInput {
                title: p.title,
                body_md: p.body_md,
                ..Default::default()
            },
        )?;
        changed(&app, "notes");
        return Ok(QuickAddResult { kind, id: n.id });
    }
    let projects = tasks::list_projects_inner(&conn)?;
    let p = parse_task(&text, &projects, Local::now().naive_local(), resolve_day(day));
    if p.title.is_empty() {
        return Err(AppError::Invalid("Title is empty".into()));
    }
    let due = p
        .due_local
        .as_deref()
        .and_then(|d| NaiveDateTime::parse_from_str(d, "%Y-%m-%dT%H:%M:%S").ok())
        .map(|n| to_iso(local_to_utc(n)));
    let t = tasks::create(
        &conn,
        TaskInput {
            title: p.title,
            priority: p.priority,
            project_id: p.project_id,
            due_at: due,
            target_minutes: p.target_minutes,
            tags: p.tags,
            ..Default::default()
        },
    )?;
    changed(&app, "tasks");
    Ok(QuickAddResult { kind, id: t.id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn projects() -> Vec<Project> {
        [("a", "Daybook App"), ("b", "Client work"), ("c", "Website"), ("d", "Personal")]
            .iter()
            .enumerate()
            .map(|(i, (id, name))| Project {
                id: (*id).into(),
                name: (*name).into(),
                color: "#000".into(),
                sort: i as i64,
            })
            .collect()
    }

    fn thursday() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 29).unwrap().and_hms_opt(10, 0, 0).unwrap()
    }

    fn parse(text: &str) -> QuickAddPreview {
        parse_task(text, &projects(), thursday(), thursday().date())
    }

    #[test]
    fn spec_example() {
        let p = parse("Call Rafi at 4pm #work !high");
        assert_eq!(p.title, "Call Rafi");
        assert_eq!(p.due_local.as_deref(), Some("2026-10-29T16:00:00"));
        assert!(p.has_time);
        assert_eq!(p.tags, vec!["work"]);
        assert_eq!(p.project.as_deref(), Some("Client work"));
        assert_eq!(p.priority.as_deref(), Some("high"));
    }

    #[test]
    fn priorities() {
        for (t, want) in [("!high", "high"), ("!h", "high"), ("!med", "med"), ("!m", "med"), ("!low", "low"), ("!l", "low")] {
            assert_eq!(parse(&format!("x {t}")).priority.as_deref(), Some(want));
        }
        assert_eq!(parse("x !wow").title, "x !wow");
    }

    #[test]
    fn time_formats() {
        assert_eq!(parse("a 4pm").due_local.as_deref(), Some("2026-10-29T16:00:00"));
        assert_eq!(parse("a 4:30pm").due_local.as_deref(), Some("2026-10-29T16:30:00"));
        assert_eq!(parse("a 16:00").due_local.as_deref(), Some("2026-10-29T16:00:00"));
        assert_eq!(parse("a at 4").due_local.as_deref(), Some("2026-10-29T16:00:00"));
        assert_eq!(parse("a at 9").due_local.as_deref(), Some("2026-10-29T09:00:00"));
        assert_eq!(parse("a 12am").due_local.as_deref(), Some("2026-10-29T00:00:00"));
        assert_eq!(parse("a 12pm").due_local.as_deref(), Some("2026-10-29T12:00:00"));
        assert_eq!(parse("meet at the office").title, "meet at the office");
    }

    #[test]
    fn days() {
        assert_eq!(parse("a tomorrow").due_local.as_deref(), Some("2026-10-30T00:00:00"));
        assert_eq!(parse("a today 5pm").due_local.as_deref(), Some("2026-10-29T17:00:00"));
        assert_eq!(parse("a friday").due_local.as_deref(), Some("2026-10-30T00:00:00"));
        assert_eq!(parse("a thursday").due_local.as_deref(), Some("2026-11-05T00:00:00"));
        assert_eq!(parse("a monday").due_local.as_deref(), Some("2026-11-02T00:00:00"));
        assert_eq!(parse("a next week").due_local.as_deref(), Some("2026-11-02T00:00:00"));
        assert_eq!(parse("a tomorrow 9:15").due_local.as_deref(), Some("2026-10-30T09:15:00"));
    }

    #[test]
    fn durations() {
        assert_eq!(parse("a 2h").target_minutes, Some(120));
        assert_eq!(parse("a 90m").target_minutes, Some(90));
        assert_eq!(parse("a 1h30m").target_minutes, Some(90));
        assert_eq!(parse("a 4pm").target_minutes, None);
    }

    #[test]
    fn default_day_and_leftover_title() {
        let day = NaiveDate::from_ymd_opt(2026, 11, 3).unwrap();
        let p = parse_task("  Write   the   report  ", &projects(), thursday(), day);
        assert_eq!(p.title, "Write the report");
        assert_eq!(p.due_local.as_deref(), Some("2026-11-03T00:00:00"));
        assert!(!p.has_time);
        assert!(parse("#work !high").title.is_empty());
    }

    #[test]
    fn project_matching() {
        assert_eq!(parse("x #personal").project.as_deref(), Some("Personal"));
        assert_eq!(parse("x #WORK").project.as_deref(), Some("Client work"));
        assert_eq!(parse("x #dev").project, None);
        assert_eq!(parse("x #dev #work #dev").tags, vec!["dev", "work"]);
    }

    #[test]
    fn note_parsing() {
        let p = parse_note("Ideas\nfirst line\nsecond");
        assert_eq!(p.title, "Ideas");
        assert_eq!(p.body_md, "first line\nsecond");
        assert_eq!(parse_note("").title, "");
    }
}
