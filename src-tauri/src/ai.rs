use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use chrono::Local;
use serde_json::{json, Value};
use tauri::State;
use tokio::sync::Notify;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::settings;
use crate::tasks;

const OPENAI_BASE: &str = "https://api.openai.com/v1";
const OLLAMA_BASE: &str = "http://localhost:11434/v1";

#[derive(Default)]
pub struct AiState(Mutex<HashMap<String, Arc<Notify>>>);

impl AiState {
    fn register(&self, id: &Option<String>) -> Option<Arc<Notify>> {
        let id = id.as_ref()?;
        let n = Arc::new(Notify::new());
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), n.clone());
        Some(n)
    }

    fn unregister(&self, id: &Option<String>) {
        if let Some(id) = id {
            self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        }
    }

    fn cancel(&self, id: &str) {
        if let Some(n) = self.0.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            n.notify_one();
        }
    }
}

struct Features {
    tasks: bool,
    notes: bool,
    suggest: bool,
}

struct Config {
    provider: String,
    base: String,
    model: String,
    language: String,
    features: Features,
    key: Option<String>,
    projects: Vec<String>,
}

fn base_url(provider: &str, stored: &str) -> AppResult<String> {
    let stored = stored.trim();
    let base = match provider {
        "compatible" => {
            if stored.is_empty() {
                return Err(AppError::Invalid("Set a base URL in AI settings".into()));
            }
            stored
        }
        "local" => {
            if stored.is_empty() {
                OLLAMA_BASE
            } else {
                stored
            }
        }
        _ => OPENAI_BASE,
    };
    Ok(base.trim_end_matches('/').to_string())
}

fn parse_features(raw: Option<String>) -> Features {
    let v: Value = raw.and_then(|r| serde_json::from_str(&r).ok()).unwrap_or(Value::Null);
    let flag = |k: &str, d: bool| v.get(k).and_then(Value::as_bool).unwrap_or(d);
    Features {
        tasks: flag("tasks", true),
        notes: flag("notes", true),
        suggest: flag("suggest", true),
    }
}

fn load_config(db: &Db, need_model: bool) -> AppResult<Config> {
    let (map, projects) = {
        let conn = db.conn();
        (
            settings::all(&conn)?,
            tasks::list_projects_inner(&conn)?.into_iter().map(|p| p.name).collect::<Vec<_>>(),
        )
    };
    let get = |k: &str| map.get(k).cloned().unwrap_or_default();
    let provider = {
        let p = get("ai.provider");
        if p.is_empty() {
            "openai".to_string()
        } else {
            p
        }
    };
    let base = base_url(&provider, &get("ai.base_url"))?;
    let key = if provider == "local" { None } else { settings::api_key()? };
    if provider != "local" && key.is_none() {
        return Err(AppError::MissingKey);
    }
    let model = get("ai.model").trim().to_string();
    if need_model && model.is_empty() {
        return Err(AppError::Invalid("Set a model in AI settings".into()));
    }
    Ok(Config {
        provider,
        base,
        model,
        language: get("ai.language"),
        features: parse_features(map.get("ai.features").cloned()),
        key,
        projects,
    })
}

fn language_rule(setting: &str) -> &'static str {
    match setting {
        "english" => "write in English",
        "bangla" => "write the content in Bangla, keep technical terms in English",
        _ => "reply in the language of the user's text",
    }
}

fn frame(kind: &str, cfg: &Config, length: &str) -> String {
    let now = Local::now();
    let intro = if kind == "note" {
        "You turn a user's raw notes into a clean, well structured note for a personal notes app."
    } else {
        "You turn a user's rough sentence into a clear, actionable task for a personal task manager."
    };
    let projects = if cfg.projects.is_empty() {
        "none".to_string()
    } else {
        cfg.projects.join(", ")
    };
    format!(
        "{intro}\nToday is {}, local time {}, time zone {}. Existing projects: {projects}.\nLength: {length}. Language: {}.\nRules:\n",
        now.format("%Y-%m-%d (%A)"),
        now.format("%H:%M"),
        now.format("%:z"),
        language_rule(&cfg.language)
    )
}

const CODE_RULE: &str =
    "- Use `inline code` for commands, keys, file names; fenced code blocks with a language tag for code.\n- Return only JSON that matches the schema.";

