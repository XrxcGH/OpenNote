//! Generated audio for tests and demos, so nothing needs a microphone.
//!
//! [`synthetic`] makes an [`AudioSource`] that plays a generated signal on a virtual capture clock,
//! and a handle that drives it. The handle delivers packets the way an audio callback would. It can
//! also skip time to make a gap, a pause, or drift.
//!
//! [`LevelEncoder`] stands in for Opus, so tests run without building libopus. Its packets hold
//! each frame's peak level, not sound.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use super::clock::{Clock, WallClock};
use super::encoder::{EncoderFactory, FrameEncoder};
use super::ring::SinkHandle;
use super::source::{AudioSource, DeviceState, SourceFormat};
use super::{AudioError, Result, FRAME_SAMPLES};

/// The sample at a frame index.
pub type Signal = Arc<dyn Fn(u64) -> f32 + Send + Sync>;

/// A sine wave at `rate`.
pub fn sine(frequency_hz: f64, amplitude: f32, rate: u32) -> Signal {
    Arc::new(move |frame| {
        let angle = std::f64::consts::TAU * frequency_hz * (frame % u64::from(rate)) as f64 / f64::from(rate);
        amplitude * angle.sin() as f32
    })
}

/// The Unix time that a [`ManualClock`] reports at its starting capture time.
pub const MANUAL_WALL_BASE_MS: i64 = 1_800_000_000_000;

/// A clock that only moves when a test says so. As a wall clock it reads [`MANUAL_WALL_BASE_MS`] at
/// the capture time it started with, and moves in step with it.
#[derive(Debug, Default)]
pub struct ManualClock {
    now_ns: AtomicU64,
    start_ns: u64,
}

impl ManualClock {
    pub fn new(start_ns: u64) -> Arc<Self> {
        Arc::new(ManualClock {
            now_ns: AtomicU64::new(start_ns),
            start_ns,
        })
    }

