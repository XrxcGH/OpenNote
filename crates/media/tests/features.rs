//! Level meters, source switching, the clock anchor, and taps, through the whole recording pipeline.

mod common;

use std::sync::{Arc, Mutex};

use common::{read_stream, recorder, wait_until, SECOND};
use opennote_media::audio::synthetic::{
    sine, synthetic, test_tone_source, FailingSource, ManualClock, MANUAL_WALL_BASE_MS,
};
use opennote_media::audio::tap::{PcmTap, TapFactory};
use opennote_media::audio::{SourceFormat, TrackKind, TrackStart};

const START: u64 = 5 * SECOND;

fn mic(asset: &str, source: impl opennote_media::audio::AudioSource + 'static) -> TrackStart {
    TrackStart::new(TrackKind::Microphone, asset, Box::new(source))
}

#[test]
fn the_summary_ties_the_capture_clock_to_unix_time() {
    let dir = tempfile::tempdir().unwrap();
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir.path(), ManualClock::new(START))
        .start("rec", vec![mic("a", source)])
        .unwrap();
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();
    assert_eq!(summary.clock.capture_ns, START);
    assert_eq!(summary.clock.unix_ms, MANUAL_WALL_BASE_MS);
    assert_eq!(summary.tracks[0].asset, "a");
    // A stroke written 2.5 s after the start lands 2.5 s into the capture clock.
    assert_eq!(
        summary.clock.capture_ns_at(MANUAL_WALL_BASE_MS + 2_500),
        START + 2_500_000_000
    );
}

#[test]
fn levels_show_the_peak_and_how_long_a_track_has_been_silent() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir.path(), clock.clone())
        .start("rec", vec![mic("a", source)])
        .unwrap();
    handle.produce_ms(1_000);
    wait_until(|| recording.health()[0].frames == 48_000);
    clock.set_ns(START + SECOND);
    let level = recording.levels()[0].level;
    assert!((level.peak - 0.1).abs() < 0.005, "{level:?}");
    assert!((level.rms - 0.0707).abs() < 0.005, "{level:?}");
    assert!(level.silent_ms < 50 && !level.clipped, "{level:?}");

    // Twenty-five seconds pass with nothing recorded, as if the microphone were muted.
    clock.set_ns(START + 26 * SECOND);
    let level = recording.levels()[0].level;
    assert_eq!(level.peak, 0.0);
    assert!(level.silent_ms >= 24_000, "{level:?}");
    assert!(level.idle_ms >= 24_000, "{level:?}");
    recording.stop().unwrap();
}

#[test]
fn a_new_microphone_continues_the_same_file_at_its_own_rate() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (first, first_handle) = test_tone_source(START);
    let mut recording = recorder(dir.path(), clock.clone())
        .start("rec", vec![mic("a", first)])
        .unwrap();
    first_handle.produce_ms(1_000);
    wait_until(|| recording.health()[0].frames == 48_000);

    // A headset at 16 kHz takes over a quarter of a second later.
    let format = SourceFormat {
        rate: 16_000,
        channels: 1,
    };
    let (second, second_handle) = synthetic(format, sine(440.0, 0.2, 16_000), START + 1_250_000_000);
    clock.set_ns(START + 1_250_000_000);
    recording
        .switch_source(TrackKind::Microphone, Box::new(second))
        .unwrap();
    second_handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();

    let timeline = &summary.tracks[0].timeline;
    // One second, a quarter second of silence, and one second at the new rate.
    assert!(
        (timeline.frames as i64 - 108_000).abs() <= 960,
        "{} frames",
        timeline.frames
    );
    let stream = read_stream(&dir.path().join(&summary.tracks[0].audio_file));
    assert!(stream.levels[..45].iter().all(|level| (0.09..=0.11).contains(level)));
    assert!(stream.levels[66..stream.levels.len() - 2]
        .iter()
        .all(|level| (0.17..=0.21).contains(level)));
}

#[test]
fn a_source_that_fails_after_a_switch_leaves_the_track_recording_silence() {
    let dir = tempfile::tempdir().unwrap();
    let (first, handle) = test_tone_source(START);
    let mut recording = recorder(dir.path(), ManualClock::new(START))
        .start("rec", vec![mic("a", first)])
        .unwrap();
    handle.produce_ms(500);
    let error = recording
        .switch_source(TrackKind::Microphone, Box::new(FailingSource))
        .unwrap_err();
    assert!(error.to_string().contains("no microphone"), "{error}");
    assert!(recording
        .switch_source(TrackKind::SystemAudio, Box::new(FailingSource))
        .is_err());
    assert!(recording.stop().is_ok());
}

struct Collect(Arc<Mutex<Vec<(u64, u64, usize)>>>, Arc<Mutex<Option<u64>>>);

impl PcmTap for Collect {
    fn pcm(&mut self, first_frame: u64, capture_ns: u64, samples: &[f32]) {
        self.0.lock().unwrap().push((first_frame, capture_ns, samples.len()));
    }

    fn finish(&mut self, frames: u64) {
        *self.1.lock().unwrap() = Some(frames);
    }
}

