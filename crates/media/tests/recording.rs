//! Recording through the whole pipeline with generated audio: no microphone is involved.

mod common;

use std::sync::Arc;

use common::{read_stream, recorder, SECOND};
use opennote_media::audio::synthetic::{sine, synthetic, test_tone_source, FailingSource, ManualClock, Signal};
use opennote_media::audio::{Anchor, SourceFormat, TrackKind, TrackStart};

const START: u64 = 5 * SECOND;

fn mic(asset: &str, start_ns: u64) -> TrackStart {
    let (source, _) = test_tone_source(start_ns);
    TrackStart::new(TrackKind::Microphone, asset, Box::new(source))
}

#[test]
fn a_tone_becomes_half_second_pages_and_a_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir.path(), clock)
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(3_000);
    let summary = recording.stop().unwrap();

    let track = &summary.tracks[0];
    assert_eq!(
        track.timeline.anchors,
        vec![Anchor {
            frame: 0,
            time_ns: START
        }]
    );
    assert_eq!(track.timeline.frames, 144_000);
    assert_eq!(track.timeline.time_at(48_000), Some(START + SECOND));
    assert_eq!(track.timeline.frame_at(START + 2_500_000_000), Some(120_000));
    assert_eq!(track.dropped_packets, 0);

    let stream = read_stream(&dir.path().join(&track.audio_file));
    assert_eq!(stream.levels.len(), 150);
    assert!(
        stream.levels.iter().all(|level| (0.09..=0.1).contains(level)),
        "{:?}",
        stream.levels
    );
    assert_eq!(stream.frames, 144_000);
    assert!(stream.closed);
    // Six pages of 25 frames, which is 500 ms each, and the closing page.
    let granules: Vec<u64> = stream.audio_pages.iter().map(|page| page.granule).collect();
    assert_eq!(granules.len(), 7);
    assert!(
        granules.windows(2).take(5).all(|pair| pair[1] - pair[0] == 24_000),
        "{granules:?}"
    );
}

#[test]
fn a_gap_is_filled_with_silence_and_a_long_gap_starts_a_stretch() {
    let dir = tempfile::tempdir().unwrap();
    let (source, handle) = test_tone_source(START);
    let clock = ManualClock::new(START);
    let recording = recorder(dir.path(), clock)
        .start(
            "a",
            vec![TrackStart::new(TrackKind::SystemAudio, "a", Box::new(source))],
        )
        .unwrap();
    handle.produce_ms(1_000);
    handle.skip_ms(2_000);
    handle.produce_ms(1_000);
    handle.skip_ms(60_000);
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();

    let track = &summary.tracks[0];
    // 1 s of tone, 2 s of silence, 1 s of tone, and then a stretch that starts 60 s later.
    let second_stretch = START + 64 * SECOND;
    assert_eq!(
        track.timeline.anchors,
        vec![
            Anchor {
                frame: 0,
                time_ns: START
            },
            Anchor {
                frame: 4 * 48_000,
                time_ns: second_stretch
            },
        ]
    );
    assert_eq!(track.timeline.frames, 5 * 48_000);
    assert_eq!(track.silence_frames, 96_000);
    assert_eq!(track.timeline.frame_at(START + 2 * SECOND), Some(96_000));
    assert_eq!(track.timeline.frame_at(START + 30 * SECOND), None);

    let levels = read_stream(&dir.path().join(&track.audio_file)).levels;
    let silent: Vec<usize> = (0..levels.len()).filter(|&frame| levels[frame] == 0.0).collect();
    assert_eq!(silent, (50..150).collect::<Vec<_>>());
    assert_eq!(levels.len(), 250);
}

#[test]
fn pause_and_resume_leave_a_gap_in_the_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (source, handle) = test_tone_source(START);
    let mut recording = recorder(dir.path(), clock.clone())
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(1_000);
    clock.set_ns(handle.now_ns());
    recording.pause().unwrap();
    assert!(recording.is_paused());
    handle.produce_ms(500);
    clock.set_ns(handle.now_ns());
    recording.resume().unwrap();
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();

    assert_eq!(summary.pauses.len(), 1);
    assert_eq!(summary.pauses[0].paused_ns, START + SECOND);
    assert_eq!(summary.pauses[0].resumed_ns, START + SECOND + 500_000_000);
    let timeline = &summary.tracks[0].timeline;
    assert_eq!(timeline.frames, 96_000);
    assert_eq!(timeline.anchors.len(), 2);
    assert_eq!(timeline.frame_at(START + 1_200_000_000), None);
    assert_eq!(timeline.nearest_frame(START + 1_200_000_000), Some(48_000));
    assert_eq!(timeline.frame_at(START + 1_750_000_000), Some(60_000));
    let stream = read_stream(&dir.path().join(&summary.tracks[0].audio_file));
    assert_eq!(stream.levels.len(), 100);
}

