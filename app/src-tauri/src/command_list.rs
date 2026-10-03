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
    "install_status", "install_pick_folder", "install_check_folder", "install_move_to_user_programs",
    "shell_open_external",
    "updater_status", "updater_check", "updater_download", "updater_restart_to_update",
    "updater_skip", "updater_unskip", "updater_go_back",
    "notes_snapshot_load", "notes_snapshot_save",
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
