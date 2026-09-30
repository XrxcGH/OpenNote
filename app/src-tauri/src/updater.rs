//! Glue between `crates/updater` and Tauri (ARCHITECTURE.md section 18): the start guard, the scheduler thread,
//! the `updater_*` commands, the `updater://status` event, and the lifecycle hooks that apply an update on exit.
//!
//! This skeleton reports the updater as off, the way development builds show it, and its commands return
//! `notImplemented`. The updater work package fills it in.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    ipc::{IpcError, IpcResult},
    lifecycle::{ExitPlan, ExitReason, LifecycleHooks},
    paths::Paths,
    settings::schema::Settings,
};

/// What the start guard decided, in the terms the app needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardOutcome {
    /// Start normally. `counted_attempt` is this start's number while a new version is still pending.
    Continue { counted_attempt: Option<u8> },
    /// The previous version was restored and started; this process exits.
    Relaunched,
    /// A rollback was due, but the previous copy is missing or damaged; the app shows a notice.
    RollbackUnavailable { from: String, previous: Option<String> },
}

/// The updater's state as the interface shows it, matching the interface's `UpdaterStatus`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    pub phase: UpdaterPhase,
    pub last_check: Option<String>,
    pub skipped_version: Option<String>,
    pub previous: Option<PreviousInfo>,
}

impl UpdaterStatus {
    /// A status with no check yet, no skipped version, and no previous copy.
    pub fn new(phase: UpdaterPhase) -> Self {
        Self {
            phase,
            last_check: None,
            skipped_version: None,
            previous: None,
        }
    }
}

/// The version "Go back" returns to, and whether its copy is still there and intact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviousInfo {
    pub version: String,
    pub available: bool,
}

/// The updater's phase, matching the interface's `UpdaterPhase` (section 18.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UpdaterPhase {
    Disabled {
        reason: DisabledReason,
    },
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        notes: String,
        size: u64,
        waiting_for_unmetered: bool,
    },
    Downloading {
        version: String,
        received: u64,
        total: u64,
    },
    Verifying {
        version: String,
    },
    Ready {
        version: String,
        notes: String,
        blocked_by: Option<BlockedBy>,
    },
    Applying {
        version: String,
    },
    Error {
        code: ErrorCode,
        retry_at: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DisabledReason {
    DevBuild,
    ManualMode,
    NotWritable,
}

/// What keeps a ready update from applying.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockedBy {
    UnsavedChanges,
    Recording,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Offline,
    Unreachable,
    VerifyFailed,
    DiskFull,
    SwapFailed,
    Unknown,
}

/// Runs the start guard after the instance lock and before Tauri starts (section 18.8).
pub fn guard_on_start(_paths: &Paths) -> GuardOutcome {
    GuardOutcome::Continue { counted_attempt: None }
}

/// The status the boot payload carries, before the scheduler thread starts.
pub fn initial_status(_paths: &Paths, _settings: &Settings) -> UpdaterStatus {
    UpdaterStatus::new(UpdaterPhase::Disabled {
        reason: DisabledReason::DevBuild,
    })
}

/// The updater's lifecycle hooks: start the healthy timer and the schedule when ready, and apply on exit.
pub fn hooks(_paths: &Paths) -> Arc<dyn LifecycleHooks> {
    Arc::new(NoHooks)
}

/// Hooks that do nothing, until the updater work package adds the real ones.
struct NoHooks;

impl LifecycleHooks for NoHooks {
    fn on_ready(&self, _app: &AppHandle) {}

    fn on_exit(&self, _app: &AppHandle, _reason: ExitReason) -> ExitPlan {
        ExitPlan::default()
    }
}

#[tauri::command]
pub fn updater_status() -> IpcResult<UpdaterStatus> {
    Ok(UpdaterStatus::new(UpdaterPhase::Disabled {
        reason: DisabledReason::DevBuild,
    }))
}

#[tauri::command]
pub fn updater_check() -> IpcResult<()> {
    Err(IpcError::not_implemented("updater_check"))
}

#[tauri::command]
pub fn updater_download() -> IpcResult<()> {
    Err(IpcError::not_implemented("updater_download"))
}

#[tauri::command]
pub fn updater_restart_to_update() -> IpcResult<()> {
    Err(IpcError::not_implemented("updater_restart_to_update"))
}

#[tauri::command]
pub fn updater_skip(version: String) -> IpcResult<()> {
    let _ = version;
    Err(IpcError::not_implemented("updater_skip"))
}

#[tauri::command]
pub fn updater_unskip() -> IpcResult<()> {
    Err(IpcError::not_implemented("updater_unskip"))
}

#[tauri::command]
pub fn updater_go_back() -> IpcResult<()> {
    Err(IpcError::not_implemented("updater_go_back"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn serializes_phases_as_the_interface_reads_them() {
        let ready = UpdaterPhase::Ready {
            version: "0.5.0".into(),
            notes: "n".into(),
            blocked_by: None,
        };
        assert_eq!(
            serde_json::to_value(ready).expect("serializes"),
            json!({ "kind": "ready", "version": "0.5.0", "notes": "n", "blockedBy": null })
        );
        let available = UpdaterPhase::Available {
            version: "0.5.0".into(),
            notes: String::new(),
            size: 7,
            waiting_for_unmetered: true,
        };
        assert_eq!(
            serde_json::to_value(available).expect("serializes")["waitingForUnmetered"],
            json!(true)
        );
        let error = UpdaterPhase::Error {
            code: ErrorCode::VerifyFailed,
            retry_at: None,
        };
        assert_eq!(
            serde_json::to_value(error).expect("serializes"),
            json!({ "kind": "error", "code": "verifyFailed", "retryAt": null })
        );
    }

    #[test]
    fn reports_the_updater_as_off_until_it_lands() {
        let status = updater_status().expect("a status");
        assert_eq!(
            serde_json::to_value(status).expect("serializes"),
            json!({
                "phase": { "kind": "disabled", "reason": "devBuild" },
                "lastCheck": null, "skippedVersion": null, "previous": null
            })
        );
    }
}
