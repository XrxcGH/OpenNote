//! A stand-in engine, so the queue and the interface work before whisper.cpp is wired in.

use std::time::{Duration, Instant};

use super::audio::SAMPLES_PER_SECOND;
use super::{AudioSource, Device, EngineSettings, JobControl, Segment, Transcript, TranscriptionEngine};
use crate::error::IntelError;

/// Produces a placeholder segment for each chunk of audio, in the shape of the real engine's output.
///
/// It reads the audio, reports progress, and honors cancel like a real engine, so the queue and
/// the interface can be built and tested against it.
#[derive(Clone, Debug)]
pub struct StubEngine {
    devices: Vec<Device>,
    chunk_samples: usize,
    chunk_delay: Duration,
    failing_device: Option<Device>,
}

impl Default for StubEngine {
    fn default() -> Self {
        StubEngine {
            devices: vec![Device::Cpu],
            chunk_samples: 30 * SAMPLES_PER_SECOND as usize,
            chunk_delay: Duration::ZERO,
            failing_device: None,
        }
    }
}

impl StubEngine {
    /// An engine that offers the processor only, with no delay.
    pub fn new() -> StubEngine {
        StubEngine::default()
    }

    /// Sets the devices the engine offers.
    pub fn with_devices(mut self, devices: &[Device]) -> StubEngine {
        self.devices = devices.to_vec();
        self
    }

    /// Sets the samples in each chunk, which is one segment. The default is 30 seconds.
    pub fn with_chunk_samples(mut self, samples: usize) -> StubEngine {
        self.chunk_samples = samples.max(1);
        self
    }

    /// Makes each chunk take at least this long, as real work would.
    pub fn with_chunk_delay(mut self, delay: Duration) -> StubEngine {
        self.chunk_delay = delay;
        self
    }

    /// Makes every job on this device fail, to exercise the fallback to the processor.
    pub fn failing_on(mut self, device: Device) -> StubEngine {
        self.failing_device = Some(device);
        self
    }

    /// Waits out the chunk delay, waking every few milliseconds to notice a cancel.
    fn work(&self, control: &JobControl) -> Result<(), IntelError> {
        let until = Instant::now() + self.chunk_delay;
        while Instant::now() < until {
            control.check_canceled()?;
            std::thread::sleep(Duration::from_millis(2).min(until - Instant::now()));
        }
        Ok(())
    }
}

impl TranscriptionEngine for StubEngine {
    fn name(&self) -> String {
        "stub".to_owned()
    }

    fn devices(&self) -> Vec<Device> {
        self.devices.clone()
    }

    fn transcribe(
        &self,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError> {
        if self.failing_device == Some(settings.device) {
            return Err(IntelError::Engine(format!(
                "the stub engine was set to fail on the {}",
                settings.device
            )));
        }
        let total = audio.total_samples().filter(|&t| t > 0);
        let mut buffer = vec![0.0_f32; self.chunk_samples];
        let mut done: u64 = 0;
        let mut segments = Vec::new();
        loop {
            control.check_canceled()?;
            let count = audio.read(&mut buffer)? as u64;
            if count == 0 {
                break;
            }
            self.work(control)?;
            let ms = |samples: u64| samples * 1000 / u64::from(SAMPLES_PER_SECOND);
            let text = format!("Stub segment {}.", segments.len() + 1);
            segments.push(Segment {
                start_ms: ms(done),
                end_ms: ms(done + count),
                text,
            });
            control.emit_segment(segments[segments.len() - 1].clone());
            done += count;
            if let Some(total) = total {
                control.report_progress(done as f32 / total as f32);
            }
        }
        Ok(Transcript {
            language: settings.language.clone(),
            device: settings.device,
            segments,
        })
    }
}