#[test]
fn a_tap_hears_every_packet_and_the_end() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let ended = Arc::new(Mutex::new(None));
    let (seen_by_tap, ended_by_tap) = (Arc::clone(&seen), Arc::clone(&ended));
    let tap: TapFactory = Arc::new(move |kind| {
        (kind == TrackKind::Microphone)
            .then(|| Box::new(Collect(Arc::clone(&seen_by_tap), Arc::clone(&ended_by_tap))) as Box<dyn PcmTap>)
    });
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir.path(), ManualClock::new(START))
        .with_tap(tap)
        .start("rec", vec![mic("a", source)])
        .unwrap();
    handle.produce_ms(500);
    let summary = recording.stop().unwrap();

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 50);
    assert_eq!(seen[0], (0, START, 480));
    assert_eq!(seen[1], (480, START + 10_000_000, 480));
    assert_eq!(
        seen.iter().map(|packet| packet.2 as u64).sum::<u64>(),
        summary.tracks[0].timeline.frames
    );
    assert_eq!(*ended.lock().unwrap(), Some(24_000));
}

mod guard {
    use std::path::Path;
    use std::sync::Arc;

    use opennote_media::audio::{Battery, Environment, Guard, StopReason, Warning};

    use super::*;

    /// A machine with plenty of everything.
    struct Roomy;

    impl Environment for Roomy {
        fn free_bytes(&self, _dir: &Path) -> Option<u64> {
            Some(1 << 40)
        }

        fn battery(&self) -> Option<Battery> {
            None
        }
    }

    fn running(clock: &Arc<ManualClock>, dir: &Path) -> (opennote_media::audio::Recording, Guard) {
        let (source, handle) = test_tone_source(START);
        let recording = recorder(dir, clock.clone())
            .start("rec", vec![mic("a", source)])
            .unwrap();
        handle.produce_ms(1_000);
        wait_until(|| recording.health()[0].frames == 48_000);
        (recording, Guard::new(dir, Arc::new(Roomy)))
    }

    #[test]
    fn a_working_microphone_raises_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let clock = ManualClock::new(START);
        let (recording, mut guard) = running(&clock, dir.path());
        clock.set_ns(START + SECOND);
        let status = guard.check(&recording);
        assert!(status.warnings.is_empty() && status.stop.is_none(), "{status:?}");
        recording.stop().unwrap();
    }

    #[test]
    fn a_microphone_that_delivers_nothing_is_reported_as_stalled() {
        let dir = tempfile::tempdir().unwrap();
        let clock = ManualClock::new(START);
        let (recording, mut guard) = running(&clock, dir.path());
        clock.set_ns(START + 2 * SECOND);
        assert!(guard.check(&recording).warnings.is_empty());
        // Four seconds after the last packet, the device looks unplugged.
        clock.set_ns(START + 5 * SECOND);
        assert!(matches!(
            guard.check(&recording).warnings[..],
            [Warning::DeviceStalled { seconds: 4, .. }]
        ));
        recording.stop().unwrap();
    }

    #[test]
    fn a_microphone_that_records_only_silence_for_twenty_seconds_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let clock = ManualClock::new(START);
        let (source, handle) = synthetic(
            SourceFormat {
                rate: 48_000,
                channels: 1,
            },
            Arc::new(|_| 0.0),
            START,
        );
        let recording = recorder(dir.path(), clock.clone())
            .start("rec", vec![mic("a", source)])
            .unwrap();
        let mut guard = Guard::new(dir.path(), Arc::new(Roomy));
        handle.produce_ms(19_000);
        clock.set_ns(handle.now_ns());
        wait_until(|| recording.health()[0].frames == 19 * 48_000);
        assert!(guard.check(&recording).warnings.is_empty());
        handle.produce_ms(2_000);
        clock.set_ns(handle.now_ns());
        wait_until(|| recording.health()[0].frames == 21 * 48_000);
        assert_eq!(
            guard.check(&recording).warnings,
            vec![Warning::MicrophoneSilent { seconds: 21 }]
        );
        recording.stop().unwrap();
    }

    #[test]
    fn a_pause_silences_the_watch_and_resuming_starts_it_again() {
        let dir = tempfile::tempdir().unwrap();
        let clock = ManualClock::new(START);
        let (mut recording, mut guard) = running(&clock, dir.path());
        recording.pause().unwrap();
        clock.set_ns(START + 60 * SECOND);
        assert!(guard.check(&recording).warnings.is_empty());
        recording.resume().unwrap();
        assert!(guard.check(&recording).warnings.is_empty());
        clock.set_ns(START + 90 * SECOND);
        assert!(!guard.check(&recording).warnings.is_empty());
        recording.stop().unwrap();
    }

    #[test]
    fn almost_no_disk_asks_for_a_stop() {
        struct Tight;
        impl Environment for Tight {
            fn free_bytes(&self, _dir: &Path) -> Option<u64> {
                Some(2 * 1024 * 1024)
            }

            fn battery(&self) -> Option<Battery> {
                None
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let clock = ManualClock::new(START);
        let (recording, _) = running(&clock, dir.path());
        let status = Guard::new(dir.path(), Arc::new(Tight)).check(&recording);
        assert_eq!(
            status.stop,
            Some(StopReason::DiskFull {
                free_bytes: 2 * 1024 * 1024
            })
        );
        assert!(status.warnings.iter().any(|w| matches!(w, Warning::LowDisk { .. })));
        // Stopping closes the files cleanly, and the summary says how much was saved.
        let summary = recording.stop().unwrap();
        assert_eq!(summary.tracks[0].timeline.frames, 48_000);
    }
}
