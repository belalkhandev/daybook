use std::collections::HashMap;

use rusqlite::params;
use tauri::{AppHandle, State};

use crate::db::{changed, Db};
use crate::error::{AppError, AppResult};

const KEYS: [&str; 8] = [
    "accent",
    "reduce_transparency",
    "ai.provider",
    "ai.base_url",
    "ai.model",
    "ai.features",
    "ai.length",
    "ai.language",
];

const KEYRING_SERVICE: &str = "daybook";
const KEYRING_USER: &str = "ai-api-key";

pub fn all(conn: &rusqlite::Connection) -> AppResult<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        if KEYS.contains(&k.as_str()) {
            map.insert(k, v);
        }
    }
    Ok(map)
}

pub fn api_key() -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::Other(e.to_string()))?;
    match entry.get_password() {
        Ok(k) if !k.is_empty() => Ok(Some(k)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Other(e.to_string())),
    }
}

#[tauri::command]
pub fn get_settings(db: State<Db>) -> AppResult<HashMap<String, String>> {
    all(&db.conn())
}

#[tauri::command]
pub fn set_setting(app: AppHandle, db: State<Db>, key: String, value: String) -> AppResult<()> {
    if !KEYS.contains(&key.as_str()) {
        return Err(AppError::Invalid("Unknown setting".into()));
    }
    db.conn().execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    changed(&app, "settings");
    Ok(())
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, key: String) -> AppResult<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::Invalid("API key is empty".into()));
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::Other(e.to_string()))?;
    entry
        .set_password(key)
        .map_err(|e| AppError::Other(format!("Couldn't save to the system keyring: {e}")))?;
    changed(&app, "settings");
    Ok(())
}

#[tauri::command]
pub fn has_api_key() -> AppResult<bool> {
    Ok(api_key().unwrap_or(None).is_some())
}

#[tauri::command]
pub fn clear_api_key(app: AppHandle) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::Other(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(AppError::Other(e.to_string())),
    }
    changed(&app, "settings");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_whitelisted_keys_are_exposed() {
        let db = Db::memory().unwrap();
        let conn = db.conn();
        conn.execute("INSERT INTO settings (key, value) VALUES ('accent', '#0F766E')", []).unwrap();
        let map = all(&conn).unwrap();
        assert_eq!(map.get("accent").map(String::as_str), Some("#0F766E"));
        assert!(!map.contains_key("seeded"));
    }
}
