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
    Tool {
        id: "solvers",
        title: "Math solvers",
        width: 600.0,
        height: 720.0,
    },
    Tool {
        id: "vectors",
        title: "Vectors",
        width: 560.0,
        height: 720.0,
    },
    Tool {
        id: "solids",
        title: "Solids of revolution",
        width: 560.0,
        height: 720.0,
    },
    Tool {
        id: "projectile",
        title: "Projectile simulator",
        width: 560.0,
        height: 720.0,
    },
    Tool {
        id: "kit-design",
        title: "Design tools",
        width: 560.0,
        height: 720.0,
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
        area: [
            position.x,
            position.y,
            position.x + edge(size.width),
            position.y + edge(size.height),
        ],
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

/// Where a new window with no saved place goes, so it does not cover another tool window. It goes just right of
/// the rightmost one open (or just left of the leftmost, if there is no room), at the same height. `None` when no
/// other tool window is open or neither side has room; Windows then picks the place.
fn beside_open_tools(app: &AppHandle, window: &WebviewWindow) -> Option<(i32, i32)> {
    const GAP: i32 = 8;
    let own = window.outer_size().ok()?;
    let work = window.current_monitor().ok().flatten()?.work_area().to_owned();
    let (left, right) = (work.position.x, work.position.x + edge(work.size.width));
    let others: Vec<(i32, i32, i32)> = TOOLS
        .iter()
        .filter_map(|spec| app.get_webview_window(&label(spec)))
        .filter(|other| other.label() != window.label())
        .filter_map(|other| Some((other.outer_position().ok()?, other.outer_size().ok()?)))
        .map(|(at, size)| (at.x, at.x + edge(size.width), at.y))
        .collect();
    let (min_x, _, _) = *others.iter().min_by_key(|one| one.0)?;
    let (_, max_end, y) = *others.iter().max_by_key(|one| one.1)?;
    let wide = edge(own.width);
    if max_end + GAP + wide <= right {
        return Some((max_end + GAP, y));
    }
    (min_x - GAP - wide >= left).then_some((min_x - GAP - wide, y))
}

/// Moves a new window to the place it had, if one is saved, and shows it.
fn restore_and_show(app: &AppHandle, tool: &str, window: &WebviewWindow) {
    let saved = place::load(&places_file(app)).remove(tool);
    if let Some(open) = saved.and_then(|saved| place::opening(&saved, &monitors(app))) {
        let _ = window.set_size(PhysicalSize::new(open.size.0, open.size.1));
        let _ = window.set_position(PhysicalPosition::new(open.position.0, open.position.1));
    } else if let Some((x, y)) = beside_open_tools(app, window) {
        let _ = window.set_position(PhysicalPosition::new(x, y));
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
        .on_navigation(crate::window::is_app_url)
        .zoom_hotkeys_enabled(false)
        .build()
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    crate::lifecycle::watch_window(&window);
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

    /// A function in the source: its module (the file's name, or its folder's for `mod.rs`), its name, its text
    /// from its `fn` line to its closing brace, and whether it is a synchronous command.
    struct Function {
        module: String,
        name: String,
        text: String,
        sync_command: bool,
    }

    /// The functions in one file's text. A function ends at the first `}` line with its own indent, as rustfmt
    /// lays them out. A command is a function with a `#[tauri::command]` attribute, in any of its forms.
    fn functions_in(module: &str, text: &str) -> Vec<Function> {
        let lines: Vec<&str> = text.lines().collect();
        let mut found = Vec::new();
        for (at, line) in lines.iter().enumerate() {
            let trimmed = line.trim_start();
            let indent = &line[..line.len() - trimmed.len()];
            let mut head = trimmed;
            let mut is_async = false;
            for qualifier in ["pub(crate) ", "pub(super) ", "pub ", "const ", "async ", "unsafe "] {
                if let Some(rest) = head.strip_prefix(qualifier) {
                    is_async |= qualifier == "async ";
                    head = rest;
                }
            }
            let Some(signature) = head.strip_prefix("fn ") else {
                continue;
            };
            let name: String = signature
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            let closing = format!("{indent}}}");
            let Some(end) = lines[at..].iter().position(|line| *line == closing) else {
                continue;
            };
            let command = lines[..at]
                .iter()
                .rev()
                .map(|line| line.trim_start())
                .take_while(|line| line.starts_with("#[") || line.starts_with("//"))
                .any(|line| line.starts_with("#[tauri::command"));
            found.push(Function {
                module: module.to_owned(),
                name,
                text: lines[at..=at + end].join("\n"),
                sync_command: command && !is_async,
            });
        }
        found
    }

    /// Whether `text` calls the function `name`: by its name or a module path ending in it, but not as a method
    /// or a type's associated function (`RateLimit::new(`), whose name may be any type's.
    fn calls(text: &str, name: &str) -> bool {
        let call = format!("{name}(");
        text.match_indices(&call).any(|(at, _)| {
            let before = &text[..at];
            if before
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
                || before.ends_with("fn ")
            {
                return false;
            }
            let Some(path) = before.strip_suffix("::") else {
                return true;
            };
            let segment = path
                .rsplit(|c: char| !(c.is_alphanumeric() || c == '_'))
                .next()
                .unwrap_or_default();
            !segment.starts_with(|c: char| c.is_uppercase())
        })
    }

    /// Whether `caller` calls `callee`. A name defined more than once (`run`, `build`, `create`) is followed only
    /// from its own module or through a path naming that module (`windows_ops::build(`), so a command calling some
    /// other `run` is not taken for one that builds a window.
    fn reaches(caller: &Function, callee: &Function, defined: &std::collections::BTreeMap<&str, usize>) -> bool {
        calls(&caller.text, &callee.name)
            && (defined.get(callee.name.as_str()) == Some(&1)
                || caller.module == callee.module
                || caller.text.contains(&format!("{}::{}(", callee.module, callee.name)))
    }

    /// The synchronous commands that build a window directly or through functions they call.
    fn window_building_sync_commands(functions: &[Function]) -> Vec<String> {
        let mut defined: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
        for function in functions {
            *defined.entry(function.name.as_str()).or_default() += 1;
        }
        let mut builders: Vec<bool> = functions
            .iter()
            .map(|function| {
                function.text.contains("WebviewWindowBuilder") || function.text.contains("WindowBuilder::new")
            })
            .collect();
        loop {
            let more: Vec<usize> = (0..functions.len())
                .filter(|&at| !builders[at])
                .filter(|&at| {
                    (0..functions.len()).any(|of| builders[of] && reaches(&functions[at], &functions[of], &defined))
                })
                .collect();
            if more.is_empty() {
                break;
            }
            for at in more {
                builders[at] = true;
            }
        }
        functions
            .iter()
            .zip(&builders)
            .filter(|(function, builds)| function.sync_command && **builds)
            .map(|(function, _)| function.name.clone())
            .collect()
    }

    /// Every function in `src`.
    fn source_functions() -> Vec<Function> {
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
        files
            .iter()
            .flat_map(|file| {
                let stem = file.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default();
                let module = if stem == "mod" {
                    file.parent()
                        .and_then(|dir| dir.file_name())
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                } else {
                    stem
                };
                functions_in(module, &std::fs::read_to_string(file).expect("a source file reads"))
            })
            .collect()
    }

    /// The scan finds a window built through helpers of any name, under any form of the command attribute.
    #[test]
    fn the_scan_follows_helpers_and_every_form_of_the_command_attribute() {
        let text = [
            "#[tauri::command(rename_all = \"snake_case\")]",
            "pub fn pop_out(app: AppHandle) -> IpcResult<()> {",
            "    crate::shell::make(&app)",
            "}",
            "",
            "/// A command that builds nothing.",
            "#[tauri::command]",
            "pub fn quiet(app: AppHandle) -> IpcResult<()> {",
            "    app.build_menu();",
            "    let _ = Opener::make(&app);",
            "    Ok(())",
            "}",
            "",
            "#[tauri::command]",
            "pub async fn later(app: AppHandle) -> IpcResult<()> {",
            "    make(&app)",
            "}",
            "",
            "fn make(app: &AppHandle) -> IpcResult<()> {",
            "    inner(app)",
            "}",
            "",
            "impl Opener {",
            "    pub(crate) fn inner(app: &AppHandle) -> IpcResult<()> {",
            "        WebviewWindowBuilder::new(app, \"x\", url).build()?;",
            "        Ok(())",
            "    }",
            "}",
        ]
        .join("\n");
        let functions = functions_in("shell", &text);
        assert_eq!(window_building_sync_commands(&functions), vec!["pop_out".to_owned()]);
    }

    /// A name two modules define is followed only from its own module or through a path naming it.
    #[test]
    fn the_scan_tells_apart_functions_that_share_a_name() {
        let builds = [
            "pub fn build(app: &AppHandle) {",
            "    WebviewWindowBuilder::new(app, \"x\", url).build();",
            "}",
        ]
        .join("\n");
        let calls_by_name = [
            "fn build() {}",
            "",
            "#[tauri::command]",
            "pub fn tidy() {",
            "    build();",
            "}",
            "",
            "#[tauri::command]",
            "pub fn pop(app: AppHandle) {",
            "    windows_ops::build(&app);",
            "}",
        ]
        .join("\n");
        let mut functions = functions_in("windows_ops", &builds);
        functions.extend(functions_in("menu", &calls_by_name));
        assert_eq!(window_building_sync_commands(&functions), vec!["pop".to_owned()]);
    }

    /// WebView2 can't finish building a webview while the main thread waits in a synchronous command: the window
    /// appears and its page stays about:blank. Commands that build windows, directly or through any function they
    /// call, must be async.
    #[test]
    fn no_synchronous_command_builds_a_window() {
        let functions = source_functions();
        let found = window_building_sync_commands(&functions);
        assert!(found.is_empty(), "synchronous commands that build windows: {found:?}");
        let named = |name: &str| functions.iter().find(|function| function.name == name);
        assert!(
            named("window_minimize").is_some_and(|function| function.sync_command),
            "the scan finds synchronous commands"
        );
        assert!(
            named("tool_window_open").is_some_and(|function| !function.sync_command),
            "the scan finds the async commands that build windows"
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
