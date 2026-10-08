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

/// Opens a tool in a window of its own, or brings its window forward if it is open. `pinned` keeps it above other
/// windows.
///
/// It is async so it runs off the main thread. A synchronous command runs on the main thread, and WebView2 can't
/// finish building the new webview while that thread waits in the command: the window appeared, its page stayed
/// about:blank, and the call never answered, so the tool stayed docked too.
#[tauri::command]
pub async fn tool_window_open(app: AppHandle, tool: String, pinned: bool) -> IpcResult<()> {
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
        .map(|window| crate::lifecycle::watch_window(&window))
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

    /// The source of every synchronous command in `src`: its name and its body.
    fn sync_commands() -> Vec<(String, String)> {
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for entry in std::fs::read_dir(dir).expect("src reads").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, out);
                } else if path.extension().is_some_and(|extension| extension == "rs") {
                    out.push(path);
                }
            }
        }
        let mut files = Vec::new();
        walk(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut files,
        );
        let mut commands = Vec::new();
        for file in files {
            let text = std::fs::read_to_string(&file).expect("a source file reads");
            for (at, _) in text.match_indices("#[tauri::command]") {
                // Only the attribute at the start of a line, not this scan's own string.
                if !text[..at].ends_with('\n') {
                    continue;
                }
                let rest = &text[at..];
                let Some(start) = rest.find("fn ") else { continue };
                if rest[..start].contains("async") {
                    continue;
                }
                let end = rest.find("\n}\n").unwrap_or(rest.len());
                let name = rest[start + 3..].split('(').next().unwrap_or_default().to_owned();
                commands.push((name, rest[..end].to_owned()));
            }
        }
        commands
    }

    /// WebView2 can't finish building a webview while the main thread waits in a synchronous command: the window
    /// appears and its page stays about:blank. Commands that build windows must be async.
    #[test]
    fn no_synchronous_command_builds_a_window() {
        let builders = ["WebviewWindowBuilder", "open_page(", "open_capture(", "build("];
        let found: Vec<String> = sync_commands()
            .into_iter()
            .filter(|(_, body)| builders.iter().any(|builder| body.contains(builder)))
            .map(|(name, _)| name)
            .collect();
        assert!(found.is_empty(), "synchronous commands that build windows: {found:?}");
        assert!(
            sync_commands().iter().any(|(name, _)| name == "window_minimize"),
            "the scan finds synchronous commands"
        );
    }

    #[test]
    fn opens_windows_that_fit_a_small_screen() {
        for tool in TOOLS {
            assert!(tool.width >= 320.0 && tool.width <= 640.0, "{}", tool.id);
            assert!(tool.height >= 360.0 && tool.height <= 720.0, "{}", tool.id);
        }
    }
}
