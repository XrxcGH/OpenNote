//! Audio capture (spike 4): records the default microphone and system audio (WASAPI loopback) at the
//! same time with cpal, and measures their clocks, callback timing, and gaps. A quiet test tone times
//! the path from an output stream to the loopback stream. Separate parts measure Opus encoding and the
//! cost of flushing a file each second.
//!
//! Privacy: the callbacks keep statistics only (times, frame counts, and levels). No microphone or
//! loopback audio is stored, in memory or on disk.
//!
//! The modes are devices, capture, clock, opus, and flush.
//!
//! The clock mode records for 10 minutes against a silent output stream and plays no tone. The
//! samples option sets the capture length in seconds (default 60), or the clock length when only the
//! clock mode runs. Without the auto option, the spike prints live levels, so a person can try device
//! changes.

mod analysis;
mod detect;
mod devices;
mod durability;
mod encode;
mod report;
mod session;
mod streams;
mod timing;
mod tone;

use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::common::{clock, results, Result};
use crate::options::Options;

const MODES: [&str; 5] = ["devices", "capture", "clock", "opus", "flush"];
const DEFAULT_SECONDS: f64 = 60.0;
/// Seconds the clock mode records for, unless `--samples` sets it in that mode alone.
const CLOCK_SECONDS: f64 = 600.0;
/// Seconds of generated audio to encode with Opus.
const OPUS_SECONDS: f64 = 300.0;
/// Chunks to append and flush.
const FLUSHES: usize = 50;

pub fn run(options: &Options) -> Result<()> {
    if let Some(mode) = options.mode.as_deref().filter(|mode| !MODES.contains(mode)) {
        return Err(format!(
            "The audio spike has no mode \"{mode}\". Try one of: {}.",
            MODES.join(", ")
        )
        .into());
    }
    let host = cpal::default_host();
    if !options.auto {
        return watch(&host, seconds(options, "capture", DEFAULT_SECONDS));
    }
    let results = measure(&host, options)?;
    results::write(&options.results_path(), "audio", Value::Object(results))
}

/// How long `mode` records: `--samples` seconds when it applies, otherwise `default`. `--samples`
/// sets the capture length, or the clock length when only the clock mode runs.
fn seconds(options: &Options, mode: &str, default: f64) -> f64 {
    let applies = mode == "capture" || options.mode.as_deref() == Some(mode);
    let samples = options.samples.filter(|_| applies).map(|samples| samples as f64);
    samples.unwrap_or(default).max(12.0)
}

fn measure(host: &cpal::Host, options: &Options) -> Result<Map<String, Value>> {
    let wants = |name: &str| options.mode.as_deref().is_none_or(|mode| mode == name);
    let mut results = Map::new();
    results.insert(
        "privacy".into(),
        json!("Only statistics were kept. No microphone or loopback audio was stored."),
    );
    if wants("devices") || wants("capture") || wants("clock") {
        results.insert("devices".into(), devices::describe(host));
    }
    if wants("capture") {
        let seconds = seconds(options, "capture", DEFAULT_SECONDS);
        println!("Recording statistics for {seconds} s, with a quiet 19 kHz tone in two stretches...");
        let session = session::record(host, seconds, &session::CAPTURE)?;
        let capture = json!({ "seconds": seconds, "results": report::capture(&session) });
        results.insert("capture".into(), capture);
    }
    if wants("clock") {
        let seconds = seconds(options, "clock", CLOCK_SECONDS);
        println!("Recording statistics for {seconds} s against a silent output stream, to compare clocks...");
        let session = session::record(host, seconds, &session::CLOCK)?;
        results.insert(
            "clock".into(),
            json!({ "seconds": seconds, "results": report::clock(&session) }),
        );
    }
    if wants("opus") {
        println!("Encoding {OPUS_SECONDS} s of generated audio with Opus...");
        results.insert("opus".into(), encode::measure(OPUS_SECONDS));
    }
    if wants("flush") {
        println!("Timing {FLUSHES} appends and flushes of a temporary file...");
        let flush = durability::measure(FLUSHES).unwrap_or_else(|error| json!({ "error": error.to_string() }));
        results.insert("flush".into(), flush);
    }
    Ok(results)
}

/// Prints the devices, then the microphone and loopback levels once a second, for trying by hand.
fn watch(host: &cpal::Host, seconds: f64) -> Result<()> {
    use cpal::traits::HostTrait;

    println!("{}", serde_json::to_string_pretty(&devices::describe(host))?);
    let origin = clock::now();
    let microphone = host
        .default_input_device()
        .ok_or_else(|| "There is no default microphone.".to_string())
        .and_then(|device| session::start_capture(&device, true, seconds, origin));
    let loopback = host
        .default_output_device()
        .ok_or_else(|| "There is no default output device.".to_string())
        .and_then(|device| session::start_capture(&device, false, seconds, origin));
    println!("Showing levels for {seconds} s. Play something, or change or unplug a device, and watch.");
    let (mut microphone_seen, mut loopback_seen) = (0, 0);
    for second in 1..=seconds as u64 {
        std::thread::sleep(Duration::from_secs(1));
        let microphone_line = since(&microphone, &mut microphone_seen);
        let loopback_line = since(&loopback, &mut loopback_seen);
        println!("{second:>4} s  microphone: {microphone_line}  loopback: {loopback_line}");
    }
    Ok(())
}

/// Packets, peak level, and errors since the last call.
fn since(running: &std::result::Result<streams::Running<streams::CaptureLog>, String>, seen: &mut usize) -> String {
    let running = match running {
        Ok(running) => running,
        Err(error) => return format!("unavailable ({error})"),
    };
    let log = streams::lock(&running.log);
    let fresh = &log.packets[(*seen).min(log.packets.len())..];
    *seen = log.packets.len();
    let peak = fresh.iter().map(|packet| packet.peak).fold(0.0, f32::max);
    let errors = log
        .errors
        .last()
        .map_or(String::new(), |error| format!(", last error {}", error.kind));
    format!(
        "{:>3} packets, peak {:>6.1} dBFS, {} errors{errors}",
        fresh.len(),
        analysis::dbfs(f64::from(peak)),
        log.errors.len()
    )
}
