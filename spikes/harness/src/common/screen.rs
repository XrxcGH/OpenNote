//! Guards for measurements that inject input or read the screen.
//!
//! Only one such measurement may run at a time. Otherwise one spike's input and windows would spoil the//! numbers of another. The screen lock enforces that across processes. The desktop check refuses to//! measure while the session is locked, because injected input then goes nowhere and capture fails.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime};

use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, OpenInputDesktop, DESKTOP_ACCESS_FLAGS, DESKTOP_CONTROL_FLAGS,
};

use super::Result;

/// A lock older than this is treated as left behind by a crashed run.
const STALE_AFTER: Duration = Duration::from_secs(20 * 60);

/// Holds the screen for one measurement, and keeps the display on while held. Released on drop.
pub struct ScreenLock {
    path: PathBuf,
}

impl ScreenLock {
    /// Waits up to `timeout` for the screen to be free, then takes it.
    pub fn acquire(timeout: Duration) -> Result<ScreenLock> {
        ScreenLock::acquire_at(std::env::temp_dir().join("opennote-spike-screen.lock"), timeout)
    }

    fn acquire_at(path: PathBuf, timeout: Duration) -> Result<ScreenLock> {
        let deadline = Instant::now() + timeout;
        loop {
            // Creating a directory is atomic, so exactly one process succeeds.
            if fs::create_dir(&path).is_ok() {
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED) };
                return Ok(ScreenLock { path });
            }
            if is_stale(&path) {
                let _ = fs::remove_dir(&path);
                continue;
            }
            if Instant::now() >= deadline {
                return Err(format!("Another spike is using the screen ({} exists).", path.display()).into());
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    }
}

impl Drop for ScreenLock {
    fn drop(&mut self) {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        let _ = fs::remove_dir(&self.path);
    }
}

fn is_stale(path: &PathBuf) -> bool {
    let created = fs::metadata(path).and_then(|meta| meta.modified());
    created.is_ok_and(|time| SystemTime::now().duration_since(time).unwrap_or_default() > STALE_AFTER)
}

/// Fails when the input desktop isn't the person's desktop, for example when the session is locked.
pub fn check_desktop() -> Result<()> {
    let desktop = unsafe { OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_ACCESS_FLAGS(0x0100)) };
    match desktop {
        Ok(handle) => {
            let _ = unsafe { CloseDesktop(handle) };
            Ok(())
        }
        Err(_) => {
            Err("The Windows session is locked or showing a secure screen, so input and capture can't run.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_lock_waits_for_the_first() {
        let path = std::env::temp_dir().join(format!("opennote-lock-test-{}", std::process::id()));
        let first = ScreenLock::acquire_at(path.clone(), Duration::ZERO).unwrap();
        assert!(ScreenLock::acquire_at(path.clone(), Duration::ZERO).is_err());
        drop(first);
        assert!(ScreenLock::acquire_at(path, Duration::ZERO).is_ok());
    }
}
