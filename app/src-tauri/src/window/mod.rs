//! The main window: creating it, its WebView2 settings, the frame, placement, and the Snap Layouts overlay
//! (ARCHITECTURE.md sections 8.5 and 10), plus the window commands.
//!
//! The main window's config has `"create": false`, so [`create`] builds the window from it. It then adds what only
//! code can set: the background color, the boot script, the data folder, the zoom, the minimum size, the saved
//! placement, and the WebView2 settings.

pub mod caption;
pub mod custom_frame;
pub mod frame;
pub mod placement;
#[cfg(windows)]
pub mod resize_border;
#[cfg(windows)]
pub mod snap_overlay;
#[cfg(windows)]
pub mod subclass;
pub mod system_menu;
#[cfg(all(test, windows))]
mod test_windows;
pub mod webview;

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::{window::Color, AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::{
    appearance::{self, Current, ThemeName},
    boot::{self, Startup},
    events, install,
    ipc::{IpcError, IpcResult},
    lifecycle::{self, ExitReason},
    paths::Paths,
    perf,
    settings::SettingsStore,
    state::DeviceStateStore,
    theme_tokens::Rgb,
    zoom,
};

/// The main window's label, from tauri.conf.json.
pub const MAIN: &str = "main";

/// The longest window title the interface may set, in characters.
pub const MAX_TITLE_CHARS: usize = 200;

/// A point in physical pixels, relative to the client area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The color the window was created with, for the perf log's `windowShown` mark.
struct Background(Rgb);

/// Builds the main window from its config, with its placement, colors, boot script, zoom, and WebView2 settings,
/// and shows it (section 8.5).
///
/// The config says `decorations: false`, for the HTML title bar with its own caption buttons. Those are behind the
/// `shell.customFrame` flag, so the window keeps the native frame unless the flag is on; the page's caption layout
/// report switches the frame either way ([`custom_frame`]). A window created without the native frame gets it back
/// when the page reports no caption buttons in time or its process fails.
pub fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let windows = &app.config().app.windows;
    let config = windows
        .iter()
        .find(|window| window.label == MAIN)
        .ok_or(tauri::Error::WindowNotFound)?;
    let settings = app.state::<SettingsStore>().get();
    let state = app.state::<DeviceStateStore>().get();
    let paths = app.state::<Paths>();

    let raw = appearance::read_raw();
    let text_scale = appearance::decode(raw, 1.0).text_scale;
    let zoom = zoom::effective_zoom(
        settings.appearance.text_size.percent(),
        text_scale,
        primary_work_width_dips(app),
    );
    let os = appearance::decode(raw, zoom);
    let data = boot::payload(&app.state::<Startup>(), &settings, &state, &os, install::status(&paths));
    let color = boot::window_color(settings.appearance.theme, &os, boot::system_window_color());
    let Rgb(r, g, b) = color;
    app.manage(Current::new(os));
    app.manage(Background(color));

    let undecorated = custom_frame::at_start(data.channel, &data.flag_overrides, &settings.experimental.flags);
    let builder = WebviewWindowBuilder::from_config(app, config)?
        .decorations(!undecorated)
        .background_color(Color(r, g, b, 255))
        .initialization_script(boot::initialization_script(&data))
        .data_directory(paths.webview.clone())
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false);
    #[cfg(all(windows, feature = "test-endpoints"))]
    let builder =
        match webview::driver_browser_args(std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok().as_deref()) {
            Some(args) => builder.additional_browser_args(&args),
            None => builder,
        };
    let window = builder.build()?;
    perf::mark("windowCreated", None);
    webview::configure(&window);
    let lost = window.clone();
    webview::on_page_lost(&window, move || custom_frame::fall_back(&lost, true));
    if undecorated {
        custom_frame::await_first_report(&window);
    }
    zoom::apply(&window, settings.appearance.text_size.percent(), os.text_scale);
    if let Err(error) = frame::set_theme(&window, data.resolved_theme) {
        log::warn!("Couldn't color the window frame: {error}");
    }
    if let Err(error) = frame::install_subclass(&window) {
        log::warn!("Couldn't listen for Windows messages: {error}");
    }
    watch(&window);
    perf::mark("webviewCreated", None);
    if lifecycle::SHOW_EARLY {
        let restored = state
            .window
            .placement
            .as_ref()
            .is_some_and(|saved| placement::restore(&window, saved));
        if !restored {
            let _ = window.center();
        }
        show(app);
    } else {
        show_after_fallback_delay(window.clone());
    }
    Ok(window)
}

