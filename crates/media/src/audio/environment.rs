//! What the recording guard asks of the machine: free disk space, the battery, and a wish to stay
//! awake. Windows answers these through the Win32 API. Other platforms have no capture source yet, so
//! they answer nothing, and the guard then skips those checks.

use std::path::Path;

/// The state of the battery.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Battery {
    /// Charge, from 0 to 100.
    pub percent: u8,
    /// Whether the machine is on mains power.
    pub plugged_in: bool,
    /// Minutes the battery should last at the current drain, if Windows says.
    pub minutes_left: Option<u32>,
}

/// Facts about the machine, which tests replace with their own.
pub trait Environment: Send + Sync {
    /// Bytes free on the volume that holds `dir`.
    fn free_bytes(&self, dir: &Path) -> Option<u64>;

    /// The battery, or none for a desktop machine.
    fn battery(&self) -> Option<Battery>;
}

/// The real machine.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemEnvironment;

#[cfg(windows)]
impl Environment for SystemEnvironment {
    fn free_bytes(&self, dir: &Path) -> Option<u64> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free_to_caller = 0u64;
        // SAFETY: the path is null terminated, and the output pointers are valid or null.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_to_caller,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        (ok != 0).then_some(free_to_caller)
    }

    fn battery(&self) -> Option<Battery> {
        use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

        // SAFETY: an all-zero status is a valid value for this plain struct.
        let mut status: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        // SAFETY: the pointer is valid.
        if unsafe { GetSystemPowerStatus(&mut status) } == 0 {
            return None;
        }
        // The flag has bit 7 set when there is no battery, and is 255 when it is unknown.
        if status.BatteryFlag == 255 || status.BatteryFlag & 128 != 0 || status.BatteryLifePercent > 100 {
            return None;
        }
        Some(Battery {
            percent: status.BatteryLifePercent,
            plugged_in: status.ACLineStatus == 1,
            minutes_left: (status.BatteryLifeTime != u32::MAX).then_some(status.BatteryLifeTime / 60),
        })
    }
}

#[cfg(not(windows))]
impl Environment for SystemEnvironment {
    fn free_bytes(&self, _dir: &Path) -> Option<u64> {
        None
    }

    fn battery(&self) -> Option<Battery> {
        None
    }
}

/// Keeps the machine awake while it exists, so the screen may dim but the PC doesn't sleep in the
/// middle of a recording. Dropping it lets the machine sleep again.
pub struct KeepAwake {
    #[cfg(windows)]
    held: Option<(std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>)>,
}

impl KeepAwake {
    /// Asks Windows to stay awake. On other platforms it does nothing.
    pub fn new() -> Self {
        #[cfg(windows)]
        {
            KeepAwake { held: hold() }
        }
        #[cfg(not(windows))]
        {
            KeepAwake {}
        }
    }

    /// Whether the request is in force.
    pub fn is_held(&self) -> bool {
        #[cfg(windows)]
        {
            self.held.is_some()
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
}

impl Default for KeepAwake {
    fn default() -> Self {
        Self::new()
    }
}

/// The request belongs to the thread that makes it, so a thread of its own holds it until told to let go.
#[cfg(windows)]
fn hold() -> Option<(std::sync::mpsc::Sender<()>, std::thread::JoinHandle<()>)> {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};

    let (release, wait) = std::sync::mpsc::channel::<()>();
    let (ready, ready_rx) = std::sync::mpsc::channel();
    let thread = std::thread::Builder::new()
        .name("opennote-keep-awake".into())
        .spawn(move || {
            // SAFETY: this call only sets flags for the calling thread.
            let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            let _ = ready.send(previous != 0);
            // Wakes when the owner drops the sender.
            let _ = wait.recv();
            // SAFETY: as above. Passing only ES_CONTINUOUS clears the request.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        })
        .ok()?;
    if ready_rx.recv().ok()? {
        Some((release, thread))
    } else {
        drop(release);
        let _ = thread.join();
        None
    }
}

#[cfg(windows)]
impl Drop for KeepAwake {
    fn drop(&mut self) {
        if let Some((release, thread)) = self.held.take() {
            drop(release);
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn the_machine_reports_free_space_for_a_real_folder() {
        let dir = tempfile::tempdir().unwrap();
        let free = SystemEnvironment.free_bytes(dir.path()).expect("free space");
        assert!(free > 1_000_000, "{free} bytes free");
        assert_eq!(SystemEnvironment.free_bytes(&dir.path().join("missing\\deeper")), None);
    }

    #[test]
    fn the_battery_report_is_sensible_when_there_is_one() {
        if let Some(battery) = SystemEnvironment.battery() {
            assert!(battery.percent <= 100);
        }
    }

    #[test]
    fn keeping_awake_can_be_taken_and_given_back() {
        let awake = KeepAwake::new();
        let held = awake.is_held();
        drop(awake);
        // Asking again after letting go works the same.
        assert_eq!(KeepAwake::new().is_held(), held);
    }
}
