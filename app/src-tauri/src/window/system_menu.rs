//! The system menu (ARCHITECTURE.md section 10.7). WebView2 can swallow Alt+Space while it has focus, so the
//! interface's `window.systemMenu` command (Alt+Space) calls `window_show_system_menu`, which opens the real menu
//! from `GetSystemMenu` with `TrackPopupMenu` and posts the chosen `WM_SYSCOMMAND`, as Windows does. Right-clicking
//! the Snap Layouts overlay opens it too; WebView2 opens it itself for a right-click on an `app-region: drag` area.

use tauri::{Manager, WebviewWindow};

use super::{caption::CaptionOverlay, Point};
use crate::ipc::IpcResult;

/// Where the menu opens without a point: the client area's start corner, below the title bar when the page has
/// reported its caption layout.
pub fn default_anchor(title_bar_bottom: Option<f64>) -> Point {
    Point {
        x: 0.0,
        y: title_bar_bottom.filter(|y| y.is_finite() && *y > 0.0).unwrap_or(0.0),
    }
}

/// Opens the system menu at `at`, in physical pixels relative to the client area, or at [`default_anchor`].
pub fn show(window: &WebviewWindow, at: Option<Point>) -> IpcResult<()> {
    let bottom = window
        .state::<CaptionOverlay>()
        .layout()
        .map(|layout| layout.maximize.y + layout.maximize.height);
    let anchor = at.unwrap_or_else(|| default_anchor(bottom));
    platform::show(window, anchor)
}

#[cfg(windows)]
pub use platform::track;

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, POINT, WPARAM},
        Graphics::Gdi::ClientToScreen,
        UI::WindowsAndMessaging::{
            EnableMenuItem, GetSystemMenu, GetWindowLongPtrW, IsIconic, IsZoomed, PostMessageW, SetForegroundWindow,
            TrackPopupMenu, GWL_EXSTYLE, GWL_STYLE, MF_BYCOMMAND, MF_ENABLED, MF_GRAYED, SC_CLOSE, SC_MAXIMIZE,
            SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE, TPM_LAYOUTRTL, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_SYSCOMMAND,
            WS_EX_LAYOUTRTL, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SIZEBOX,
        },
    };

    use super::Point;
    use crate::ipc::IpcResult;

    pub fn show(window: &WebviewWindow, anchor: Point) -> IpcResult<()> {
        let target = window.clone();
        window.run_on_main_thread(move || {
            let Ok(hwnd) = target.hwnd() else {
                return;
            };
            // The anchor is a validated client point in physical pixels, well inside `i32`.
            #[allow(clippy::cast_possible_truncation)]
            let mut point = POINT {
                x: anchor.x.round() as i32,
                y: anchor.y.round() as i32,
            };
            // SAFETY: `hwnd` is the live main window, and this runs on the thread that owns it.
            unsafe {
                let _ = ClientToScreen(hwnd, &mut point);
                track(hwnd, point);
            }
        })?;
        Ok(())
    }

    /// Opens the window's system menu at a screen point, with its items enabled for the window's state, and posts
    /// the chosen command. It must run on the thread that owns `hwnd`.
    pub fn track(hwnd: HWND, at: POINT) {
        // SAFETY: `hwnd` is the live main window on its own thread; the menu belongs to it.
        unsafe {
            let menu = GetSystemMenu(hwnd, false);
            if menu.is_invalid() {
                return;
            }
            let style = u32::try_from(GetWindowLongPtrW(hwnd, GWL_STYLE)).unwrap_or_default();
            let ex_style = u32::try_from(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)).unwrap_or_default();
            let (maximized, minimized) = (IsZoomed(hwnd).as_bool(), IsIconic(hwnd).as_bool());
            let normal = !maximized && !minimized;
            let items = [
                (SC_RESTORE, !normal),
                (SC_MOVE, normal),
                (SC_SIZE, normal && style & WS_SIZEBOX.0 != 0),
                (SC_MINIMIZE, !minimized && style & WS_MINIMIZEBOX.0 != 0),
                (SC_MAXIMIZE, !maximized && style & WS_MAXIMIZEBOX.0 != 0),
                (SC_CLOSE, true),
            ];
            for (command, enabled) in items {
                let state = if enabled { MF_ENABLED } else { MF_GRAYED };
                let _ = EnableMenuItem(menu, command, MF_BYCOMMAND | state);
            }
            // The menu closes at once unless its owner is the foreground window.
            let _ = SetForegroundWindow(hwnd);
            let mut flags = TPM_RETURNCMD | TPM_RIGHTBUTTON;
            if ex_style & WS_EX_LAYOUTRTL.0 != 0 {
                flags |= TPM_LAYOUTRTL;
            }
            let chosen = TrackPopupMenu(menu, flags, at.x, at.y, None, hwnd, None).0;
            if let Ok(command) = usize::try_from(chosen) {
                if command != 0 {
                    let _ = PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(command), LPARAM(0));
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    use super::Point;
    use crate::ipc::IpcResult;

    /// Other systems draw their own window menus.
    pub fn show(_window: &WebviewWindow, _anchor: Point) -> IpcResult<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_below_the_title_bar_at_the_start_corner() {
        assert_eq!(default_anchor(Some(60.0)), Point { x: 0.0, y: 60.0 });
    }

    #[test]
    fn opens_at_the_client_corner_without_a_layout() {
        assert_eq!(default_anchor(None), Point { x: 0.0, y: 0.0 });
        assert_eq!(default_anchor(Some(f64::NAN)), Point { x: 0.0, y: 0.0 });
    }
}
