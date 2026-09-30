//! The main window: creating it, its WebView2 settings, the frame, placement, and the Snap Layouts overlay
//! (ARCHITECTURE.md sections 8.5 and 10), plus the window commands.
//!
//! The main window's config has `"create": false`, so [`create`] builds the window from it. For now the window
//! keeps Phase 0's behavior: hidden until the themed page loads, with a fallback timer. The shell work package
//! adds what only code can set, such as the placement, background color, boot script, and zoom.

pub mod caption;
pub mod frame;
pub mod placement;
pub mod webview;

use std::{thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    AppHandle, Emitter, Manager, Runtime, Webview, WebviewWindow, WebviewWindowBuilder,
};

use crate::{
    appearance::ThemeName,
    events,
    ipc::{IpcError, IpcResult},
    lifecycle::{self, ExitReason},
};

/// The main window's label, from tauri.conf.json.
pub const MAIN: &str = "main";

/// The longest window title the interface may set, in characters.
pub const MAX_TITLE_CHARS: usize = 200;

/// How long start-up waits for the page before showing the main window anyway.
const SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(3);

/// A point in physical pixels, relative to the client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Builds the main window from its config and starts the show fallback timer.
///
/// The config says `decorations: false`, for the HTML title bar with its own caption buttons. Until those land,
/// this keeps the native frame, so the window can still be moved, resized from the title bar, and closed.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let windows = &app.config().app.windows;
    let config = windows
        .iter()
        .find(|window| window.label == MAIN)
        .ok_or(tauri::Error::WindowNotFound)?;
    let window = WebviewWindowBuilder::from_config(app, config)?
        .decorations(true)
        .build()?;
    show_after_fallback_delay(window.clone());
    Ok(window)
}

/// Shows the main window once its page has loaded, so start-up never shows WebView2's default white background
/// (BRAND.md section 4). Showing a visible window does nothing.
pub fn show_when_loaded<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    let window = webview.window();
    if payload.event() == PageLoadEvent::Finished && window.label() == MAIN {
        let _ = window.show();
    }
}

/// Brings the main window forward for a second launch, and passes its arguments to the interface as
/// `window://forwarded-args`.
pub fn receive_forwarded(app: &AppHandle, args: Vec<String>) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to(MAIN, events::WINDOW_FORWARDED_ARGS, args) {
        log::warn!("Couldn't pass a second launch's arguments on: {error}");
    }
}

/// Shows the main window after a delay, in case the page never finishes loading.
pub fn show_after_fallback_delay(window: WebviewWindow) {
    thread::spawn(move || {
        thread::sleep(SHOW_FALLBACK_DELAY);
        let _ = window.show();
    });
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> IpcResult<()> {
    Ok(window.minimize()?)
}

#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) -> IpcResult<()> {
    if window.is_maximized()? {
        Ok(window.unmaximize()?)
    } else {
        Ok(window.maximize()?)
    }
}

/// Closes the app through the exit handshake, as the caption button, Alt+F4, and the taskbar do.
#[tauri::command]
pub fn window_close(app: AppHandle) -> IpcResult<()> {
    lifecycle::request_exit(&app, ExitReason::Close);
    Ok(())
}

#[tauri::command]
pub fn window_set_title(window: WebviewWindow, title: String) -> IpcResult<()> {
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(IpcError::invalid(
            "title",
            "The window title is longer than 200 characters.",
        ));
    }
    Ok(window.set_title(&title)?)
}

/// Opens the real system menu at `at`, or at the title bar's start corner when `at` is `None` (section 10.7).
#[tauri::command]
pub fn window_show_system_menu(at: Option<Point>) -> IpcResult<()> {
    let _ = at;
    Err(IpcError::not_implemented("window_show_system_menu"))
}

/// Sets the frame colors for the theme the page shows.
#[tauri::command]
pub fn window_set_frame_theme(window: WebviewWindow, theme: ThemeName) -> IpcResult<()> {
    frame::set_theme(&window, theme)
}
