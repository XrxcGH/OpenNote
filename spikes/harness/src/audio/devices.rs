//! Lists the default microphone and speakers, with their default and supported stream configurations.
//! Other devices are only counted, since their names can be personal (for example, someone's earbuds).

use std::collections::{BTreeMap, BTreeSet};

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Host, SupportedBufferSize, SupportedStreamConfig, SupportedStreamConfigRange};
use serde_json::{json, Value};

/// The default input and output devices and how many others there are.
pub fn describe(host: &Host) -> Value {
    let count = |devices: Result<usize, cpal::Error>| devices.map_or(Value::Null, |count| json!(count));
    json!({
        "host": host.id().name(),
        "input_devices": count(host.input_devices().map(Iterator::count)),
        "output_devices": count(host.output_devices().map(Iterator::count)),
        "default_input": host.default_input_device().map(|device| describe_device(&device, true)),
        "default_output": host.default_output_device().map(|device| describe_device(&device, false)),
    })
}

fn describe_device(device: &Device, input: bool) -> Value {
    let description = device.description().ok();
    let (default, supported) = if input {
        (
            device.default_input_config(),
            device.supported_input_configs().map(|configs| configs.collect()),
        )
    } else {
        (
            device.default_output_config(),
            device.supported_output_configs().map(|configs| configs.collect()),
        )
    };
    json!({
        "name": device.to_string(),
        "manufacturer": description.as_ref().and_then(|d| d.manufacturer().map(str::to_owned)),
        "device_type": description.as_ref().map(|d| d.device_type().to_string()),
        "interface": description.as_ref().map(|d| d.interface_type().to_string()),
        "default_config": default.map_or_else(|error| json!({ "error": error.to_string() }), |c| config(&c)),
        "supported_configs": supported.map_or_else(
            |error: cpal::Error| json!({ "error": error.to_string() }),
            |ranges: Vec<SupportedStreamConfigRange>| group(&ranges),
        ),
    })
}

/// A stream configuration as JSON.
pub fn config(config: &SupportedStreamConfig) -> Value {
    json!({
        "channels": config.channels(),
        "sample_rate": config.sample_rate(),
        "sample_format": config.sample_format().to_string(),
        "buffer_frames": buffer(config.buffer_size()),
    })
}

fn buffer(size: &SupportedBufferSize) -> Value {
    match size {
        SupportedBufferSize::Range { min, max } => json!({ "min": min, "max": max }),
        SupportedBufferSize::Unknown => Value::Null,
    }
}

/// Groups the supported configurations so the list stays short. WASAPI reports one entry for each
/// sample format and rate, each with a buffer of one device period. This lists the rates and the period
/// in milliseconds once for each set of formats that share them.
fn group(ranges: &[SupportedStreamConfigRange]) -> Value {
    let mut by_format: BTreeMap<(u16, String), (BTreeSet<u32>, BTreeSet<String>)> = BTreeMap::new();
    for range in ranges {
        let key = (range.channels(), range.sample_format().to_string());
        let (rates, periods) = by_format.entry(key).or_default();
        for rate in [range.min_sample_rate(), range.max_sample_rate()] {
            rates.insert(rate);
            if let SupportedBufferSize::Range { min, max } = range.buffer_size() {
                let ms = |frames: &u32| format!("{:.1}", f64::from(*frames) * 1000.0 / f64::from(rate));
                let (min, max) = (ms(min), ms(max));
                periods.insert(if min == max { min } else { format!("{min} to {max}") });
            }
        }
    }
    let mut shapes: BTreeMap<(u16, Vec<u32>, Vec<String>), Vec<String>> = BTreeMap::new();
    for ((channels, format), (rates, periods)) in by_format {
        let key = (channels, rates.into_iter().collect(), periods.into_iter().collect());
        shapes.entry(key).or_default().push(format);
    }
    let list: Vec<Value> = shapes
        .into_iter()
        .map(|((channels, rates, periods), formats)| {
            json!({ "channels": channels, "sample_formats": formats, "sample_rates": rates, "period_ms": periods })
        })
        .collect();
    json!(list)
}
