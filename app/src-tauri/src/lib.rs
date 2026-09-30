//! The OpenNote desktop shell: creates the window and exposes commands to the interface.

pub mod args;
pub mod early;
pub mod events;
pub mod instance;
pub mod ipc;
pub mod paths;
pub mod theme_tokens;
pub mod updater;
pub mod window;

use std::{thread, time::Duration};

use tauri::{webview::PageLoadEvent, Manager};

use early::EarlyContext;

/// How long start-up waits for the page before showing the main window anyway.
const SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(3);

/// Returns the app version, for the About screen and update checks.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Starts the app with what the early steps in `early.rs` found. Doesn't return.
pub fn run(context: EarlyContext) {
    // The instance guard holds the profile's lock, so it stays alive until the process exits.
    let _instance = context.instance;
    tauri::Builder::default()
        // The main window starts hidden and appears once the themed page has loaded, so start-up doesn't
        // show WebView2's default white background (BRAND.md section 4). Showing a visible window does nothing.
        .on_page_load(|webview, payload| {
            let window = webview.window();
            if payload.event() == PageLoadEvent::Finished && window.label() == "main" {
                let _ = window.show();
            }
        })
        .setup(|app| {
            // Shows the main window anyway if the page never finishes loading.
            if let Some(window) = app.get_webview_window("main") {
                thread::spawn(move || {
                    thread::sleep(SHOW_FALLBACK_DELAY);
                    let _ = window.show();
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("OpenNote failed to start");
}

#[cfg(test)]
mod tests {
    use super::app_version;

    #[test]
    fn version_matches_the_package() {
        assert_eq!(app_version(), env!("CARGO_PKG_VERSION"));
        assert!(!app_version().is_empty());
    }
}
