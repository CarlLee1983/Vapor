pub mod cli;
pub mod commands;
pub mod doctor;
pub mod git;
pub mod update;
pub mod window;

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
            commands::list_git_tags,
            commands::read_tagsmith_config,
            commands::preview_create_tag,
            commands::create_git_tag,
            commands::preview_delete_tag,
            commands::delete_git_tag,
            commands::preview_checkout_branch,
            commands::checkout_branch,
            commands::preview_create_branch,
            commands::create_branch,
            commands::preview_rename_branch,
            commands::rename_branch,
            commands::preview_delete_branch,
            commands::delete_branch,
            commands::list_stashes,
            commands::preview_create_stash,
            commands::create_stash,
            commands::preview_apply_stash,
            commands::apply_stash,
            commands::preview_pop_stash,
            commands::pop_stash,
            commands::preview_drop_stash,
            commands::drop_stash,
            commands::preview_cherry_pick,
            commands::cherry_pick_commit,
            commands::abort_git_operation,
            commands::continue_git_operation,
            commands::get_launch_path,
            commands::install_cli,
            commands::cli_status,
            commands::detect_install_source,
            commands::doctor_run,
            commands::doctor_fix,
            commands::open_repo_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
