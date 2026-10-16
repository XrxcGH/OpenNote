//! Where a recording lives in a notebook, following the asset rules of the note format (spec 10).
//!
//! Each track is an asset of the page. Its audio file is `assets/<asset ID>-mic.ogg` or `-system.ogg`,
//! named by the same function that names images, so readers accept it and garbage collection treats
//! it like any other asset. The timeline file sits beside it as `<asset ID>-mic.timeline`. It starts
//! with the same ID, so it stays while the asset is in the page's table and goes with it.
//!
//! The page keeps a `recordings` entry (spec 5.6, reserved today) for each recording. The core keeps
//! that field as it is, so this module defines what goes in it. The order that keeps a crash from
//! losing a recording is:
//!
//! 1. Generate the IDs with [`RecordingPlan::generate`].
//! 2. Save the page with an entry in the `recording` state ([`RecordingEntry::starting`]) and an
//!    asset for each track with `state` set to `recording` ([`asset_entry`]).
//! 3. Start the recorder with [`RecordingPlan::start`]. Update the entry with the clock anchor.
//! 4. When the recording stops, save [`RecordingEntry::from_summary`] and the finished assets.
//!
//! If the app dies between 2 and 4, the page opens with an entry still in the `recording` state.
//! The app then calls `recover_recording` with [`RecordingPlan::from_entry`], and saves the result.

use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use opennote_core::format::names::{asset_file_name, check_asset_file_name};
use opennote_core::model::Asset;
use opennote_core::{AssetId, Clock as CoreClock, Id, Timestamp};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::audio::{
    AudioError, AudioSource, ClockAnchor, Pause, Recorder, Recording, RecordingSummary, Result, Timeline, TrackKind,
    TrackRef, TrackStart, TrackSummary, WallClock,
};

/// The media type of every track file.
pub const AUDIO_MIME: &str = "audio/ogg";

/// The IDs of one recording and its tracks, chosen before anything is written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordingPlan {
    pub id: String,
    pub tracks: Vec<TrackRef>,
}

impl RecordingPlan {
    /// New IDs for a recording with a track of each kind.
    pub fn generate(kinds: &[TrackKind], clock: &dyn CoreClock) -> Self {
        RecordingPlan {
            id: Id::generate(clock).to_string(),
            tracks: kinds
                .iter()
                .map(|&kind| TrackRef {
                    kind,
                    asset: AssetId::generate(clock).to_string(),
                })
                .collect(),
        }
    }

    /// The plan for an edit or a conversion that replaces a recording. It keeps the recording ID, so
    /// the flags, text marks, and listening place that name it still find it. Each track gets a new
    /// asset, since assets never change (spec 10.3). Use it for `keep`, `remove`, `trim_silence`,
    /// `compress`, and `enhance`, and for the first half of a `split`.
    pub fn replacing(summary: &RecordingSummary, clock: &dyn CoreClock) -> Self {
        RecordingPlan {
            id: summary.id.clone(),
            tracks: summary
                .tracks
                .iter()
                .map(|track| TrackRef {
                    kind: track.kind,
                    asset: AssetId::generate(clock).to_string(),
                })
                .collect(),
        }
    }

    /// The plan an entry describes, for recovery.
    pub fn from_entry(entry: &RecordingEntry) -> Self {
        RecordingPlan {
            id: entry.id.clone(),
            tracks: entry
                .tracks
                .iter()
                .map(|track| TrackRef {
                    kind: track.kind,
                    asset: track.asset.clone(),
                })
                .collect(),
        }
    }

    /// Starts the recorder on these tracks. `sources` must hold one source for each planned track.
    pub fn start(&self, recorder: &Recorder, sources: Vec<(TrackKind, Box<dyn AudioSource>)>) -> Result<Recording> {
        let mut tracks = Vec::new();
        for (kind, source) in sources {
            let planned = self.tracks.iter().find(|track| track.kind == kind);
            let track = planned.ok_or_else(|| AudioError::Format("The plan has no such track.".into()))?;
            audio_file_name(&track.asset, kind)?;
            tracks.push(TrackStart::new(kind, track.asset.clone(), source));
        }
        recorder.start(&self.id, tracks)
    }
}

