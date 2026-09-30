//! The settings commands. Each change is sent to every window as `settings://changed`, with the label of the
//! window that made it.

use serde_json::Value;
use tauri::{Emitter, State, WebviewWindow};

use super::{
    schema::{Settings, SettingsSectionKey},
    SettingsChanged, SettingsStore,
};
use crate::{events, ipc::IpcResult};

/// Applies a merge patch from the interface and returns the new settings.
#[tauri::command]
pub fn settings_update(window: WebviewWindow, store: State<'_, SettingsStore>, patch: Value) -> IpcResult<Settings> {
    let settings = store.update(patch, window.label())?;
    announce(&window, &settings);
    Ok(settings)
}

/// Puts one section back to its defaults and returns the new settings.
#[tauri::command]
pub fn settings_reset(
    window: WebviewWindow,
    store: State<'_, SettingsStore>,
    section: SettingsSectionKey,
) -> IpcResult<Settings> {
    let settings = store.reset(section, window.label())?;
    announce(&window, &settings);
    Ok(settings)
}

fn announce(window: &WebviewWindow, settings: &Settings) {
    let payload = SettingsChanged {
        settings: settings.clone(),
        origin: window.label().to_owned(),
    };
    if let Err(error) = window.emit(events::SETTINGS_CHANGED, payload) {
        log::warn!("Couldn't send {}: {error}", events::SETTINGS_CHANGED);
    }
}
