//! Recordings: starting, pausing, resuming, and stopping the tracks of one recording.
//!
//! A page can hold several recordings, each with its own ID and files. Start a new one with
//! [`Recorder::start`] after the last one stops. A recording's summary has what the note file needs:
//! the files, each track's timeline, the pauses, and the anchor between the capture clock and the
//! Unix time that strokes carry.

use std::path::PathBuf;
use std::sync::Arc;

use super::clock::{Clock, ClockAnchor, SystemClock, SystemWallClock, WallClock};
use super::encoder::{opus_factory, EncoderFactory};
use super::files::{TrackFiles, TrackKind};
use super::level::Meter;
use super::ring::{packet_channel, SinkHandle, TrackStats};
use super::source::{AudioSource, IdleSource, SourceFormat};
use super::summary::{Pause, RecordingSummary, TrackFailure, TrackHealth, TrackLevel, TrackWatch};
use super::tap::TapFactory;
use super::track::{abandon, ActiveTrack};
use super::worker::{self, Control, Parts};
use super::writer::TrackWriter;
use super::{AudioError, Options, Result};

/// A source, the kind of track it records, and the ID of the asset that will hold the track's audio.
pub struct TrackStart {
    pub kind: TrackKind,
    pub asset: String,
    pub source: Box<dyn AudioSource>,
}

impl TrackStart {
    pub fn new(kind: TrackKind, asset: impl Into<String>, source: Box<dyn AudioSource>) -> Self {
        TrackStart {
            kind,
            asset: asset.into(),
            source,
        }
    }
}

/// Starts recordings in one folder, usually a page's assets folder.
#[derive(Clone)]
pub struct Recorder {
    dir: PathBuf,
    clock: Arc<dyn Clock>,
    wall: Arc<dyn WallClock>,
    options: Options,
    encoder: EncoderFactory,
    tap: Option<TapFactory>,
}

impl Recorder {
    /// A recorder with the real clocks, the default options, and the Opus encoder.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Recorder {
            dir: dir.into(),
            clock: Arc::new(SystemClock),
            wall: Arc::new(SystemWallClock),
            options: Options::default(),
            encoder: opus_factory(),
            tap: None,
        }
    }

    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    /// The wall clock that anchors the capture clock to Unix time. Pass the app's session clock.
    pub fn with_wall_clock(mut self, wall: Arc<dyn WallClock>) -> Self {
        self.wall = wall;
        self
    }

    pub fn with_options(mut self, options: Options) -> Self {
        self.options = options;
        self
    }

    pub fn with_encoder(mut self, encoder: EncoderFactory) -> Self {
        self.encoder = encoder;
        self
    }

    /// Lets other code listen to each track as it is written.
    pub fn with_tap(mut self, tap: TapFactory) -> Self {
        self.tap = Some(tap);
        self
    }

    /// Starts recording `tracks`, one file each, named after the tracks' assets. It fails, leaving
    /// nothing behind, if a file exists or a source can't start.
    pub fn start(&self, id: &str, tracks: Vec<TrackStart>) -> Result<Recording> {
        let kinds: Vec<TrackKind> = tracks.iter().map(|track| track.kind).collect();
        if kinds.is_empty()
            || kinds
                .iter()
                .enumerate()
                .any(|(index, kind)| kinds[..index].contains(kind))
        {
            return Err(AudioError::Format(
                "A recording needs one source for each kind of track.".into(),
            ));
        }
        std::fs::create_dir_all(&self.dir)?;
        let anchor = ClockAnchor::now(self.clock.as_ref(), self.wall.as_ref());
        let mut active = Vec::new();
        for track in tracks {
            match self.open_track(track, anchor) {
                Ok(track) => active.push(track),
                Err(error) => return Err(abandon(active, error)),
            }
        }
        for index in 0..active.len() {
            if let Err(error) = active[index].start() {
                return Err(abandon(active, error));
            }
        }
        Ok(Recording {
            id: id.to_owned(),
            clock: Arc::clone(&self.clock),
            anchor,
            tracks: active,
            pauses: Vec::new(),
            started_ns: self.clock.now_ns(),
            paused_since: None,
        })
    }

    fn open_track(&self, start: TrackStart, anchor: ClockAnchor) -> Result<ActiveTrack> {
        let TrackStart { kind, asset, source } = start;
        let format = source.format();
        check_format(format)?;
        let files = TrackFiles::new(&self.dir, &asset, kind)?;
        let encoder = (self.encoder)()?;
        let stats = Arc::new(TrackStats::default());
        let writer = TrackWriter::create(&files, encoder, &self.options, Arc::clone(&stats), anchor)?;
        let capacity = format.rate as usize * self.options.ring_seconds.max(1) as usize;
        let (sink, reader) = packet_channel(format, capacity, Arc::clone(&stats));
        let meter = Arc::new(Meter::new(self.clock.now_ns()));
        let parts = Parts {
            reader,
            writer,
            control: Arc::new(Control::default()),
            meter: Arc::clone(&meter),
            tap: self.tap.as_ref().and_then(|make| make(kind)),
            rate: format.rate,
        };
        let worker = worker::spawn(parts, &self.options)?;
        Ok(ActiveTrack {
            kind,
            asset,
            files,
            source,
            sink: SinkHandle::new(sink),
            worker,
            stats,
            meter,
        })
    }
}

