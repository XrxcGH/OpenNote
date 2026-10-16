//! The Phase 9 soak test, in simulated time: three hours of audio go through the whole pipeline in
//! seconds. A device clock that runs 9.3 ppm fast is the worst drift the 100 ms budget allows over
//! three hours, and a click every minute shows where each timestamp really lands.
//!
//! Run it with `cargo test -p opennote-media --release --test soak -- --ignored`.

mod common;

use std::sync::Arc;

use common::{read_stream, recorder, wait_until, SECOND};
use opennote_media::audio::synthetic::{synthetic, ManualClock, Signal};
use opennote_media::audio::{Options, SourceFormat, TrackKind, TrackStart};

const START: u64 = 7 * SECOND;
const HOURS: u64 = 3;
const DRIFT_PPM: f64 = 9.3;

#[test]
#[ignore = "simulates three hours of audio, which takes a while in a debug build"]
fn three_hours_keep_every_timestamp_within_the_budget() {
    let dir = tempfile::tempdir().unwrap();
    let click: Signal = Arc::new(|frame| if frame % (48_000 * 60) == 0 { 0.9 } else { 0.01 });
    let (source, handle) = synthetic(
        SourceFormat {
            rate: 48_000,
            channels: 1,
        },
        click,
        START,
    );
    handle.set_clock_error_ppm(DRIFT_PPM);
    let options = Options {
        sync: false,
        ring_seconds: 60,
        ..Options::default()
    };
    let recording = recorder(dir.path(), ManualClock::new(START))
        .with_options(options)
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();

    // Thirty seconds at a time, so the writer keeps up with a ring that holds sixty.
    let chunks = HOURS * 3_600 / 30;
    for chunk in 1..=chunks {
        handle.produce_ms(30_000);
        wait_until(|| recording.health()[0].frames + 48_000 >= chunk * 30 * 48_000);
    }
    let health = recording.health().remove(0);
    let summary = recording.stop().unwrap();
    assert_eq!(health.dropped_packets, 0);

    let timeline = &summary.tracks[0].timeline;
    println!("{} stretches over {} frames", timeline.anchors.len(), timeline.frames);
    let levels = read_stream(&dir.path().join(&summary.tracks[0].audio_file)).levels;
    let clicks: Vec<usize> = (0..levels.len()).filter(|&frame| levels[frame] > 0.5).collect();
    assert_eq!(clicks.len() as u64, HOURS * 60);
    let mut worst_ms = 0f64;
    for (minute, frame) in clicks.iter().enumerate() {
        let truth = START as f64 + minute as f64 * 60.0 * 1e9 * (1.0 - DRIFT_PPM / 1e6);
        let frame_start = timeline.time_at(*frame as u64 * 960).unwrap() as f64;
        // The click falls somewhere in its 20 ms frame, so the frame's start is up to 20 ms early.
        let error_ms = (truth - frame_start) / 1e6 - 10.0;
        worst_ms = worst_ms.max(error_ms.abs());
    }
    println!("The worst timestamp error is {worst_ms:.1} ms.");
    assert!(worst_ms < 100.0, "{worst_ms} ms is over the 100 ms budget");
}
