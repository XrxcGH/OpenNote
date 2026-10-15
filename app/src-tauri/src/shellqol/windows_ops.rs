//! Windows of their own: a page in a window beside the main one, the quick capture window, and the mini window
//! (the main window kept on top). The extra windows load the same interface as the main one, with the boot payload
//! and a script that names what they show, as tool windows do.

use serde_json::{json, Value};
use tauri::{window::Color, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{arg, ok, opt};
use crate::{
    appearance::Current,
    boot::{self, Startup},
    install,
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
    settings::SettingsStore,
    state::{DeviceStateStore, StoredLocation},
    theme_tokens::Rgb,
};

/// The label of a page's window: `page-` and the page ID's letters and digits only, which the capability grants.
pub fn page_label(page: &str) -> String {
    let safe: String = page.chars().filter(char::is_ascii_alphanumeric).take(40).collect();
    format!("page-{}", safe.to_ascii_lowercase())
}

/// The script that names what an extra window shows. The values are JSON strings, so nothing breaks out of it.
pub fn script(boot_script: &str, kind: &str, page: Option<&str>) -> String {
    let kind = serde_json::to_string(kind).unwrap_or_else(|_| "\"\"".to_owned());
    let page = serde_json::to_string(&page).unwrap_or_else(|_| "null".to_owned());
    format!("{boot_script}\nwindow.__OPENNOTE_WINDOW__ = {{ kind: {kind}, page: {page} }};")
}

fn build(
    app: &AppHandle,
    label: &str,
    title: &str,
    size: (f64, f64),
    kind: &str,
    page: Option<(&str, StoredLocation)>,
    on_top: bool,
) -> IpcResult<()> {
    let settings = app.state::<SettingsStore>().get();
    let mut state = app.state::<DeviceStateStore>().get();
    if let Some((_, location)) = &page {
        state.location = location.clone();
    }
    let paths = app.state::<Paths>();
    let os = app.state::<Current>().get();
    let data = boot::payload(&app.state::<Startup>(), &settings, &state, &os, install::status(&paths));
    let Rgb(r, g, b) = boot::window_color(settings.appearance.theme, &os, boot::system_window_color());
    let text = script(
        &boot::initialization_script(&data),
        kind,
        page.as_ref().map(|(id, _)| *id),
    );
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(320.0, 240.0)
        .always_on_top(on_top)
        .center()
        .background_color(Color(r, g, b, 255))
        .initialization_script(text)
        .data_directory(paths.webview.clone())
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .build()
        .map(|window| crate::lifecycle::watch_window(&window))
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
}

/// Opens a page in a window of its own, or brings its window forward.
pub fn open_page(
    app: &AppHandle,
    page: &str,
    section: Option<String>,
    notebook: Option<String>,
    title: &str,
) -> IpcResult<()> {
    let label = page_label(page);
    if let Some(open) = app.get_webview_window(&label) {
        let _ = open.show();
        let _ = open.set_focus();
        return Ok(());
    }
    let location = StoredLocation::Workspace {
        notebook_id: notebook,
        section_id: section,
        page_id: Some(page.to_owned()),
    };
    build(
        app,
        &label,
        title,
        (900.0, 720.0),
        "page",
        Some((page, location)),
        false,
    )
}

/// Opens the quick capture window, or brings it forward.
pub fn open_capture(app: &AppHandle) -> IpcResult<()> {
    if let Some(open) = app.get_webview_window("capture") {
        let _ = open.show();
        let _ = open.set_focus();
        return Ok(());
    }
    build(app, "capture", "Quick note", (460.0, 320.0), "capture", None, true)
}

/// Opens Windows settings on the pen page, where the pen top button can be set to open OpenNote. The address is
/// fixed here, so nothing from the interface reaches the command line.
fn open_pen_settings() -> IpcResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:pen")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(IpcError::not_implemented("Pen settings"))
    }
}

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "window.setAlwaysOnTop" => {
            let on: bool = arg(args, "on")?;
            let main = app
                .get_webview_window("main")
                .ok_or_else(|| IpcError::new(codes::INTERNAL, "There is no main window."))?;
            main.set_always_on_top(on)?;
            ok()
        }
        "window.openPage" => {
            let page: String = arg(args, "pageId")?;
            let title: Option<String> = opt(args, "title")?;
            open_page(
                app,
                &page,
                opt(args, "sectionId")?,
                opt(args, "notebookId")?,
                &title.unwrap_or_default(),
            )?;
            ok()
        }
        "window.closeCapture" => {
            if let Some(window) = app.get_webview_window("capture") {
                window.close()?;
            }
            ok()
        }
        "window.openPenSettings" => {
            open_pen_settings()?;
            ok()
        }
        "window.focusMain" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(json!({ "ok": true }))
        }
        _ => Err(IpcError::invalid("name", "isn't a window call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_hold_only_letters_and_digits() {
        assert_eq!(page_label("01J8-Page_ID"), "page-01j8pageid");
        assert_eq!(page_label("../../x\"y"), "page-xy");
    }

    #[test]
    fn the_script_escapes_what_it_is_given() {
        let text = script("boot();", "page", Some("a\"b"));
        assert!(text.starts_with("boot();"));
        assert!(text.contains(r#"page: "a\"b""#));
        assert!(script("", "capture", None).contains("page: null"));
    }
}
