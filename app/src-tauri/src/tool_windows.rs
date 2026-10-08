//! Tool windows (Phase 10): the timers, the calculator, and Upcoming in windows of their own.
//!
//! The interface opens its tools as floating windows over the page. A tool's "Open in its own window" button calls
//! [`tool_window_open`]. That builds a second window with the main window's boot payload and WebView2 data folder.
//! The tool follows the theme and keeps its state, which it saves in the app's browser storage. The window loads
//! the same interface and shows only the tool its script names.
//!
//! Each window saves its size, place, and monitor as it moves and closes, and opens there again (see [`place`]).
//! [`tool_windows_reset`] forgets them and puts the open windows back.

mod place;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use tauri::{
    window::Color, AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::{
    appearance::Current,
    boot::{self, Startup},
    install,
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
    settings::SettingsStore,
    state::DeviceStateStore,
    theme_tokens::Rgb,
};

/// A tool that can have a window of its own.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tool {
    /// The name the interface uses, such as `timers`.
    pub id: &'static str,
    pub title: &'static str,
    /// The first size of the window, in logical pixels.
    pub width: f64,
    pub height: f64,
}

pub const TOOLS: &[Tool] = &[
    Tool {
        id: "timers",
        title: "Timers",
        width: 380.0,
        height: 560.0,
    },
    Tool {
        id: "calculator",
        title: "Calculator",
        width: 440.0,
        height: 640.0,
    },
    Tool {
        id: "upcoming",
        title: "Upcoming",
        width: 420.0,
        height: 560.0,
    },
    Tool {
        id: "flashcards",
        title: "Flashcards",
        width: 460.0,
        height: 640.0,
    },
    Tool {
        id: "converter",
        title: "Unit converter",
        width: 400.0,
        height: 480.0,
    },
    Tool {
        id: "reference",
        title: "Reference tables",
        width: 520.0,
        height: 640.0,
    },
    Tool {
        id: "dictionary",
        title: "Dictionary",
        width: 420.0,
        height: 600.0,
    },
    Tool {
        id: "citations",
        title: "Citations",
        width: 480.0,
        height: 640.0,
    },
];

/// The tool with this name, or `None`. Nothing from the interface reaches a window label or a script unless it
/// is in [`TOOLS`].
pub fn find(id: &str) -> Option<&'static Tool> {
    TOOLS.iter().find(|tool| tool.id == id)
}

/// The label of a tool's window. Capabilities grant `tool-*`.
pub fn label(tool: &Tool) -> String {
    format!("tool-{}", tool.id)
}

/// The boot payload's script, then the name of the tool the window shows.
pub fn script(boot_script: &str, tool: &Tool) -> String {
    format!("{boot_script}\nwindow.__OPENNOTE_TOOL__ = \"{}\";", tool.id)
}

/// How long moves and resizes are folded together before a tool window's place is saved.
const SAVE_DELAY: Duration = Duration::from_millis(400);

fn places_file(app: &AppHandle) -> PathBuf {
    app.state::<Paths>().state_file.with_file_name(place::FILE)
}

fn edge(value: u32) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn describe(monitor: &tauri::Monitor, primary: Option<&tauri::Monitor>) -> place::Monitor {
    let (position, size, work) = (monitor.position(), monitor.size(), monitor.work_area());
    place::Monitor {
        name: monitor.name().cloned(),
        area: [position.x, position.y, position.x + edge(size.width), position.y + edge(size.height)],
        work: [
            work.position.x,
            work.position.y,
            work.position.x + edge(work.size.width),
            work.position.y + edge(work.size.height),
        ],
        scale: monitor.scale_factor(),
        primary: primary.is_some_and(|one| one.position() == monitor.position() && one.size() == monitor.size()),
    }
}

fn monitors(app: &AppHandle) -> Vec<place::Monitor> {
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| describe(monitor, primary.as_ref()))
        .collect()
}

/// Saves where a tool's window is now. A minimized window has no place worth keeping.
fn save_now(app: &AppHandle, tool: &str, window: &WebviewWindow) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size), Ok(Some(current))) =
        (window.outer_position(), window.inner_size(), window.current_monitor())
    else {
        return;
    };
    let primary = app.primary_monitor().ok().flatten();
    let now = place::Now {
        position: (position.x, position.y),
        size: (size.width, size.height),
    };
    if let Some(saved) = place::capture(&now, &describe(&current, primary.as_ref())) {
        if let Err(error) = place::save(&places_file(app), tool, saved) {
            log::warn!("The {tool} window's place was not saved: {error}");
        }
    }
}

