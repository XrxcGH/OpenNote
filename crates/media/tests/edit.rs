//! Editing recordings: trim, split, and remove a part. The stand-in codec keeps the samples, so each
//! test plays the edited recording and compares it to the signal that went in, to the sample, at the
//! capture time the position map gives. That is the promise to the notes: after an edit, a stroke or a
//! word still finds the audio that was playing when it was written.

mod common;

use std::path::Path;
use std::sync::Arc;

use common::{noise, pcm_recorder, SECOND};
use opennote_media::audio::synthetic::{synthetic, ManualClock, Signal, SyntheticHandle};
use opennote_media::audio::{RecordingSummary, SourceFormat, TrackKind, TrackRef, TrackStart};
use opennote_media::edit::{keep, remove, split, trim_silence};
use opennote_media::layout::RecordingPlan;
use opennote_media::pcm_codec::pcm_decoder_factory;
use opennote_media::playback::{open_recording, Player};
use opennote_media::positions::PositionMap;
use sha2::{Digest, Sha256};

const START: u64 = 7 * SECOND;
const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};
/// The stand-in codec keeps 16 bits.
const TOLERANCE: f32 = 5e-5;
/// A cut costs up to 30 ms at each edge (see `edit::runs`), plus a frame of rounding.
const EDGE_LOSS_NS: u64 = 65_000_000;

fn plan(id: &str, asset: &str) -> RecordingPlan {
    RecordingPlan {
        id: id.into(),
        tracks: vec![TrackRef {
            kind: TrackKind::Microphone,
            asset: asset.into(),
        }],
    }
}

fn source(signal: Signal) -> (TrackStart, SyntheticHandle) {
    let (source, handle) = synthetic(MONO, signal, START);
    (TrackStart::new(TrackKind::Microphone, "a", Box::new(source)), handle)
}

/// Records `seconds` of noise.
fn record(dir: &Path, seconds: u64) -> RecordingSummary {
    record_signal(dir, noise(), seconds)
}

fn record_signal(dir: &Path, signal: Signal, seconds: u64) -> RecordingSummary {
    let (track, handle) = source(signal);
    let recording = pcm_recorder(dir, ManualClock::new(START))
        .start("rec", vec![track])
        .unwrap();
    handle.produce_ms(seconds * 1_000);
    recording.stop().unwrap()
}

/// Two seconds, five seconds of pause, then two more seconds. The signal runs on through the pause.
fn record_with_pause(dir: &Path) -> RecordingSummary {
    let clock = ManualClock::new(START);
    let (track, handle) = source(noise());
    let mut recording = pcm_recorder(dir, clock.clone()).start("rec", vec![track]).unwrap();
    handle.produce_ms(2_000);
    clock.set_ns(handle.now_ns());
    recording.pause().unwrap();
    handle.produce_ms(5_000);
    clock.set_ns(handle.now_ns());
    recording.resume().unwrap();
    handle.produce_ms(2_000);
    recording.stop().unwrap()
}

fn open(dir: &Path, summary: &RecordingSummary) -> Player {
    open_recording(dir, summary, &pcm_decoder_factory()).unwrap()
}

fn render(player: &mut Player, samples: usize) -> Vec<f32> {
    let mut out = vec![0.0; samples];
    let mut done = 0;
    while done < samples {
        let count = player.render(&mut out[done..]).unwrap();
        if count == 0 {
            break;
        }
        done += count;
    }
    out.truncate(done);
    out
}

/// The frame of the original signal that was captured at a time.
fn signal_frame(capture_ns: u64) -> u64 {
    (capture_ns - START) * 48_000 / SECOND
}

/// Plays the recording at `position_ns` and checks that the audio is the signal at the capture time that
/// the recording's own position map names for that position.
fn assert_audio_at(dir: &Path, summary: &RecordingSummary, position_ns: u64) {
    let map = PositionMap::from_summary(summary);
    let capture = map.capture_at(position_ns).expect("the position holds audio");
    let first_frame = signal_frame(capture);
    let mut player = open(dir, summary);
    player.seek_ns(position_ns);
    let audio = render(&mut player, 4_800);
    assert_eq!(audio.len(), 4_800, "audio at {position_ns} ns");
    let signal = noise();
    for (index, sample) in audio.iter().enumerate() {
        let expected = signal(first_frame + index as u64);
        assert!(
            (sample - expected).abs() < TOLERANCE,
            "at {position_ns} ns, sample {index}: {sample} is not {expected}"
        );
    }
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn hash(path: &Path) -> Vec<u8> {
    Sha256::digest(std::fs::read(path).unwrap()).to_vec()
}

#[test]
fn keeping_a_range_plays_exactly_that_audio() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 4);
    let edited = keep(dir.path(), &summary, &[(SECOND, 3 * SECOND)], &plan("new", "e")).unwrap();

    let duration = PositionMap::from_summary(&edited).duration_ns();
    assert!(
        (2 * SECOND - EDGE_LOSS_NS..=2 * SECOND).contains(&duration),
        "{duration}"
    );
    // The kept audio starts at one second (give or take the edge), at the capture time it had.
    let first = PositionMap::from_summary(&edited).capture_at(0).unwrap();
    assert!(
        (START + SECOND..=START + SECOND + EDGE_LOSS_NS).contains(&first),
        "{first}"
    );
    for position in [0, 500_000_000, duration / 2, duration - 100_000_000] {
        assert_audio_at(dir.path(), &edited, position);
    }
}

