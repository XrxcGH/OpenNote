//! The window frame (ARCHITECTURE.md sections 9.2 and 10.7): DWM frame colors, the system menu, and the
//! subclass that hears about Windows settings changes, display changes, and the session ending. The frame follows
//! the app's theme through `DWMWA_USE_IMMERSIVE_DARK_MODE` and the border color, never through Tauri's
//! `setTheme`, which would also change WebView2's `prefers-color-scheme`.

use tauri::{Manager, WebviewWindow};

use crate::{
    appearance::ThemeName,
    ipc::IpcResult,
    theme_tokens::{Rgb, BORDER_SUBTLE},
    window::Point,
};

/// The window border color for a theme: `border.subtle`.
pub fn border_color(theme: ThemeName) -> Rgb {
    match theme {
        ThemeName::Light => BORDER_SUBTLE.light,
        ThemeName::Dark => BORDER_SUBTLE.dark,
    }
}

/// A `COLORREF` (0x00BBGGRR) for a color.
pub fn colorref(Rgb(r, g, b): Rgb) -> u32 {
    u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16)
}

/// Sets the frame, the system menu, and the window border to the light or dark theme.
#[cfg(windows)]
pub fn set_theme(window: &WebviewWindow, theme: ThemeName) -> IpcResult<()> {
    use windows::{
        core::BOOL,
        Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE},
    };

    let hwnd = window.hwnd()?;
    let dark = BOOL::from(theme == ThemeName::Dark);
    let size = u32::try_from(std::mem::size_of::<BOOL>()).unwrap_or(4);
    // SAFETY: `hwnd` is this process's live main window, and the call only reads `size` bytes from `dark`,
    // which outlives it.
    unsafe { DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, (&raw const dark).cast(), size)? };
    let border = colorref(border_color(theme));
    // SAFETY: as above, with a four byte COLORREF. Windows 10 doesn't know this attribute, which isn't an error
    // worth reporting: the border just keeps its default color there.
    let result = unsafe { DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, (&raw const border).cast(), 4) };
    if let Err(error) = result {
        log::debug!("The window border color isn't supported here: {error}");
    }
    Ok(())
}

/// Other systems draw their own frames.
#[cfg(not(windows))]
pub fn set_theme(_window: &WebviewWindow, _theme: ThemeName) -> IpcResult<()> {
    Ok(())
}