#[test]
fn audio_captured_during_a_pause_is_left_out_even_if_the_stream_keeps_running() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (source, handle) = test_tone_source(START);
    handle.keep_running_while_paused();
    let mut recording = recorder(dir.path(), clock.clone())
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(1_000);
    clock.set_ns(handle.now_ns());
    recording.pause().unwrap();
    handle.produce_ms(1_000);
    clock.set_ns(handle.now_ns());
    recording.resume().unwrap();
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();

    let timeline = &summary.tracks[0].timeline;
    assert_eq!(timeline.frames, 96_000);
    assert_eq!(
        timeline.anchors,
        vec![
            Anchor {
                frame: 0,
                time_ns: START
            },
            Anchor {
                frame: 48_000,
                time_ns: START + 2 * SECOND
            },
        ]
    );
}

#[test]
fn a_44_1_khz_stereo_source_is_recorded_as_48_khz_mono() {
    let dir = tempfile::tempdir().unwrap();
    let format = SourceFormat {
        rate: 44_100,
        channels: 2,
    };
    let (source, handle) = synthetic(format, sine(1_000.0, 0.25, 44_100), START);
    let recording = recorder(dir.path(), ManualClock::new(START))
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(2_000);
    let summary = recording.stop().unwrap();
    let frames = summary.tracks[0].timeline.frames as i64;
    assert!((frames - 96_000).abs() < 1_000, "{frames} frames");
    assert_eq!(summary.tracks[0].timeline.anchors.len(), 1);
}

#[test]
fn a_device_clock_that_drifts_keeps_timestamps_within_the_tolerance() {
    let dir = tempfile::tempdir().unwrap();
    // A click on the first frame of every second, over a quiet tone.
    let click: Signal = Arc::new(|frame| if frame % 48_000 == 0 { 0.9 } else { 0.01 });
    let (source, handle) = synthetic(
        SourceFormat {
            rate: 48_000,
            channels: 1,
        },
        click,
        START,
    );
    // A clock error 1,000 times the worst the spike measured, to show drift within a minute of audio.
    handle.set_clock_error_ppm(2_000.0);
    let recording = recorder(dir.path(), ManualClock::new(START))
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(60_000);
    let summary = recording.stop().unwrap();
    assert_eq!(summary.tracks[0].dropped_packets, 0);
    let timeline = &summary.tracks[0].timeline;
    assert!(timeline.anchors.len() > 3, "{} stretches", timeline.anchors.len());

    // Find each click in the file, and compare the time the timeline gives its frame with the
    // capture time it really had. A click lands somewhere in its 20 ms frame.
    let levels = read_stream(&dir.path().join(&summary.tracks[0].audio_file)).levels;
    let clicks: Vec<usize> = (0..levels.len()).filter(|&frame| levels[frame] > 0.5).collect();
    assert_eq!(clicks.len(), 60);
    for (second, frame) in clicks.iter().enumerate() {
        let truth = START as f64 + second as f64 * 1e9 * (1.0 - 2_000.0 / 1e6);
        let frame_start = timeline.time_at(*frame as u64 * 960).unwrap() as f64;
        let late_ms = (truth - frame_start) / 1e6;
        assert!(
            (-16.0..=36.0).contains(&late_ms),
            "click {second} is {late_ms} ms after its frame starts"
        );
    }
}

#[test]
fn several_recordings_share_a_folder_and_never_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let recorder = recorder(dir.path(), ManualClock::new(START));
    for id in ["one", "two"] {
        let (source, handle) = test_tone_source(START);
        let recording = recorder
            .start(id, vec![TrackStart::new(TrackKind::Microphone, id, Box::new(source))])
            .unwrap();
        handle.produce_ms(200);
        recording.stop().unwrap();
    }
    assert!(dir.path().join("one-mic.ogg").exists() && dir.path().join("two-mic.ogg").exists());
    let size = std::fs::metadata(dir.path().join("one-mic.ogg")).unwrap().len();
    assert!(recorder.start("one", vec![mic("one", START)]).is_err());
    assert_eq!(std::fs::metadata(dir.path().join("one-mic.ogg")).unwrap().len(), size);
    assert!(recorder.start("../bad", vec![mic("../bad", START)]).is_err());
}

#[test]
fn a_source_that_fails_to_start_leaves_no_files() {
    let dir = tempfile::tempdir().unwrap();
    let sources = vec![
        mic("a", START),
        TrackStart::new(TrackKind::SystemAudio, "a", Box::new(FailingSource)),
    ];
    let error = recorder(dir.path(), ManualClock::new(START))
        .start("a", sources)
        .err()
        .unwrap();
    assert!(error.to_string().contains("no microphone"), "{error}");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn a_leftover_timeline_file_stops_a_recording_and_leaves_no_audio_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a-mic.timeline"), b"ONTIMEL2").unwrap();
    let recorder = recorder(dir.path(), ManualClock::new(START));
    assert!(recorder.start("a", vec![mic("a", START)]).is_err());
    assert!(!dir.path().join("a-mic.ogg").exists());
}