#[test]
fn the_files_an_edit_starts_from_are_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 3);
    let audio = dir.path().join(&summary.tracks[0].audio_file);
    let timeline = dir.path().join(&summary.tracks[0].timeline_file);
    let before = (hash(&audio), hash(&timeline));

    keep(dir.path(), &summary, &[(0, SECOND)], &plan("new", "e")).unwrap();
    remove(dir.path(), &summary, &[(SECOND, 2 * SECOND)], &plan("new2", "f")).unwrap();

    assert_eq!((hash(&audio), hash(&timeline)), before);
    // Each edit added two files under its own asset ID.
    assert_eq!(files_in(dir.path()).len(), 6);
}

#[test]
fn removing_a_part_leaves_a_hole_so_that_notes_keep_their_timing() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 5);
    let edited = remove(dir.path(), &summary, &[(2 * SECOND, 3 * SECOND)], &plan("new", "e")).unwrap();

    let before = PositionMap::from_summary(&summary);
    let after = PositionMap::from_summary(&edited);
    assert!(after.duration_ns() <= 4 * SECOND);
    assert!(after.duration_ns() >= 4 * SECOND - 2 * EDGE_LOSS_NS);

    // Something written at four seconds finds the same audio as it did before the edit: the audio
    // there is the signal at that capture time, and the edit only moved its position.
    let written_at = START + 4 * SECOND;
    let old_position = before.locate(written_at).position_ns;
    let new_position = after.locate(written_at).position_ns;
    assert!(
        new_position < old_position,
        "later audio moves earlier by the removed second"
    );
    assert!((old_position - new_position) as i64 - SECOND as i64 >= -(2 * EDGE_LOSS_NS as i64));
    assert_audio_at(dir.path(), &edited, new_position);
    // So does something written in the first second, which did not move.
    assert_eq!(
        before.locate(START + 500_000_000).position_ns,
        after.locate(START + 500_000_000).position_ns
    );
    assert_audio_at(dir.path(), &edited, after.locate(START + 500_000_000).position_ns);

    // A time inside the removed part now falls in a hole, and locates to where the next audio starts.
    let hole = after.locate(START + 2_500_000_000);
    assert!(!hole.exact);
}

#[test]
fn a_removal_can_span_a_pause() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_with_pause(dir.path());
    assert_eq!(PositionMap::from_summary(&summary).duration_ns(), 4 * SECOND);
    // Positions 1 s to 3 s: the last second before the pause and the first second after it.
    let edited = remove(dir.path(), &summary, &[(SECOND, 3 * SECOND)], &plan("new", "e")).unwrap();
    let after = PositionMap::from_summary(&edited);
    assert!(after.duration_ns() <= 2 * SECOND);
    assert!(after.duration_ns() >= 2 * SECOND - 2 * EDGE_LOSS_NS);
    // The second half of what is left is the end of the recording: its last audio is at 9 s.
    assert_audio_at(dir.path(), &edited, 0);
    assert_audio_at(dir.path(), &edited, after.duration_ns() - 100_000_000);
    let end = after.capture_at(after.duration_ns() - 1).unwrap();
    assert!(end > START + 8_900_000_000 && end <= START + 9 * SECOND, "{end}");
}

#[test]
fn a_split_makes_two_recordings_that_together_hold_the_audio() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 4);
    let [first, second] = split(dir.path(), &summary, 2 * SECOND, [&plan("one", "e"), &plan("two", "f")]).unwrap();

    let (one, two) = (PositionMap::from_summary(&first), PositionMap::from_summary(&second));
    assert!(one.duration_ns() <= 2 * SECOND && one.duration_ns() >= 2 * SECOND - EDGE_LOSS_NS);
    assert!(two.duration_ns() <= 2 * SECOND && two.duration_ns() >= 2 * SECOND - EDGE_LOSS_NS);
    assert_eq!(first.id, "one");
    assert_eq!(second.id, "two");
    // The second starts, in capture time, where the first one ends.
    let one_end = one.capture_at(one.duration_ns() - 1).unwrap();
    let two_start = two.capture_at(0).unwrap();
    assert!(two_start >= one_end && two_start - one_end <= EDGE_LOSS_NS + 20_000_000);
    assert_audio_at(dir.path(), &first, 1_000_000_000);
    assert_audio_at(dir.path(), &second, 1_000_000_000);
    assert_audio_at(dir.path(), &second, two.duration_ns() - 100_000_000);
}

