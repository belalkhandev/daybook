use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn open_task_window(app: AppHandle, id: String) -> AppResult<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::Invalid("Invalid task id".into()));
    }
    let label = format!("task-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html?view=task&id={id}").into()))
        .title("Trove")
        .inner_size(1280.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

pub fn open_shot_editor_inner(app: &AppHandle, id: &str) -> AppResult<()> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(AppError::Invalid("Invalid shot id".into()));
    }
    let label = format!("shot-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(format!("index.html?view=shot&id={id}").into()))
        .title("Trove")
        .inner_size(1280.0, 860.0)
        .min_inner_size(900.0, 600.0)
        .decorations(false)
        .center()
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_shot_editor(app: AppHandle, id: String) -> AppResult<()> {
    open_shot_editor_inner(&app, &id)
}

#[tauri::command]
pub async fn focus_main_window(app: AppHandle, view: Option<String>) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(v) = view {
        let _ = app.emit_to("main", "go-view", v);
    }
    Ok(())
}
