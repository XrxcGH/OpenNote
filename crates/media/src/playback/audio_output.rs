//! What a playback session needs from a sound device, and a stand-in device for tests.

use std::sync::{Arc, Mutex};

use crate::audio::Result;

/// A function that fills a buffer of interleaved samples. A device calls it from its own thread.
pub type FillFn = Box<dyn FnMut(&mut [f32]) + Send>;

/// What a sound device needs from the session.
pub trait AudioOutput: Send {
    /// The rate and channel count the device runs at.
    fn format(&self) -> OutputFormat;

    /// Starts calling `fill` on the device's thread. It gets a buffer of interleaved samples to fill.
    fn start(&mut self, fill: FillFn) -> Result<()>;

    /// Stops calling `fill`.
    fn stop(&mut self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputFormat {
    pub rate: u32,
    pub channels: u16,
}

/// An output for tests: the test plays the device's part by calling [`ManualOutput::pull`].
#[derive(Clone)]
pub struct ManualOutput {
    format: OutputFormat,
    fill: Arc<Mutex<Option<FillFn>>>,
}

impl ManualOutput {
    pub fn new(format: OutputFormat) -> Self {
        ManualOutput {
            format,
            fill: Arc::new(Mutex::new(None)),
        }
    }

    /// Asks the session for `frames` frames of interleaved audio, as a device callback would.
    pub fn pull(&self, frames: usize) -> Vec<f32> {
        let mut buffer = vec![0.0; frames * usize::from(self.format.channels)];
        if let Some(fill) = self.fill.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
            fill(&mut buffer);
        }
        buffer
    }
}

impl AudioOutput for ManualOutput {
    fn format(&self) -> OutputFormat {
        self.format
    }

    fn start(&mut self, fill: FillFn) -> Result<()> {
        *self.fill.lock().unwrap_or_else(|p| p.into_inner()) = Some(fill);
        Ok(())
    }

    fn stop(&mut self) {
        *self.fill.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}