#[test]
fn an_edit_that_leaves_nothing_fails_and_leaves_no_files() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 2);
    let names = files_in(dir.path());

    assert!(keep(dir.path(), &summary, &[], &plan("new", "e")).is_err());
    assert!(remove(dir.path(), &summary, &[(0, 2 * SECOND)], &plan("new", "e")).is_err());
    // Less than a packet is gone with its edges.
    assert!(keep(
        dir.path(),
        &summary,
        &[(SECOND, SECOND + 10_000_000)],
        &plan("new", "e")
    )
    .is_err());
    for at in [0, 2 * SECOND, 3 * SECOND] {
        assert!(split(dir.path(), &summary, at, [&plan("one", "e"), &plan("two", "f")]).is_err());
    }
    assert_eq!(files_in(dir.path()), names);
}

/// Silence, a loud stretch of noise, and silence again.
fn speech_in_silence(quiet_before_frames: u64, loud_frames: u64) -> Signal {
    let loud = noise();
    Arc::new(move |frame| {
        if frame >= quiet_before_frames && frame < quiet_before_frames + loud_frames {
            loud(frame)
        } else {
            0.0
        }
    })
}

#[test]
fn trimming_silence_keeps_the_sound_and_a_margin() {
    let dir = tempfile::tempdir().unwrap();
    // 2 s of silence, 3 s of sound, 2 s of silence.
    let summary = record_signal(dir.path(), speech_in_silence(96_000, 144_000), 7);
    let edited = trim_silence(dir.path(), &summary, &plan("new", "e"), &pcm_decoder_factory())
        .unwrap()
        .expect("there is silence to trim");

    let after = PositionMap::from_summary(&edited);
    // The sound plus 0.2 s of margin on each side, less what the cut costs.
    assert!(after.duration_ns() <= 3_400_000_000, "{}", after.duration_ns());
    assert!(
        after.duration_ns() >= 3_400_000_000 - 2 * EDGE_LOSS_NS,
        "{}",
        after.duration_ns()
    );
    let start = after.capture_at(0).unwrap();
    assert!((START + 1_800_000_000..=START + 1_800_000_000 + EDGE_LOSS_NS).contains(&start));
    // The sound is all there, from just inside the margin to its last sample.
    assert_audio_at(dir.path(), &edited, 300_000_000);
    assert_audio_at(dir.path(), &edited, after.duration_ns() - 400_000_000);
}

#[test]
fn trimming_does_nothing_when_there_is_nothing_worth_trimming() {
    let dir = tempfile::tempdir().unwrap();
    let decoders = pcm_decoder_factory();

    // Sound from end to end.
    let loud = record(dir.path(), 3);
    assert!(trim_silence(dir.path(), &loud, &plan("new", "e"), &decoders)
        .unwrap()
        .is_none());

    // A short lead-in is left alone.
    let other = tempfile::tempdir().unwrap();
    let short = record_signal(other.path(), speech_in_silence(9_600, 120_000), 3);
    assert!(trim_silence(other.path(), &short, &plan("new", "e"), &decoders)
        .unwrap()
        .is_none());

    // So is a recording of nothing but silence, which has no sound to keep.
    let quiet = tempfile::tempdir().unwrap();
    let silent = record_signal(quiet.path(), Arc::new(|_| 0.0), 3);
    assert!(trim_silence(quiet.path(), &silent, &plan("new", "e"), &decoders)
        .unwrap()
        .is_none());
    assert_eq!(files_in(dir.path()).len(), 2);
}

#[test]
fn an_edited_recording_can_be_edited_again() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record(dir.path(), 6);
    let once = remove(dir.path(), &summary, &[(SECOND, 2 * SECOND)], &plan("one", "e")).unwrap();
    let twice = remove(dir.path(), &once, &[(3 * SECOND, 4 * SECOND)], &plan("two", "f")).unwrap();
    let map = PositionMap::from_summary(&twice);
    assert!(map.duration_ns() <= 4 * SECOND);
    assert!(map.duration_ns() >= 4 * SECOND - 4 * EDGE_LOSS_NS);
    for position in [0, SECOND, 2 * SECOND, map.duration_ns() - 100_000_000] {
        assert_audio_at(dir.path(), &twice, position);
    }
}
