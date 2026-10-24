//! Synchronization: pen strokes and typing during a recording find their audio again.
//!
//! A scripted session writes strokes and types words while the audio carries a short burst of sound
//! at each of those moments, like a pen tapping the table. The recording has a pause and a device
//! clock that runs fast. After it stops, the test looks up each stroke and each word in the timestamp
//! map, plays the audio from the position it names, and measures where the burst falls.

mod common;

use std::sync::Arc;

use common::{pcm_recorder, SECOND};
use opennote_media::audio::synthetic::{synthetic, ManualClock, Signal, MANUAL_WALL_BASE_MS};
use opennote_media::audio::{Options, RecordingSummary, SourceFormat, TrackKind, TrackStart};
use opennote_media::pcm_codec::pcm_decoder_factory;
use opennote_media::playback::open_recording;
use opennote_media::positions::PositionMap;
use opennote_media::stamps::{Entry, Stamp, StampIndex, Target, TextMarks};

const START: u64 = 9 * SECOND;
/// The device clock runs this fast. It is much worse than a real one, so resyncs happen.
const DRIFT_PPM: f64 = 400.0;
/// The session lasts two minutes, with a pause from 50 s to 70 s.
const SESSION_MS: u64 = 120_000;
const PAUSE_MS: std::ops::Range<u64> = 50_000..70_000;
const BURST_FRAMES: u64 = 1_440;
/// The budget from the development plan.
const BUDGET_MS: f64 = 100.0;

#[derive(Clone, Copy)]
enum Kind {
    Stroke,
    Word,
}

/// When something is written, in milliseconds after the recording started.
fn script() -> Vec<(u64, Kind)> {
    let mut events = Vec::new();
    let mut at = 1_500u64;
    let mut index = 0u64;
    while at < SESSION_MS - 2_000 {
        if !(PAUSE_MS.start - 600..PAUSE_MS.end + 600).contains(&at) {
            events.push((
                at,
                if index.is_multiple_of(2) {
                    Kind::Stroke
                } else {
                    Kind::Word
                },
            ));
        }
        index += 1;
        at += 1_300 + (index * 389) % 2_100;
    }
    events
}

/// The device frame in which something at `offset_ms` of the capture clock is heard. The device clock
/// runs fast, so it has gone through a little more audio than the capture clock says. A paused
/// recording drops audio, but the device goes on.
fn device_frame(offset_ms: u64) -> u64 {
    (offset_ms as f64 / (1.0 - DRIFT_PPM / 1e6) * 48.0) as u64
}

/// A signal that is quiet except for a burst of noise at each event.
fn signal(events: &[(u64, Kind)]) -> Signal {
    let starts: Vec<u64> = events.iter().map(|(at, _)| device_frame(*at)).collect();
    Arc::new(move |frame| {
        let index = starts.partition_point(|start| *start <= frame);
        let in_burst = index > 0 && frame < starts[index - 1] + BURST_FRAMES;
        if in_burst {
            let mixed = frame.wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(31);
            ((mixed >> 40) as f32 / 16_777_216.0 - 0.5) * 0.9
        } else {
            0.0003
        }
    })
}

fn record(dir: &std::path::Path, events: &[(u64, Kind)]) -> RecordingSummary {
    let format = SourceFormat {
        rate: 48_000,
        channels: 1,
    };
    let (source, handle) = synthetic(format, signal(events), START);
    handle.set_clock_error_ppm(DRIFT_PPM);
    let clock = ManualClock::new(START);
    let options = Options {
        sync: false,
        ring_seconds: 130,
        ..Options::default()
    };
    let mut recording = pcm_recorder(dir, clock.clone())
        .with_options(options)
        .start(
            "rec",
            vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))],
        )
        .unwrap();
    // The session passes in steps of ten seconds. The capture clock follows the source's.
    for at_ms in (0..SESSION_MS).step_by(10_000) {
        if at_ms == PAUSE_MS.start {
            clock.set_ns(handle.now_ns());
            recording.pause().unwrap();
        }
        if at_ms == PAUSE_MS.end {
            clock.set_ns(handle.now_ns());
            recording.resume().unwrap();
        }
        handle.produce_ms(10_000);
    }
    clock.set_ns(handle.now_ns());
    recording.stop().unwrap()
}

/// The index of everything written, the way the page would hold it, and the target of each event.
fn index_of(summary: &RecordingSummary, events: &[(u64, Kind)]) -> (StampIndex, Vec<Target>) {
    let (mut entries, mut targets) = (Vec::new(), Vec::new());
    let mut marks = TextMarks::default();
    let mut text_length = 0;
    for (number, (at, kind)) in events.iter().enumerate() {
        // The wall clock and the capture clock agree at the start.
        let unix_ms = MANUAL_WALL_BASE_MS + *at as i64;
        let capture_ns = summary.clock.capture_ns_at(unix_ms);
        let target = match kind {
            Kind::Stroke => Target::Stroke {
                id: format!("s{number}"),
            },
            Kind::Word => {
                let stamp = Stamp {
                    recording: &summary.id,
                    capture_ns,
                };
                marks.edit(text_length, 0, 5, Some(stamp));
                text_length += 6;
                Target::Text {
                    block: "b".into(),
                    from: text_length - 6,
                    to: text_length - 1,
                }
            }
        };
        match kind {
            Kind::Stroke => entries.extend(Entry::stroke(summary, &format!("s{number}"), unix_ms, 600)),
            Kind::Word => entries.push(Entry::at(&summary.id, capture_ns, target.clone())),
        }
        targets.push(target);
    }
    // Words typed 1.3 s or more apart each get a mark of their own.
    assert!(marks.marks.len() > 10);
    (StampIndex::new(entries), targets)
}

#[test]
fn strokes_and_words_find_their_audio_within_the_budget() {
    let dir = tempfile::tempdir().unwrap();
    let events = script();
    let summary = record(dir.path(), &events);
    assert!(
        summary.tracks[0].timeline.anchors.len() >= 2,
        "the drift and the pause should make stretches"
    );
    assert_eq!(summary.pauses.len(), 1);

    let map = PositionMap::from_summary(&summary);
    let (index, targets) = index_of(&summary, &events);
    assert_eq!(index.len(), events.len());
    let mut player = open_recording(dir.path(), &summary, &pcm_decoder_factory()).unwrap();
    let mut worst_ms = 0f64;
    for target in &targets {
        let seek = index
            .seek_for(target, |_| Some(&map))
            .expect("every event is in the index");
        assert!(seek.exact);
        // Start 100 ms before the position, and see where the burst begins.
        player.seek_ns(seek.position_ns.saturating_sub(100_000_000));
        let mut audio = vec![0.0; 14_400];
        let count = player.render(&mut audio).unwrap();
        let begin = audio[..count]
            .iter()
            .position(|sample| sample.abs() > 0.05)
            .expect("a burst");
        let error_ms = begin as f64 / 48.0 - 100.0;
        worst_ms = worst_ms.max(error_ms.abs());
    }
    println!("The worst error of {} events is {worst_ms:.1} ms.", events.len());
    assert!(worst_ms < BUDGET_MS, "{worst_ms} ms is over the {BUDGET_MS} ms budget");
}
