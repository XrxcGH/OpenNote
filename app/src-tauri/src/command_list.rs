// Every command the interface can call (ARCHITECTURE.md section 6.4). build.rs includes this file to declare
// the commands in the app manifest. The manifest generates an `allow-<command>` permission for each one, and
// capabilities/default.json grants each by name. The tests below keep this list, the generate_handler! list in
// lib.rs, and the capability file in step. This file has no inner doc comment, because build.rs includes it.

/// The app's commands, grouped by module in the order of the table in ARCHITECTURE.md section 6.4.
#[rustfmt::skip]
pub const APP_COMMANDS: &[&str] = &[
    "settings_update", "settings_reset",
    "state_update", "state_flush",
    "window_minimize", "window_toggle_maximize", "window_close", "window_set_title",
    "window_set_caption_layout", "window_show_system_menu", "window_set_frame_theme",
    "app_first_paint", "app_ready", "app_exit_ready",
    "perf_mark", "log_write",
    "audio_assets_dir", "audio_devices", "audio_clock", "audio_prepare", "audio_begin",
    "audio_recording_status", "audio_pause_recording", "audio_resume_recording",
    "audio_switch_microphone", "audio_switch_system_audio", "audio_stop", "audio_recover",
    "audio_open_playback", "audio_play", "audio_pause_playback", "audio_seek", "audio_skip",
    "audio_set_speed", "audio_set_skip_silence", "audio_playback_status", "audio_close_playback",
    "audio_trim_silence", "audio_remove_part", "audio_delete_files", "audio_adopt_tracks",
    "audio_split", "audio_enhance", "audio_compress", "audio_storage_scan", "audio_purge_history", "audio_export",
    "audio_import_file", "audio_meeting_poll", "audio_snap",
    "crash_consent_get", "crash_consent_set", "crash_example", "crash_list", "crash_prepare", "crash_send",
    "crash_delete", "crash_delete_all", "diagnostics_self_check", "diagnostics_build_feedback",
    "diagnostics_save_feedback", "diagnostics_startup", "diagnostics_enter_safe_mode", "diagnostics_restart",
    "privacy_get", "privacy_set_offline",
    "install_status", "install_pick_folder", "install_check_folder", "install_move_to_user_programs",
    "shell_open_external",
    "updater_status", "updater_check", "updater_download", "updater_restart_to_update",
    "updater_skip", "updater_unskip", "updater_go_back",
    "notes_snapshot_load", "notes_snapshot_save",
    "notes_load_initial", "notes_list_notebooks", "notes_list_children", "notes_get", "notes_create", "notes_rename",
    "notes_set_color", "notes_move", "notes_set_page_level", "notes_trash", "notes_restore", "notes_list_trash",
    "notes_restore_from_trash", "notes_purge", "notes_status", "notes_flush",
    "page_open", "page_apply", "page_undo", "page_redo", "page_save_now", "page_close",
    "history_list", "history_open", "history_restore", "history_restore_blocks", "history_name",
    "page_add_strokes", "page_read_strokes",
    "clipboard_facts", "clipboard_read", "image_import", "image_import_url", "image_import_clip",
    "spell_languages", "spell_check", "spell_suggest", "spell_add_word", "spell_remove_word", "speech_voices", "speech_synthesize",
    "print_prepare", "print_render", "print_close", "export_pick_save", "export_write", "export_open", "export_selection_docx",
    "search_call", "shellqol_call",
    "tool_window_open", "study_anki_read", "study_anki_write", "study_zotero_items",
    "interop_pick", "interop_detect", "interop_local_sources", "interop_preview", "interop_import", "interop_cancel",
    "interop_export", "interop_reveal", "interop_more",
    "intel_settings_get", "intel_settings_set", "intel_status", "intel_ocr_languages",
    "intel_ocr_recognize", "intel_ink_recognize", "intel_ink_tidy", "intel_summarize",
    "intel_keywords", "intel_action_items", "intel_chapters", "intel_vocabulary_offer",
    "intel_speech_voices", "intel_speech_synthesize", "intel_read_aloud_start", "intel_read_aloud_next",
    "intel_read_aloud_cancel", "intel_clip_audio", "intel_ext_call",
    "page_extras_caret", "page_extras_link_title", "attachment_import", "attachment_open", "attachment_stop",
    "connectors_list", "connectors_connect", "connectors_cancel", "connectors_disconnect", "connectors_request",
];

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::APP_COMMANDS;

    fn sorted<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<&'a str> {
        let mut names: Vec<_> = names.into_iter().collect();
        names.sort_unstable();
        names
    }

    #[test]
    fn names_each_command_once() {
        assert_eq!(APP_COMMANDS.iter().collect::<BTreeSet<_>>().len(), APP_COMMANDS.len());
    }

    #[test]
    fn lib_registers_exactly_these_commands() {
        let lib = include_str!("lib.rs");
        let start = lib.find("generate_handler![").expect("lib.rs registers its commands") + "generate_handler![".len();
        let list = &lib[start..start + lib[start..].find(']').expect("the list ends")];
        let registered = list.split(',').map(str::trim).filter(|path| !path.is_empty());
        let names = registered.map(|path| path.rsplit("::").next().unwrap_or(path));
        assert_eq!(sorted(names), sorted(APP_COMMANDS.iter().copied()));
    }

    #[test]
    fn the_capability_grants_exactly_these_commands() {
        let file = include_str!("../capabilities/default.json");
        let capability: serde_json::Value = serde_json::from_str(file).expect("the capability file is JSON");
        let granted = capability["permissions"].as_array().expect("a permissions list");
        let granted: Vec<&str> = granted.iter().filter_map(|permission| permission.as_str()).collect();
        let expected: Vec<String> = APP_COMMANDS
            .iter()
            .map(|name| format!("allow-{}", name.replace('_', "-")))
            .collect();
        let expected = expected.iter().map(String::as_str).chain(["core:default"]);
        assert_eq!(sorted(granted), sorted(expected));
    }
}
