//! A tap lets other code listen to a track while it is written, for example live transcription.
//!
//! The writer thread calls the tap with the same 48 kHz mono samples that go to the encoder, after
//! the pause filter and the rate conversion. It is a hook only, since the media crate has no listeners
//! yet. A slow tap slows the writer, so a tap should copy the samples to its own queue and return.

use std::sync::Arc;

use super::files::TrackKind;

/// Listens to one track of a recording.
pub trait PcmTap: Send {
    /// Samples were written to the track as frames `first_frame` onward. `capture_ns` is the capture
    /// time of the first sample. Silence added for gaps is not passed, so frame numbers can skip.
    fn pcm(&mut self, first_frame: u64, capture_ns: u64, samples: &[f32]);

    /// The track ended after `frames` frames.
    fn finish(&mut self, frames: u64) {
        let _ = frames;
    }
}

/// Makes the tap for a track, or none if nothing listens to it.
pub type TapFactory = Arc<dyn Fn(TrackKind) -> Option<Box<dyn PcmTap>> + Send + Sync>;