/// Opens the real system menu at `at` (physical pixels from the client area's corner), or at the window's top
/// start corner when `at` is `None`, and runs the command the person picks (section 10.7).
#[cfg(windows)]
pub fn show_system_menu(window: &WebviewWindow, at: Option<Point>) -> IpcResult<()> {
    use windows::Win32::{
        Foundation::{LPARAM, POINT, RECT, WPARAM},
        Graphics::Gdi::ClientToScreen,
        UI::WindowsAndMessaging::{
            GetSystemMenu, GetWindowRect, PostMessageW, SetForegroundWindow, TrackPopupMenuEx, TPM_LEFTALIGN,
            TPM_RETURNCMD, TPM_TOPALIGN, WM_SYSCOMMAND,
        },
    };

    let hwnd = window.hwnd()?;
    // SAFETY: every handle and pointer below is this process's window or a local that outlives its call.
    unsafe {
        let menu = GetSystemMenu(hwnd, false);
        if menu.is_invalid() {
            return Ok(());
        }
        let mut corner = match at {
            Some(point) => POINT {
                x: point.x.round() as i32,
                y: point.y.round() as i32,
            },
            None => POINT { x: 0, y: 0 },
        };
        if at.is_some() {
            let _ = ClientToScreen(hwnd, &mut corner);
        } else {
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect)?;
            corner = POINT {
                x: rect.left,
                y: rect.top,
            };
        }
        let _ = SetForegroundWindow(hwnd);
        let command = TrackPopupMenuEx(
            menu,
            (TPM_RETURNCMD | TPM_LEFTALIGN | TPM_TOPALIGN).0,
            corner.x,
            corner.y,
            hwnd,
            None,
        );
        if command.0 != 0 {
            let _ = PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(command.0 as usize), LPARAM(0));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn show_system_menu(_window: &WebviewWindow, _at: Option<Point>) -> IpcResult<()> {
    Ok(())
}

/// Listens to the main window's messages for the things only Windows tells a window.
///
/// Those are a settings change (the app theme, contrast, animations, and text size), a display or DPI change
/// (the zoom cap follows the work area), and the session ending, which runs the exit handshake with its short
/// budget.
#[cfg(windows)]
pub fn install_subclass(window: &WebviewWindow) -> IpcResult<()> {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    use self::subclass::{proc, Watcher};

    let hwnd = window.hwnd()?;
    let watcher = Box::into_raw(Box::new(Watcher::new(window.app_handle().clone())));
    // SAFETY: the watcher is leaked on purpose, because the subclass lives as long as the window, which lives
    // as long as the process.
    unsafe { SetWindowSubclass(hwnd, Some(proc), 1, watcher as usize).ok()? };
    Ok(())
}

#[cfg(not(windows))]
pub fn install_subclass(_window: &WebviewWindow) -> IpcResult<()> {
    Ok(())
}

#[cfg(windows)]
mod subclass {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::Duration,
    };

    use tauri::AppHandle;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::DefSubclassProc,
            WindowsAndMessaging::{
                WM_DISPLAYCHANGE, WM_DPICHANGED, WM_ENDSESSION, WM_QUERYENDSESSION, WM_SETTINGCHANGE,
            },
        },
    };

    use crate::{
        appearance,
        lifecycle::{self, ExitReason},
    };

    /// Windows sends several setting messages for one change, so a refresh waits this long for the rest.
    const REFRESH_DELAY: Duration = Duration::from_millis(60);

    pub struct Watcher {
        app: AppHandle,
        refresh_waiting: Arc<AtomicBool>,
    }

    impl Watcher {
        pub fn new(app: AppHandle) -> Self {
            Self {
                app,
                refresh_waiting: Arc::new(AtomicBool::new(false)),
            }
        }

        /// Re-reads the appearance shortly, once for a burst of messages.
        fn refresh_soon(&self) {
            if self.refresh_waiting.swap(true, Ordering::AcqRel) {
                return;
            }
            let (app, flag) = (self.app.clone(), Arc::clone(&self.refresh_waiting));
            thread::spawn(move || {
                thread::sleep(REFRESH_DELAY);
                flag.store(false, Ordering::Release);
                appearance::refresh(&app);
            });
        }
    }

    /// The window procedure layered over the main window's own.
    pub unsafe extern "system" fn proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        data: usize,
    ) -> LRESULT {
        // SAFETY: `data` is the leaked `Watcher` that `install_subclass` passed, valid for the window's life.
        let watcher = unsafe { &*(data as *const Watcher) };
        match message {
            WM_SETTINGCHANGE | WM_DISPLAYCHANGE | WM_DPICHANGED => watcher.refresh_soon(),
            WM_QUERYENDSESSION => {
                lifecycle::request_exit(&watcher.app, ExitReason::SessionEnd);
                return LRESULT(1);
            }
            WM_ENDSESSION if wparam.0 != 0 => crate::flush_files(&watcher.app),
            _ => {}
        }
        // SAFETY: passes the message on, unchanged, to the next procedure in the chain.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packs_a_colorref_as_blue_green_red() {
        assert_eq!(colorref(Rgb(0x12, 0x34, 0x56)), 0x0056_3412);
    }

    #[test]
    fn the_border_follows_the_theme() {
        assert_eq!(border_color(ThemeName::Light), BORDER_SUBTLE.light);
        assert_eq!(border_color(ThemeName::Dark), BORDER_SUBTLE.dark);
    }
}
