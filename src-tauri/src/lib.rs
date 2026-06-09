pub mod cli;
pub mod commands;
pub mod doctor;
pub mod git;
pub mod update;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_path = cli::parse_launch_path(&std::env::args().collect::<Vec<_>>());

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        use tauri::{Emitter, Manager};
        if let Some(path) = cli::parse_launch_path(&argv) {
            let _ = app.emit("open-repo", path.display().to_string());
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(cli::LaunchPath(launch_path))
        .invoke_handler(tauri::generate_handler![
            commands::get_repository_state,
            commands::get_commit_log,
            commands::get_diff,
            commands::preview_push,
            commands::push_branch,
            commands::preview_pull,
            commands::pull_branch,
            commands::add_remote,
            commands::set_remote_url,
            commands::remove_remote,
            commands::stage_files,
            commands::unstage_files,
            commands::preview_commit,
            commands::create_commit,
            commands::get_last_commit_message,
            commands::get_launch_path,
            commands::install_cli,
            commands::cli_status,
            commands::detect_install_source,
            commands::doctor_run,
            commands::doctor_fix
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
