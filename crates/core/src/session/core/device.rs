//! `device.json`: this device's ID and label (spec 5.3 and 20.1), and the `session.json` marker.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, FsErrorKind};
use crate::id::DeviceId;
use crate::model::DeviceRef;
use crate::store::fs::Fs;
use crate::store::layout::DataLayout;
use crate::store::lock::ensure_dir_all;
use crate::time::{Clock, Timestamp};

#[derive(Serialize, Deserialize)]
struct DeviceFile {
    id: DeviceId,
    label: String,
}

/// Reads `device.json`, or makes it with a new device ID and a label that is never the computer's or the
/// account's name, such as `Windows device GWGM` (spec 5.3).
pub(crate) fn load_or_create(fs: &dyn Fs, data: &DataLayout, clock: &dyn Clock) -> Result<DeviceRef, CoreError> {
    let path = data.device_json();
    match fs.read(&path, 64 * 1024) {
        Ok(bytes) => {
            if let Ok(file) = serde_json::from_slice::<DeviceFile>(&bytes) {
                return Ok(DeviceRef {
                    id: file.id,
                    label: file.label,
                });
            }
        }
        Err(e) if e.kind == FsErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let id = DeviceId::generate(clock);
    let device = DeviceRef {
        id,
        label: default_label(id),
    };
    save(fs, data, &device)?;
    Ok(device)
}

/// A label from the platform and the last 4 characters of the device ID.
pub(crate) fn default_label(id: DeviceId) -> String {
    let text = id.to_string();
    let tail: String = text
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let platform = match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "Mac",
        "linux" => "Linux",
        "android" => "Android",
        "ios" => "iPad",
        _ => "OpenNote",
    };
    format!("{platform} device {}", tail.to_uppercase())
}

/// Writes `device.json`.
pub(crate) fn save(fs: &dyn Fs, data: &DataLayout, device: &DeviceRef) -> Result<(), CoreError> {
    ensure_dir_all(fs, &data.root)?;
    let file = DeviceFile {
        id: device.id,
        label: device.label.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&file).unwrap_or_default();
    fs.replace_durable(&data.device_json(), &bytes)?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    running: bool,
    since: Timestamp,
}

/// Marks the app as running, and returns whether the last run ended without marking itself stopped. The
/// marker only chooses the start-up message: recovery never trusts it (spec 20.3).
pub(crate) fn mark_running(fs: &dyn Fs, data: &DataLayout, now: Timestamp) -> bool {
    let path = data.session_json();
    let unclean = fs
        .read(&path, 64 * 1024)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SessionFile>(&bytes).ok())
        .is_some_and(|file| file.running);
    let file = SessionFile {
        running: true,
        since: now,
    };
    let _ = ensure_dir_all(fs, &data.root);
    let _ = fs.write_derived(&path, &serde_json::to_vec(&file).unwrap_or_default());
    unclean
}

/// Marks the app as stopped, on a clean exit.
pub(crate) fn mark_stopped(fs: &dyn Fs, data: &DataLayout, now: Timestamp) {
    let file = SessionFile {
        running: false,
        since: now,
    };
    let _ = fs.write_derived(&data.session_json(), &serde_json::to_vec(&file).unwrap_or_default());
}
