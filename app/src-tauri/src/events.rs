//! The events Rust sends to the interface, named `<domain>://<event>` (ARCHITECTURE.md section 6.4). The
//! interface listens for the same names in `platform/tauri/`.

/// `{ settings, origin }`: the settings changed, and `origin` is the label of the window that changed them.
pub const SETTINGS_CHANGED: &str = "settings://changed";

/// `OsAppearance`: the Windows theme, contrast, animations, text scale, or effective zoom changed.
pub const OS_APPEARANCE_CHANGED: &str = "os://appearance-changed";

/// `boolean`: the window was maximized (`true`) or restored (`false`).
pub const WINDOW_MAXIMIZED: &str = "window://maximized";

/// `CaptionState`: hover and pressed state of the Snap Layouts overlay over the Maximize button.
pub const WINDOW_CAPTION_STATE: &str = "window://caption-state";

/// `string[]`: the arguments of a second launch, forwarded to this process.
pub const WINDOW_FORWARDED_ARGS: &str = "window://forwarded-args";

/// `ExitReason`: the app is about to close; the interface runs its before-exit hooks and answers.
pub const APP_BEFORE_EXIT: &str = "app://before-exit";

/// `UpdaterStatus`: the updater's phase or details changed.
pub const UPDATER_STATUS: &str = "updater://status";

/// Every event name, for tests and for the interface's mirror of this list.
pub const ALL: [&str; 7] = [
    SETTINGS_CHANGED,
    OS_APPEARANCE_CHANGED,
    WINDOW_MAXIMIZED,
    WINDOW_CAPTION_STATE,
    WINDOW_FORWARDED_ARGS,
    APP_BEFORE_EXIT,
    UPDATER_STATUS,
];

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::ALL;

    #[test]
    fn names_are_unique_and_follow_the_domain_scheme() {
        assert_eq!(ALL.iter().collect::<HashSet<_>>().len(), ALL.len());
        for name in ALL {
            let (domain, event) = name.split_once("://").expect("every name has a domain");
            let valid = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_lowercase() || c == '-');
            assert!(valid(domain) && valid(event), "{name}");
        }
    }
}
