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
//!
//! On Windows, tao keeps the caption styles on a window without the native frame and answers `WM_NCCALCSIZE` for
//! it. The first `WM_NCCALCSIZE` comes before tao's handler is ready, so the window starts with the native caption
//! until something recomputes the frame. Showing the window through tao does, and so does every report that switches
//! the frame ([`apply`]), so a native caption never stays over caption buttons the page draws.

use std::{collections::BTreeMap, thread, time::Duration};

use tauri::{Manager, WebviewWindow};

use super::{
    caption::{CaptionLayout, CaptionOverlay},
    tao_window::TaoWindow,
};
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
    // macOS and Linux keep their own title bars: the traffic lights, and the window manager's frame (ADR 0055).
    cfg!(windows) && is_enabled(channel, &[boot_overrides, settings_flags])
}

/// Applies a caption layout on the main thread, which owns the window: the native frame for `None`, the custom
/// frame and the Snap Layouts overlay for `Some`. With `frame_changed`, the report switches the frame, or is the
/// first, so the window's frame is recomputed too.
pub fn apply(window: &WebviewWindow, layout: Option<CaptionLayout>, frame_changed: bool) -> IpcResult<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        if let Err(error) = apply_now(&target, layout.as_ref(), frame_changed) {
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
        if let Err(error) = apply_now(&target, None, true) {
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

fn apply_now(window: &WebviewWindow, layout: Option<&CaptionLayout>, frame_changed: bool) -> IpcResult<()> {
    switch_frame(window, layout.is_some(), frame_changed)?;
    platform::apply(window, layout)
}

/// Gives the window the custom frame or the native one. Tao skips `set_decorations` when it already counts the
/// window as undecorated, as it does from creation, so a report that switches the frame also recomputes it.
fn switch_frame(window: &impl TaoWindow, custom: bool, frame_changed: bool) -> tauri::Result<()> {
    if window.is_decorated()? == custom {
        window.set_decorations(!custom)?;
    }
    if frame_changed {
        platform::refresh_frame(window)?;
    }
    Ok(())
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
        },
    };

    use super::super::{caption::CaptionLayout, resize_border, snap_overlay, subclass, tao_window::TaoWindow};
    use crate::ipc::IpcResult;

    pub fn refresh_frame(window: &impl TaoWindow) -> tauri::Result<()> {
        recompute_frame(window.hwnd()?);
        Ok(())
    }

    /// Sends `WM_NCCALCSIZE` again without moving, sizing, activating, or reordering the window.
    pub fn recompute_frame(hwnd: HWND) {
        let flags = SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE;
        // SAFETY: `hwnd` is a window of this process; the flags change nothing but the frame.
        let _ = unsafe { SetWindowPos(hwnd, None, 0, 0, 0, 0, flags) };
    }

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

    use super::super::{caption::CaptionLayout, tao_window::TaoWindow};
    use crate::ipc::IpcResult;

    /// Other systems keep their own title bars, and Tauri's `set_decorations` redraws them.
    pub fn refresh_frame(_window: &impl TaoWindow) -> tauri::Result<()> {
        Ok(())
    }

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
    fn keeps_the_native_frame_on_macos_and_linux() {
        let none = BTreeMap::new();
        assert_eq!(at_start(Channel::Dev, &none, &flags(true)), cfg!(windows));
    }

    // The custom frame is a Windows feature (ADR 0055).
    #[cfg(windows)]
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

    // The app's real window: tao's, without the native frame, hidden until it is placed and shown. See the
    // `tao_window` module docs for the flags tao keeps.
    #[cfg(windows)]
    mod frame {
        use tao::{
            dpi::LogicalSize,
            event_loop::EventLoopBuilder,
            platform::windows::EventLoopBuilderExtWindows,
            window::{Window, WindowBuilder},
        };
        use windows::Win32::{
            Foundation::{POINT, RECT},
            Graphics::Gdi::ClientToScreen,
            UI::{
                HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
                WindowsAndMessaging::{
                    GetWindowRect, IsWindowVisible, SetWindowPlacement, SM_CYCAPTION, WINDOWPLACEMENT,
                },
            },
        };

        use super::super::{
            super::{
                placement::{self, WindowPlacement},
                tao_window::TaoWindow,
            },
            switch_frame,
        };

        fn app_window(target: &tao::event_loop::EventLoop<()>) -> Window {
            WindowBuilder::new()
                .with_title("OpenNote test")
                .with_decorations(false)
                .with_visible(false)
                .with_inner_size(LogicalSize::new(800.0, 600.0))
                .build(target)
                .expect("a tao window")
        }

        /// Whether the client area starts a native caption's height or more below the window's top edge. Without
        /// the native frame, tao keeps only a thin top inset for the window's shadow.
        fn has_native_caption(window: &Window) -> bool {
            let hwnd = TaoWindow::hwnd(window).expect("the handle");
            let mut rect = RECT::default();
            let mut client = POINT::default();
            // SAFETY: `hwnd` is live on this thread, and both outputs are locals.
            let caption = unsafe {
                GetWindowRect(hwnd, &mut rect).expect("the window rectangle");
                let _ = ClientToScreen(hwnd, &mut client);
                GetSystemMetricsForDpi(SM_CYCAPTION, GetDpiForWindow(hwnd))
            };
            client.y - rect.top >= caption
        }

        fn is_visible(window: &Window) -> bool {
            // SAFETY: the handle is a live window of this thread.
            unsafe { IsWindowVisible(TaoWindow::hwnd(window).expect("the handle")).as_bool() }
        }

        /// The window's own rectangle as a saved normal placement (`SW_SHOWNORMAL`), so placing it neither moves
        /// nor sizes the window, as when the app starts where it was last closed.
        fn where_it_is(window: &Window) -> WindowPlacement {
            let mut rect = RECT::default();
            // SAFETY: the handle is a live window of this thread, and `rect` is a local.
            unsafe { GetWindowRect(TaoWindow::hwnd(window).expect("the handle"), &mut rect) }.expect("the rectangle");
            WindowPlacement {
                show_cmd: 1,
                normal: [rect.left, rect.top, rect.right, rect.bottom],
            }
        }

        #[test]
        fn one_title_bar_after_a_saved_placement_and_the_fallbacks() {
            let event_loop = EventLoopBuilder::new().with_any_thread(true).build();

            // A start with a saved placement shows only the page's title bar.
            let window = app_window(&event_loop);
            assert!(
                has_native_caption(&window),
                "the window should start with the caption from creation"
            );
            assert!(placement::restore(&window, &where_it_is(&window)));
            assert!(is_visible(&window));
            assert!(
                !has_native_caption(&window),
                "the native caption stayed over the page's title bar"
            );

            // The deadline or page-lost fallback brings the native frame back, and the window stays on screen.
            switch_frame(&window, false, true).expect("the native frame");
            assert!(is_visible(&window), "the native frame coming back hid the window");
            assert!(has_native_caption(&window));

            // The page's next report takes the native frame away again.
            switch_frame(&window, true, true).expect("the custom frame");
            assert!(is_visible(&window));
            assert!(!has_native_caption(&window));

            // A window that Windows showed without tao keeps the caption from creation, and tao already counts it as
            // undecorated. The page's first report removes the caption all the same.
            let stale = app_window(&event_loop);
            let WindowPlacement {
                normal: [left, top, right, bottom],
                ..
            } = where_it_is(&stale);
            let raw = WINDOWPLACEMENT {
                length: u32::try_from(std::mem::size_of::<WINDOWPLACEMENT>()).expect("the size"),
                showCmd: 1,
                rcNormalPosition: RECT {
                    left,
                    top,
                    right,
                    bottom,
                },
                ..WINDOWPLACEMENT::default()
            };
            // SAFETY: the handle is a live window of this thread, and `raw` is a local with its length set.
            unsafe { SetWindowPlacement(TaoWindow::hwnd(&stale).expect("the handle"), &raw) }.expect("placed");
            assert!(has_native_caption(&stale));
            switch_frame(&stale, true, true).expect("the custom frame");
            assert!(!has_native_caption(&stale), "the first report left the native caption");
        }
    }
}