/// Moves a new window to the place it had, if one is saved, and shows it.
fn restore_and_show(app: &AppHandle, tool: &str, window: &WebviewWindow) {
    let saved = place::load(&places_file(app)).remove(tool);
    if let Some(open) = saved.and_then(|saved| place::opening(&saved, &monitors(app))) {
        let _ = window.set_size(PhysicalSize::new(open.size.0, open.size.1));
        let _ = window.set_position(PhysicalPosition::new(open.position.0, open.position.1));
    }
    let _ = window.show();
}

/// Watches a tool window: its place is saved shortly after it moves or resizes, and when it closes.
fn watch(app: &AppHandle, tool: &'static str, window: &WebviewWindow) {
    let pending = Arc::new(AtomicBool::new(false));
    let (app, handle) = (app.clone(), window.clone());
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if pending.swap(true, Ordering::AcqRel) {
                return;
            }
            let (pending, app, handle) = (Arc::clone(&pending), app.clone(), handle.clone());
            thread::spawn(move || {
                thread::sleep(SAVE_DELAY);
                pending.store(false, Ordering::Release);
                save_now(&app, tool, &handle);
            });
        }
        WindowEvent::CloseRequested { .. } => save_now(&app, tool, &handle),
        _ => {}
    });
}

/// Opens a tool in a window of its own, or brings its window forward if it is open. `pinned` keeps it above other
/// windows.
#[tauri::command]
pub fn tool_window_open(app: AppHandle, tool: String, pinned: bool) -> IpcResult<()> {
    let spec = find(&tool).ok_or_else(|| IpcError::invalid("tool", "That tool does not exist."))?;
    let label = label(spec);
    if let Some(open) = app.get_webview_window(&label) {
        let _ = open.set_always_on_top(pinned);
        let _ = open.show();
        let _ = open.set_focus();
        return Ok(());
    }
    let settings = app.state::<SettingsStore>().get();
    let state = app.state::<DeviceStateStore>().get();
    let paths = app.state::<Paths>();
    let os = app.state::<Current>().get();
    let data = boot::payload(&app.state::<Startup>(), &settings, &state, &os, install::status(&paths));
    let Rgb(r, g, b) = boot::window_color(settings.appearance.theme, &os, boot::system_window_color());
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(320.0, 360.0)
        .always_on_top(pinned)
        .visible(false)
        .background_color(Color(r, g, b, 255))
        .initialization_script(script(&boot::initialization_script(&data), spec))
        .data_directory(paths.webview.clone())
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .build()
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    restore_and_show(&app, spec.id, &window);
    watch(&app, spec.id, &window);
    Ok(())
}

/// Forgets the saved size and place of every tool window and puts the open ones back at their first size, in the
/// middle of their monitor.
#[tauri::command]
pub fn tool_windows_reset(app: AppHandle) -> IpcResult<()> {
    place::clear(&places_file(&app)).map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    for spec in TOOLS {
        if let Some(open) = app.get_webview_window(&label(spec)) {
            let _ = open.set_size(LogicalSize::new(spec.width, spec.height));
            let _ = open.center();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_the_tools_it_lists() {
        assert_eq!(find("timers").map(|tool| tool.title), Some("Timers"));
        assert!(find("Timers").is_none());
        assert!(find("timers\"; alert(1); \"").is_none());
        assert!(find("").is_none());
    }

    #[test]
    fn names_each_tool_once_and_gives_it_a_label_the_capability_grants() {
        let mut ids: Vec<_> = TOOLS.iter().map(|tool| tool.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), TOOLS.len());
        for tool in TOOLS {
            assert!(label(tool).starts_with("tool-"));
            assert!(label(tool).chars().all(|c| c.is_ascii_lowercase() || c == '-'));
        }
    }

    #[test]
    fn puts_the_tool_after_the_boot_payload() {
        let tool = find("calculator").unwrap();
        let text = script("window.__OPENNOTE_BOOT__ = {};", tool);
        assert!(text.starts_with("window.__OPENNOTE_BOOT__ = {};"));
        assert!(text.ends_with("window.__OPENNOTE_TOOL__ = \"calculator\";"));
    }

    #[test]
    fn opens_windows_that_fit_a_small_screen() {
        for tool in TOOLS {
            assert!(tool.width >= 320.0 && tool.width <= 640.0, "{}", tool.id);
            assert!(tool.height >= 360.0 && tool.height <= 720.0, "{}", tool.id);
        }
    }
}
