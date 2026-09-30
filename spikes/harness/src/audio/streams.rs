//! The cpal streams: the microphone, system audio through WASAPI loopback, and the output that plays
//! the test tone. The callbacks keep statistics only (times, frame counts, levels, and the tone level),
//! never the audio itself.

use std::sync::{Arc, Mutex, MutexGuard};

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{Device, FromSample, InputCallbackInfo, OutputCallbackInfo, SampleFormat, SizedSample, Stream};
use serde::Serialize;

use super::tone::{self, Block, Goertzel, Tone};
use crate::common::{clock, Result};

/// Length of a Goertzel block, in milliseconds.
const BLOCK_MS: f64 = 2.0;

/// Frames in a Goertzel block: 96 at 48 kHz.
pub fn block_frames(sample_rate: u32) -> usize {
    (f64::from(sample_rate) * BLOCK_MS / 1000.0).round().max(1.0) as usize
}

/// One capture callback.
#[derive(Clone, Copy, Debug)]
pub struct Packet {
    /// When the callback ran, in QPC ticks.
    pub arrival: i64,
    /// cpal's capture time of the first frame, in nanoseconds on the QPC clock.
    pub capture_ns: u64,
    /// cpal's callback time, in nanoseconds on the QPC clock.
    pub callback_ns: u64,
    pub frames: u32,
    pub peak: f32,
    pub rms: f32,
    /// Time spent in the callback, in QPC ticks.
    pub work: i64,
}

/// A stream error reported by cpal.
#[derive(Clone, Debug, Serialize)]
pub struct StreamError {
    pub at_s: f64,
    pub kind: String,
    pub message: String,
}

/// Everything a capture stream recorded.
#[derive(Debug)]
pub struct CaptureLog {
    pub packets: Vec<Packet>,
    pub blocks: Vec<Block>,
    pub errors: Vec<StreamError>,
    channels: usize,
    frame_ns: f64,
    filter: Goertzel,
    block_start_ns: u64,
}

/// One output callback.
#[derive(Clone, Copy, Debug)]
pub struct Render {
    pub arrival: i64,
    pub callback_ns: u64,
    /// cpal's predicted time the first frame is played.
    pub playback_ns: u64,
    pub first_frame: u64,
    pub frames: u32,
}

#[derive(Debug, Default)]
pub struct RenderLog {
    pub renders: Vec<Render>,
    pub errors: Vec<StreamError>,
}

/// A running stream and what it has recorded so far.
pub struct Running<L> {
    pub stream: Stream,
    pub log: Arc<Mutex<L>>,
    pub config: cpal::SupportedStreamConfig,
    pub period_frames: Option<u32>,
    pub started: i64,
}

/// Converts QPC ticks to nanoseconds, the unit of cpal's WASAPI timestamps.
pub fn ticks_to_ns(ticks: i64) -> u64 {
    (i128::from(ticks) * 1_000_000_000 / i128::from(clock::frequency())).max(0) as u64
}

/// Locks a log, even if a callback panicked while holding it.
pub fn lock<L>(log: &Mutex<L>) -> MutexGuard<'_, L> {
    log.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl CaptureLog {
    fn new(config: &cpal::SupportedStreamConfig, capacity: usize) -> CaptureLog {
        let rate = f64::from(config.sample_rate());
        let block = block_frames(config.sample_rate());
        CaptureLog {
            packets: Vec::with_capacity(capacity),
            blocks: Vec::with_capacity(capacity * 6),
            errors: Vec::new(),
            channels: usize::from(config.channels()).max(1),
            frame_ns: 1e9 / rate,
            filter: Goertzel::new(f64::from(tone::FREQUENCY_HZ), rate, block),
            block_start_ns: 0,
        }
    }

    /// Records one packet: its times, frame count, levels, and the tone level in channel 0.
    fn record<T>(&mut self, data: &[T], info: &InputCallbackInfo, arrival: i64)
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        let timestamp = info.timestamp();
        let capture_ns = timestamp.capture.as_nanos() as u64;
        let (mut peak, mut squares) = (0f32, 0f64);
        for (index, frame) in data.chunks_exact(self.channels).enumerate() {
            for &sample in frame {
                let value: f32 = sample.to_sample();
                peak = peak.max(value.abs());
                squares += f64::from(value) * f64::from(value);
            }
            if self.filter.at_block_start() {
                self.block_start_ns = capture_ns + (index as f64 * self.frame_ns) as u64;
            }
            if let Some(amplitude) = self.filter.push(frame[0].to_sample()) {
                let start_ns = self.block_start_ns;
                self.blocks.push(Block { start_ns, amplitude });
            }
        }
        self.packets.push(Packet {
            arrival,
            capture_ns,
            callback_ns: timestamp.callback.as_nanos() as u64,
            frames: (data.len() / self.channels) as u32,
            peak,
            rms: (squares / data.len().max(1) as f64).sqrt() as f32,
            work: clock::now() - arrival,
        });
    }
}

