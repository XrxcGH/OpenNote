//! Glue between `crates/updater` and Tauri (ARCHITECTURE.md section 18): the start guard, the scheduler thread,
//! the `updater_*` commands, and the `updater://status` event. The updater work package fills it in.

use crate::paths::Paths;

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

/// Runs the start guard after the instance lock and before Tauri starts (section 18.8).
pub fn guard_on_start(_paths: &Paths) -> GuardOutcome {
    GuardOutcome::Continue { counted_attempt: None }
}
