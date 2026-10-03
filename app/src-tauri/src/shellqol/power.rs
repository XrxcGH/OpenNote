//! Power status for low-power mode: whether the PC runs on battery, and whether Windows battery saver is on. A
//! thread checks every few seconds and sends a `power` event when the answer changes, so the interface can reduce
//! animations and background work while it matters.

use std::{sync::Mutex, time::Duration};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{emit, out};
use crate::ipc::{IpcError, IpcResult};

/// How often the thread looks.
const POLL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Running on battery.
    pub on_battery: bool,
    /// Windows battery saver is on.
    pub saver: bool,
    /// The charge, when Windows knows it.
    pub percent: Option<u8>,
}

/// Reads Windows' power status fields: `ac_line` is 0 offline, 1 online, 255 unknown; `battery_flag` has 128 set
/// for no battery; `percent` is 255 for unknown; `system_flag` is 1 while battery saver is on.
pub fn decode(ac_line: u8, battery_flag: u8, percent: u8, system_flag: u8) -> Status {
    let has_battery = battery_flag & 128 == 0 && battery_flag != 255;
    Status {
        on_battery: ac_line == 0 && has_battery,
        saver: system_flag == 1,
        percent: (percent <= 100).then_some(percent),
    }
}

/// Whether the interface should save power.
pub fn saving(status: Status) -> bool {
    status.on_battery || status.saver
}

#[cfg(windows)]
pub fn status() -> Status {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut raw = SYSTEM_POWER_STATUS::default();
    // SAFETY: `raw` is a valid SYSTEM_POWER_STATUS for the call to fill.
    if unsafe { GetSystemPowerStatus(&mut raw) }.is_err() {
        return Status::default();
    }
    decode(raw.ACLineStatus, raw.BatteryFlag, raw.BatteryLifePercent, raw.SystemStatusFlag)
}

#[cfg(not(windows))]
pub fn status() -> Status {
    Status::default()
}

static LAST: Mutex<Option<Status>> = Mutex::new(None);

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("opennote-power".into()).spawn(move || loop {
        let now = status();
        let changed = {
            let mut last = LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let changed = last.is_none_or(|before| {
                before.on_battery != now.on_battery || before.saver != now.saver
            });
            *last = Some(now);
            changed
        };
        if changed {
            emit(&app, "power", json!({ "onBattery": now.on_battery, "saver": now.saver, "percent": now.percent }));
        }
        std::thread::sleep(POLL);
    });
    if let Err(error) = spawned {
        ::log::warn!("Couldn't start the power watcher: {error}");
    }
}

pub fn call(_app: &AppHandle, name: &str) -> IpcResult<Value> {
    match name {
        "power.status" => out(status()),
        _ => Err(IpcError::invalid("name", "isn't a power call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_laptop_off_the_charger_is_on_battery() {
        let status = decode(0, 1, 80, 0);
        assert!(status.on_battery && !status.saver);
        assert_eq!(status.percent, Some(80));
        assert!(saving(status));
    }

    #[test]
    fn a_desktop_without_a_battery_is_never_on_battery() {
        let status = decode(1, 128, 255, 0);
        assert!(!status.on_battery);
        assert_eq!(status.percent, None);
        assert!(!saving(status));
        assert!(!decode(0, 128, 255, 0).on_battery);
    }

    #[test]
    fn battery_saver_counts_even_on_the_charger() {
        assert!(saving(decode(1, 8, 50, 1)));
    }
}
