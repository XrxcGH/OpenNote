//! Helpers for the recording tests: a recorder that uses the stand-in encoder, and a reader that
//! checks a file with the independent `ogg` crate.

#![allow(dead_code)]

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opennote_media::audio::ogg::{scan_pages, PageInfo, FLAG_EOS};
use opennote_media::audio::recording::Recorder;
use opennote_media::audio::synthetic::{level_factory, level_of, ManualClock, LEVEL_PRE_SKIP};
use opennote_media::audio::Options;

/// One second in nanoseconds.
pub const SECOND: u64 = 1_000_000_000;

/// What a stand-in encoded file holds.
pub struct Stream {
    /// The peak level of each 20 ms frame.
    pub levels: Vec<f32>,
    /// The pages after the two headers.
    pub audio_pages: Vec<PageInfo>,
    /// The frames the file claims to hold, from its last granule position.
    pub frames: u64,
    /// Whether the last page closes the stream.
    pub closed: bool,
}

pub fn read_stream(path: &Path) -> Stream {
    let mut reader = ogg::PacketReader::new(BufReader::new(File::open(path).unwrap()));
    let mut levels = Vec::new();
    let mut index = 0;
    while let Some(packet) = reader.read_packet().unwrap() {
        if index >= 2 {
            levels.push(level_of(&packet.data));
        }
        index += 1;
    }
    let scan = scan_pages(BufReader::new(File::open(path).unwrap())).unwrap();
    let last = scan.pages.last().unwrap();
    Stream {
        levels,
        audio_pages: scan.pages[2..].to_vec(),
        frames: last.granule.saturating_sub(u64::from(LEVEL_PRE_SKIP)),
        closed: last.flags & FLAG_EOS != 0,
    }
}

/// A recorder in `dir` with a manual clock and the stand-in encoder. It skips `sync_data`, which
/// the tests don't need. Its ring holds 70 s, so a test can hand it a minute of audio at once
/// without the writer thread having to keep up.
pub fn recorder(dir: &Path, clock: Arc<ManualClock>) -> Recorder {
    let options = Options {
        sync: false,
        ring_seconds: 70,
        ..Options::default()
    };
    Recorder::new(dir)
        .with_clock(clock.clone())
        .with_wall_clock(clock)
        .with_options(options)
        .with_encoder(level_factory())
}

/// Like [`recorder`], but with the stand-in codec that keeps the audio, so a test can play it back.
pub fn pcm_recorder(dir: &Path, clock: Arc<ManualClock>) -> Recorder {
    recorder(dir, clock).with_encoder(opennote_media::pcm_codec::pcm_encoder_factory())
}

/// A noise-like signal that never repeats within a day, so any shift of the audio is detectable.
pub fn noise() -> opennote_media::audio::synthetic::Signal {
    Arc::new(|frame| {
        let mixed = frame.wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(23) ^ frame.wrapping_mul(0xC2B2_AE3D);
        let value = ((mixed >> 40) as f32 / 16_777_216.0 - 0.5) * 0.6;
        // Never zero, so that a zero from a device can only mean it had nothing to play.
        if value.abs() < 1e-3 {
            1e-3
        } else {
            value
        }
    })
}

/// Waits until `condition` holds, for up to ten seconds.
pub fn wait_until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !condition() {
        assert!(Instant::now() < deadline, "The condition did not hold in time.");
        std::thread::sleep(Duration::from_millis(2));
    }
}
