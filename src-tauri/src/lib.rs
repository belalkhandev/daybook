mod ai;
mod capture;
mod comments;
mod db;
mod error;
mod markdown;
mod notes;
mod ocr;
mod quickadd;
mod reminders;
mod settings;
mod shots;
mod tasks;
mod timer;
mod windows;

use tauri::Manager;

fn hotkeys(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    for (keys, mode) in [("PrintScreen", "area"), ("Shift+PrintScreen", "window"), ("Control+PrintScreen", "screen")] {
        let _ = app.global_shortcut().on_shortcut(keys, move |h, _, ev| {
            if ev.state() == ShortcutState::Pressed {
                let h = h.clone();
                tauri::async_runtime::spawn(async move {
                    let state = h.state::<capture::CaptureState>();
                    let _ = capture::start_capture(h.clone(), state, mode.to_string()).await;
                });
            }
        });
    }
}

pub fn run() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let database = db::Db::open().map_err(|e| e.to_string())?;
            app.manage(database);
            app.manage(ai::AiState::default());
            app.manage(capture::CaptureState::default());
            hotkeys(app.handle());
            reminders::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tasks::list_tasks,
            tasks::list_week_counts,
            tasks::get_task,
            tasks::create_task,
            tasks::update_task,
            tasks::set_task_status,
            tasks::delete_task,
            tasks::move_task_to_tomorrow,
            tasks::search_tasks,
            tasks::list_projects,
            tasks::create_project,
            tasks::list_tags,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_reset,
            comments::list_comments,
            comments::add_comment,
            comments::update_comment,
            comments::delete_comment,
            notes::list_notes,
            notes::note_counts,
            notes::get_note,
            notes::create_note,
            notes::update_note,
            notes::delete_note,
            notes::note_open_items_to_today,
            markdown::render_markdown,
            quickadd::parse_quick_add,
            quickadd::create_from_quick_add,
            ai::ai_generate,
            ai::ai_refine,
            ai::ai_improve_markdown,
            ai::ai_test_connection,
            ai::ai_cancel,
            settings::get_settings,
            settings::set_setting,
            settings::set_api_key,
            settings::has_api_key,
            settings::clear_api_key,
            windows::open_task_window,
            windows::focus_main_window,
            windows::open_shot_editor,
            shots::list_shots,
            shots::get_shot,
            shots::update_shot,
            shots::delete_shot,
            shots::read_shot_bytes,
            shots::save_shot_image,
            shots::reveal_shot,
            capture::start_capture,
            capture::capture_info,
            capture::finish_capture,
            capture::cancel_capture,
            capture::copy_shot_image,
            capture::request_attach,
            capture::switch_to_window_capture,
            capture::copy_png_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daybook");
}
