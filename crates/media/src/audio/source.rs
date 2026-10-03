//! The interface between the recorder and whatever produces audio.
//!
//! The microphone and WASAPI loopback are sources, and so are the generated signals that tests use.
//! Porting to another platform means writing another source.

use super::ring::SinkHandle;
use super::Result;

/// The format a source delivers, which is the device's own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourceFormat {
    pub rate: u32,
    pub channels: u16,
}

/// What a source knows about its device, for the recording guard.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DeviceState {
    /// The device is gone, and the source waits for it, or for a new default, to come back. The track
    /// records silence meanwhile.
    pub lost: bool,
    /// The source records a device the person picked, which was the system's default when recording
    /// began and no longer is. For system audio, the sound now plays through another device.
    pub not_default: bool,
}

/// Something that produces audio packets.
pub trait AudioSource: Send {
    /// The format of the packets when the source starts. A source whose device changes later tells
    /// the sink the new format with [`SinkHandle::set_format`] before it delivers in it.
    fn format(&self) -> SourceFormat;

    /// Starts delivering packets to `sink`, each stamped with the capture time of its first frame on
    /// the capture clock. Delivery happens on the source's own thread, which must never wait.
    fn start(&mut self, sink: SinkHandle) -> Result<()>;

    /// Stops or restarts delivery. The recorder also ignores packets captured while paused, so a
    /// source that can't pause its stream may keep running.
    fn set_paused(&mut self, paused: bool) -> Result<()>;

    /// Stops the source for good. No packet arrives after this returns.
    fn stop(&mut self);

    /// Whether the device is there, and still the one the system uses.
    fn device_state(&self) -> DeviceState {
        DeviceState::default()
    }
}

/// A source that delivers nothing. When a new source fails to start after a switch, a recording puts
/// this in the track. The track keeps its place and records silence until another source replaces it.
pub struct IdleSource(pub SourceFormat);

impl AudioSource for IdleSource {
    fn format(&self) -> SourceFormat {
        self.0
    }

    fn start(&mut self, _sink: SinkHandle) -> Result<()> {
        Ok(())
    }

    fn set_paused(&mut self, _paused: bool) -> Result<()> {
        Ok(())
    }

    fn stop(&mut self) {}
}
