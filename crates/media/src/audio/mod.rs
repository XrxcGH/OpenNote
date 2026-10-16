//! Audio recording, as ADR 0007 decided it.
//!
//! A recording has one track for each source: the microphone, and optionally system audio. The path
//! from a source to a file is:
//!
//! 1. The source's callback copies samples into a lock-free ring ([`ring`]) with the capture time of
//!    each packet. It never waits.
//!
//! 2. A writer thread ([`worker`]) reads the ring, converts to 48 kHz mono ([`resample`]), places each
//!    packet on the track's timeline ([`track_clock`]), and fills short gaps with silence.
//!
//! 3. The track writer ([`writer`]) encodes 20 ms frames and writes them as Ogg pages ([`ogg`]). Each
//!    page holds at most half a second and is written and synced as it fills.
//!
//! 4. The timeline ([`timeline`]) maps frame counts to capture-clock times, so a stroke's timestamp
//!    finds its audio. It is saved beside the audio as it grows, so [`recovery`] can restore both
//!    after a crash.
//!
//! [`Recorder`] starts recordings, and a [`Recording`] can pause, resume, and stop.
//!
//! Sources implement [`AudioSource`]. The cpal microphone and loopback sources live in `device`, on
//! Windows. The generated sources in [`synthetic`] let tests run without a microphone.

pub mod catalog;
pub mod clock;
#[cfg(windows)]
pub mod device;
#[cfg(windows)]
pub mod device_catalog;
pub mod encoder;
pub mod environment;
pub mod error;
pub mod files;
pub mod guard;
pub mod level;
pub mod ogg;
pub mod recording;
pub mod recovery;
pub mod resample;
pub mod ring;
pub mod source;
pub mod summary;
pub mod synthetic;
pub mod tap;
pub mod timeline;
mod track;
pub mod track_clock;

#[cfg(feature = "opus")]
pub(crate) mod opus_encoder;
mod worker;
mod writer;

pub use catalog::{resolve, DeviceCatalog, DeviceInfo, Direction, FixedCatalog, Resolution};
pub use clock::{Clock, ClockAnchor, SystemClock, SystemWallClock, WallClock};
pub use environment::{Battery, Environment, KeepAwake, SystemEnvironment};
pub use error::{AudioError, Result};
pub use files::{TrackFiles, TrackKind, TrackRef};
pub use guard::{Guard, StopReason, Thresholds, Warning};
pub use level::{Level, Meter};
pub use recording::{Recorder, Recording, Stopped, TrackStart};
pub use source::{AudioSource, DeviceState, SourceFormat};
pub use summary::{Pause, RecordingSummary, TrackFailure, TrackHealth, TrackLevel, TrackSummary, TrackWatch};
pub use tap::{PcmTap, TapFactory};
pub use timeline::{Anchor, Timeline};

use track_clock::ClockConfig;

/// Every track is stored as 48 kHz mono, the rate Opus works at best.
pub const TRACK_RATE: u32 = 48_000;
/// Samples in one 20 ms Opus frame at the track rate.
pub const FRAME_SAMPLES: usize = 960;

/// How a recording behaves. The defaults follow ADR 0007.
#[derive(Clone, Copy, Debug)]
pub struct Options {
    /// The most audio in one Ogg page, in milliseconds. It counts in whole frames, from 20 ms to
    /// 1,000 ms. A crash loses the page in progress, so this and the ring's latency set the loss.
    pub page_ms: u32,
    /// How long a source may go quiet before the frames waiting in a page are written anyway.
    pub idle_flush_ms: u32,
    /// How much audio the ring buffer holds for each track, in seconds.
    pub ring_seconds: u32,
    /// How gaps and drift are handled.
    pub clock: ClockConfig,
    /// Whether to ask the operating system to write each page to the disk, not just to its cache.
    pub sync: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            page_ms: 500,
            idle_flush_ms: 250,
            ring_seconds: 10,
            clock: ClockConfig {
                tolerance_ns: 15_000_000,
                max_fill_ns: 10_000_000_000,
                frame_samples: FRAME_SAMPLES as u64,
            },
            sync: true,
        }
    }
}

impl Options {
    /// Frames in a full page.
    pub fn page_frames(&self) -> usize {
        (self.page_ms.clamp(20, 1_000) / 20) as usize
    }
}