/// The primary monitor's work area width in DIPs, for the first zoom before a window exists to ask.
fn primary_work_width_dips(app: &AppHandle) -> f64 {
    match app.primary_monitor() {
        Ok(Some(monitor)) => f64::from(monitor.work_area().size.width) / monitor.scale_factor().max(1.0),
        _ => f64::MAX,
    }
}

/// Keeps the placement, the maximized state, and closing in step with the window.
fn watch(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let saver = placement::Saver::default();
    let maximized = Arc::new(AtomicBool::new(window.is_maximized().unwrap_or(false)));
    let watched = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            lifecycle::on_close_requested(&app);
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            saver.schedule(&app);
            let now = watched.is_maximized().unwrap_or(false);
            if maximized.swap(now, Ordering::AcqRel) != now {
                if let Err(error) = app.emit_to(MAIN, events::WINDOW_MAXIMIZED, now) {
                    log::warn!("Couldn't send {}: {error}", events::WINDOW_MAXIMIZED);
                }
            }
        }
        _ => {}
    });
}

/// Shows the main window if it's hidden, and notes the first time in the perf log with the color it was painted
/// with. Restoring a saved placement can already have shown the window, so the note doesn't depend on that.
pub fn show(app: &AppHandle) {
    static NOTED: AtomicBool = AtomicBool::new(false);
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if !NOTED.swap(true, Ordering::AcqRel) {
        let detail = app.try_state::<Background>().map(|color| perf::hex(color.0));
        perf::mark("windowShown", detail.as_deref());
    }
}

/// Brings the main window forward for a second launch, and passes its arguments to the interface as
/// `window://forwarded-args`.
pub fn receive_forwarded(app: &AppHandle, args: Vec<String>) {
    // The jump list's "New quick note" opens the capture window and leaves the main window where it is.
    if args.iter().any(|arg| arg == crate::shellqol::QUICK_NOTE_ARG) {
        if let Err(error) = crate::shellqol::windows_ops::open_capture(app) {
            log::warn!("Couldn't open quick capture: {error}");
        }
        return;
    }
    // A file opened from Explorer while the app runs: the person chose it, so the interface may open it.
    crate::interop::open_files::grant_forwarded(&args);
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit_to(MAIN, events::WINDOW_FORWARDED_ARGS, args) {
        log::warn!("Couldn't pass a second launch's arguments on: {error}");
    }
}

/// Shows a hidden main window after the first-paint fallback, in case the page never paints.
fn show_after_fallback_delay(window: WebviewWindow) {
    thread::spawn(move || {
        thread::sleep(lifecycle::FIRST_PAINT_FALLBACK);
        show(window.app_handle());
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

/// Opens the real system menu at `at`, in physical pixels relative to the client area, or at the title bar's start
/// corner when `at` is `None` (section 10.7).
#[tauri::command]
pub fn window_show_system_menu(window: WebviewWindow, at: Option<Point>) -> IpcResult<()> {
    let usable = |value: f64| value.is_finite() && value.abs() <= 100_000.0;
    if at.is_some_and(|at| !usable(at.x) || !usable(at.y)) {
        return Err(IpcError::invalid("at", "The menu's position isn't a usable point."));
    }
    system_menu::show(&window, at)
}

/// Sets the frame colors for the theme the page shows.
#[tauri::command]
pub fn window_set_frame_theme(window: WebviewWindow, theme: ThemeName) -> IpcResult<()> {
    frame::set_theme(&window, theme)
}
