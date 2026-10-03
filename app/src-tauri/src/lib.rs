//! The OpenNote desktop shell: the app's managed state, its commands, and the run loop (ARCHITECTURE.md section
//! 8.1). `main.rs` runs the early start-up steps, then calls [`run`].

pub mod appearance;
pub mod args;
pub mod audio;
pub mod audio_more;
pub mod boot;
pub mod clipboard;
pub mod command_list;
pub mod core_bridge;
pub mod early;
pub mod events;
pub mod hardening;
pub mod images;
pub mod ink_bridge;
pub mod install;
pub mod instance;
pub mod intel;
pub mod interop;
pub mod ipc;
pub mod lifecycle;
pub mod log;
pub mod notes;
pub mod notes_snapshot;
pub mod page_export;
pub mod paths;
pub mod perf;
pub mod settings;
pub mod shell;
pub mod speech;
pub mod spelling;
pub mod state;
pub mod theme_tokens;
pub mod tool_windows;
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
    // The crash hooks go first, so a crash while the rest starts is saved too (once the person said yes).
    let hardening = hardening::Hardening::start(&paths);
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
    let audio = audio::AudioState::new(&paths);
    let intel = intel::IntelState::new(&paths);
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
        .manage(hardening)
        .manage(clipboard::ClipTokens::default())
        .manage(spelling::SpellService)
        .manage(page_export::ExportGrants::default())
        .manage(audio)
        .manage(intel)
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
            audio::shutdown(app);
            flush_files(app);
            app.state::<core_bridge::CoreBridge>().shutdown();
            app.state::<hardening::Hardening>().end_clean();
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
// checks-disable-next-line modifiability: Tauri's handler macro takes the whole list of commands in one place.
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
        audio::audio_assets_dir,
        audio::audio_devices,
        audio::audio_clock,
        audio::audio_prepare,
        audio::audio_begin,
        audio::audio_recording_status,
        audio::audio_pause_recording,
        audio::audio_resume_recording,
        audio::audio_switch_microphone,
        audio::audio_switch_system_audio,
        audio::audio_stop,
        audio::audio_recover,
        audio::audio_open_playback,
        audio::audio_play,
        audio::audio_pause_playback,
        audio::audio_seek,
        audio::audio_skip,
        audio::audio_set_speed,
        audio::audio_set_skip_silence,
        audio::audio_playback_status,
        audio::audio_close_playback,
        audio::audio_trim_silence,
        audio::audio_remove_part,
        audio::audio_delete_files,
        audio::audio_adopt_tracks,
        audio_more::audio_split,
        audio_more::audio_enhance,
        audio_more::audio_compress,
        audio_more::audio_storage_scan,
        audio_more::audio_purge_history,
        audio_more::audio_export,
        audio_more::audio_import_file,
        audio_more::meeting::audio_meeting_poll,
        audio_more::snap::audio_snap,
        hardening::crash_consent_get,
        hardening::crash_consent_set,
        hardening::crash_example,
        hardening::crash_list,
        hardening::crash_prepare,
        hardening::crash_send,
        hardening::crash_delete,
        hardening::crash_delete_all,
        hardening::diagnostics_self_check,
        hardening::diagnostics_build_feedback,
        hardening::diagnostics_save_feedback,
        hardening::diagnostics_startup,
        hardening::diagnostics_enter_safe_mode,
        hardening::diagnostics_restart,
        hardening::privacy_get,
        hardening::privacy_set_offline,
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
        core_bridge::search::search_call,
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
        page_export::print_prepare,
        page_export::print_render,
        page_export::print_close,
        page_export::export_pick_save,
        page_export::export_write,
        page_export::export_open,
        tool_windows::tool_window_open,
        interop::commands::interop_pick,
        interop::commands::interop_detect,
        interop::commands::interop_local_sources,
        interop::commands::interop_preview,
        interop::commands::interop_import,
        interop::commands::interop_cancel,
        interop::commands::interop_export,
        interop::commands::interop_reveal,
        intel::intel_settings_get,
        intel::intel_settings_set,
        intel::intel_status,
        intel::intel_ocr_languages,
        intel::intel_ocr_recognize,
        intel::intel_ink_recognize,
        intel::intel_ink_tidy,
        intel::intel_summarize,
        intel::intel_keywords,
        intel::intel_action_items,
        intel::intel_chapters,
        intel::intel_vocabulary_offer,
        intel::intel_speech_voices,
        intel::intel_speech_synthesize,
        intel::intel_read_aloud_start,
        intel::intel_read_aloud_next,
        intel::intel_read_aloud_cancel,
        intel::intel_clip_audio,
    ]
}
