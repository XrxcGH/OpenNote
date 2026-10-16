//! The command surface for the app: what the Tauri layer will call, as plain methods with JSON types.
//!
//! One [`AudioService`] holds at most one running recording and one open playback. Each method here
//! becomes one command, and the TypeScript client in `app/src/core/audio` has a method of the same
//! name. Everything that crosses the boundary is `serde` data in camelCase.
//!
//! Recording takes two steps, so a crash can't leave audio that no page knows about. [`prepare`]
//! chooses the IDs and returns the page entry and the assets, and the app saves them. Only then does
//! [`begin`] open the devices and create the files. If `begin` fails, its error names the entry and
//! the assets that the page saved for nothing, and the page removes them.
//!
//! [`prepare`]: AudioService::prepare
//! [`begin`]: AudioService::begin

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::{Clock as CoreClock, Timestamp};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::audio::encoder::EncoderFactory;
use crate::audio::{
    resolve, AudioError, AudioSource, Clock, ClockAnchor, DeviceCatalog, DeviceInfo, Direction, Environment, Guard,
    KeepAwake, Options, Recorder, Recording, RecordingSummary, Resolution, Result, TrackKind, TrackLevel, TrackRef,
};
use crate::audio::{StopReason, Stopped, TrackFailure, Warning};
use crate::layout::{asset_entry, asset_json, RecordingEntry, RecordingPlan};
use crate::playback::{AudioOutput, DecoderFactory};

mod playback;
#[cfg(windows)]
mod system;

pub use crate::playback::session::Status as PlaybackStatus;
pub use playback::PlaybackInfo;
#[cfg(windows)]
pub use system::SystemDevices;

/// Makes the sources and outputs for real or for test devices.
pub trait DeviceFactory: Send + Sync {
    /// A microphone by its catalog ID, or the default for `None`.
    fn microphone(&self, id: Option<&str>) -> Result<Box<dyn AudioSource>>;

    /// System audio from the output device with this ID, or the default for `None`.
    fn system_audio(&self, id: Option<&str>) -> Result<Box<dyn AudioSource>>;

    /// A playback device by its catalog ID, or the default for `None`.
    fn output(&self, id: Option<&str>) -> Result<Box<dyn AudioOutput>>;
}

/// Everything the service depends on, so tests can replace each part.
#[derive(Clone)]
pub struct Services {
    pub catalog: Arc<dyn DeviceCatalog>,
    pub environment: Arc<dyn Environment>,
    pub devices: Arc<dyn DeviceFactory>,
    /// The capture clock.
    pub clock: Arc<dyn Clock>,
    /// The app's session clock, which gives Unix times and makes IDs.
    pub session: Arc<dyn CoreClock>,
    pub encoder: EncoderFactory,
    pub decoder: DecoderFactory,
    pub options: Options,
}

/// What the person asks for when they press record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    /// The page's `assets` folder.
    pub assets_dir: PathBuf,
    /// The microphone's ID from the device list, or none for the default.
    pub microphone: Option<String>,
    /// Whether to record system audio too, for meetings.
    pub system_audio: bool,
    /// The output device whose sound to record, or none for the default.
    pub system_device: Option<String>,
}

/// What the page must save before recording begins.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub entry: RecordingEntry,
    /// The asset table entries to add, as `page.json` writes them.
    pub assets: Vec<Value>,
    /// The devices that were chosen. A saved choice that is gone falls back to the default.
    pub microphone: Resolution,
    pub system_audio: Option<Resolution>,
}

impl Prepared {
    /// What the page removes if this recording never begins.
    pub fn discard(&self) -> Discard {
        Discard {
            entry: self.entry.id.clone(),
            assets: self.entry.tracks.iter().map(|track| track.asset.clone()).collect(),
        }
    }
}

/// The `recordings` entry and the asset table entries of a recording that never began.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discard {
    /// The ID of the `recordings` entry.
    pub entry: String,
    /// The IDs of the assets.
    pub assets: Vec<String>,
}

/// Why [`AudioService::begin`] failed, and what the page saved for the recording that now never begins.
#[derive(Debug)]
pub struct BeginFailed {
    pub error: AudioError,
    /// What to remove from the page. `None` when nothing was prepared.
    pub discard: Option<Discard>,
}

impl fmt::Display for BeginFailed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(f)
    }
}

impl std::error::Error for BeginFailed {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.error)
    }
}

impl From<BeginFailed> for AudioError {
    fn from(failed: BeginFailed) -> Self {
        failed.error
    }
}

/// What the screen shows while recording.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub paused: bool,
    /// Capture time now, and the matching Unix time, for stamping strokes and text.
    pub now: ClockReading,
    pub bytes: u64,
    pub levels: Vec<TrackLevel>,
    pub warnings: Vec<Warning>,
    /// Set when recording should stop now. The screen calls [`AudioService::stop`] and shows a notice.
    pub stop: Option<StopReason>,
}

/// Both clocks, read together.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockReading {
    pub capture_ns: u64,
    pub unix_ms: i64,
}

