//! `updates\state.json`, the updater's own record (ARCHITECTURE.md section 18.6). Older versions must read files
//! that newer ones wrote, so fields are only ever added, and unknown fields survive every write. The file is
//! part of the upgrade contract.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The file's name inside `updates\`.
pub const FILE_NAME: &str = "state.json";

/// The format version this build writes.
pub const STATE_VERSION: u32 = 1;

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

/// The verified update waiting in `updates\`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedRecord {
    pub version: String,
    pub platform: String,
    pub file: String,
    pub path: String,
    pub sha256: String,
    #[serde(flatten)]
    pub unknown: Map<String, Value>,
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
}
