//! Listening to the audio a speech engine reads, without a second pass over the file.

use std::sync::{Arc, Mutex, PoisonError};

use super::cluster::label_ranges;
use super::features::FrameStream;
use crate::error::IntelError;
use crate::transcribe::AudioSource;

/// The voice prints being gathered from one recording.
#[derive(Clone, Default)]
pub struct Listening(Arc<Mutex<FrameStream>>);

impl Listening {
    /// A listener with nothing heard yet.
    pub fn new() -> Listening {
        Listening::default()
    }

    /// The speaker of each stretch, given as start and end in milliseconds. A stretch too short or too quiet to
    /// tell, or any stretch of a recording too long to keep, has none.
    pub fn label(&self, ranges: &[(u64, u64)]) -> Vec<Option<u32>> {
        let stream = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        label_ranges(stream.frames(), ranges)
    }
}

/// Audio that passes through to an engine while a [`Listening`] hears it.
pub struct Tee<A> {
    inner: A,
    listening: Listening,
}

impl<A: AudioSource> Tee<A> {
    /// Wraps `inner`.
    pub fn new(inner: A, listening: Listening) -> Tee<A> {
        Tee { inner, listening }
    }
}

impl<A: AudioSource> AudioSource for Tee<A> {
    fn total_samples(&self) -> Option<u64> {
        self.inner.total_samples()
    }

    fn read(&mut self, buffer: &mut [f32]) -> Result<usize, IntelError> {
        let count = self.inner.read(buffer)?;
        self.listening
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(&buffer[..count]);
        Ok(count)
    }

    fn rewind(&mut self) -> Result<(), IntelError> {
        self.inner.rewind()?;
        self.listening.0.lock().unwrap_or_else(PoisonError::into_inner).reset();
        Ok(())
    }
}
