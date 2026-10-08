//! What a recording leaves behind, and what a screen can ask of one that is running.

use serde::{Deserialize, Serialize};

use super::clock::ClockAnchor;
use super::files::TrackKind;
use super::level::Level;
use super::source::DeviceState;
use super::timeline::Timeline;

/// A time the recording was paused.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    pub paused_ns: u64,
    pub resumed_ns: u64,
}

/// One track of a finished recording.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    pub kind: TrackKind,
    /// The ID of the asset that holds the audio.
    pub asset: String,
    /// The audio file's name, in the folder the recorder wrote to.
    pub audio_file: String,
    /// The timeline file's name. The summary holds the same timeline, so the file is a backup.
    pub timeline_file: String,
    pub timeline: Timeline,
    /// Packets lost because the writer fell behind. Each shows up as silence.
    pub dropped_packets: u64,
    /// Frames of silence added for gaps in capture.
    pub silence_frames: u64,
}

/// What a finished or recovered recording leaves for the note file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSummary {
    pub id: String,
    pub started_ns: u64,
    pub ended_ns: u64,
    /// Ties the capture clock to Unix time, so a stroke's start time finds its audio.
    pub clock: ClockAnchor,
    pub pauses: Vec<Pause>,
    pub tracks: Vec<TrackSummary>,
    /// Whether a crash cut the recording off and recovery restored it. Recovered summaries have no
    /// pauses, since nothing recorded them. The timelines still show them as gaps.
    pub recovered: bool,
}

/// A track whose writer failed before the recording stopped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFailure {
    pub kind: TrackKind,
    pub message: String,
    /// Whether the audio written before the failure was kept. If not, the summary leaves the track out.
    pub saved: bool,
}

/// How a track is doing, for a screen that shows recording health.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackHealth {
    pub kind: TrackKind,
    pub dropped_packets: u64,
    pub frames: u64,
    pub silence_frames: u64,
    /// Why the writer stopped, if it did. The recording has stopped growing then.
    pub failure: Option<String>,
    /// Whether the source's device is there, and still the default.
    pub device: DeviceState,
}

/// How long a track has been quiet and how long since it delivered anything, for the recording guard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrackWatch {
    pub kind: TrackKind,
    pub silent_ms: u64,
    pub idle_ms: u64,
}

/// A track's level, with its kind.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackLevel {
    pub kind: TrackKind,
    #[serde(flatten)]
    pub level: Level,
}
