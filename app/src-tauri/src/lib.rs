//! The OpenNote desktop shell: creates the window and exposes commands to the interface.

/// Returns the app version, for the About screen and update checks.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Starts the app. Shared by the desktop binary and, later, the mobile entry points.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
