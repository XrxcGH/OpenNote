//! Personal settings, owned by Rust (ARCHITECTURE.md section 16). The store keeps the raw document, so keys
//! written by a newer version survive every write, and a typed view parsed from it. The interface changes
//! settings only through merge patches.
//!
//! This skeleton keeps settings in memory, starting from the defaults. The shell work package adds loading
//! before the window, per-field leniency, validation of every field, and the coalesced atomic writer.

pub mod commands;
pub mod migrate;
pub mod patch;
pub mod schema;

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ipc::{IpcError, IpcResult};
use schema::{Settings, SettingsSectionKey};

/// The payload of `settings://changed`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsChanged {
    pub settings: Settings,
    /// The label of the window that made the change.
    pub origin: String,
}

pub struct SettingsStore {
    raw: Mutex<Value>,
    read_only: bool,
}

impl SettingsStore {
    /// A store that never touches the disk, starting from `settings`.
    pub fn in_memory(settings: &Settings) -> Self {
        Self {
            raw: Mutex::new(to_raw(settings)),
            read_only: false,
        }
    }

    /// The typed view of the current settings.
    pub fn get(&self) -> Settings {
        parse(&self.raw()).unwrap_or_default()
    }

    /// Applies a merge patch. An invalid patch changes nothing and returns the error with the field's path.
    pub fn update(&self, patch: Value, origin: &str) -> IpcResult<Settings> {
        log::debug!("Settings patch from {origin}");
        self.change(|raw| patch::merge_patch(raw, &patch))
    }

    /// Puts one section back to its defaults, dropping any keys the defaults don't have.
    pub fn reset(&self, section: SettingsSectionKey, origin: &str) -> IpcResult<Settings> {
        log::debug!("Settings reset of {} from {origin}", section.key());
        let defaults = to_raw(&Settings::default());
        self.change(|raw| {
            if let Value::Object(fields) = raw {
                fields.insert(section.key().to_owned(), defaults[section.key()].clone());
            }
        })
    }

    /// True when a newer version's `minWriterSchema` forbids writing the file (section 16.6).
    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// Changes a copy of the raw document, and keeps it only when its typed view is valid.
    fn change(&self, edit: impl FnOnce(&mut Value)) -> IpcResult<Settings> {
        let mut raw = self.raw();
        let mut next = raw.clone();
        edit(&mut next);
        let settings = parse(&next)?;
        settings.validate()?;
        *raw = next;
        Ok(settings)
    }

    fn raw(&self) -> MutexGuard<'_, Value> {
        self.raw.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn to_raw(settings: &Settings) -> Value {
    serde_json::to_value(settings).unwrap_or_default()
}

fn parse(raw: &Value) -> IpcResult<Settings> {
    Settings::deserialize(raw).map_err(|error| IpcError::invalid("settings", &error.to_string()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use schema::ThemePreference;

    #[test]
    fn applies_a_patch_and_returns_the_new_settings() {
        let store = SettingsStore::in_memory(&Settings::default());
        let settings = store
            .update(json!({ "appearance": { "theme": "dark" } }), "main")
            .expect("valid");
        assert_eq!(settings.appearance.theme, ThemePreference::Dark);
        assert_eq!(store.get(), settings);
    }

    #[test]
    fn an_invalid_patch_changes_nothing() {
        let store = SettingsStore::in_memory(&Settings::default());
        assert!(store
            .update(json!({ "appearance": { "theme": "purple" } }), "main")
            .is_err());
        let error = store
            .update(json!({ "appearance": { "textSize": 120 } }), "main")
            .expect_err("invalid");
        assert_eq!(error.field.as_deref(), Some("appearance.textSize"));
        assert_eq!(store.get(), Settings::default());
    }

    #[test]
    fn keeps_keys_it_doesnt_know() {
        let store = SettingsStore::in_memory(&Settings::default());
        store.update(json!({ "future": { "a": 1 } }), "main").expect("valid");
        store
            .update(json!({ "startup": { "openLastPage": false } }), "main")
            .expect("valid");
        assert_eq!(store.raw()["future"], json!({ "a": 1 }));
    }

    #[test]
    fn resets_one_section() {
        let store = SettingsStore::in_memory(&Settings::default());
        let patch = json!({ "appearance": { "theme": "light", "extra": 1 }, "startup": { "openLastPage": false } });
        store.update(patch, "main").expect("valid");
        let settings = store.reset(SettingsSectionKey::Appearance, "main").expect("resets");
        assert_eq!(settings.appearance, schema::Appearance::default());
        assert!(!settings.startup.open_last_page);
        assert_eq!(store.raw()["appearance"].get("extra"), None);
    }
}
