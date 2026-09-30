//! One recording session: the microphone and loopback streams run the whole time, while an output
//! stream plays in some phases. In the capture plan, it plays the test tone in two separate stretches.
//! The quiet stretches around them show whether loopback delivers anything while nothing plays. The
//! second stretch shows whether loopback timestamps stay right after it restarts. In the clock plan,
//! it plays silence the whole time, so loopback runs without a break for a long clock measurement.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Host, SupportedStreamConfig};
use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};

use super::streams::{self, lock, CaptureLog, Packet, Render, RenderLog, Running, StreamError};
use super::tone::{self, Block, Tone};
use crate::common::{clock, Result};

/// What the output stream does in a phase.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Output {
    Off,
    Tone,
    Silence,
}

/// A phase of a session, and the share of the run it takes.
pub struct Step {
    pub name: &'static str,
    pub share: f64,
    pub output: Output,
}

const fn step(name: &'static str, share: f64, output: Output) -> Step {
    Step { name, share, output }
}

/// Quiet, tone, quiet, tone, quiet.
pub const CAPTURE: [Step; 5] = [
    step("quiet before", 1.0 / 6.0, Output::Off),
    step("first tone", 1.0 / 3.0, Output::Tone),
    step("quiet between", 1.0 / 12.0, Output::Off),
    step("second tone", 1.0 / 3.0, Output::Tone),
    step("quiet after", 1.0 / 12.0, Output::Off),
];

/// Silence the whole time, so loopback never pauses.
pub const CLOCK: [Step; 1] = [step("silent output", 1.0, Output::Silence)];
/// The first burst starts this long after the output stream does.
const TONE_START_MS: u64 = 500;
/// Most bursts in one stretch: 10 bursts of 150 ms, so 3 s of tone in the whole run.
const BURSTS_PER_STRETCH: u64 = 10;

/// What a capture stream recorded, or why it couldn't start.
pub struct Captured {
    pub config: SupportedStreamConfig,
    pub period_frames: Option<u32>,
    pub started: i64,
    pub packets: Vec<Packet>,
    pub blocks: Vec<Block>,
    pub errors: Vec<StreamError>,
}

/// What one output stretch played.
pub struct Played {
    pub tone: Tone,
    pub config: SupportedStreamConfig,
    pub period_frames: Option<u32>,
    pub started: i64,
    pub stopped: i64,
    pub renders: Vec<Render>,
    pub errors: Vec<StreamError>,
}

pub struct Phase {
    pub name: &'static str,
    pub start: i64,
    pub end: i64,
    pub played: Option<std::result::Result<Played, String>>,
}

pub struct Session {
    pub origin: i64,
    pub microphone: std::result::Result<Captured, String>,
    pub loopback: std::result::Result<Captured, String>,
    pub phases: Vec<Phase>,
}

/// Asks Windows not to sleep while a session records. Released on drop.
struct KeepAwake;

impl KeepAwake {
    fn new() -> KeepAwake {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        KeepAwake
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    }
}

/// Records for `seconds`, following `plan`.
pub fn record(host: &Host, seconds: f64, plan: &[Step]) -> Result<Session> {
    let output = host
        .default_output_device()
        .ok_or("There is no default output device.")?;
    let _awake = KeepAwake::new();
    let origin = clock::now();
    let microphone = host
        .default_input_device()
        .ok_or_else(|| "There is no default microphone.".to_string())
        .and_then(|device| start_capture(&device, true, seconds, origin));
    let loopback = start_capture(&output, false, seconds, origin);
    let mut phases = Vec::new();
    for step in plan {
        let length = seconds * step.share;
        let start = clock::now();
        let played = (step.output != Output::Off).then(|| play(&output, length, step.output, origin));
        if step.output == Output::Off {
            std::thread::sleep(Duration::from_secs_f64(length));
        }
        phases.push(Phase {
            name: step.name,
            start,
            end: clock::now(),
            played,
        });
    }
    Ok(Session {
        origin,
        microphone: microphone.map(finish_capture),
        loopback: loopback.map(finish_capture),
        phases,
    })
}

/// Starts the microphone (`input`) or loopback on the default output, in the device's own format.
pub fn start_capture(
    device: &Device,
    input: bool,
    seconds: f64,
    origin: i64,
) -> std::result::Result<Running<CaptureLog>, String> {
    let config = if input {
        device.default_input_config()
    } else {
        device.default_output_config()
    };
    let config = config.map_err(|error| error.to_string())?;
    streams::start_capture(device, config, seconds, origin).map_err(|error| error.to_string())
}

/// Stops a capture stream and takes what it recorded.
pub fn finish_capture(running: Running<CaptureLog>) -> Captured {
    drop(running.stream);
    let mut log = lock(&running.log);
    Captured {
        config: running.config,
        period_frames: running.period_frames,
        started: running.started,
        packets: std::mem::take(&mut log.packets),
        blocks: std::mem::take(&mut log.blocks),
        errors: std::mem::take(&mut log.errors),
    }
}

/// Plays the tone, or silence, on `device` for `seconds`, then stops.
fn play(device: &Device, seconds: f64, output: Output, origin: i64) -> std::result::Result<Played, String> {
    let rate = device
        .default_output_config()
        .map_err(|error| error.to_string())?
        .sample_rate();
    let bursts = match output {
        Output::Tone => Tone::bursts_that_fit(seconds, TONE_START_MS, BURSTS_PER_STRETCH),
        Output::Off | Output::Silence => 0,
    };
    let tone = Tone::new(rate, TONE_START_MS, bursts);
    assert!(tone.total_seconds() * 2.0 <= tone::MAX_TOTAL_SECONDS);
    let running = match streams::start_output(device, tone.clone(), origin) {
        Ok(running) => running,
        Err(error) => {
            std::thread::sleep(Duration::from_secs_f64(seconds));
            return Err(error.to_string());
        }
    };
    std::thread::sleep(Duration::from_secs_f64(seconds));
    drop(running.stream);
    let stopped = clock::now();
    let log: Arc<Mutex<RenderLog>> = running.log;
    let mut log = lock(&log);
    Ok(Played {
        tone,
        config: running.config,
        period_frames: running.period_frames,
        started: running.started,
        stopped,
        renders: std::mem::take(&mut log.renders),
        errors: std::mem::take(&mut log.errors),
    })
}
