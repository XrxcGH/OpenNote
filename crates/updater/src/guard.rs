//! The start guard (ARCHITECTURE.md section 18.8). It runs in the app's start-up, after the instance lock and
//! before Tauri starts, and decides whether this start counts, or whether to roll back to the previous copy.

use std::path::PathBuf;

use semver::Version;

use crate::{config::UpdaterDirs, swap::Replacer};

/// How many starts of a new version may fail to reach `app_ready` before the next launch rolls back.
pub const MAX_FAILED_STARTS: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardDecision {
    /// Start normally. `counted_attempt` is this start's number when a new version is still pending.
    Continue { counted_attempt: Option<u8> },
    /// The previous copy is back in place; start it with `--rolled-back-from` and exit.
    RolledBack {
        from: Version,
        to: Version,
        relaunch: PathBuf,
    },
    /// A rollback was due, but the previous copy is missing or damaged. Start normally and show a notice.
    RollbackUnavailable { from: Version },
}

/// Reads `updates\state.json` and decides how this start goes.
pub fn guard_on_start(_dirs: &UpdaterDirs, _current: &Version, _replacer: &dyn Replacer) -> GuardDecision {
    GuardDecision::Continue { counted_attempt: None }
}
