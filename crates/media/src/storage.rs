//! What recordings take on disk, what compressing one would save, and removing the audio of one.
//!
//! The "Recording storage" list in the app shows each recording's length and size. Compressing and
//! removing audio both ask for a confirmation that says how much space they free, so each has a function
//! that gives the number before anything changes.
//!
//! Removing the audio keeps the transcript and the flags, because they live in the page and not in the
//! audio files. The caller saves the page without the recording's tracks first, and only then calls
//! [`delete_audio`], so a crash in between leaves files that nothing refers to, and not a page that refers
//! to files that are gone. The core's garbage collection would also remove those files in time.

use std::path::Path;

use serde::Serialize;

use crate::audio::{RecordingSummary, Result, TrackKind, TrackSummary};
use crate::convert::Quality;
use crate::positions::PositionMap;

/// An Ogg file's overhead on top of the packets: page headers and checksums.
const OGG_OVERHEAD: f64 = 1.03;
const TRACK_RATE: f64 = 48_000.0;

/// What one track takes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackUsage {
    pub kind: TrackKind,
    pub asset: String,
    pub audio_bytes: u64,
    pub timeline_bytes: u64,
}

/// What a recording takes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub recording: String,
    /// How long the recording plays, with pauses left out.
    pub duration_ns: u64,
    pub tracks: Vec<TrackUsage>,
    pub total_bytes: u64,
}

fn size_of(dir: &Path, name: &str) -> u64 {
    std::fs::metadata(dir.join(name)).map_or(0, |meta| meta.len())
}

/// The size of a recording's files. A file that is missing counts as nothing.
pub fn usage(dir: &Path, summary: &RecordingSummary) -> Usage {
    let tracks: Vec<TrackUsage> = summary
        .tracks
        .iter()
        .map(|track| TrackUsage {
            kind: track.kind,
            asset: track.asset.clone(),
            audio_bytes: size_of(dir, &track.audio_file),
            timeline_bytes: size_of(dir, &track.timeline_file),
        })
        .collect();
    Usage {
        recording: summary.id.clone(),
        duration_ns: PositionMap::from_summary(summary).duration_ns(),
        total_bytes: tracks.iter().map(|t| t.audio_bytes + t.timeline_bytes).sum(),
        tracks,
    }
}

/// About how large the audio of a recording would be after compressing it. Opus at a fixed bitrate is
/// predictable, so this is within a few percent.
pub fn estimated_size(summary: &RecordingSummary, quality: Quality) -> u64 {
    summary
        .tracks
        .iter()
        .map(|track| {
            (track.timeline.frames as f64 / TRACK_RATE * f64::from(quality.bitrate()) / 8.0 * OGG_OVERHEAD) as u64
        })
        .sum()
}

/// The space that compressing would free, or nothing if the audio is already that small.
pub fn space_freed_by_compressing(dir: &Path, summary: &RecordingSummary, quality: Quality) -> u64 {
    let audio: u64 = usage(dir, summary).tracks.iter().map(|t| t.audio_bytes).sum();
    audio.saturating_sub(estimated_size(summary, quality))
}

/// Deletes the audio and timeline files of every track and returns the bytes freed. A file that is already
/// gone is not an error.
pub fn delete_audio(dir: &Path, summary: &RecordingSummary) -> Result<u64> {
    let mut freed = 0;
    for track in &summary.tracks {
        freed += delete_track(dir, track)?;
    }
    Ok(freed)
}

fn delete_track(dir: &Path, track: &TrackSummary) -> Result<u64> {
    let mut freed = 0;
    for name in [&track.audio_file, &track.timeline_file] {
        let size = size_of(dir, name);
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => freed += size,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(freed)
}