/// Whether the recorder can take audio in this format.
pub(super) fn check_format(format: SourceFormat) -> Result<()> {
    if format.channels == 0 || format.rate < 8_000 {
        return Err(AudioError::Format(format!(
            "{} Hz with {} channels",
            format.rate, format.channels
        )));
    }
    Ok(())
}

/// A recording in progress.
pub struct Recording {
    id: String,
    clock: Arc<dyn Clock>,
    anchor: ClockAnchor,
    tracks: Vec<ActiveTrack>,
    pauses: Vec<Pause>,
    started_ns: u64,
    paused_since: Option<u64>,
}

impl Recording {
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The pairing of the capture clock and Unix time that the recording started with.
    pub fn clock_anchor(&self) -> ClockAnchor {
        self.anchor
    }

    pub fn is_paused(&self) -> bool {
        self.paused_since.is_some()
    }

    /// The capture time now. Strokes and text changes are stamped on this clock.
    pub fn now_ns(&self) -> u64 {
        self.clock.now_ns()
    }

    /// Stops recording until [`Recording::resume`]. Audio captured before now is kept, and audio
    /// captured until the resume is left out.
    pub fn pause(&mut self) -> Result<()> {
        if self.is_paused() {
            return Ok(());
        }
        let now = self.clock.now_ns();
        self.paused_since = Some(now);
        let mut outcome = Ok(());
        for track in &mut self.tracks {
            track.worker.control().pause(now);
            outcome = outcome.and(track.source.set_paused(true));
        }
        outcome
    }

    /// Starts recording again. Each track's timeline gets a new stretch at the resume.
    pub fn resume(&mut self) -> Result<()> {
        let Some(since) = self.paused_since.take() else {
            return Ok(());
        };
        let now = self.clock.now_ns();
        self.pauses.push(Pause {
            paused_ns: since,
            resumed_ns: now.max(since),
        });
        let mut outcome = Ok(());
        for track in &mut self.tracks {
            track.worker.control().resume(now);
            track.meter.restart(now);
            outcome = outcome.and(track.source.set_paused(false));
        }
        outcome
    }

    /// Replaces the source of the `kind` track with `source`, for example when the person picks
    /// another microphone. Recording goes on in the same file. The short gap while the devices
    /// change becomes silence. If the new source can't start, the track records silence until a
    /// working source replaces it, and the error says why.
    pub fn switch_source(&mut self, kind: TrackKind, mut source: Box<dyn AudioSource>) -> Result<()> {
        let paused = self.is_paused();
        let now = self.clock.now_ns();
        let format = source.format();
        check_format(format)?;
        let track = self
            .tracks
            .iter_mut()
            .find(|track| track.kind == kind)
            .ok_or_else(|| AudioError::Format("This recording has no such track.".into()))?;
        track.source.stop();
        track.sink.set_format(format);
        track.meter.restart(now);
        if let Err(error) = source.start(track.sink.clone()) {
            track.source = Box::new(IdleSource(format));
            return Err(error);
        }
        if paused {
            source.set_paused(true)?;
        }
        track.source = source;
        Ok(())
    }

