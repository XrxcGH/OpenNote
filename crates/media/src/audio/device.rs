//! The default microphone and system audio (WASAPI loopback), captured with cpal in shared mode.
//!
//! ADR 0007 chose this. The microphone is an input device, the default one unless the person picked
//! another. System audio is a capture stream on an output device, which cpal opens as loopback.
//! Both use the device's own format, which the writer converts to 48 kHz mono. Packets carry cpal's
//! capture times, which are on the performance counter clock.
//!
//! A supervisor thread owns the cpal stream. It closes the stream while paused, so the device and the
//! operating system's microphone indicator are free. It reopens the stream on resume, and after
//! cpal reports a lost device or an invalid stream.
//!
//! A source without a device ID follows the system's default: cpal ends a default stream when the
//! default changes, and the reopen takes the new default. A reopened stream may run in another
//! format. The sink learns it before the first packet, and the writer converts each packet by its
//! own rate.
//!
//! The source tells the recording guard when its device is gone and the reopen keeps failing. A
//! source can be pinned to a device that was the default when it opened. It also says when the
//! default moves elsewhere, which for system audio means the sound now plays through another device.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, DeviceId, ErrorKind, InputCallbackInfo, SampleFormat, SizedSample, Stream, SupportedStreamConfig};

use super::recording::check_format;
use super::ring::{Sample, SinkHandle};
use super::source::{AudioSource, DeviceState, SourceFormat};
use super::{AudioError, Result};

/// How often the supervisor checks for a pause, a resume, or a lost device.
const POLL: Duration = Duration::from_millis(200);
/// How long it waits before trying again after a failed reopen.
const RETRY: Duration = Duration::from_secs(1);
/// How many passes go by between checks of the default device, for a pinned source.
const DEFAULT_CHECK_PASSES: u32 = 5;
/// The most messages the diagnostic log keeps.
const LOG_LIMIT: usize = 50;

/// Which device a source captures. A device is named by its ID from the catalog, and `None` means
/// the system default.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Capture {
    /// An input device.
    Input(Option<String>),
    /// What an output device plays.
    Output(Option<String>),
}

#[derive(Default)]
struct Shared {
    paused: AtomicBool,
    stop: AtomicBool,
    /// cpal said the stream ended, so the supervisor reopens it.
    lost: AtomicBool,
    /// Reopening failed, and the supervisor keeps trying.
    down: AtomicBool,
    /// The pinned device is no longer the default it was.
    not_default: AtomicBool,
    log: Mutex<Vec<String>>,
}

