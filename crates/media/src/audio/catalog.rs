//! The list of audio devices, and how a saved choice finds its device again.
//!
//! Settings keep a device by its ID, the string the operating system gives it. IDs stay the same
//! across restarts. A headset can still be gone when the app starts, so a choice that no longer
//! matches any device falls back to the default and says so. The screen can then tell the person which
//! microphone it used instead.

use serde::{Deserialize, Serialize};

use super::{AudioError, Result};

/// Whether a device records or plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    /// A microphone or another input. A recording captures it directly.
    Input,
    /// Speakers or headphones. A recording captures what they play, as system audio.
    Output,
}

/// One audio device, as the picker shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// The operating system's ID for the device. Settings keep this.
    pub id: String,
    /// The name the person knows, such as "Headset Microphone (Surface USB Audio)".
    pub name: String,
    pub direction: Direction,
    /// Whether this is the device the system uses when none is chosen.
    pub is_default: bool,
    /// The device's own sample rate in hertz, if it said.
    pub sample_rate: Option<u32>,
    /// The device's own channel count, if it said.
    pub channels: Option<u16>,
}

/// Lists the devices that are present now.
pub trait DeviceCatalog: Send + Sync {
    fn list(&self) -> Result<Vec<DeviceInfo>>;
}

/// A catalog with a fixed list, for tests and screens that run without audio hardware.
#[derive(Clone, Debug, Default)]
pub struct FixedCatalog(pub Vec<DeviceInfo>);

impl DeviceCatalog for FixedCatalog {
    fn list(&self) -> Result<Vec<DeviceInfo>> {
        Ok(self.0.clone())
    }
}

/// The device a choice resolved to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub device: DeviceInfo,
    /// Whether the saved choice was gone and the default took its place.
    pub fell_back: bool,
}

/// Finds the device for a saved `wanted` ID in `direction`. No ID means the default. An ID that no
/// longer matches falls back to the default. With no device at all, it is an error that names the
/// kind of device, since the person has to plug one in.
pub fn resolve(catalog: &dyn DeviceCatalog, direction: Direction, wanted: Option<&str>) -> Result<Resolution> {
    let devices: Vec<DeviceInfo> = catalog
        .list()?
        .into_iter()
        .filter(|device| device.direction == direction)
        .collect();
    if let Some(id) = wanted {
        if let Some(device) = devices.iter().find(|device| device.id == id) {
            return Ok(Resolution {
                device: device.clone(),
                fell_back: false,
            });
        }
    }
    let default = devices
        .iter()
        .find(|device| device.is_default)
        .or_else(|| devices.first())
        .ok_or_else(|| {
            let what = match direction {
                Direction::Input => "microphone",
                Direction::Output => "output device",
            };
            AudioError::Device(format!("There is no {what}."))
        })?;
    Ok(Resolution {
        device: default.clone(),
        fell_back: wanted.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(id: &str, direction: Direction, is_default: bool) -> DeviceInfo {
        DeviceInfo {
            id: id.into(),
            name: format!("Device {id}"),
            direction,
            is_default,
            sample_rate: Some(48_000),
            channels: Some(2),
        }
    }

    fn catalog() -> FixedCatalog {
        FixedCatalog(vec![
            device("built-in", Direction::Input, true),
            device("headset", Direction::Input, false),
            device("speakers", Direction::Output, true),
        ])
    }

    #[test]
    fn a_saved_choice_finds_its_device() {
        let found = resolve(&catalog(), Direction::Input, Some("headset")).unwrap();
        assert_eq!((found.device.id.as_str(), found.fell_back), ("headset", false));
    }

    #[test]
    fn no_choice_means_the_default() {
        let found = resolve(&catalog(), Direction::Input, None).unwrap();
        assert_eq!((found.device.id.as_str(), found.fell_back), ("built-in", false));
        let found = resolve(&catalog(), Direction::Output, None).unwrap();
        assert_eq!(found.device.id, "speakers");
    }

    #[test]
    fn a_missing_device_falls_back_and_says_so() {
        let found = resolve(&catalog(), Direction::Input, Some("unplugged")).unwrap();
        assert_eq!((found.device.id.as_str(), found.fell_back), ("built-in", true));
        // A device of the other direction doesn't count.
        assert!(
            resolve(&catalog(), Direction::Input, Some("speakers"))
                .unwrap()
                .fell_back
        );
    }

    #[test]
    fn a_catalog_without_a_default_uses_the_first_device() {
        let catalog = FixedCatalog(vec![device("a", Direction::Input, false)]);
        assert_eq!(resolve(&catalog, Direction::Input, None).unwrap().device.id, "a");
    }

    #[test]
    fn no_devices_is_an_error_that_names_the_kind() {
        let error = resolve(&FixedCatalog::default(), Direction::Input, None).unwrap_err();
        assert!(error.to_string().contains("no microphone"), "{error}");
        assert!(resolve(&catalog(), Direction::Output, Some("x")).is_ok());
    }
}