/// What the page saves when recording ends.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finished {
    pub entry: RecordingEntry,
    pub assets: Vec<Value>,
    pub summary: RecordingSummary,
    /// The tracks whose writer failed while recording. The audio written before then is kept, and
    /// the entry is marked recovered.
    #[serde(default)]
    pub failures: Vec<TrackFailure>,
}

struct Active {
    recording: Recording,
    plan: RecordingPlan,
    entry: RecordingEntry,
    guard: Guard,
    _awake: KeepAwake,
    dir: PathBuf,
}

struct Pending {
    plan: RecordingPlan,
    request: StartRequest,
    /// The device IDs to open, or none to follow the default.
    microphone: Option<String>,
    system: Option<String>,
}

pub struct AudioService {
    services: Services,
    pending: Option<Pending>,
    active: Option<Active>,
    playback: Option<playback::Open>,
}

fn busy() -> AudioError {
    AudioError::Format("A recording is already running.".into())
}

impl AudioService {
    pub fn new(services: Services) -> Self {
        AudioService {
            services,
            pending: None,
            active: None,
            playback: None,
        }
    }

    /// The input and output devices that are present now.
    pub fn devices(&self) -> Result<Vec<DeviceInfo>> {
        self.services.catalog.list()
    }

    /// Both clocks, read together. The interface compares its own clock with this one to stamp strokes
    /// and text on the capture clock.
    pub fn clock(&self) -> ClockReading {
        ClockReading {
            capture_ns: self.services.clock.now_ns(),
            unix_ms: self.services.session.now().unix_ms(),
        }
    }

    /// Chooses the devices and IDs, and returns what the page must save before [`AudioService::begin`].
    pub fn prepare(&mut self, request: StartRequest) -> Result<Prepared> {
        if self.active.is_some() {
            return Err(busy());
        }
        let catalog = self.services.catalog.as_ref();
        let microphone = resolve(catalog, Direction::Input, request.microphone.as_deref())?;
        let system = request
            .system_audio
            .then(|| resolve(catalog, Direction::Output, request.system_device.as_deref()))
            .transpose()?;
        let mut kinds = vec![TrackKind::Microphone];
        kinds.extend(system.as_ref().map(|_| TrackKind::SystemAudio));
        let plan = RecordingPlan::generate(&kinds, self.services.session.as_ref());
        let now = self.services.session.now();
        let entry = RecordingEntry::starting(&plan, now);
        let assets = assets_of(&request.assets_dir, &plan.tracks, now, true)?;
        self.pending = Some(Pending {
            plan,
            microphone: pinned(request.microphone.as_deref(), &microphone),
            system: system
                .as_ref()
                .and_then(|resolution| pinned(request.system_device.as_deref(), resolution)),
            request,
        });
        Ok(Prepared {
            entry,
            assets,
            microphone,
            system_audio: system,
        })
    }

    /// Opens the devices and starts writing the files that [`AudioService::prepare`] planned. The
    /// returned entry has the clock anchor, and is the one to save. If it fails, no file is left
    /// behind, and the error says which entry and assets the page should remove.
    pub fn begin(&mut self) -> std::result::Result<RecordingEntry, BeginFailed> {
        let pending = self.pending.take().ok_or_else(|| BeginFailed {
            error: AudioError::Format("Prepare a recording before beginning it.".into()),
            discard: None,
        })?;
        let discard = Discard {
            entry: pending.plan.id.clone(),
            assets: pending.plan.tracks.iter().map(|track| track.asset.clone()).collect(),
        };
        self.start(pending).map_err(|error| BeginFailed {
            error,
            discard: Some(discard),
        })
    }

    fn start(&mut self, pending: Pending) -> Result<RecordingEntry> {
        let services = &self.services;
        let mut sources: Vec<(TrackKind, Box<dyn AudioSource>)> = vec![(
            TrackKind::Microphone,
            services.devices.microphone(pending.microphone.as_deref())?,
        )];
        if pending.request.system_audio {
            sources.push((
                TrackKind::SystemAudio,
                services.devices.system_audio(pending.system.as_deref())?,
            ));
        }
        let dir = pending.request.assets_dir.clone();
        let recorder = Recorder::new(&dir)
            .with_clock(Arc::clone(&services.clock))
            .with_wall_clock(crate::layout::wall_clock(Arc::clone(&services.session)))
            .with_options(services.options)
            .with_encoder(Arc::clone(&services.encoder));
        let recording = pending.plan.start(&recorder, sources)?;
        let mut entry =
            RecordingEntry::starting(&pending.plan, Timestamp::from_unix_ms(recording.clock_anchor().unix_ms));
        entry.clock = Some(recording.clock_anchor());
        entry.started_ns = recording.now_ns();
        self.active = Some(Active {
            guard: Guard::new(&dir, Arc::clone(&services.environment)),
            recording,
            plan: pending.plan,
            entry: entry.clone(),
            _awake: KeepAwake::new(),
            dir,
        });
        Ok(entry)
    }

    fn active(&mut self) -> Result<&mut Active> {
        self.active
            .as_mut()
            .ok_or_else(|| AudioError::Format("No recording is running.".into()))
    }