impl Shared {
    fn note(&self, message: String) {
        let mut log = lock(&self.log);
        if log.len() < LOG_LIMIT {
            log.push(message);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A source that captures a cpal device.
pub struct CpalSource {
    capture: Capture,
    format: SourceFormat,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl CpalSource {
    /// The default microphone.
    pub fn microphone() -> Result<Self> {
        Self::new(Capture::Input(None))
    }

    /// The default speakers, through loopback.
    pub fn system_audio() -> Result<Self> {
        Self::new(Capture::Output(None))
    }

    /// A microphone by its ID from the device catalog, or the default for `None`.
    pub fn input(id: Option<&str>) -> Result<Self> {
        Self::new(Capture::Input(id.map(str::to_owned)))
    }

    /// The speakers with this ID, through loopback, or the default for `None`.
    pub fn loopback(id: Option<&str>) -> Result<Self> {
        Self::new(Capture::Output(id.map(str::to_owned)))
    }

    fn new(capture: Capture) -> Result<Self> {
        let (_, config) = open_device(&capture)?;
        let format = SourceFormat {
            rate: config.sample_rate(),
            channels: config.channels(),
        };
        Ok(CpalSource {
            capture,
            format,
            shared: Arc::new(Shared::default()),
            thread: None,
        })
    }

    /// What went wrong so far, for diagnostics. The list is short and never holds audio.
    pub fn messages(&self) -> Vec<String> {
        lock(&self.shared.log).clone()
    }

    fn wake(&self) {
        if let Some(thread) = &self.thread {
            thread.thread().unpark();
        }
    }
}

impl AudioSource for CpalSource {
    fn format(&self) -> SourceFormat {
        self.format
    }

    fn start(&mut self, sink: SinkHandle) -> Result<()> {
        let (ready, ready_rx) = mpsc::channel();
        let setup = Setup {
            capture: self.capture.clone(),
            format: self.format,
            sink,
        };
        let shared = Arc::clone(&self.shared);
        let thread = thread::Builder::new()
            .name("opennote-audio-device".into())
            .spawn(move || supervise(setup, shared, ready))
            .map_err(|error| AudioError::Device(error.to_string()))?;
        match ready_rx.recv() {
            Ok(Ok(())) => {
                self.thread = Some(thread);
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => Err(AudioError::Device(
                "The audio thread ended before the device opened.".into(),
            )),
        }
    }

    fn set_paused(&mut self, paused: bool) -> Result<()> {
        self.shared.paused.store(paused, Ordering::SeqCst);
        self.wake();
        Ok(())
    }

    fn stop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }

    fn device_state(&self) -> DeviceState {
        DeviceState {
            lost: self.shared.down.load(Ordering::SeqCst),
            not_default: self.shared.not_default.load(Ordering::SeqCst),
        }
    }
}

impl Drop for CpalSource {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Setup {
    capture: Capture,
    format: SourceFormat,
    sink: SinkHandle,
}

fn device_error(error: cpal::Error) -> AudioError {
    AudioError::Device(error.to_string())
}

/// The device for `capture`, and its stream configuration.
fn open_device(capture: &Capture) -> Result<(Device, SupportedStreamConfig)> {
    let host = cpal::default_host();
    match capture {
        Capture::Input(id) => {
            let device = pick(&host, id.as_deref(), host.default_input_device(), "microphone")?;
            let config = device.default_input_config().map_err(device_error)?;
            Ok((device, config))
        }
        Capture::Output(id) => {
            let device = pick(&host, id.as_deref(), host.default_output_device(), "output device")?;
            let config = device.default_output_config().map_err(device_error)?;
            Ok((device, config))
        }
    }
}

/// The device with this ID, or the default one when no ID is given.
fn pick(host: &cpal::Host, id: Option<&str>, default: Option<Device>, what: &str) -> Result<Device> {
    match id {
        None => default.ok_or_else(|| AudioError::Device(format!("There is no default {what}."))),
        Some(id) => {
            let parsed: DeviceId = id
                .parse()
                .map_err(|_| AudioError::Device(format!("\"{id}\" is not a device ID.")))?;
            host.device_by_id(&parsed)
                .ok_or_else(|| AudioError::Device(format!("The {what} \"{id}\" is not connected.")))
        }
    }
}

/// Keeps a stream open while recording runs. The first result goes to `ready`. After a first
/// failure the thread ends, and after later failures it retries.
fn supervise(setup: Setup, shared: Arc<Shared>, ready: Sender<Result<()>>) {
    let mut supervisor = Supervisor {
        setup,
        shared,
        stream: None,
        ready: Some(ready),
        pinned_was_default: None,
        passes: 0,
    };
    while !supervisor.shared.stop.load(Ordering::SeqCst) {
        match supervisor.pass() {
            Some(wait) => thread::park_timeout(wait),
            None => return,
        }
    }
}

struct Supervisor {
    setup: Setup,
    shared: Arc<Shared>,
    stream: Option<Stream>,
    /// Waits for the first result, until it is sent.
    ready: Option<Sender<Result<()>>>,
    /// For a source pinned to a device ID: whether that device was the default at the first open.
    pinned_was_default: Option<bool>,
    passes: u32,
}

impl Supervisor {
    /// Closes the stream while paused or after an error, and opens it when it should run. Returns how
    /// long to wait before the next pass, or `None` when the first open failed and the thread ends.
    fn pass(&mut self) -> Option<Duration> {
        let wanted = !self.shared.paused.load(Ordering::SeqCst);
        if !wanted || self.shared.lost.swap(false, Ordering::SeqCst) {
            self.stream = None;
        }
        self.passes = self.passes.wrapping_add(1);
        if self.stream.is_some() && self.passes.is_multiple_of(DEFAULT_CHECK_PASSES) {
            self.check_default();
        }
        if !wanted || self.stream.is_some() {
            return Some(POLL);
        }
        match open_stream(&mut self.setup, &self.shared) {
            Ok(stream) => {
                self.stream = Some(stream);
                self.shared.down.store(false, Ordering::SeqCst);
                if self.pinned_was_default.is_none() {
                    self.pinned_was_default =
                        pinned(&self.setup.capture).map(|id| default_id(&self.setup.capture).as_deref() == Some(id));
                }
                self.report(Ok(()));
                Some(POLL)
            }
            Err(error) => {
                self.shared.note(error.to_string());
                if self.ready.is_some() {
                    self.report(Err(error));
                    return None;
                }
                self.shared.down.store(true, Ordering::SeqCst);
                Some(RETRY)
            }
        }
    }

    /// For a source pinned to the device that was the default, notes whether it still is.
    fn check_default(&self) {
        if let (Some(true), Some(id)) = (self.pinned_was_default, pinned(&self.setup.capture)) {
            let moved = default_id(&self.setup.capture).is_some_and(|default| default != id);
            self.shared.not_default.store(moved, Ordering::SeqCst);
        }
    }

    fn report(&mut self, result: Result<()>) {
        if let Some(ready) = self.ready.take() {
            let _ = ready.send(result);
        }
    }
}

/// The device ID a source is pinned to, or none for one that follows the default.
fn pinned(capture: &Capture) -> Option<&str> {
    match capture {
        Capture::Input(id) | Capture::Output(id) => id.as_deref(),
    }
}

/// The ID of the system's default device in the direction of `capture`.
fn default_id(capture: &Capture) -> Option<String> {
    let host = cpal::default_host();
    let device = match capture {
        Capture::Input(_) => host.default_input_device(),
        Capture::Output(_) => host.default_output_device(),
    };
    device.and_then(|device| device.id().ok()).map(|id| id.to_string())
}

/// Takes the format of a reopened stream. The sink learns a new format before any packet comes in
/// it, since no stream is running while the supervisor reopens one. A format the recorder can't take
/// keeps the recording waiting.
fn adopt_format(setup: &mut Setup, format: SourceFormat) -> Result<()> {
    if format != setup.format {
        check_format(format)?;
        setup.sink.set_format(format);
        setup.format = format;
    }
    Ok(())
}

fn open_stream(setup: &mut Setup, shared: &Arc<Shared>) -> Result<Stream> {
    let (device, config) = open_device(&setup.capture)?;
    adopt_format(
        setup,
        SourceFormat {
            rate: config.sample_rate(),
            channels: config.channels(),
        },
    )?;
    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, setup, shared),
        SampleFormat::I16 => build::<i16>(&device, &config, setup, shared),
        SampleFormat::I32 => build::<i32>(&device, &config, setup, shared),
        other => Err(AudioError::Format(format!("{other} samples"))),
    }?;
    stream.play().map_err(device_error)?;
    Ok(stream)
}

fn build<T>(device: &Device, config: &SupportedStreamConfig, setup: &Setup, shared: &Arc<Shared>) -> Result<Stream>
where
    T: SizedSample + Sample,
{
    let sink = setup.sink.clone();
    let on_data = move |data: &[T], info: &InputCallbackInfo| {
        // The handle never waits, so the callback doesn't either.
        sink.push(info.timestamp().capture.as_nanos() as u64, data);
    };
    let shared = Arc::clone(shared);
    let on_error = move |error: cpal::Error| {
        if matches!(
            error.kind(),
            ErrorKind::DeviceNotAvailable | ErrorKind::StreamInvalidated
        ) {
            shared.lost.store(true, Ordering::SeqCst);
        }
        shared.note(error.to_string());
    };
    device
        .build_input_stream::<T, _, _>(config.config(), on_data, on_error, None)
        .map_err(device_error)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::super::ring::{packet_channel, TrackStats};
    use super::*;

    #[test]
    fn a_reopened_stream_in_another_format_goes_on_in_that_format() {
        let first = SourceFormat {
            rate: 48_000,
            channels: 2,
        };
        let (sink, mut reader) = packet_channel(first, 48_000, Arc::new(TrackStats::default()));
        let mut setup = Setup {
            capture: Capture::Output(None),
            format: first,
            sink: SinkHandle::new(sink),
        };
        let headset = SourceFormat {
            rate: 16_000,
            channels: 1,
        };
        adopt_format(&mut setup, headset).unwrap();
        assert_eq!(setup.format, headset);
        setup.sink.push(7, &[0.5f32; 160]);
        let mut samples = Vec::new();
        let packet = reader.next(&mut samples).unwrap();
        assert_eq!((packet.rate, samples.len()), (16_000, 160));

        let unusable = SourceFormat {
            rate: 4_000,
            channels: 1,
        };
        assert!(adopt_format(&mut setup, unusable).is_err());
        assert_eq!(setup.format, headset, "the recording waits for a usable format");
    }

    #[test]
    fn a_source_knows_whether_it_follows_the_default() {
        assert_eq!(pinned(&Capture::Output(None)), None);
        assert_eq!(pinned(&Capture::Input(Some("mic".into()))), Some("mic"));
    }
}
