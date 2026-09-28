mod claude;
mod disk;
mod settings;
mod system;
mod tray;

pub fn run() {
    tauri::Builder::default()
        .plugin(tray::autostart_plugin())
        .plugin(tray::global_shortcut_plugin())
        .manage(system::Monitor::new())
        .invoke_handler(tauri::generate_handler![
            system::get_system_stats,
            claude::get_claude_stats,
            disk::get_disk_report,
            disk::clean_targets,
            settings::get_settings,
            settings::save_settings
        ])
        // закрытие окна прячет его в трей, а не завершает приложение
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            // ВАЖНО: окно создаётся скрытым (visible: false в tauri.conf.json),
            // показывает его именно tray::setup. Без этого вызова приложение
            // запустится невидимым.
            tray::setup(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
