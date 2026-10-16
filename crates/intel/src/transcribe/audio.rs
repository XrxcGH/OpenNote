//! Where an engine reads audio from.

use crate::error::IntelError;

/// The sample rate of [`AudioSource`]: 16 kHz, which is what whisper.cpp expects.
pub const SAMPLES_PER_SECOND: u32 = 16_000;

/// A recording as mono 32-bit floating-point samples at 16 kHz, read in order.
///
/// The app decodes its stored Opus files into this form as it reads. Nothing here touches the
/// microphone, and nothing is written to disk.
pub trait AudioSource: Send {
    /// The number of samples in the recording, if known. Progress needs it.
    fn total_samples(&self) -> Option<u64>;

    /// Fills the start of `buffer` with the next samples and returns how many it wrote.
    /// Zero means the end of the recording.
    fn read(&mut self, buffer: &mut [f32]) -> Result<usize, IntelError>;

    /// Goes back to the first sample, so a failed job can run again on another device.
    fn rewind(&mut self) -> Result<(), IntelError>;
}

/// A recording held in memory. Useful for tests and short clips.
#[derive(Clone, Debug, Default)]
pub struct MemoryAudio {
    samples: Vec<f32>,
    position: usize,
}

impl MemoryAudio {
    /// Wraps samples at 16 kHz.
    pub fn new(samples: Vec<f32>) -> MemoryAudio {
        MemoryAudio { samples, position: 0 }
    }

    /// Silence of the given length.
    pub fn silence(seconds: u32) -> MemoryAudio {
        MemoryAudio::new(vec![0.0; seconds as usize * SAMPLES_PER_SECOND as usize])
    }
}

impl AudioSource for MemoryAudio {
    fn total_samples(&self) -> Option<u64> {
        Some(self.samples.len() as u64)
    }

    fn read(&mut self, buffer: &mut [f32]) -> Result<usize, IntelError> {
        let count = buffer.len().min(self.samples.len() - self.position);
        buffer[..count].copy_from_slice(&self.samples[self.position..self.position + count]);
        self.position += count;
        Ok(count)
    }

    fn rewind(&mut self) -> Result<(), IntelError> {
        self.position = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_audio_reads_in_order_and_rewinds() {
        let mut audio = MemoryAudio::new(vec![1.0, 2.0, 3.0]);
        let mut buffer = [0.0; 2];
        assert_eq!(audio.read(&mut buffer).unwrap(), 2);
        assert_eq!(buffer, [1.0, 2.0]);
        assert_eq!(audio.read(&mut buffer).unwrap(), 1);
        assert_eq!(audio.read(&mut buffer).unwrap(), 0);
        audio.rewind().unwrap();
        assert_eq!(audio.read(&mut buffer).unwrap(), 2);
    }
}
