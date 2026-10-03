//! Personal settings, owned by Rust (ARCHITECTURE.md section 16). The store keeps the raw document, so keys and
//! values written by a newer version survive every write, and a typed view parsed from it field by field. The
//! interface changes settings only through merge patches, which Rust validates. A writer thread saves the raw
//! document 250 ms after a change, atomically; theme changes and the exit handshake save at once.

pub mod commands;
pub mod editing;
pub mod file;
pub mod ink;
mod ink_device;
pub mod lenient;
pub mod load;
pub mod migrate;
pub mod patch;
pub mod schema;
pub mod validate;
pub mod writer;

use std::{
    sync::{Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use serde::Serialize;
use serde_json::Value;

use crate::{
    boot::Notice,
    ipc::{IpcError, IpcResult},
    paths::Paths,
};
use schema::{Settings, SettingsSectionKey};
use writer::Writer;

/// How long the writer folds changes together before saving.
pub const SAVE_DELAY: Duration = Duration::from_millis(250);

/// The payload of `settings://changed`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingsChanged {
    pub settings: Settings,
    /// The label of the window that made the change.
    pub origin: String,
}

struct Document {
    raw: Value,
    settings: Settings,
}

pub struct SettingsStore {
    document: Mutex<Document>,
    read_only: bool,
    writer: Option<Writer>,
}

/// The store and what the interface learns about the load.
pub struct Loaded {
    pub store: SettingsStore,
    /// `settings.json` didn't exist.
    pub first_run: bool,
    pub notices: Vec<Notice>,
}

impl SettingsStore {
    /// A store that never touches the disk, starting from `settings`.
    pub fn in_memory(settings: &Settings) -> Self {
        Self::from_raw(serde_json::to_value(settings).unwrap_or_default(), false, None)
    }

    /// Loads `settings.json` before the window exists, and starts its writer.
    pub fn load(paths: &Paths) -> Loaded {
        let read = load::read(paths);
        let writer = Writer::spawn(paths.settings_file.clone(), SAVE_DELAY, "settings");
        let store = Self::from_raw(read.raw, read.read_only, Some(writer));
        if read.needs_write {
            store.save(&store.document().raw, true);
        }
        Loaded {
            store,
            first_run: read.first_run,
            notices: read.notices,
        }
    }

    fn from_raw(raw: Value, read_only: bool, writer: Option<Writer>) -> Self {
        let parsed = lenient::parse::<Settings, _>(&raw, |settings| settings.validate().is_ok());
        for path in &parsed.repaired {
            log::warn!("Settings: used the default for {}", lenient::display(path));
        }
        Self {
            document: Mutex::new(Document {
                raw,
                settings: parsed.value,
            }),
            read_only,
            writer,
        }
    }

    /// The typed view of the current settings.
    pub fn get(&self) -> Settings {
        self.document().settings.clone()
    }

    /// Applies a merge patch. An invalid patch changes nothing and returns the error with the field's path.
    pub fn update(&self, patch: Value, origin: &str) -> IpcResult<Settings> {
        log::debug!("Settings patch from {origin}");
        let touched = patch::leaf_paths(&patch);
        let versions = ["schemaVersion", "minWriterSchema"];
        if let Some(path) = touched
            .iter()
            .find(|path| path.first().is_some_and(|key| versions.contains(&key.as_str())))
        {
            return Err(IpcError::invalid(
                &lenient::display(path),
                "Only a migration changes the schema versions.",
            ));
        }
        if !patch.is_object() {
            return Err(IpcError::invalid("patch", "A settings patch is an object."));
        }
        let theme = touched
            .iter()
            .any(|path| lenient::related(path, &["appearance".into(), "theme".into()]));
        self.change(&touched, theme, |raw| patch::merge_patch(raw, &patch))
    }

    /// Puts one section back to its defaults, dropping any keys the defaults don't have.
    pub fn reset(&self, section: SettingsSectionKey, origin: &str) -> IpcResult<Settings> {
        log::debug!("Settings reset of {} from {origin}", section.key());
        let defaults = load::defaults();
        let touched = [vec![section.key().to_owned()]];
        self.change(&touched, section == SettingsSectionKey::Appearance, |raw| {
            if let Value::Object(fields) = raw {
                fields.insert(section.key().to_owned(), defaults[section.key()].clone());
            }
        })
    }

    /// True when a newer version's `minWriterSchema` forbids writing the file (section 16.6). Changes then last
    /// until the app closes.
    pub fn read_only(&self) -> bool {
        self.read_only
    }

    /// Saves any waiting change now.
    pub fn flush(&self) -> std::io::Result<()> {
        match &self.writer {
            Some(writer) if !self.read_only => writer.flush(),
            _ => Ok(()),
        }
    }

    /// Changes a copy of the raw document, and keeps it only when every touched path parses and validates.
    fn change(&self, touched: &[Vec<String>], now: bool, edit: impl FnOnce(&mut Value)) -> IpcResult<Settings> {
        let mut document = self.document();
        let mut raw = document.raw.clone();
        edit(&mut raw);
        let parsed = lenient::parse::<Settings, _>(&raw, |settings| settings.validate().is_ok());
        let rejected = parsed
            .repaired
            .iter()
            .find(|repaired| touched.iter().any(|path| lenient::related(path, repaired)));
        if let Some(path) = rejected {
            return Err(IpcError::invalid(
                &lenient::display(path),
                "That value isn't allowed here.",
            ));
        }
        document.raw = raw;
        document.settings = parsed.value.clone();
        self.save(&document.raw, now);
        Ok(parsed.value)
    }

    fn save(&self, raw: &Value, now: bool) {
        let Some(writer) = self.writer.as_ref().filter(|_| !self.read_only) else {
            return;
        };
        writer.schedule(raw.clone());
        if now {
            if let Err(error) = writer.flush() {
                log::error!("Couldn't save the settings: {error}");
            }
        }
    }

    fn document(&self) -> MutexGuard<'_, Document> {
        self.document.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[cfg(test)]
    fn raw(&self) -> Value {
        self.document().raw.clone()
    }
}

#[cfg(test)]
mod tests;
