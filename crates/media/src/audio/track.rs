//! A track while it records: its source, its ring, its writer thread, and its files.

use std::path::PathBuf;
use std::sync::Arc;

use super::files::{TrackFiles, TrackKind};
use super::level::Meter;
use super::recovery::recover_track;
use super::ring::{SinkHandle, TrackStats};
use super::source::AudioSource;
use super::summary::{TrackFailure, TrackSummary};
use super::timeline::Timeline;
use super::worker::Worker;
use super::{AudioError, Result};

/// A track while it records.
pub(super) struct ActiveTrack {
    pub(super) kind: TrackKind,
    pub(super) asset: String,
    pub(super) files: TrackFiles,
    pub(super) source: Box<dyn AudioSource>,
    pub(super) sink: SinkHandle,
    pub(super) worker: Worker,
    pub(super) stats: Arc<TrackStats>,
    pub(super) meter: Arc<Meter>,
}

impl ActiveTrack {
    pub(super) fn start(&mut self) -> Result<()> {
        self.source.start(self.sink.clone())
    }

    /// Drains the ring and closes the files. If the writer failed, the files are closed the way crash
    /// recovery closes them, which keeps the audio written before the failure. The failure comes back
    /// beside the summary. The summary is missing only when not even that could be done.
    pub(super) fn finish(self) -> (Option<TrackSummary>, Option<TrackFailure>) {
        let ActiveTrack {
            kind,
            asset,
            files,
            worker,
            stats,
            ..
        } = self;
        let summary = |timeline: Timeline| {
            let name = |path: &PathBuf| {
                path.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            };
            TrackSummary {
                kind,
                asset: asset.clone(),
                audio_file: name(&files.audio),
                timeline_file: name(&files.timeline),
                timeline,
                dropped_packets: TrackStats::load(&stats.dropped_packets),
                silence_frames: TrackStats::load(&stats.silence_frames),
            }
        };
        let error = match worker.finish() {
            Ok(timeline) => return (Some(summary(timeline)), None),
            Err(error) => error,
        };
        match recover_track(&files) {
            Ok(recovered) => (
                Some(summary(recovered.timeline)),
                Some(TrackFailure {
                    kind,
                    message: error.to_string(),
                    saved: true,
                }),
            ),
            Err(also) => (
                None,
                Some(TrackFailure {
                    kind,
                    message: format!("{error} Closing the file failed too: {also}"),
                    saved: false,
                }),
            ),
        }
    }
}

/// Stops tracks that were only partly started, deletes their files, and passes the error on.
pub(super) fn abandon(tracks: Vec<ActiveTrack>, error: AudioError) -> AudioError {
    for mut track in tracks {
        track.source.stop();
        let files = track.files.clone();
        let _ = track.worker.finish();
        let _ = std::fs::remove_file(files.audio);
        let _ = std::fs::remove_file(files.timeline);
    }
    error
}