fn error_handler(errors: impl Fn(StreamError) + Send + 'static, origin: i64) -> impl FnMut(cpal::Error) + Send {
    move |error: cpal::Error| {
        errors(StreamError {
            at_s: clock::elapsed_ms(origin, clock::now()) / 1000.0,
            kind: format!("{:?}", error.kind()),
            message: error.to_string(),
        });
    }
}

/// Starts a capture stream on `device` in its own shared-mode format. On an output device, cpal opens
/// it in loopback mode, which captures what the device plays.
pub fn start_capture(
    device: &Device,
    config: cpal::SupportedStreamConfig,
    seconds: f64,
    origin: i64,
) -> Result<Running<CaptureLog>> {
    let capacity = (seconds * 400.0) as usize + 1_000;
    let log = Arc::new(Mutex::new(CaptureLog::new(&config, capacity)));
    let stream = match config.sample_format() {
        SampleFormat::F32 => build_capture::<f32>(device, config, &log, origin)?,
        SampleFormat::I16 => build_capture::<i16>(device, config, &log, origin)?,
        SampleFormat::I32 => build_capture::<i32>(device, config, &log, origin)?,
        other => return Err(format!("The spike can't read {other} samples.").into()),
    };
    Running::start(stream, log, config)
}

impl<L> Running<L> {
    /// Starts a built stream and notes its callback period.
    fn start(stream: Stream, log: Arc<Mutex<L>>, config: cpal::SupportedStreamConfig) -> Result<Running<L>> {
        let period_frames = stream.buffer_size().ok();
        stream.play()?;
        Ok(Running {
            stream,
            log,
            config,
            period_frames,
            started: clock::now(),
        })
    }
}

fn build_capture<T>(
    device: &Device,
    config: cpal::SupportedStreamConfig,
    log: &Arc<Mutex<CaptureLog>>,
    origin: i64,
) -> Result<Stream>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let (data_log, error_log) = (Arc::clone(log), Arc::clone(log));
    let on_data = move |data: &[T], info: &InputCallbackInfo| {
        let arrival = clock::now();
        lock(&data_log).record(data, info, arrival);
    };
    let on_error = error_handler(move |error| lock(&error_log).errors.push(error), origin);
    Ok(device.build_input_stream::<T, _, _>(config.config(), on_data, on_error, None)?)
}

/// Starts an output stream on `device` that plays `tone` and silence otherwise. WASAPI converts the
/// 32-bit float samples to the device format.
pub fn start_output(device: &Device, tone: Tone, origin: i64) -> Result<Running<RenderLog>> {
    let config = device.default_output_config()?;
    let channels = usize::from(config.channels());
    let log = Arc::new(Mutex::new(RenderLog::default()));
    let (data_log, error_log) = (Arc::clone(&log), Arc::clone(&log));
    let mut next_frame = 0u64;
    let on_data = move |data: &mut [f32], info: &OutputCallbackInfo| {
        let arrival = clock::now();
        let first_frame = next_frame;
        for frame in data.chunks_exact_mut(channels) {
            frame.fill(tone.sample(next_frame));
            next_frame += 1;
        }
        let timestamp = info.timestamp();
        lock(&data_log).renders.push(Render {
            arrival,
            callback_ns: timestamp.callback.as_nanos() as u64,
            playback_ns: timestamp.playback.as_nanos() as u64,
            first_frame,
            frames: (next_frame - first_frame) as u32,
        });
    };
    let on_error = error_handler(move |error| lock(&error_log).errors.push(error), origin);
    let stream_config = cpal::StreamConfig {
        channels: config.channels(),
        sample_rate: config.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    let stream = device.build_output_stream::<f32, _, _>(stream_config, on_data, on_error, None)?;
    Running::start(stream, log, config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_ticks_to_nanoseconds() {
        assert_eq!(ticks_to_ns(0), 0);
        assert_eq!(ticks_to_ns(clock::frequency()), 1_000_000_000);
        assert_eq!(ticks_to_ns(-5), 0);
        assert_eq!(block_frames(48_000), 96);
        assert_eq!(block_frames(44_100), 88);
    }
}