fn system_prompt(kind: &str, cfg: &Config, length: &str) -> String {
    let mut s = frame(kind, cfg, length);
    if kind == "note" {
        s.push_str(
            "- Clean up the user's raw notes. Keep every fact, remove filler, group into sections such as Decisions, Follow-ups, Ideas. Follow-ups become - [ ] items. Do not add facts.\n\
             - Title: short, no trailing period.\n\
             - folder is one of work, personal, ideas. color is one of violet, mint, peach, sky, rose, yellow.\n\
             - Brief = short sections with few bullets. Detailed = add context and notes sections.\n",
        );
    } else {
        s.push_str(
            "- Title: short, starts with a verb, no trailing period.\n\
             - Pick a project only from the list; otherwise null.\n\
             - Infer priority, due date/time and a realistic time target from the text; never invent facts the user did not imply.\n\
             - markdown: one summary sentence, then \"### Highlights\" bullets if useful, then \"### Steps\" as a \"- [ ]\" checklist.\n\
             - Brief = summary + max 3 checklist items. Detailed = add context and notes sections.\n",
        );
    }
    s.push_str(CODE_RULE);
    s
}

fn task_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "project", "priority", "due_at", "target_minutes", "tags", "markdown"],
        "properties": {
            "title": {"type": "string"},
            "project": {"type": ["string", "null"]},
            "priority": {"type": "string", "enum": ["low", "med", "high"]},
            "due_at": {"type": ["string", "null"]},
            "target_minutes": {"type": ["integer", "null"]},
            "tags": {"type": "array", "items": {"type": "string"}},
            "markdown": {"type": "string"}
        }
    })
}

fn note_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "folder", "color", "tags", "markdown"],
        "properties": {
            "title": {"type": "string"},
            "folder": {"type": "string", "enum": ["work", "personal", "ideas"]},
            "color": {"type": "string", "enum": ["violet", "mint", "peach", "sky", "rose", "yellow"]},
            "tags": {"type": "array", "items": {"type": "string"}},
            "markdown": {"type": "string"}
        }
    })
}

fn markdown_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["markdown"],
        "properties": {"markdown": {"type": "string"}}
    })
}

fn authorize(req: reqwest::RequestBuilder, cfg: &Config) -> reqwest::RequestBuilder {
    match &cfg.key {
        Some(k) if cfg.provider != "local" => req.bearer_auth(k),
        _ => req,
    }
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| AppError::Network)
}

fn map_status(status: reqwest::StatusCode) -> AppResult<()> {
    match status.as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(AppError::Unauthorized),
        429 => Err(AppError::RateLimited),
        code => Err(AppError::Other(format!("The AI service answered with an error ({code})"))),
    }
}

async fn complete(
    ai: &AiState,
    request_id: &Option<String>,
    cfg: &Config,
    system: String,
    user: String,
    name: &str,
    schema: Value,
) -> AppResult<String> {
    let mut body = json!({
        "model": cfg.model,
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user}
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": name, "strict": true, "schema": schema.clone()}
        }
    });
    if cfg.provider == "local" {
        body["format"] = schema;
    }
    let req = authorize(client()?.post(format!("{}/chat/completions", cfg.base)).json(&body), cfg);
    let cancel = ai.register(request_id);
    let work = async {
        let resp = req.send().await.map_err(|_| AppError::Network)?;
        map_status(resp.status())?;
        let v: Value = resp.json().await.map_err(|_| AppError::BadResponse)?;
        v["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or(AppError::BadResponse)
    };
    let result = match cancel {
        Some(n) => {
            tokio::select! {
                r = work => r,
                _ = n.notified() => Err(AppError::Cancelled),
            }
        }
        None => work.await,
    };
    ai.unregister(request_id);
    result
}

fn clamp_title(t: &str) -> String {
    let t = t.trim().trim_end_matches('.').trim();
    t.chars().take(80).collect()
}