    /// The level meters, the warnings, and the clocks, for the recording indicator.
    pub fn recording_status(&mut self) -> Result<RecordingStatus> {
        let now = self.clock();
        let active = self.active()?;
        let status = active.guard.check(&active.recording);
        Ok(RecordingStatus {
            paused: active.recording.is_paused(),
            now,
            bytes: active.recording.bytes_on_disk(),
            levels: active.recording.levels(),
            warnings: status.warnings,
            stop: status.stop,
        })
    }

    pub fn pause_recording(&mut self) -> Result<()> {
        self.active()?.recording.pause()
    }

    pub fn resume_recording(&mut self) -> Result<()> {
        self.active()?.recording.resume()
    }

    /// Records from another microphone from now on, in the same file. A device that is gone falls
    /// back to the default, and the result says so. With no ID, the track follows the default.
    pub fn switch_microphone(&mut self, id: Option<String>) -> Result<Resolution> {
        let resolution = resolve(self.services.catalog.as_ref(), Direction::Input, id.as_deref())?;
        let source = self
            .services
            .devices
            .microphone(pinned(id.as_deref(), &resolution).as_deref())?;
        self.active()?.recording.switch_source(TrackKind::Microphone, source)?;
        Ok(resolution)
    }

    /// Records the sound of another output device from now on, in the same file, as when the guard
    /// says the system now plays elsewhere. With no ID, the track follows the default output.
    pub fn switch_system_audio(&mut self, id: Option<String>) -> Result<Resolution> {
        let resolution = resolve(self.services.catalog.as_ref(), Direction::Output, id.as_deref())?;
        let source = self
            .services
            .devices
            .system_audio(pinned(id.as_deref(), &resolution).as_deref())?;
        self.active()?.recording.switch_source(TrackKind::SystemAudio, source)?;
        Ok(resolution)
    }

    /// Stops recording, closes the files, and returns what the page saves.
    pub fn stop(&mut self) -> Result<Finished> {
        let active = self
            .active
            .take()
            .ok_or_else(|| AudioError::Format("No recording is running.".into()))?;
        let created = self.services.session.now();
        let Stopped { summary, failures } = active.recording.stop_reporting()?;
        let entry = RecordingEntry::from_summary(&summary, Some(&active.entry));
        let assets = assets_of(&active.dir, &present(&active.plan.tracks, &summary), created, false)?;
        Ok(Finished {
            entry,
            assets,
            summary,
            failures,
        })
    }

    /// Restores a recording that a crash cut off. The page calls this when it opens with an entry
    /// still in the `recording` state, and saves what it returns. The recording that is running, or
    /// prepared to begin, is in that state too, and is refused: its files are still being written.
    pub fn recover(&self, assets_dir: &Path, entry: &RecordingEntry) -> Result<Finished> {
        if self.is_running(&entry.id) {
            return Err(AudioError::Format(format!(
                "Recording {} is still running. Its entry is saved when it stops.",
                entry.id
            )));
        }
        let plan = RecordingPlan::from_entry(entry);
        let recovered = crate::audio::recovery::recover_recording(assets_dir, &plan.id, &plan.tracks)?;
        let created = self.services.session.now();
        Ok(Finished {
            entry: RecordingEntry::from_summary(&recovered.summary, Some(entry)),
            assets: assets_of(assets_dir, &present(&plan.tracks, &recovered.summary), created, false)?,
            summary: recovered.summary,
            failures: Vec::new(),
        })
    }

    /// Whether `id` is the recording that is running, or the one prepared to begin. A page that opens with an
    /// entry still in the `recording` state asks this first: in another window, that entry is the live recording.
    pub fn is_running(&self, id: &str) -> bool {
        let active = self.active.as_ref().map(|active| active.plan.id.as_str());
        let pending = self.pending.as_ref().map(|pending| pending.plan.id.as_str());
        active == Some(id) || pending == Some(id)
    }

    /// The clock anchor of the running recording, which strokes use to find their audio.
    pub fn anchor(&mut self) -> Result<ClockAnchor> {
        Ok(self.active()?.recording.clock_anchor())
    }
}

/// The device ID to open for a choice: the one the person asked for when it is there, or none, which
/// follows the system's default as it changes. A device that is gone gets the default instead.
fn pinned(asked: Option<&str>, resolution: &Resolution) -> Option<String> {
    asked
        .filter(|_| !resolution.fell_back)
        .map(|_| resolution.device.id.clone())
}

/// The planned tracks that the summary kept.
fn present(tracks: &[TrackRef], summary: &RecordingSummary) -> Vec<TrackRef> {
    tracks
        .iter()
        .filter(|track| summary.tracks.iter().any(|saved| saved.asset == track.asset))
        .cloned()
        .collect()
}

fn assets_of(dir: &Path, tracks: &[TrackRef], created: Timestamp, growing: bool) -> Result<Vec<Value>> {
    tracks
        .iter()
        .map(|track| asset_entry(dir, track, created, growing).map(|asset| asset_json(&asset)))
        .collect()
}
