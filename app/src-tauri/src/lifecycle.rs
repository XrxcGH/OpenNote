//! The app's lifecycle after start-up (ARCHITECTURE.md sections 8.2 and 8.7): the show strategy, first paint,
//! `app_ready`, and the exit handshake that every way of closing goes through.
//!
//! This skeleton keeps Phase 0's behavior: the window shows when the page loads (see `window/mod.rs`), and a
//! close exits at once. The shell work package adds the handshake with the 3 s timeout, the session-end budget,
//! and the calls to [`LifecycleHooks`].

use std::{path::PathBuf, sync::Arc};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::ipc::IpcResult;

/// Why the app is closing, matching the interface's `ExitReason`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExitReason {
    Close,
    RestartToUpdate,
    GoBack,
    MoveApp,
    SessionEnd,
}

/// What to do once the handshake allows the exit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExitPlan {
    pub relaunch: Option<Relaunch>,
}

/// A process to start on the way out. The lifecycle adds `--wait-pid` with this process's id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relaunch {
    pub exe: PathBuf,
    pub args: Vec<String>,
}

/// Work other modules do at lifecycle points. The updater implements it.
pub trait LifecycleHooks: Send + Sync + 'static {
    /// The last page is on screen. The updater starts its healthy timer and its schedule.
    fn on_ready(&self, app: &AppHandle);
    /// The interface allowed the exit. The updater applies or swaps when the reason and policy allow it.
    fn on_exit(&self, app: &AppHandle, reason: ExitReason) -> ExitPlan;
}

/// The hooks in managed state.
pub struct Hooks(pub Arc<dyn LifecycleHooks>);

/// The interface's answer to `app://before-exit`: `{ ok: true }`, or `{ ok: false, reason }` with a message key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExitResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// When the page first painted and when the last page was ready, as epoch milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyTimings {
    pub first_paint_epoch_ms: f64,
    pub page_ready_epoch_ms: f64,
    pub page_id: Option<String>,
}

/// Starts the exit handshake. Until the shell work package builds it, closing exits at once, and the reasons
/// that need a relaunch do nothing.
pub fn request_exit(app: &AppHandle, reason: ExitReason) {
    match reason {
        ExitReason::Close | ExitReason::SessionEnd => app.exit(0),
        ExitReason::RestartToUpdate | ExitReason::GoBack | ExitReason::MoveApp => {
            log::warn!("Ignored an exit for {reason:?}: the exit handshake isn't implemented yet.");
        }
    }
}

/// The page has painted its first frame. Under the hidden show strategy, this shows the window.
#[tauri::command]
pub fn app_first_paint() -> IpcResult<()> {
    Ok(())
}

/// The last page is on screen.
#[tauri::command]
pub fn app_ready(timings: ReadyTimings) -> IpcResult<()> {
    log::debug!(
        "Ready {} ms after the first paint",
        timings.page_ready_epoch_ms - timings.first_paint_epoch_ms
    );
    Ok(())
}

/// The interface's answer to `app://before-exit`.
#[tauri::command]
pub fn app_exit_ready(result: ExitResult) -> IpcResult<()> {
    log::debug!("Exit answer: {result:?}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_both_shapes_of_the_exit_answer() {
        let ok: ExitResult = serde_json::from_value(json!({ "ok": true })).expect("parses");
        assert_eq!(ok, ExitResult { ok: true, reason: None });
        let blocked: ExitResult =
            serde_json::from_value(json!({ "ok": false, "reason": "errors.recording" })).expect("parses");
        assert_eq!(blocked.reason.as_deref(), Some("errors.recording"));
    }

    #[test]
    fn names_exit_reasons_as_the_interface_does() {
        let names = [
            ExitReason::Close,
            ExitReason::RestartToUpdate,
            ExitReason::GoBack,
            ExitReason::MoveApp,
        ]
        .map(|reason| serde_json::to_value(reason).expect("serializes"));
        assert_eq!(
            names,
            [
                json!("close"),
                json!("restartToUpdate"),
                json!("goBack"),
                json!("moveApp")
            ]
        );
        assert_eq!(
            serde_json::to_value(ExitReason::SessionEnd).expect("serializes"),
            json!("sessionEnd")
        );
    }
}
