//! Glue between `crates/updater` and Tauri (ARCHITECTURE.md section 18). It holds the start guard, the status in
//! the boot payload, the worker thread, the `updater_*` commands, the `updater://status` event, and the lifecycle
//! hooks that install an update on exit.
//!
//! A development build, a build without an update key, and a copy in a folder it can't write to never update
//! themselves. Their status says why, and Settings explains it.

mod config;
mod exit;
mod service;
mod system;
mod worker;

use std::{
    path::Path,
    process::Command,
    sync::{Arc, OnceLock},
};

use opennote_updater::{state::UpdaterState, swap::SelfReplace, GuardDecision};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    ipc::{codes, IpcError, IpcResult},
    lifecycle::LifecycleHooks,
    paths::Paths,
    settings::schema::Settings,
};
use service::{Message, Service};

// UPDATE_PUBLIC_KEYS, TEST_UPDATE_PUBLIC_KEY, and TEST_ENDPOINTS_MARKER, written by build.rs from keys/*.pub
// and the test-endpoints feature (ARCHITECTURE.md section 18.12).
include!(concat!(env!("OUT_DIR"), "/update_keys.rs"));

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
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct UpdaterStatus {
    pub phase: UpdaterPhase,
    pub last_check: Option<String>,
    pub skipped_version: Option<String>,
    #[cfg_attr(test, ts(inline))]
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
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PreviousInfo {
    pub version: String,
    pub available: bool,
}

/// The updater's phase, matching the interface's `UpdaterPhase` (section 18.2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum UpdaterPhase {
    Disabled {
        #[cfg_attr(test, ts(inline))]
        reason: DisabledReason,
    },
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        notes: String,
        #[cfg_attr(test, ts(type = "number"))]
        size: u64,
        waiting_for_unmetered: bool,
    },
    Downloading {
        version: String,
        #[cfg_attr(test, ts(type = "number"))]
        received: u64,
        #[cfg_attr(test, ts(type = "number"))]
        total: u64,
    },
    Verifying {
        version: String,
    },
    Ready {
        version: String,
        notes: String,
        #[cfg_attr(test, ts(inline))]
        blocked_by: Option<BlockedBy>,
    },
    Applying {
        version: String,
    },
    Error {
        #[cfg_attr(test, ts(inline))]
        code: ErrorCode,
        retry_at: Option<String>,
    },
}

/// Why the updater is off. `noKey` is a build without an update public key, which can't verify any update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum DisabledReason {
    DevBuild,
    ManualMode,
    NotWritable,
    NoKey,
}

/// What keeps a ready update from applying.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum BlockedBy {
    UnsavedChanges,
    Recording,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ErrorCode {
    Offline,
    Unreachable,
    VerifyFailed,
    DiskFull,
    SwapFailed,
    Unknown,
}

impl ErrorCode {
    /// The code for `UpdateError::code`.
    pub fn from_code(code: &str) -> Self {
        match code {
            "offline" => Self::Offline,
            "unreachable" => Self::Unreachable,
            "verifyFailed" => Self::VerifyFailed,
            "diskFull" => Self::DiskFull,
            "swapFailed" => Self::SwapFailed,
            _ => Self::Unknown,
        }
    }
}

/// The version a phase is about, if it's about one.
pub fn phase_version(phase: Option<&UpdaterPhase>) -> Option<String> {
    match phase? {
        UpdaterPhase::Available { version, .. }
        | UpdaterPhase::Downloading { version, .. }
        | UpdaterPhase::Verifying { version }
        | UpdaterPhase::Ready { version, .. }
        | UpdaterPhase::Applying { version } => Some(version.clone()),
        _ => None,
    }
}

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

fn service(paths: &Paths) -> &'static Arc<Service> {
    SERVICE.get_or_init(|| Arc::new(Service::new(paths.clone())))
}

/// The update state file, or the default state in a development build, which never reads it.
fn state_of(paths: &Paths) -> UpdaterState {
    if config::is_dev_build() {
        UpdaterState::default()
    } else {
        UpdaterState::load(&paths.updates)
    }
}

/// The previous copy's version, without hashing it, which the worker does right after start.
fn unchecked_previous(paths: &Paths) -> Option<PreviousInfo> {
    let record = state_of(paths).previous?;
    let current = config::current_version().to_string();
    let exists = Path::new(&record.path)
        .file_name()
        .is_some_and(|name| paths.previous.join(name).is_file());
    (record.version != current && exists).then_some(PreviousInfo {
        version: record.version,
        available: true,
    })
}

/// Runs the start guard after the instance lock and before Tauri starts (section 18.8). A development build
/// never touches the update state.
pub fn guard_on_start(paths: &Paths) -> GuardOutcome {
    let Some(dirs) = config::dirs(paths).filter(|_| !config::is_dev_build()) else {
        return GuardOutcome::Continue { counted_attempt: None };
    };
    let current = config::current_version();
    match opennote_updater::guard_on_start(&dirs, &current, &SelfReplace) {
        GuardDecision::Continue { counted_attempt } => {
            config::fail_before_ready_for_tests(counted_attempt);
            GuardOutcome::Continue { counted_attempt }
        }
        GuardDecision::RolledBack { from, to, relaunch } => {
            log::error!("{from} failed to start twice, so {to} is back.");
            let pid = std::process::id().to_string();
            let from = from.to_string();
            let args = ["--wait-pid", pid.as_str(), "--rolled-back-from", from.as_str()];
            if let Err(error) = Command::new(&relaunch).args(args).spawn() {
                log::error!("Couldn't start {to} after the rollback: {error}");
            }
            GuardOutcome::Relaunched
        }
        GuardDecision::RollbackUnavailable { from, previous } => GuardOutcome::RollbackUnavailable {
            from: from.to_string(),
            previous: previous.map(|version| version.to_string()),
        },
    }
}

