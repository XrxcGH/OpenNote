//! One process per profile (ARCHITECTURE.md section 8.3), so exactly one process writes the settings, the device
//! state, and the exe. The lock is a named mutex keyed by the profile, `Local\OpenNote.<key>`. The owner keeps a
//! hidden message-only window named after the same key. A second launch finds that window, lets the owner take
//! the foreground, sends its arguments with `WM_COPYDATA`, and exits without reading settings or touching the
//! update state.
//!
//! When the mutex exists but no window answers within 2 s, the owner is shutting down. The second launch then
//! waits up to 10 s for the mutex and carries on as the new owner. If the mutex never comes free, it gives up.
//!
//! The technique follows the Windows part of `tauri-plugin-single-instance` 2.5.1 (Apache-2.0 or MIT), keyed by
//! profile instead of by the app identifier, so test profiles can run side by side.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{args::Args, paths::Paths};

/// How long a second launch looks for the owner's window before it assumes the owner is shutting down.
pub const FIND_OWNER_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a second launch then waits for the owner to release the profile.
pub const LOCK_TIMEOUT: Duration = Duration::from_secs(10);

pub enum InstanceOutcome {
    /// This process owns the profile. Keep the guard alive until the process exits.
    Owner(InstanceGuard),
    /// Another process owns the profile and has this launch's arguments; exit now.
    Forwarded,
    /// Another process holds the profile but neither answered nor let go within the timeouts; exit now.
    Unavailable,
}

/// What a second launch hands to the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Forwarded {
    /// The launch's arguments, without the program name and the relaunch flags.
    pub args: Vec<String>,
    /// The launch's working folder, so relative file names can be resolved later.
    pub cwd: String,
}

type Handler = Box<dyn Fn(Forwarded) + Send + 'static>;

/// Holds the instance mutex and the message window, and releases them when dropped.
pub struct InstanceGuard {
    #[cfg(windows)]
    owner: Option<win::Owner>,
}

impl std::fmt::Debug for InstanceGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InstanceGuard")
    }
}

impl InstanceGuard {
    /// A guard that holds nothing, for tests of the start-up order.
    #[cfg(test)]
    pub(crate) fn for_tests() -> Self {
        Self {
            #[cfg(windows)]
            owner: None,
        }
    }

    /// Calls `handler` with each later launch's arguments, starting with any that arrived before this call.
    pub fn on_forwarded(&self, handler: impl Fn(Forwarded) + Send + 'static) {
        #[cfg(windows)]
        if let Some(owner) = &self.owner {
            owner.sink.set_handler(Box::new(handler));
        }
        #[cfg(not(windows))]
        let _ = handler;
    }
}

/// Takes the profile's lock, or forwards `args` to the process that holds it.
pub fn acquire(paths: &Paths, args: &Args) -> InstanceOutcome {
    let payload = Forwarded {
        args: args.rest.clone(),
        cwd: std::env::current_dir()
            .map(|dir| dir.display().to_string())
            .unwrap_or_default(),
    };
    acquire_with(&paths.profile_key(), &payload, FIND_OWNER_TIMEOUT, LOCK_TIMEOUT)
}

#[cfg(windows)]
fn acquire_with(key: &str, payload: &Forwarded, find: Duration, wait: Duration) -> InstanceOutcome {
    win::acquire(key, payload, find, wait)
}

/// Other systems don't share a profile between processes yet.
#[cfg(not(windows))]
fn acquire_with(_key: &str, _payload: &Forwarded, _find: Duration, _wait: Duration) -> InstanceOutcome {
    InstanceOutcome::Owner(InstanceGuard {})
}

/// Launches that arrive before the app installs its handler wait here.
#[derive(Default)]
struct Sink {
    queue: std::sync::Mutex<Vec<Forwarded>>,
    handler: std::sync::Mutex<Option<Handler>>,
}

impl Sink {
    fn deliver(&self, forwarded: Forwarded) {
        let handler = lock(&self.handler);
        match handler.as_ref() {
            Some(handler) => handler(forwarded),
            None => lock(&self.queue).push(forwarded),
        }
    }

    fn set_handler(&self, handler: Handler) {
        let mut slot = lock(&self.handler);
        for forwarded in std::mem::take(&mut *lock(&self.queue)) {
            handler(forwarded);
        }
        *slot = Some(handler);
    }
}

fn lock<T>(mutex: &std::sync::Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(windows)]
mod win;

#[cfg(all(test, windows))]
mod tests;
