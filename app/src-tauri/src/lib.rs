//! The OpenNote desktop shell: the app's managed state, its commands, and the run loop (ARCHITECTURE.md section
//! 8.1). `main.rs` runs the early start-up steps, then calls [`run`].

pub mod appearance;
pub mod args;
pub mod boot;
pub mod clipboard;
pub mod command_list;
pub mod core_bridge;
pub mod early;
pub mod events;
pub mod images;
pub mod ink_bridge;
pub mod install;
pub mod instance;
pub mod ipc;
pub mod lifecycle;
pub mod log;
pub mod notes;
pub mod notes_snapshot;
pub mod paths;
pub mod perf;
pub mod settings;
pub mod shell;
pub mod speech;
pub mod spelling;
pub mod state;
pub mod theme_tokens;
pub mod updater;
pub mod window;
pub mod zoom;

use tauri::{ipc::Invoke, Manager};

use boot::Startup;
use early::EarlyContext;
use instance::InstanceGuard;
use lifecycle::ExitState;
use settings::SettingsStore;
use state::DeviceStateStore;

/// Where ts-rs writes the interface's copies of the shared types (ARCHITECTURE.md section 6.2), relative to its
/// default `bindings` folder under this crate. `cargo test` writes them, and CI fails when they drift.
#[cfg(test)]
pub(crate) const BINDINGS: &str = "../../src/platform/bindings/";

/// Starts the app with what the early steps found. Doesn't return.
pub fn run(context: EarlyContext) {
    let EarlyContext {
        args,
        paths,
        instance,
        guard,
        webview2_version,
    } = context;
    install::set_app_user_model_id();
    let loaded = SettingsStore::load(&paths);
    let (state, state_notice) = DeviceStateStore::load(&paths);
    perf::mark("settingsLoaded", None);
    let mut launch = boot::Launch { args, guard };
    // A moved-from path that isn't the copy this one was made from is dropped, so it also gets no "Moved" notice.
    if let Some(old) = launch.args.moved_from.take() {
        if install::delete_moved_from(&paths, old.clone()) {
            launch.args.moved_from = Some(old);
        }
    }
    let settings = loaded.store.get();
    let mut notices = loaded.notices;
    notices.extend(state_notice);
    notices.extend(launch.notices(env!("CARGO_PKG_VERSION")));
    let startup = Startup {
        first_run: loaded.first_run,
        settings_read_only: loaded.store.read_only(),
        notices,
        webview2_version,
        process_start_epoch_ms: boot::process_start_epoch_ms(),
        updater: updater::initial_status(&paths, &settings),
        flag_overrides: boot::flag_overrides(&std::env::var("OPENNOTE_FLAGS").unwrap_or_default()),
    };
    let hooks = lifecycle::Hooks(updater::hooks(&paths));
    let pages = core_bridge::CoreBridge::new(&paths);
    let builder = images::register_renditions(tauri::Builder::default());
    let app = builder
        .manage(loaded.store)
        .manage(state)
        .manage(hooks)
        .manage(startup)
        .manage(launch)
        .manage(paths)
        .manage(ExitState::default())
        .manage(pages)
        .manage(clipboard::ClipTokens::default())
        .manage(spelling::SpellService)
        // The instance guard holds the profile's lock, so it lives in managed state until the process exits.
        .manage(instance)
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<InstanceGuard>()
                .on_forwarded(move |forwarded| window::receive_forwarded(&handle, forwarded.args));
            window::caption::init(app.handle());
            window::create(app.handle())?;
            Ok(())
        })
        .invoke_handler(commands())
        .build(tauri::generate_context!())
        .expect("OpenNote failed to start");
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            flush_files(app);
            app.state::<core_bridge::CoreBridge>().shutdown();
        }
    });
}

/// Saves the settings and the device state that are still waiting for their writers.
pub fn flush_files(app: &tauri::AppHandle) {
    if let Err(error) = app.state::<SettingsStore>().flush() {
        ::log::error!("Couldn't save the settings: {error}");
    }
    if let Err(error) = app.state::<DeviceStateStore>().flush() {
        ::log::error!("Couldn't save the device state: {error}");
    }
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
        notes::notes_load_initial,
        notes::notes_list_notebooks,
        notes::notes_list_children,
        notes::notes_get,
        notes::notes_create,
        notes::notes_rename,
        notes::notes_set_color,
        notes::notes_move,
        notes::notes_set_page_level,
        notes::notes_trash,
        notes::notes_restore,
        notes::notes_list_trash,
        notes::notes_restore_from_trash,
        notes::notes_purge,
        notes::notes_status,
        notes::notes_flush,
        core_bridge::page_open,
        core_bridge::page_apply,
        core_bridge::page_undo,
        core_bridge::page_redo,
        core_bridge::page_save_now,
        core_bridge::page_close,
        core_bridge::history_list,
        core_bridge::history_open,
        core_bridge::history_restore,
        core_bridge::history_restore_blocks,
        core_bridge::history_name,
        ink_bridge::page_add_strokes,
        ink_bridge::page_read_strokes,
        clipboard::clipboard_facts,
        clipboard::clipboard_read,
        images::import::image_import,
        images::web::image_import_url,
        images::import::image_import_clip,
        spelling::spell_languages,
        spelling::spell_check,
        spelling::spell_suggest,
        spelling::spell_add_word,
        spelling::spell_remove_word,
        speech::speech_voices,
        speech::speech_synthesize,
    ]
}