/// The status the boot payload carries, before the worker starts. It never waits for the network or hashing:
/// a staged update shows as ready once the worker has verified it again.
pub fn initial_status(paths: &Paths, settings: &Settings) -> UpdaterStatus {
    let blocked = config::this_build_blocked();
    UpdaterStatus {
        phase: config::resting_phase(blocked, settings.updates.install),
        last_check: state_of(paths).last_check,
        skipped_version: settings.updates.skipped_version.clone(),
        previous: unchecked_previous(paths),
    }
}

/// The updater's lifecycle hooks: start the healthy timer and the schedule when ready, and install on exit.
pub fn hooks(paths: &Paths) -> Arc<dyn LifecycleHooks> {
    Arc::new(exit::UpdaterHooks(Arc::clone(service(paths))))
}

/// The service the hooks made, which the commands use. Every app start makes it before the first command.
fn running() -> IpcResult<&'static Arc<Service>> {
    SERVICE
        .get()
        .ok_or_else(|| IpcError::new(codes::INTERNAL, "the updater isn't running"))
}

#[tauri::command]
pub fn updater_status(app: AppHandle) -> IpcResult<UpdaterStatus> {
    let service = running()?;
    service.attach(&app);
    Ok(service.status(&service.settings()))
}

#[tauri::command]
pub fn updater_check(app: AppHandle) -> IpcResult<()> {
    running()?.send(&app, Message::Check)
}

#[tauri::command]
pub fn updater_download(app: AppHandle) -> IpcResult<()> {
    running()?.send(&app, Message::Download)
}

#[tauri::command]
pub fn updater_restart_to_update(app: AppHandle) -> IpcResult<()> {
    running()?.restart_to_update(&app)
}

#[tauri::command]
pub fn updater_skip(app: AppHandle, version: String) -> IpcResult<()> {
    running()?.skip(&app, &version)
}

#[tauri::command]
pub fn updater_unskip(app: AppHandle) -> IpcResult<()> {
    running()?.unskip(&app)
}

#[tauri::command]
pub fn updater_go_back(app: AppHandle) -> IpcResult<()> {
    running()?.go_back(&app)
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
    fn embeds_only_minisign_public_keys() {
        for key in UPDATE_PUBLIC_KEYS {
            let key_line = key.lines().nth(1).unwrap_or_default();
            assert!(key.starts_with("untrusted comment:") && key_line.starts_with("RW") && key_line.len() == 56);
        }
    }

    #[test]
    fn only_test_endpoint_builds_carry_the_marker_and_the_test_key() {
        let test_build = cfg!(feature = "test-endpoints");
        assert_eq!(TEST_ENDPOINTS_MARKER.is_some(), test_build);
        assert_eq!(
            TEST_ENDPOINTS_MARKER.map(|marker| marker.starts_with("OPENNOTE-TEST-")),
            test_build.then_some(true)
        );
        if !test_build {
            assert_eq!(TEST_UPDATE_PUBLIC_KEY, None);
        }
    }

    #[test]
    fn a_development_build_reports_the_updater_as_off() {
        let dir = tempfile::tempdir().expect("a folder");
        let paths = Paths::under_profile(dir.path());
        let status = initial_status(&paths, &Settings::default());
        if config::is_dev_build() {
            assert_eq!(
                serde_json::to_value(status).expect("serializes"),
                json!({
                    "phase": { "kind": "disabled", "reason": "devBuild" },
                    "lastCheck": null, "skippedVersion": null, "previous": null
                })
            );
            assert_eq!(guard_on_start(&paths), GuardOutcome::Continue { counted_attempt: None });
            assert!(!paths.updates.exists(), "a development build never writes the state");
        }
    }

    #[test]
    fn names_the_new_reason_and_maps_every_error_code() {
        let no_key = UpdaterPhase::Disabled {
            reason: DisabledReason::NoKey,
        };
        assert_eq!(
            serde_json::to_value(no_key).expect("serializes"),
            json!({ "kind": "disabled", "reason": "noKey" })
        );
        for code in [
            "offline",
            "unreachable",
            "verifyFailed",
            "diskFull",
            "swapFailed",
            "unknown",
        ] {
            let mapped = serde_json::to_value(ErrorCode::from_code(code)).expect("serializes");
            assert_eq!(mapped, json!(code));
        }
        assert_eq!(ErrorCode::from_code("anything else"), ErrorCode::Unknown);
    }

    #[test]
    fn knows_which_version_a_phase_is_about() {
        let ready = UpdaterPhase::Ready {
            version: "0.5.0".into(),
            notes: String::new(),
            blocked_by: None,
        };
        assert_eq!(phase_version(Some(&ready)), Some("0.5.0".into()));
        assert_eq!(phase_version(Some(&UpdaterPhase::UpToDate)), None);
        assert_eq!(phase_version(None), None);
    }
}
