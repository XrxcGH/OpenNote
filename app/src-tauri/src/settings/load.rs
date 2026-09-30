//! Reading `settings.json` at start (ARCHITECTURE.md sections 16.5 and 16.6). A file that isn't valid JSON is
//! renamed to `settings.corrupt-<timestamp>.json`, and the `.bak` copy or the defaults take its place. A file
//! from an older schema is backed up, then migrated. A file whose `minWriterSchema` is newer than this build
//! opens read-only. After each good load, the file is copied to `settings.json.bak`.

use std::{fs, io, path::Path};

use serde_json::Value;

use super::{
    file,
    migrate::{self, MigrateError, Migration},
    schema::{Settings, SCHEMA_VERSION},
};
use crate::{boot::Notice, paths::Paths};

/// How many settings backups the backups folder keeps.
pub const BACKUPS_KEPT: usize = 3;

/// What reading the settings file found.
#[derive(Debug)]
pub struct Read {
    pub raw: Value,
    /// `settings.json` didn't exist.
    pub first_run: bool,
    pub read_only: bool,
    /// The document changed on the way in (restored or migrated), so it should be written.
    pub needs_write: bool,
    pub notices: Vec<Notice>,
}

impl Read {
    fn fresh(raw: Value) -> Self {
        Read {
            raw,
            first_run: false,
            read_only: false,
            needs_write: false,
            notices: Vec::new(),
        }
    }
}

pub fn defaults() -> Value {
    serde_json::to_value(Settings::default()).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
}

/// Reads the settings file under `paths`.
pub fn read(paths: &Paths) -> Read {
    let path = &paths.settings_file;
    match fs::read(path) {
        Ok(bytes) => match parse_object(&bytes) {
            Some(raw) => {
                if let Err(error) = fs::copy(path, file::with_suffix(path, ".bak")) {
                    log::warn!("Couldn't copy the settings to settings.json.bak: {error}");
                }
                prepare(Read::fresh(raw), paths)
            }
            None => restore(paths),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => Read {
            first_run: true,
            ..Read::fresh(defaults())
        },
        Err(error) => {
            log::error!("Couldn't read the settings, so they open read-only with the defaults: {error}");
            Read {
                read_only: true,
                ..Read::fresh(defaults())
            }
        }
    }
}

fn parse_object(bytes: &[u8]) -> Option<Value> {
    serde_json::from_slice::<Value>(bytes).ok().filter(Value::is_object)
}

/// Sets a corrupt file aside, then uses the `.bak` copy or the defaults.
fn restore(paths: &Paths) -> Read {
    let path = &paths.settings_file;
    let stamp = file::timestamp(std::time::SystemTime::now());
    let saved_as = format!("settings.corrupt-{stamp}.json");
    if let Err(error) = fs::rename(path, path.with_file_name(&saved_as)) {
        log::error!("Couldn't set the unreadable settings aside: {error}");
    }
    log::warn!("The settings file wasn't valid JSON; it's saved as {saved_as}.");
    let backup = fs::read(file::with_suffix(path, ".bak"))
        .ok()
        .and_then(|bytes| parse_object(&bytes));
    let mut read = match backup {
        Some(raw) => prepare(Read::fresh(raw), paths),
        None => Read::fresh(defaults()),
    };
    read.needs_write = !read.read_only;
    read.notices.insert(0, Notice::SettingsReset { saved_as });
    read
}

/// Handles the schema version: read-only for files older versions may not write, a migration for older ones.
fn prepare(mut read: Read, paths: &Paths) -> Read {
    if migrate::min_writer_of(&read.raw) > SCHEMA_VERSION {
        log::warn!("The settings were saved by a newer version that older versions may not write; read-only.");
        read.read_only = true;
        read.notices.push(Notice::SettingsReadOnly);
        return read;
    }
    let version = migrate::version_of(&read.raw);
    if version >= SCHEMA_VERSION {
        return read;
    }
    let files = (paths.settings_file.as_path(), paths.backups.as_path());
    match migrate_with_backup(&read.raw, files, migrate::MIGRATIONS, SCHEMA_VERSION) {
        Ok(migrated) => {
            read.raw = migrated;
            read.needs_write = true;
        }
        Err(error) => {
            log::error!("Couldn't migrate the settings from version {version}, so they open read-only: {error:?}");
            read.read_only = true;
        }
    }
    read
}

/// Copies the settings file to the backups folder as `settings-v<n>-<timestamp>.json`, keeping the newest
/// three, then migrates the document to `target`. Nothing migrates without a backup.
pub fn migrate_with_backup(
    raw: &Value,
    (path, backups): (&Path, &Path),
    steps: &[Migration],
    target: u32,
) -> Result<Value, MigrateError> {
    let version = migrate::version_of(raw);
    let copy = file::backup(path, backups, &format!("settings-v{version}-"), BACKUPS_KEPT)
        .map_err(|error| MigrateError::Backup(error.to_string()))?;
    log::info!("Backed up the settings to {} before migrating.", copy.display());
    migrate::migrate_with(raw.clone(), target, steps)
}