/// The file name of a track's audio, checked against the rules for asset names (spec 10.1).
pub fn audio_file_name(asset: &str, kind: TrackKind) -> Result<String> {
    let id = AssetId::parse(asset).map_err(|error| AudioError::Format(format!("\"{asset}\": {error}")))?;
    let name = asset_file_name(id, &format!("{}.ogg", kind.stem()), AUDIO_MIME);
    if !check_asset_file_name(id, &name) {
        return Err(AudioError::Format(format!(
            "\"{name}\" is not a valid asset file name."
        )));
    }
    Ok(name)
}

/// Lets the recorder use the app's session clock, which the format spec anchors to a monotonic clock
/// once, as its wall clock.
pub fn wall_clock(clock: Arc<dyn CoreClock>) -> Arc<dyn WallClock> {
    struct Adapter(Arc<dyn CoreClock>);
    impl WallClock for Adapter {
        fn unix_ms(&self) -> i64 {
            self.0.now().unix_ms()
        }
    }
    Arc::new(Adapter(clock))
}

/// Whether a recording is still being written.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordingState {
    /// The audio files are growing, or a crash stopped them before anyone closed them.
    Recording,
    Complete,
    /// A crash cut the recording off and recovery closed its files.
    Recovered,
}

/// One track in a page's `recordings` entry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackEntry {
    pub kind: TrackKind,
    pub asset: String,
    pub timeline: Timeline,
    #[serde(default)]
    pub silence_frames: u64,
    #[serde(default)]
    pub dropped_packets: u64,
}

/// An item of a page's `recordings` array. The fields the screens add, such as flags and the place
/// where listening stopped, ride along in `extra` and survive every update.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingEntry {
    pub id: String,
    pub state: RecordingState,
    /// When recording started, as a timestamp in the form of spec 2.5.
    pub started: String,
    /// Absent until the recorder has started and reported its anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clock: Option<ClockAnchor>,
    #[serde(default)]
    pub started_ns: u64,
    #[serde(default)]
    pub ended_ns: u64,
    #[serde(default)]
    pub pauses: Vec<Pause>,
    pub tracks: Vec<TrackEntry>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl RecordingEntry {
    /// The entry to save before recording starts.
    pub fn starting(plan: &RecordingPlan, started: Timestamp) -> Self {
        RecordingEntry {
            id: plan.id.clone(),
            state: RecordingState::Recording,
            started: started.to_rfc3339(),
            clock: None,
            started_ns: 0,
            ended_ns: 0,
            pauses: Vec::new(),
            tracks: plan
                .tracks
                .iter()
                .map(|track| TrackEntry {
                    kind: track.kind,
                    asset: track.asset.clone(),
                    timeline: Timeline::default(),
                    silence_frames: 0,
                    dropped_packets: 0,
                })
                .collect(),
            extra: Map::new(),
        }
    }

    /// The entry for a stopped or recovered recording. `extra` carries over from `previous`, the entry
    /// saved when recording started.
    pub fn from_summary(summary: &RecordingSummary, previous: Option<&RecordingEntry>) -> Self {
        let started = Timestamp::from_unix_ms(summary.clock.unix_ms_at(summary.started_ns));
        RecordingEntry {
            id: summary.id.clone(),
            state: if summary.recovered {
                RecordingState::Recovered
            } else {
                RecordingState::Complete
            },
            started: started.to_rfc3339(),
            clock: Some(summary.clock),
            started_ns: summary.started_ns,
            ended_ns: summary.ended_ns,
            pauses: summary.pauses.clone(),
            tracks: summary
                .tracks
                .iter()
                .map(|track| TrackEntry {
                    kind: track.kind,
                    asset: track.asset.clone(),
                    timeline: track.timeline.clone(),
                    silence_frames: track.silence_frames,
                    dropped_packets: track.dropped_packets,
                })
                .collect(),
            extra: previous.map(|entry| entry.extra.clone()).unwrap_or_default(),
        }
    }

    /// The JSON for the page's `recordings` array.
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// The summary that playback and the timestamp map work from. It fails for a recording that has no
    /// clock anchor yet.
    pub fn summary(&self) -> Result<RecordingSummary> {
        let clock = self
            .clock
            .ok_or_else(|| AudioError::Corrupt("This recording has no clock anchor yet.".into()))?;
        let tracks: Result<Vec<TrackSummary>> = self
            .tracks
            .iter()
            .map(|track| {
                let audio_file = audio_file_name(&track.asset, track.kind)?;
                Ok(TrackSummary {
                    kind: track.kind,
                    asset: track.asset.clone(),
                    timeline_file: Path::new(&audio_file)
                        .with_extension("timeline")
                        .to_string_lossy()
                        .into_owned(),
                    audio_file,
                    timeline: track.timeline.clone(),
                    dropped_packets: track.dropped_packets,
                    silence_frames: track.silence_frames,
                })
            })
            .collect();
        Ok(RecordingSummary {
            id: self.id.clone(),
            started_ns: self.started_ns,
            ended_ns: self.ended_ns,
            clock,
            pauses: self.pauses.clone(),
            tracks: tracks?,
            recovered: self.state == RecordingState::Recovered,
        })
    }
}

