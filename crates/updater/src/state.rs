//! `updates\state.json`, the updater's own record (ARCHITECTURE.md section 18.6). Older versions must read files
//! that newer ones wrote, so fields are only ever added, and unknown fields survive every write. The file is
//! part of the upgrade contract. It's written atomically: a temporary file, `sync_all`, then a rename.
//!
//! Any program the person runs can write this folder, so nothing read from the file is trusted on its own. Paths
//! are rebuilt from the updater's folders, and every file is hashed and verified before it's used.

use std::{
    fs,
    io::{self, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The file's name inside `updates\`.
pub const FILE_NAME: &str = "state.json";

/// The format version this build writes.
pub const STATE_VERSION: u32 = 1;

impl UpdaterState {
    /// Reads `state.json` from the updates folder. A missing file is the default state. So is a damaged one,
    /// which is logged; the next save replaces it.
    pub fn load(updates: &Path) -> UpdaterState {
        let path = updates.join(FILE_NAME);
        match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                log::warn!("Ignored the damaged {}: {error}", path.display());
                UpdaterState::default()
            }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => UpdaterState::default(),
            Err(error) => {
                log::warn!("Couldn't read {}: {error}", path.display());
                UpdaterState::default()
            }
        }
    }

    /// Writes `state.json` atomically, creating the updates folder when needed.
    pub fn save(&self, updates: &Path) -> io::Result<()> {
        fs::create_dir_all(updates)?;
        let path = updates.join(FILE_NAME);
        let temporary = updates.join(format!("{FILE_NAME}.tmp"));
        let json = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&json)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &path)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdaterState {
    pub updater_state_version: u32,
    pub last_check: Option<String>,
    pub backoff_until: Option<String>,
    pub staged: Option<StagedRecord>,
    pub pending: Option<PendingRecord>,
    pub previous: Option<PreviousRecord>,
    pub blocked_versions: Vec<String>,
    pub rolled_back: Option<RolledBackRecord>,
    /// Fields written by a newer version, kept as they are.
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self {
            updater_state_version: STATE_VERSION,
            last_check: None,
            backoff_until: None,
            staged: None,
            pending: None,
            previous: None,
            blocked_versions: Vec::new(),
            rolled_back: None,
            unknown: Map::new(),
        }
    }
}

/// The verified update waiting in `updates\`. `size` and `signature` let a later start verify it again without the
/// manifest; a record without them never verifies, so the update downloads again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedRecord {
    pub version: String,
    pub platform: String,
    pub file: String,
    pub path: String,
    pub sha256: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub size: u64,
    /// The manifest's base64 `.sig` text.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signature: String,
    /// The manifest's release notes, so a later start shows them without the manifest.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub notes: String,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

/// A swapped-in version that hasn't had a healthy start yet, and how many starts it has had.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingRecord {
    pub version: String,
    pub from: String,
    pub attempts: u8,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

/// The copy of the version before the last update, in `previous\`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviousRecord {
    pub version: String,
    pub path: String,
    pub sha256: String,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

/// The last rollback, for the toast the restored version shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RolledBackRecord {
    pub from: String,
    pub to: String,
    pub at: String,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sample() -> Value {
        json!({
            "updaterStateVersion": 1,
            "lastCheck": "2026-10-14T18:05:00Z",
            "backoffUntil": null,
            "staged": {
                "version": "0.5.0", "platform": "windows-x86_64", "file": "OpenNote_Windows64.exe",
                "path": "C:\\updates\\OpenNote-0.5.0-windows-x86_64.exe", "sha256": "ab"
            },
            "pending": { "version": "0.5.0", "from": "0.4.0", "attempts": 1 },
            "previous": {
                "version": "0.4.0", "path": "C:\\previous\\OpenNote-0.4.0-windows-x86_64.exe", "sha256": "cd"
            },
            "blockedVersions": ["0.4.1"],
            "rolledBack": { "from": "0.5.0", "to": "0.4.0", "at": "2026-10-14T18:09:12Z" }
        })
    }

    #[test]
    fn reads_and_writes_the_documented_format() {
        let state: UpdaterState = serde_json::from_value(sample()).expect("the sample parses");
        assert_eq!(state.pending.as_ref().map(|p| p.attempts), Some(1));
        assert_eq!(serde_json::to_value(&state).expect("serializes"), sample());
    }

    #[test]
    fn keeps_fields_written_by_newer_versions() {
        let mut newer = sample();
        newer["futureField"] = json!({ "a": 1 });
        newer["pending"]["futureFlag"] = json!(true);
        let state: UpdaterState = serde_json::from_value(newer.clone()).expect("parses");
        assert_eq!(serde_json::to_value(&state).expect("serializes"), newer);
    }

    #[test]
    fn an_empty_file_reads_as_the_default() {
        let state: UpdaterState = serde_json::from_str("{}").expect("parses");
        assert_eq!(state, UpdaterState::default());
    }

    #[test]
    fn saves_and_loads_atomically_keeping_unknown_fields() {
        let dir = tempfile::tempdir().expect("a folder");
        let updates = dir.path().join("updates");
        assert_eq!(UpdaterState::load(&updates), UpdaterState::default());
        let mut newer = sample();
        newer["fromTheFuture"] = json!(1);
        newer["staged"]["size"] = json!(42);
        newer["staged"]["signature"] = json!("c2ln");
        newer["staged"]["notes"] = json!("OpenNote v0.5.0");
        let state: UpdaterState = serde_json::from_value(newer.clone()).expect("parses");
        state.save(&updates).expect("saves");
        assert_eq!(UpdaterState::load(&updates), state);
        assert!(!updates.join("state.json.tmp").exists());
        let written: Value = serde_json::from_slice(&fs::read(updates.join(FILE_NAME)).expect("reads")).expect("json");
        assert_eq!(written, newer);
    }

    #[test]
    fn a_damaged_file_loads_as_the_default() {
        let dir = tempfile::tempdir().expect("a folder");
        for text in ["not json", "[]", r#"{"pending": {"version": 1}}"#] {
            fs::write(dir.path().join(FILE_NAME), text).expect("writes");
            assert_eq!(UpdaterState::load(dir.path()), UpdaterState::default(), "{text}");
        }
    }
}
