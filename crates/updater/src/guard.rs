//! The start guard (ARCHITECTURE.md section 18.8). It runs in the app's start-up, after the instance lock and
//! before Tauri starts, so a second launch that forwards its arguments never counts. It counts each start of a
//! new version, and on the launch after two starts that never became healthy, it puts the previous copy back.

use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use semver::Version;

use crate::{
    config::UpdaterDirs,
    state::{PendingRecord, RolledBackRecord, UpdaterState},
    swap::{self, Replacer},
    time,
};

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
    /// A rollback was due, but the previous copy is missing or damaged. Start normally and show a notice that
    /// offers the previous version's download.
    RollbackUnavailable { from: Version, previous: Option<Version> },
}

/// What a start does with the pending record, before any file changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// No update is pending.
    Normal,
    /// The pending version isn't this one: the exe was replaced by hand, or rolled back. Forget it.
    Forget,
    /// Count this start as attempt `n`.
    Count(u8),
    /// Two starts never became healthy: roll back.
    RollBack,
}

/// The decision table of section 18.8.
pub fn step(pending: Option<&PendingRecord>, current: &Version) -> Step {
    let Some(pending) = pending else {
        return Step::Normal;
    };
    if Version::parse(&pending.version).ok().as_ref() != Some(current) {
        Step::Forget
    } else if pending.attempts >= MAX_FAILED_STARTS {
        Step::RollBack
    } else {
        Step::Count(pending.attempts + 1)
    }
}

/// Reads `updates\state.json` and decides how this start goes. A count is written and flushed before the app
/// goes on, so a crash right after still counts.
pub fn guard_on_start(dirs: &UpdaterDirs, current: &Version, replacer: &dyn Replacer) -> GuardDecision {
    let mut state = UpdaterState::load(&dirs.updates);
    let decision = match step(state.pending.as_ref(), current) {
        Step::Normal => return GuardDecision::Continue { counted_attempt: None },
        Step::Forget => {
            state.pending = None;
            GuardDecision::Continue { counted_attempt: None }
        }
        Step::Count(attempt) => {
            if let Some(pending) = state.pending.as_mut() {
                pending.attempts = attempt;
            }
            GuardDecision::Continue {
                counted_attempt: Some(attempt),
            }
        }
        Step::RollBack => roll_back(dirs, current, replacer, &mut state),
    };
    if let Err(error) = state.save(&dirs.updates) {
        log::error!("Couldn't record this start in the update state: {error}");
    }
    decision
}

/// Puts the previous copy back after checking its hash, blocks the failed version, and records the rollback.
fn roll_back(
    dirs: &UpdaterDirs,
    current: &Version,
    replacer: &dyn Replacer,
    state: &mut UpdaterState,
) -> GuardDecision {
    let record = state.previous.clone();
    let previous = record.as_ref().and_then(|record| Version::parse(&record.version).ok());
    let checked = record
        .as_ref()
        .and_then(|record| swap::checked_previous(&dirs.previous, record));
    let (Some(record), Some(to), Some(copy)) = (record, previous.clone(), checked) else {
        log::error!("{current} failed to start twice, and the previous copy is missing or damaged.");
        state.pending = None;
        return GuardDecision::RollbackUnavailable {
            from: current.clone(),
            previous,
        };
    };
    let Some(exe) = swap_in(replacer, &copy, &record.sha256, current) else {
        return GuardDecision::RollbackUnavailable {
            from: current.clone(),
            previous: Some(to),
        };
    };
    let from = current.to_string();
    if !state.blocked_versions.contains(&from) {
        state.blocked_versions.push(from.clone());
    }
    state.rolled_back = Some(RolledBackRecord {
        from,
        to: to.to_string(),
        at: time::format(SystemTime::now()),
        unknown: Default::default(),
    });
    state.pending = None;
    GuardDecision::RolledBack {
        from: current.clone(),
        to,
        relaunch: exe,
    }
}

/// Swaps the checked previous copy in, and returns the exe path when the previous version is there afterward. A
/// swap that fails after the rename restores the same copy, which also counts. Otherwise the next start tries again.
fn swap_in(replacer: &dyn Replacer, copy: &Path, sha256: &str, current: &Version) -> Option<PathBuf> {
    let swapped = replacer.current_exe().map_err(Into::into).and_then(|exe| {
        let new = swap::place_next_to_exe(&exe, copy, sha256)?;
        swap::replace_or_restore(replacer, &exe, &new, copy).map(|()| exe)
    });
    match swapped {
        Ok(exe) => Some(exe),
        Err(error) => {
            let exe = replacer.current_exe().ok()?;
            let restored = swap::hash_of(&exe).is_some_and(|hash| hash == sha256);
            if !restored {
                log::error!("Couldn't roll back {current}: {error}. The next start tries again.");
            }
            restored.then_some(exe)
        }
    }
}

/// Clears the pending record once this version had a healthy start. Other versions' records stay.
pub fn mark_healthy(state: &mut UpdaterState, current: &Version) -> bool {
    let healthy = state
        .pending
        .as_ref()
        .is_some_and(|pending| Version::parse(&pending.version).ok().as_ref() == Some(current));
    if healthy {
        state.pending = None;
    }
    healthy
}