/// The asset table entry for a track's audio file in `assets_dir`. While the file grows, its size is
/// the size so far and its hash is the hash of nothing, and the entry's `state` says `recording`. The
/// core's checks of size and hash skip such an entry, so the page saves before the file exists and
/// while it grows. Once the recording is closed the entry carries the real size and hash, and has no
/// `state`.
pub fn asset_entry(assets_dir: &Path, track: &TrackRef, created: Timestamp, growing: bool) -> Result<Asset> {
    let file = audio_file_name(&track.asset, track.kind)?;
    let id = AssetId::parse(&track.asset).map_err(|error| AudioError::Format(error.to_string()))?;
    let (bytes, sha256) = if growing {
        let bytes = std::fs::metadata(assets_dir.join(&file)).map_or(0, |meta| meta.len());
        (bytes, Sha256::digest([]).into())
    } else {
        digest(&assets_dir.join(&file))?
    };
    let mut extra = Map::new();
    if growing {
        extra.insert("state".into(), Value::String("recording".into()));
    }
    Ok(Asset {
        id,
        file,
        mime: AUDIO_MIME.to_owned(),
        bytes,
        sha256,
        name: format!("{}.ogg", track.kind.stem()),
        width: None,
        height: None,
        created,
        extra,
    })
}

/// An asset as `page.json` writes it (spec 10.2), including the `state` of a recording that is still
/// being written. The core's own writer produces the same keys, with the asset's ID as the table key.
pub fn asset_json(asset: &Asset) -> Value {
    let mut object = Map::new();
    object.insert("id".into(), Value::String(asset.id.to_string()));
    object.insert("file".into(), Value::String(asset.file.clone()));
    object.insert("mime".into(), Value::String(asset.mime.clone()));
    object.insert("bytes".into(), Value::from(asset.bytes));
    object.insert("sha256".into(), Value::String(asset.sha256_hex()));
    object.insert("name".into(), Value::String(asset.name.clone()));
    object.insert("created".into(), Value::String(asset.created.to_rfc3339()));
    object.extend(asset.extra.clone());
    Value::Object(object)
}

/// The size and SHA-256 hash of a file.
fn digest(path: &Path) -> Result<(u64, [u8; 32])> {
    let mut file = File::open(path)?;
    let (mut hasher, mut buffer, mut bytes) = (Sha256::new(), vec![0u8; 64 * 1024], 0u64);
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            return Ok((bytes, hasher.finalize().into()));
        }
        hasher.update(&buffer[..count]);
        bytes += count as u64;
    }
}