fn normalize_draft(kind: &str, mut v: Value, suggest: bool) -> Option<Value> {
    let obj = v.as_object_mut()?;
    let title = clamp_title(obj.get("title")?.as_str()?);
    let markdown = obj.get("markdown")?.as_str()?.to_string();
    obj.insert("title".into(), json!(title));
    obj.insert("markdown".into(), json!(markdown));
    let tags: Vec<Value> = obj
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| t.as_str())
                .filter_map(tasks::normalize_tag)
                .map(Value::from)
                .collect()
        })
        .unwrap_or_default();
    obj.insert("tags".into(), Value::Array(tags));
    if kind == "task" {
        let priority = obj.get("priority").and_then(Value::as_str).unwrap_or("med").to_string();
        let priority = if matches!(priority.as_str(), "low" | "med" | "high") { priority } else { "med".into() };
        obj.insert("priority".into(), json!(priority));
        for k in ["project", "due_at", "target_minutes"] {
            obj.entry(k).or_insert(Value::Null);
        }
        if !suggest {
            obj.insert("project".into(), Value::Null);
            obj.insert("priority".into(), json!("med"));
            obj.insert("due_at".into(), Value::Null);
            obj.insert("target_minutes".into(), Value::Null);
        }
    } else {
        let folder = obj.get("folder").and_then(Value::as_str).unwrap_or("personal").to_string();
        let folder = if matches!(folder.as_str(), "work" | "personal" | "ideas") { folder } else { "personal".into() };
        let color = obj.get("color").and_then(Value::as_str).unwrap_or("violet").to_string();
        let color = if matches!(color.as_str(), "violet" | "mint" | "peach" | "sky" | "rose" | "yellow") {
            color
        } else {
            "violet".into()
        };
        obj.insert("folder".into(), json!(folder));
        obj.insert("color".into(), json!(color));
    }
    Some(v)
}

fn raw_draft(kind: &str, content: &str) -> Value {
    let first = content
        .lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("Untitled");
    let title = clamp_title(first);
    if kind == "task" {
        json!({"title": title, "project": null, "priority": "med", "due_at": null, "target_minutes": null, "tags": [], "markdown": content})
    } else {
        json!({"title": title, "folder": "personal", "color": "violet", "tags": [], "markdown": content})
    }
}

async fn draft(
    ai: &AiState,
    request_id: &Option<String>,
    cfg: &Config,
    kind: &str,
    system: String,
    user: String,
) -> AppResult<Value> {
    let (name, schema) = if kind == "note" {
        ("note_draft", note_schema())
    } else {
        ("task_draft", task_schema())
    };
    let mut last = String::new();
    for _ in 0..2 {
        let content = complete(ai, request_id, cfg, system.clone(), user.clone(), name, schema.clone()).await?;
        if let Some(v) = serde_json::from_str::<Value>(&content)
            .ok()
            .and_then(|v| normalize_draft(kind, v, cfg.features.suggest))
        {
            return Ok(v);
        }
        last = content;
    }
    if last.trim().is_empty() {
        return Err(AppError::BadResponse);
    }
    Ok(raw_draft(kind, &last))
}

fn check_feature(cfg: &Config, kind: &str) -> AppResult<()> {
    let on = if kind == "note" { cfg.features.notes } else { cfg.features.tasks };
    if on {
        Ok(())
    } else {
        Err(AppError::Invalid("This AI feature is turned off in settings".into()))
    }
}

fn check_kind(kind: &str) -> AppResult<()> {
    if matches!(kind, "task" | "note") {
        Ok(())
    } else {
        Err(AppError::Invalid("Invalid kind".into()))
    }
}

#[tauri::command]
pub async fn ai_generate(
    db: State<'_, Db>,
    ai: State<'_, AiState>,
    kind: String,
    prompt: String,
    format: String,
    request_id: Option<String>,
) -> AppResult<Value> {
    check_kind(&kind)?;
    if prompt.trim().is_empty() {
        return Err(AppError::Invalid("Write a few words first".into()));
    }
    let cfg = load_config(&db, true)?;
    check_feature(&cfg, &kind)?;
    let length = match format.as_str() {
        "brief" | "checklist" | "detailed" => format.as_str(),
        _ => "checklist",
    };
    let system = system_prompt(&kind, &cfg, length);
    draft(&ai, &request_id, &cfg, &kind, system, prompt).await
}

#[tauri::command]
pub async fn ai_refine(
    db: State<'_, Db>,
    ai: State<'_, AiState>,
    kind: String,
    draft_json: Value,
    instruction: String,
    request_id: Option<String>,
) -> AppResult<Value> {
    check_kind(&kind)?;
    let cfg = load_config(&db, true)?;
    check_feature(&cfg, &kind)?;
    let system = system_prompt(&kind, &cfg, "as the instruction says");
    let user = format!(
        "Current draft JSON:\n{draft_json}\n\nInstruction: {instruction}\nReturn the full updated draft as JSON that matches the schema."
    );
    draft(&ai, &request_id, &cfg, &kind, system, user).await
}

