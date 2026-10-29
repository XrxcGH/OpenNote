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
//!
//! On macOS and Linux the lock is an exclusive lock on `OpenNote.<key>.lock` in the per-user runtime folder (ADR
//! 0055). A second launch that can't take it within 2 s exits, so two processes never write one profile. Its
//! arguments aren't forwarded yet; macOS brings the running app forward on its own.

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
    /// The locked file. The lock goes with the handle, when the guard drops or the process ends.
    #[cfg(not(windows))]
    _lock: Option<std::fs::File>,
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
            #[cfg(not(windows))]
            _lock: None,
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

#[cfg(not(windows))]
fn acquire_with(key: &str, _payload: &Forwarded, find: Duration, _wait: Duration) -> InstanceOutcome {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .filter(|dir| dir.is_absolute() && dir.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    match lock_file(&dir.join(format!("OpenNote.{key}.lock")), find) {
        Ok(Some(file)) => InstanceOutcome::Owner(InstanceGuard { _lock: Some(file) }),
        Ok(None) => {
            log::warn!("Another OpenNote is open with this profile, so this one exits.");
            InstanceOutcome::Unavailable
        }
        // A folder that can't hold the lock mustn't keep OpenNote from starting.
        Err(error) => {
            log::warn!("Couldn't take the instance lock, so OpenNote runs without it: {error}");
            InstanceOutcome::Owner(InstanceGuard { _lock: None })
        }
    }
}

/// Takes an exclusive lock on `path`, trying again for up to `patience` while another process holds it. `None`
/// when it stayed held.
#[cfg(any(not(windows), test))]
fn lock_file(path: &std::path::Path, patience: Duration) -> std::io::Result<Option<std::fs::File>> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    let deadline = std::time::Instant::now() + patience;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(Some(file)),
            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(std::fs::TryLockError::WouldBlock) => return Ok(None),
            Err(std::fs::TryLockError::Error(error)) => return Err(error),
        }
    }
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

#[cfg(test)]
mod lock_tests {
    use super::*;

    #[test]
    fn a_second_lock_on_the_profile_file_waits_then_gives_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("OpenNote.test.lock");
        let first = lock_file(&path, Duration::ZERO).unwrap();
        assert!(first.is_some());
        let started = std::time::Instant::now();
        assert!(lock_file(&path, Duration::from_millis(250)).unwrap().is_none());
        assert!(started.elapsed() >= Duration::from_millis(250));
        drop(first);
        assert!(lock_file(&path, Duration::ZERO).unwrap().is_some());
    }

    #[test]
    fn a_folder_that_cant_hold_the_lock_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(lock_file(&dir.path().join("missing").join("OpenNote.lock"), Duration::ZERO).is_err());
    }
}
