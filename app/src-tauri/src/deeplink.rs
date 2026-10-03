//! `opennote://` links (Phase 8, Links to paragraphs). A link names a page, and a heading or paragraph in it, by
//! IDs, so it survives renames and moves. Windows starts `OpenNote.exe "opennote://page/<id>"` when a person
//! follows one from Outlook, Word, Teams, or a browser. A second launch reaches the running window through the
//! single-instance forwarding (`window://forwarded-args`); the first launch's link waits here until the interface
//! asks for it with the `launchLink` search method. A link only ever opens a page: this module reads nothing else
//! from it.
//!
//! The protocol is registered for the current user (`HKCU\Software\Classes\opennote`), not for the machine, and
//! only by a release build that does not run from a portable folder, so a development build never takes the
//! link away from the installed app and a portable copy leaves nothing behind.

use std::sync::Mutex;

/// The scheme, with its separator.
const PREFIX: &str = "opennote://";

/// The longest link accepted. A longer one is not a link this app made.
const MAX_LINK_LEN: usize = 512;

static LAUNCH: Mutex<Option<String>> = Mutex::new(None);

/// Whether an argument is an OpenNote link: the scheme, then only characters a page or element ID link uses.
pub fn is_link(arg: &str) -> bool {
    let arg = arg.trim();
    arg.len() <= MAX_LINK_LEN
        && arg.len() > PREFIX.len()
        && arg[..PREFIX.len()].eq_ignore_ascii_case(PREFIX)
        && arg[PREFIX.len()..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '%' | '#' | '?' | '=' | '&' | '.'))
}

/// The first OpenNote link among the arguments.
pub fn find_link(args: &[String]) -> Option<String> {
    args.iter().find(|arg| is_link(arg)).map(|arg| arg.trim().to_owned())
}

/// Keeps the link a first launch was started with, for the interface to take once.
pub fn remember_launch(args: &[String]) {
    if let Some(link) = find_link(args) {
        *LAUNCH.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(link);
    }
}

/// The link the app was started with. It is given out once.
pub fn take_launch() -> Option<String> {
    LAUNCH.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
}

/// Registers `opennote://` for the current user so Windows starts this exe for it. Best effort: a failure is
/// logged and the app goes on.
pub fn register_protocol() {
    #[cfg(all(windows, not(debug_assertions)))]
    if let Err(error) = registry::register() {
        log::warn!("Couldn't register opennote:// links: {error}");
    }
}

#[cfg(all(windows, not(debug_assertions)))]
mod registry {
    use windows::{
        core::PCWSTR,
        Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE,
            REG_SZ,
        },
    };

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn set(path: &str, name: Option<&str>, value: &str) -> Result<(), String> {
        let path = wide(path);
        let value = wide(value);
        let name = name.map(wide);
        let mut key = HKEY::default();
        // SAFETY: the strings are NUL-terminated and outlive the calls, and the key is closed before returning.
        unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(path.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
            .ok()
            .map_err(|error| error.to_string())?;
            let bytes = std::slice::from_raw_parts(value.as_ptr().cast::<u8>(), value.len() * 2);
            let result = RegSetValueExW(
                key,
                name.as_ref().map_or(PCWSTR::null(), |name| PCWSTR(name.as_ptr())),
                None,
                REG_SZ,
                Some(bytes),
            );
            let _ = RegCloseKey(key);
            result.ok().map_err(|error| error.to_string())
        }
    }

    pub(super) fn register() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|error| error.to_string())?;
        if exe.parent().is_some_and(|dir| dir.join("portable").exists()) {
            return Ok(());
        }
        let command = format!("\"{}\" \"%1\"", exe.display());
        let root = "Software\\Classes\\opennote";
        set(root, None, "URL:OpenNote link")?;
        set(root, Some("URL Protocol"), "")?;
        set(&format!("{root}\\shell\\open\\command"), None, &command)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_page_and_paragraph_links() {
        assert!(is_link("opennote://page/01hzx3k9q7m2v5c8d4e6f0abcd"));
        assert!(is_link("OpenNote://page/abc/def?x=1#y"));
    }

    #[test]
    fn refuses_everything_else() {
        assert!(!is_link("https://example.com"));
        assert!(!is_link("opennote://"));
        assert!(!is_link("opennote://page/a b"));
        assert!(!is_link("opennote://page/\"; calc"));
        assert!(!is_link(&format!("opennote://{}", "a".repeat(600))));
    }

    #[test]
    fn finds_the_link_among_arguments() {
        let args = vec!["--x".to_owned(), " opennote://page/abc ".to_owned()];
        assert_eq!(find_link(&args).as_deref(), Some("opennote://page/abc"));
        assert_eq!(find_link(&["notes.onepkg".to_owned()]), None);
    }
}