#[tauri::command]
pub async fn ai_improve_markdown(
    db: State<'_, Db>,
    ai: State<'_, AiState>,
    md: String,
    request_id: Option<String>,
) -> AppResult<String> {
    let cfg = load_config(&db, true)?;
    let system = format!(
        "You improve the formatting of markdown text for a personal task manager.\nLanguage: {}.\nRules:\n\
         - Keep every fact, fix structure and headings, turn action items into - [ ] items. Do not add facts.\n{CODE_RULE}",
        language_rule(&cfg.language)
    );
    let content = complete(&ai, &request_id, &cfg, system, md, "markdown", markdown_schema()).await?;
    let v: Value = serde_json::from_str(&content).map_err(|_| AppError::BadResponse)?;
    v["markdown"].as_str().map(str::to_string).ok_or(AppError::BadResponse)
}

#[tauri::command]
pub async fn ai_test_connection(db: State<'_, Db>) -> AppResult<()> {
    let cfg = load_config(&db, false)?;
    let resp = authorize(client()?.get(format!("{}/models", cfg.base)), &cfg)
        .send()
        .await
        .map_err(|_| AppError::Network)?;
    map_status(resp.status())
}

#[tauri::command]
pub fn ai_cancel(ai: State<AiState>, request_id: String) {
    ai.cancel(&request_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(language: &str) -> Config {
        Config {
            provider: "openai".into(),
            base: OPENAI_BASE.into(),
            model: "m".into(),
            language: language.into(),
            features: Features { tasks: true, notes: true, suggest: true },
            key: None,
            projects: vec!["Client work".into(), "Personal".into()],
        }
    }

    #[test]
    fn base_urls() {
        assert_eq!(base_url("openai", "ignored").unwrap(), OPENAI_BASE);
        assert_eq!(base_url("local", "").unwrap(), OLLAMA_BASE);
        assert_eq!(base_url("compatible", "https://x.test/v1/").unwrap(), "https://x.test/v1");
        assert!(base_url("compatible", " ").is_err());
    }

    #[test]
    fn task_prompt_contains_context_and_rules() {
        let s = system_prompt("task", &cfg("bangla"), "detailed");
        assert!(s.contains("Existing projects: Client work, Personal."));
        assert!(s.contains("Length: detailed."));
        assert!(s.contains("keep technical terms in English"));
        assert!(s.contains("Return only JSON that matches the schema."));
        assert!(!s.contains('\u{2014}'));
    }

    #[test]
    fn note_prompt_keeps_facts() {
        let s = system_prompt("note", &cfg("same"), "brief");
        assert!(s.contains("Keep every fact"));
        assert!(s.contains("Follow-ups become - [ ] items"));
        assert!(s.contains("language of the user's text"));
    }

    #[test]
    fn schemas_are_strict() {
        for s in [task_schema(), note_schema(), markdown_schema()] {
            assert_eq!(s["additionalProperties"], json!(false));
            let required = s["required"].as_array().unwrap().len();
            assert_eq!(required, s["properties"].as_object().unwrap().len());
        }
    }

    #[test]
    fn normalize_cleans_task_drafts() {
        let raw = json!({"title": "  Write notes.  ", "project": "Client work", "priority": "urgent", "due_at": null,
            "target_minutes": 120, "tags": ["#Dev", " ", "release"], "markdown": "x"});
        let v = normalize_draft("task", raw.clone(), true).unwrap();
        assert_eq!(v["title"], "Write notes");
        assert_eq!(v["priority"], "med");
        assert_eq!(v["tags"], json!(["dev", "release"]));
        let off = normalize_draft("task", raw, false).unwrap();
        assert_eq!(off["project"], Value::Null);
        assert_eq!(off["target_minutes"], Value::Null);
        assert!(normalize_draft("task", json!({"title": "x"}), true).is_none());
    }

    #[test]
    fn raw_fallback_uses_first_line() {
        let v = raw_draft("note", "## Standup\n- a");
        assert_eq!(v["title"], "Standup");
        assert_eq!(v["markdown"], "## Standup\n- a");
    }

    #[test]
    fn cancel_wakes_registered_request() {
        let ai = AiState::default();
        let id = Some("r1".to_string());
        let n = ai.register(&id).unwrap();
        ai.cancel("r1");
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            tokio::time::timeout(Duration::from_millis(200), n.notified()).await.unwrap();
        });
        ai.unregister(&id);
        assert!(ai.0.lock().unwrap().is_empty());
    }

    #[test]
    fn feature_flags_default_on() {
        let f = parse_features(None);
        assert!(f.tasks && f.notes && f.suggest);
        let f = parse_features(Some(r#"{"tasks":false,"suggest":false}"#.into()));
        assert!(!f.tasks && f.notes && !f.suggest);
    }
}