    /// Each track's counters, and why its writer stopped if it did.
    pub fn health(&self) -> Vec<TrackHealth> {
        let load = TrackStats::load;
        let health = |track: &ActiveTrack| TrackHealth {
            kind: track.kind,
            dropped_packets: load(&track.stats.dropped_packets),
            frames: load(&track.stats.frames),
            silence_frames: load(&track.stats.silence_frames),
            failure: track.worker.control().failure().or_else(|| {
                track
                    .worker
                    .is_finished()
                    .then(|| "The writer thread ended.".to_owned())
            }),
            device: track.source.device_state(),
        };
        self.tracks.iter().map(health).collect()
    }

    /// Each track's level since the last call, for a level meter. Call it a few times a second.
    pub fn levels(&self) -> Vec<TrackLevel> {
        let now = self.clock.now_ns();
        self.tracks
            .iter()
            .map(|track| TrackLevel {
                kind: track.kind,
                level: track.meter.snapshot(now),
            })
            .collect()
    }

    /// How long each track has been silent and idle. Unlike [`Recording::levels`], it can be called
    /// by more than one watcher.
    pub fn watch(&self) -> Vec<TrackWatch> {
        let now = self.clock.now_ns();
        self.tracks
            .iter()
            .map(|track| {
                let (silent_ms, idle_ms) = track.meter.timing(now);
                TrackWatch {
                    kind: track.kind,
                    silent_ms,
                    idle_ms,
                }
            })
            .collect()
    }

    /// The size of the audio files so far, which the guard uses to estimate the disk space needed.
    pub fn bytes_on_disk(&self) -> u64 {
        self.tracks
            .iter()
            .filter_map(|track| std::fs::metadata(&track.files.audio).ok())
            .map(|meta| meta.len())
            .sum()
    }

    /// Stops the sources, writes what is queued, closes the files, and returns the summary. A track
    /// whose writer failed is closed the way crash recovery closes it, and the summary is marked
    /// recovered. [`Recording::stop_reporting`] also says which tracks failed and why.
    pub fn stop(self) -> Result<RecordingSummary> {
        self.stop_reporting().map(|stopped| stopped.summary)
    }

    /// Like [`Recording::stop`], with the failures of the tracks whose writer stopped early. It fails
    /// only when no track's audio could be kept.
    pub fn stop_reporting(mut self) -> Result<Stopped> {
        let ended_ns = self.clock.now_ns();
        if let Some(since) = self.paused_since.take() {
            self.pauses.push(Pause {
                paused_ns: since,
                resumed_ns: ended_ns.max(since),
            });
        }
        let mut tracks = std::mem::take(&mut self.tracks);
        for track in &mut tracks {
            track.source.stop();
        }
        let mut summaries = Vec::new();
        let mut failures = Vec::new();
        for track in tracks {
            let (summary, failure) = track.finish();
            summaries.extend(summary);
            failures.extend(failure);
        }
        if summaries.is_empty() {
            let messages: Vec<String> = failures.into_iter().map(|failure| failure.message).collect();
            return Err(AudioError::Writer(messages.join(" ")));
        }
        let pauses = std::mem::take(&mut self.pauses);
        let started_ns = self.started_ns;
        let summary = RecordingSummary {
            id: std::mem::take(&mut self.id),
            started_ns,
            ended_ns,
            clock: self.anchor,
            pauses,
            tracks: summaries,
            recovered: !failures.is_empty(),
        };
        Ok(Stopped { summary, failures })
    }
}

/// What [`Recording::stop_reporting`] returns.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stopped {
    pub summary: RecordingSummary,
    /// The tracks whose writer failed before the stop. The summary keeps what each one wrote before
    /// then, unless the failure says it was lost.
    pub failures: Vec<TrackFailure>,
}

/// A recording dropped without `stop` still ends cleanly: its sources stop, and each writer closes
/// its file on its own thread.
impl Drop for Recording {
    fn drop(&mut self) {
        for track in &mut self.tracks {
            track.source.stop();
        }
    }
}
