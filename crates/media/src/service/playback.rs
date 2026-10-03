//! The playback commands of the service.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::AudioService;
use crate::audio::{AudioError, Result};
use crate::layout::RecordingEntry;
use crate::playback::open_recording;
use crate::playback::session::{PlaybackSession, Status};
use crate::positions::PositionMap;

/// An open playback.
pub(super) struct Open {
    session: PlaybackSession,
}

/// What the screen needs to show a recording that was opened. The map lets it turn the capture time
/// of a stroke into a position without asking again.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    pub recording: String,
    pub duration_ns: u64,
    pub map: PositionMap,
}

fn closed() -> AudioError {
    AudioError::Format("No recording is open for playback.".into())
}

impl AudioService {
    /// Opens a recording of the page for playback, paused at the start. `device` is the output
    /// device's ID from the device list, or none for the default. Any playback already open closes.
    pub fn open_playback(
        &mut self,
        assets_dir: &Path,
        entry: &RecordingEntry,
        device: Option<&str>,
    ) -> Result<PlaybackInfo> {
        self.playback = None;
        let summary = entry.summary()?;
        let player = open_recording(assets_dir, &summary, &self.services.decoder)?;
        let output = self.services.devices.output(device)?;
        let info = PlaybackInfo {
            recording: summary.id.clone(),
            duration_ns: player.duration_ns(),
            map: PositionMap::from_summary(&summary),
        };
        self.playback = Some(Open {
            session: PlaybackSession::start(player, output)?,
        });
        Ok(info)
    }

    fn session(&self) -> Result<&PlaybackSession> {
        self.playback.as_ref().map(|open| &open.session).ok_or_else(closed)
    }

    /// Plays from where playback is. After a pause it goes back two seconds first.
    pub fn play(&self) -> Result<()> {
        self.session().map(PlaybackSession::play)
    }

    pub fn pause_playback(&self) -> Result<()> {
        self.session().map(PlaybackSession::pause)
    }

    /// Jumps to a position in the recording's audio, such as the one a tap on a stroke names.
    pub fn seek(&self, position_ns: u64) -> Result<()> {
        self.session().map(|session| session.seek_ns(position_ns))
    }

    /// Jumps forward or back, as the ten-second skip keys do.
    pub fn skip(&self, delta_ns: i64) -> Result<()> {
        self.session().map(|session| session.skip_ns(delta_ns))
    }

    /// Sets the speed from 0.5 to 3, without changing the pitch.
    pub fn set_speed(&self, speed: f32) -> Result<()> {
        self.session().map(|session| session.set_speed(speed))
    }

    pub fn set_skip_silence(&self, on: bool) -> Result<()> {
        self.session().map(|session| session.set_skip_silence(on))
    }

    /// The state, position, and speed, for the player controls and the moving highlight.
    pub fn playback_status(&self) -> Result<Status> {
        self.session().map(PlaybackSession::status)
    }

    /// Stops playback and frees the device.
    pub fn close_playback(&mut self) {
        self.playback = None;
    }
}