    pub fn set_ns(&self, ns: u64) {
        self.now_ns.store(ns, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now_ns(&self) -> u64 {
        self.now_ns.load(Ordering::SeqCst)
    }
}

impl WallClock for ManualClock {
    fn unix_ms(&self) -> i64 {
        let elapsed_ms = (i128::from(self.now_ns()) - i128::from(self.start_ns)) / 1_000_000;
        MANUAL_WALL_BASE_MS + elapsed_ms as i64
    }
}

/// A stand-in encoder. Each 20 ms frame becomes four bytes: its peak level as a little-endian `f32`.
#[derive(Debug, Default)]
pub struct LevelEncoder;

/// The pre-skip of the stand-in, the same as libopus's for 48 kHz voice.
pub const LEVEL_PRE_SKIP: u16 = 312;

impl FrameEncoder for LevelEncoder {
    fn pre_skip(&self) -> u16 {
        LEVEL_PRE_SKIP
    }

    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> Result<()> {
        debug_assert_eq!(pcm.len(), FRAME_SAMPLES);
        out.clear();
        out.extend_from_slice(
            &pcm.iter()
                .fold(0f32, |peak, sample| peak.max(sample.abs()))
                .to_le_bytes(),
        );
        Ok(())
    }
}

/// Makes stand-in encoders.
pub fn level_factory() -> EncoderFactory {
    Arc::new(|| Ok(Box::new(LevelEncoder) as Box<dyn FrameEncoder>))
}

/// The peak level in a stand-in packet.
pub fn level_of(packet: &[u8]) -> f32 {
    f32::from_le_bytes(packet[..4].try_into().expect("a four-byte level"))
}

struct State {
    format: SourceFormat,
    signal: Signal,
    sink: Option<SinkHandle>,
    paused: bool,
    stopped: bool,
    next_frame: u64,
    capture_ns: f64,
    /// Whether `set_paused` stops delivery. Some real streams can't pause, and the recorder must
    /// still leave out what they capture.
    honors_pause: bool,
    /// Parts per million by which the device clock runs faster than the capture clock.
    clock_error_ppm: f64,
    device: DeviceState,
}

/// The source half: give it to the recorder.
pub struct SyntheticSource(Arc<Mutex<State>>);

/// The test half: it drives the source.
#[derive(Clone)]
pub struct SyntheticHandle(Arc<Mutex<State>>);

/// Makes a source that plays `signal`, with its first frame captured at `start_ns`.
pub fn synthetic(format: SourceFormat, signal: Signal, start_ns: u64) -> (SyntheticSource, SyntheticHandle) {
    let state = Arc::new(Mutex::new(State {
        format,
        signal,
        sink: None,
        paused: false,
        stopped: false,
        next_frame: 0,
        capture_ns: start_ns as f64,
        honors_pause: true,
        clock_error_ppm: 0.0,
        device: DeviceState::default(),
    }));
    (SyntheticSource(Arc::clone(&state)), SyntheticHandle(state))
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl AudioSource for SyntheticSource {
    fn format(&self) -> SourceFormat {
        lock(&self.0).format
    }

    fn start(&mut self, sink: SinkHandle) -> Result<()> {
        lock(&self.0).sink = Some(sink);
        Ok(())
    }

    fn set_paused(&mut self, paused: bool) -> Result<()> {
        let mut state = lock(&self.0);
        state.paused = paused && state.honors_pause;
        Ok(())
    }

    fn stop(&mut self) {
        let mut state = lock(&self.0);
        state.stopped = true;
        state.sink = None;
    }

    fn device_state(&self) -> DeviceState {
        lock(&self.0).device
    }
}

impl SyntheticHandle {
    /// Delivers `ms` milliseconds of the signal as 10 ms packets, like a callback would. A source that
    /// is paused or stopped delivers nothing, but time still passes.
    pub fn produce_ms(&self, ms: u64) {
        let mut state = lock(&self.0);
        let packet_frames = u64::from(state.format.rate / 100);
        for _ in 0..ms / 10 {
            state.deliver(packet_frames);
        }
    }

    /// Lets `ms` milliseconds pass without delivering anything, like loopback while nothing plays.
    pub fn skip_ms(&self, ms: u64) {
        let mut state = lock(&self.0);
        let frames = u64::from(state.format.rate) * ms / 1_000;
        state.advance(frames);
    }

    /// Makes the source keep delivering while the recording is paused, like a stream that can't pause.
    pub fn keep_running_while_paused(&self) {
        lock(&self.0).honors_pause = false;
    }

    /// Makes the device clock run `ppm` parts per million faster than the capture clock.
    pub fn set_clock_error_ppm(&self, ppm: f64) {
        lock(&self.0).clock_error_ppm = ppm;
    }

    /// Sets what the source reports about its device, as a real one does when it is unplugged or
    /// stops being the default.
    pub fn set_device_state(&self, device: DeviceState) {
        lock(&self.0).device = device;
    }

    /// The capture time of the next frame, in nanoseconds.
    pub fn now_ns(&self) -> u64 {
        lock(&self.0).capture_ns as u64
    }

    /// Whether the recorder has started the source and not stopped it.
    pub fn is_running(&self) -> bool {
        let state = lock(&self.0);
        state.sink.is_some() && !state.stopped
    }
}

impl State {
    fn deliver(&mut self, frames: u64) {
        let (paused, capture_ns) = (self.paused, self.capture_ns as u64);
        let channels = usize::from(self.format.channels);
        let first = self.next_frame;
        if let (false, Some(sink)) = (paused, self.sink.as_ref()) {
            let mut data = Vec::with_capacity(frames as usize * channels);
            for frame in first..first + frames {
                let value = (self.signal)(frame);
                data.extend(std::iter::repeat_n(value, channels));
            }
            sink.push(capture_ns, &data);
        }
        self.advance(frames);
    }

    fn advance(&mut self, frames: u64) {
        let seconds = frames as f64 / f64::from(self.format.rate);
        self.next_frame += frames;
        self.capture_ns += seconds * 1e9 * (1.0 - self.clock_error_ppm / 1e6);
    }
}

/// Builds a microphone-like source for tests: 48 kHz mono sine at -20 dBFS.
pub fn test_tone_source(start_ns: u64) -> (SyntheticSource, SyntheticHandle) {
    let format = SourceFormat {
        rate: 48_000,
        channels: 1,
    };
    synthetic(format, sine(440.0, 0.1, 48_000), start_ns)
}

/// Fails the way a missing device does, for tests of error handling.
pub struct FailingSource;

impl AudioSource for FailingSource {
    fn format(&self) -> SourceFormat {
        SourceFormat {
            rate: 48_000,
            channels: 1,
        }
    }

    fn start(&mut self, _sink: SinkHandle) -> Result<()> {
        Err(AudioError::Device("There is no microphone.".into()))
    }

    fn set_paused(&mut self, _paused: bool) -> Result<()> {
        Ok(())
    }

    fn stop(&mut self) {}
}
