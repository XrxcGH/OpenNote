//! The OpenNote desktop shell: the app's managed state, its commands, and the run loop (ARCHITECTURE.md section
//! 8.1). `main.rs` runs the early start-up steps, then calls [`run`].

pub mod appearance;
pub mod args;
pub mod boot;
pub mod command_list;
pub mod early;
pub mod events;
pub mod install;
pub mod instance;
pub mod ipc;
pub mod lifecycle;
pub mod log;
pub mod notes_snapshot;
pub mod paths;
pub mod perf;
pub mod settings;
pub mod shell;
pub mod state;
pub mod theme_tokens;
pub mod updater;
pub mod window;
pub mod zoom;

use tauri::{ipc::Invoke, Manager};

use early::EarlyContext;
use settings::{schema::Settings, SettingsStore};

/// Starts the app with what the early steps found. Doesn't return.
pub fn run(context: EarlyContext) {
    let EarlyContext {
        args,
        paths,
        instance,
        guard,
    } = context;
    // The instance guard holds the profile's lock, so it stays alive until the process exits.
    let _instance = instance;
    let hooks = lifecycle::Hooks(updater::hooks(&paths));
    tauri::Builder::default()
        .manage(SettingsStore::in_memory(&Settings::default()))
        .manage(hooks)
        .manage(boot::Launch { args, guard })
        .manage(paths)
        .on_page_load(window::show_when_loaded)
        .setup(|app| {
            window::caption::init(app.handle());
            if let Some(main) = app.get_webview_window(window::MAIN) {
                window::show_after_fallback_delay(main);
            }
            Ok(())
        })
        .invoke_handler(commands())
        .run(tauri::generate_context!())
        .expect("OpenNote failed to start");
}

/// Every command in `command_list::APP_COMMANDS`. A test keeps the two lists in step.
fn commands() -> impl Fn(Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        settings::commands::settings_update,
        settings::commands::settings_reset,
        state::state_update,
        state::state_flush,
        window::window_minimize,
        window::window_toggle_maximize,
        window::window_close,
        window::window_set_title,
        window::caption::window_set_caption_layout,
        window::window_show_system_menu,
        window::window_set_frame_theme,
        lifecycle::app_first_paint,
        lifecycle::app_ready,
        lifecycle::app_exit_ready,
        perf::perf_mark,
        crate::log::log_write,
        install::install_status,
        install::install_pick_folder,
        install::install_check_folder,
        install::install_move_to_user_programs,
        shell::shell_open_external,
        updater::updater_status,
        updater::updater_check,
        updater::updater_download,
        updater::updater_restart_to_update,
        updater::updater_skip,
        updater::updater_unskip,
        updater::updater_go_back,
        notes_snapshot::notes_snapshot_load,
        notes_snapshot::notes_snapshot_save,
    ]
}
