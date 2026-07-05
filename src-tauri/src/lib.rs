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
            commands::get_file_blame,
            commands::get_file_history,
            commands::preview_push,
            commands::push_branch,
            commands::preview_clone,
            commands::clone_repository,
            commands::get_ssh_diagnostics,
            commands::preview_pull,
            commands::pull_branch,
            commands::add_remote,
            commands::set_remote_url,
            commands::remove_remote,
            commands::stage_files,
            commands::unstage_files,
            commands::apply_partial,
            commands::lfs_track,
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
            commands::preview_checkout_commit,
            commands::checkout_branch,
            commands::checkout_commit,
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
            commands::preview_revert,
            commands::revert_commit,
            commands::preview_reset,
            commands::reset_to_commit,
            commands::list_conflicted_files,
            commands::preview_resolve_conflict,
            commands::resolve_conflict,
            commands::preview_rebase,
            commands::rebase_branch,
            commands::abort_git_operation,
            commands::continue_git_operation,
            commands::preview_fetch,
            commands::fetch_remote,
            commands::preview_merge_branch,
            commands::merge_branch,
            commands::preview_discard_changes,
            commands::discard_changes,
            commands::get_launch_path,
            commands::install_cli,
            commands::cli_status,
            commands::detect_install_source,
            commands::doctor_run,
            commands::doctor_fix,
            commands::open_repo_window,
            commands::get_timeline,
            commands::plan_undo,
            commands::execute_undo,
            commands::get_snapshot_diff,
            commands::list_snapshot_files,
            commands::restore_snapshot_file,
            commands::cleanup_snapshots
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
