//! One process per profile (ARCHITECTURE.md section 8.3), so exactly one process writes the settings, the device
//! state, and the exe. The lock is a named mutex keyed by the profile. A second launch forwards its arguments to
//! the owner's message window with `WM_COPYDATA`. Then it exits without reading settings or touching the update
//! state.
//!
//! This skeleton always owns the lock. The shell work package adds the mutex and the forwarding, following the
//! Windows technique of `tauri-plugin-single-instance` 2.5.1.

use crate::{args::Args, paths::Paths};

pub enum InstanceOutcome {
    /// This process owns the profile. Keep the guard alive until the process exits.
    Owner(InstanceGuard),
    /// Another process owns the profile and has this launch's arguments; exit now.
    Forwarded,
}

/// Holds the instance mutex and the message window, and releases them when dropped.
#[derive(Debug)]
pub struct InstanceGuard {
    _private: (),
}

impl InstanceGuard {
    /// A guard that holds nothing, for tests of the start-up order.
    #[cfg(test)]
    pub(crate) fn for_tests() -> Self {
        Self { _private: () }
    }
}

/// Takes the profile's lock, or forwards `args` to the process that holds it.
pub fn acquire(_paths: &Paths, _args: &Args) -> InstanceOutcome {
    InstanceOutcome::Owner(InstanceGuard { _private: () })
}
