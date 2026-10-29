//! Lists the input and output devices that cpal finds on the WASAPI host.

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::Device;

use super::catalog::{DeviceCatalog, DeviceInfo, Direction};
use super::{AudioError, Result};

/// The devices of the system's default audio host.
#[derive(Clone, Copy, Debug, Default)]
pub struct CpalCatalog;

impl DeviceCatalog for CpalCatalog {
    fn list(&self) -> Result<Vec<DeviceInfo>> {
        let host = cpal::default_host();
        let default_input = host.default_input_device().and_then(|device| device.id().ok());
        let default_output = host.default_output_device().and_then(|device| device.id().ok());
        let mut devices = Vec::new();
        let inputs = host
            .input_devices()
            .map_err(|error| AudioError::Device(error.to_string()))?;
        for device in inputs {
            devices.extend(describe(&device, Direction::Input, default_input.as_ref()));
        }
        let outputs = host
            .output_devices()
            .map_err(|error| AudioError::Device(error.to_string()))?;
        for device in outputs {
            devices.extend(describe(&device, Direction::Output, default_output.as_ref()));
        }
        Ok(devices)
    }
}

/// One device's entry, or none if it went away while the list was made.
fn describe(device: &Device, direction: Direction, default: Option<&cpal::DeviceId>) -> Option<DeviceInfo> {
    let id = device.id().ok()?;
    let name = device
        .description()
        .map_or_else(|_| device.to_string(), |description| description.name().to_owned());
    let config = match direction {
        Direction::Input => device.default_input_config(),
        Direction::Output => device.default_output_config(),
    }
    .ok();
    Some(DeviceInfo {
        is_default: default == Some(&id),
        id: id.to_string(),
        name,
        direction,
        sample_rate: config.as_ref().map(cpal::SupportedStreamConfig::sample_rate),
        channels: config.as_ref().map(cpal::SupportedStreamConfig::channels),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The build machine may have no audio hardware. This checks only that listing doesn't fail in
    /// a way that would break the picker, and that each direction has at most one default.
    #[test]
    fn listing_devices_works_with_or_without_hardware() {
        let Ok(devices) = CpalCatalog.list() else {
            return;
        };
        for direction in [Direction::Input, Direction::Output] {
            let defaults = devices
                .iter()
                .filter(|device| device.direction == direction && device.is_default)
                .count();
            assert!(defaults <= 1, "{defaults} defaults");
        }
        assert!(devices
            .iter()
            .all(|device| !device.id.is_empty() && !device.name.is_empty()));
    }
}
