mod ai;
mod comments;
mod db;
mod error;
mod markdown;
mod notes;
mod quickadd;
mod reminders;
mod settings;
mod tasks;
mod timer;
mod windows;

use tauri::Manager;

pub fn run() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let database = db::Db::open().map_err(|e| e.to_string())?;
            app.manage(database);
            app.manage(ai::AiState::default());
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daybook");
}
