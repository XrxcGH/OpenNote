//! Tool windows (Phase 10): the timers, the calculator, and Upcoming in windows of their own.
//!
//! The interface opens its tools as floating windows over the page. A tool's "Open in its own window" button calls
//! [`tool_window_open`]. That builds a second window with the main window's boot payload and WebView2 data folder.
//! The tool follows the theme and keeps its state, which it saves in the app's browser storage. The window loads
//! the same interface and shows only the tool its script names.

use tauri::{window::Color, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

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
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(320.0, 360.0)
        .always_on_top(pinned)
        .background_color(Color(r, g, b, 255))
        .initialization_script(script(&boot::initialization_script(&data), spec))
        .data_directory(paths.webview.clone())
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .build()
        .map(|_| ())
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
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
