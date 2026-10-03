//! Playback of recordings: decoding, mixing the tracks, seeking, speed, and skipping silence.
//!
//! The pieces, from the file up. The [`reader`] indexes a track file and decodes any range of its
//! frames. The [`mixer`] adds the tracks of a recording by position, using the position map. The
//! [`skip`] module cuts long pauses short, and [`stretch`] changes the speed without changing the
//! pitch. The [`player`] puts them together behind `render`, `seek`, `set_speed`, and the rest. The
//! [`session`] runs a player on a thread and feeds a sound device through a ring buffer.
//!
//! [`open_recording`] builds a player for a finished or recovered recording.

use std::path::Path;

use crate::audio::{RecordingSummary, Result};
use crate::positions::PositionMap;

pub mod audio_output;
pub mod convert;
pub mod decoder;
pub mod mixer;
#[cfg(feature = "opus")]
mod opus_decoder;
#[cfg(windows)]
pub mod output;
pub mod player;
pub mod reader;
pub mod session;
pub mod skip;
pub mod stretch;

pub use audio_output::{AudioOutput, FillFn, ManualOutput, OutputFormat};
pub use decoder::{opus_decoder_factory, DecoderFactory, FrameDecoder};
pub use player::{Player, RESUME_REWIND_NS, SKIP_NS};
pub use reader::TrackReader;

/// Opens the audio files of `summary` in `dir`, and returns a player for them.
pub fn open_recording(dir: &Path, summary: &RecordingSummary, decoders: &DecoderFactory) -> Result<Player> {
    let map = PositionMap::from_summary(summary);
    if map.duration_ns() == 0 {
        return Err(player::nothing_to_play());
    }
    let mut tracks = Vec::new();
    for track in &summary.tracks {
        let reader = TrackReader::open(&dir.join(&track.audio_file), decoders)?;
        tracks.push(mixer::MixTrack::new(track.kind, reader, &track.timeline));
    }
    Ok(Player::new(mixer::Mixer::new(map, tracks)))
}
