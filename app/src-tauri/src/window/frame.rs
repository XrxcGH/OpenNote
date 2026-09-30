//! The window frame (ARCHITECTURE.md sections 9.2 and 10.7): DWM frame colors, the system menu, and the
//! session-end subclass. The frame follows the app's theme through `DWMWA_USE_IMMERSIVE_DARK_MODE`, never through
//! Tauri's `setTheme`, which would also change WebView2's `prefers-color-scheme`.
//!
//! The dark mode switch is real, so the frame keeps following the theme now that the interface can't call
//! `setTheme`. The shell work package adds the border color from `theme_tokens.rs`, the system menu, and the
//! subclass.

use tauri::WebviewWindow;

use crate::{appearance::ThemeName, ipc::IpcResult};

/// Sets the frame, the system menu, and the window border to the light or dark theme.
#[cfg(windows)]
pub fn set_theme(window: &WebviewWindow, theme: ThemeName) -> IpcResult<()> {
    use windows::{
        core::BOOL,
        Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE},
    };

    let hwnd = window.hwnd()?;
    let dark = BOOL::from(theme == ThemeName::Dark);
    let size = u32::try_from(std::mem::size_of::<BOOL>()).unwrap_or(4);
    // SAFETY: `hwnd` is this process's live main window, and the call only reads `size` bytes from `dark`,
    // which outlives it.
    unsafe { DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, (&raw const dark).cast(), size)? };
    Ok(())
}

/// Other systems draw their own frames.
#[cfg(not(windows))]
pub fn set_theme(_window: &WebviewWindow, _theme: ThemeName) -> IpcResult<()> {
    Ok(())
}
