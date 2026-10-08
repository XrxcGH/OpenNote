//! The custom window frame (ARCHITECTURE.md section 10.1), behind the `shell.customFrame` flag. With the flag on,
//! the window is undecorated and the page draws the title bar. CSS `app-region: drag` gives the real caption
//! through WebView2's non-client region support, and the HTML caption buttons call the window commands. Tauri keeps
//! resizing an undecorated window from its edges, and tao keeps `WS_SYSMENU` and `WS_MAXIMIZEBOX`, so the system
//! menu, Win+Up, and Win+Z still work.
//!
//! The page decides: its first caption layout report switches the frame ([`apply`]). Creating the window with the
//! right frame ([`at_start`], from the boot payload) only avoids a flash of the other frame before that report.
//!
//! A page that never draws its title bar would leave a window that can't be moved or closed with the mouse. So
//! the window gets the native frame back when no layout has arrived by [`REPORT_DEADLINE`], and when the page's
//! process fails ([`fall_back`]). A later report switches to the custom frame again.

use std::{collections::BTreeMap, thread, time::Duration};

use tauri::{Manager, WebviewWindow};

use super::caption::{CaptionLayout, CaptionOverlay};
use crate::{boot::Channel, ipc::IpcResult};

/// The flag's id, shared with the interface's `FlagId`.
pub const FLAG: &str = "shell.customFrame";

/// How long a window created without the native frame waits for the page's caption buttons before it takes the
/// native frame back. Development builds load the page from a dev server, so this leaves room for a slow start.
pub const REPORT_DEADLINE: Duration = Duration::from_secs(4);

/// Whether the flag is on: its channel default (on in every build but Stable, as in the interface), then the
/// overrides in order, the last one that names the flag winning. Overrides apply only to development and nightly
/// builds, as in the interface's `initFlags`.
pub fn is_enabled(channel: Channel, overrides: &[&BTreeMap<String, bool>]) -> bool {
    let default = !matches!(channel, Channel::Stable);
    if !matches!(channel, Channel::Dev | Channel::Nightly) {
        return default;
    }
    overrides
        .iter()
        .rev()
        .find_map(|overrides| overrides.get(FLAG).copied())
        .unwrap_or(default)
}

/// Whether to create the main window without the native frame, from the boot payload's channel and flag overrides
/// and the experimental flags in settings, in the order the interface's `initFlags` applies them.
pub fn at_start(
    channel: Channel,
    boot_overrides: &BTreeMap<String, bool>,
    settings_flags: &BTreeMap<String, bool>,
) -> bool {
    is_enabled(channel, &[boot_overrides, settings_flags])
}

/// Applies a caption layout on the main thread, which owns the window: the native frame for `None`, the custom
/// frame and the Snap Layouts overlay for `Some`.
pub fn apply(window: &WebviewWindow, layout: Option<CaptionLayout>) -> IpcResult<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        if let Err(error) = apply_now(&target, layout.as_ref()) {
            log::warn!("Couldn't apply the caption layout: {error}");
        }
    })?;
    Ok(())
}

/// Gives the window the native frame back when the page has no caption buttons to draw. With `page_lost`, the
/// page's process failed, so a layout it reported no longer stands. Otherwise only a window without a reported
/// layout falls back. The page's next report then counts as its first.
pub fn fall_back(window: &WebviewWindow, page_lost: bool) {
    let target = window.clone();
    let result = window.run_on_main_thread(move || {
        if !target.state::<CaptionOverlay>().forget(!page_lost) {
            return;
        }
        if target.is_decorated().unwrap_or(true) {
            return;
        }
        log::warn!("The page has no caption buttons, so the window has its native frame back.");
        if let Err(error) = apply_now(&target, None) {
            log::warn!("Couldn't give the window its native frame back: {error}");
        }
    });
    if let Err(error) = result {
        log::warn!("Couldn't reach the window to give it its native frame back: {error}");
    }
}

/// Gives a window created without the native frame [`REPORT_DEADLINE`] for the page to report its caption
/// buttons, then falls back to the native frame if it hasn't.
pub fn await_first_report(window: &WebviewWindow) {
    let window = window.clone();
    thread::spawn(move || {
        thread::sleep(REPORT_DEADLINE);
        fall_back(&window, false);
    });
}

fn apply_now(window: &WebviewWindow, layout: Option<&CaptionLayout>) -> IpcResult<()> {
    let custom = layout.is_some();
    if window.is_decorated()? == custom {
        window.set_decorations(!custom)?;
    }
    platform::apply(window, layout)
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;

    use super::super::{caption::CaptionLayout, resize_border, snap_overlay, subclass};
    use crate::ipc::IpcResult;

    pub fn apply(window: &WebviewWindow, layout: Option<&CaptionLayout>) -> IpcResult<()> {
        let hwnd = window.hwnd()?;
        if layout.is_some() {
            subclass::install(window, hwnd);
            resize_border::install(hwnd);
        }
        match layout {
            Some(layout) if layout.snap_layouts => snap_overlay::show(window, hwnd, layout),
            _ => snap_overlay::remove(hwnd),
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    use super::super::caption::CaptionLayout;
    use crate::ipc::IpcResult;

    /// Other systems have no Snap Layouts flyout.
    pub fn apply(_window: &WebviewWindow, _layout: Option<&CaptionLayout>) -> IpcResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(value: bool) -> BTreeMap<String, bool> {
        BTreeMap::from([(FLAG.to_owned(), value)])
    }

    #[test]
    fn is_on_by_default_in_every_channel_but_stable() {
        for channel in [Channel::Dev, Channel::Nightly, Channel::Beta] {
            assert!(is_enabled(channel, &[]));
            assert!(is_enabled(channel, &[&BTreeMap::new()]));
        }
        assert!(!is_enabled(Channel::Stable, &[]));
    }

    #[test]
    fn follows_overrides_in_development_and_nightly_builds_only() {
        assert!(is_enabled(Channel::Dev, &[&flags(true)]));
        assert!(is_enabled(Channel::Nightly, &[&flags(true)]));
        assert!(!is_enabled(Channel::Dev, &[&flags(false)]));
        assert!(is_enabled(Channel::Beta, &[&flags(false)]));
        assert!(!is_enabled(Channel::Stable, &[&flags(true)]));
    }

    #[test]
    fn starts_undecorated_unless_stable_or_the_boot_overrides_or_settings_say_no() {
        let none = BTreeMap::new();
        assert!(at_start(Channel::Dev, &none, &none));
        assert!(at_start(Channel::Beta, &none, &none));
        assert!(!at_start(Channel::Dev, &flags(false), &none));
        assert!(at_start(Channel::Dev, &flags(true), &none));
        assert!(at_start(Channel::Nightly, &none, &flags(true)));
        assert!(!at_start(Channel::Dev, &flags(true), &flags(false)));
        assert!(!at_start(Channel::Stable, &flags(true), &flags(true)));
    }

    #[test]
    fn lets_the_last_override_win() {
        assert!(!is_enabled(Channel::Dev, &[&flags(true), &flags(false)]));
        assert!(is_enabled(Channel::Dev, &[&flags(false), &flags(true)]));
        assert!(is_enabled(Channel::Dev, &[&flags(true), &BTreeMap::new()]));
    }
}
