//! Crash recovery. A crash leaves the files as they were when the process died. The tests copy the
//! files from a recording in progress, and tear the copy's last page the way a crash can.

mod common;

use std::path::Path;

use common::{read_stream, recorder, wait_until, SECOND};
use opennote_media::audio::recovery::{find_unfinished, recover_recording, recover_track};
use opennote_media::audio::synthetic::{test_tone_source, ManualClock};
use opennote_media::audio::{Anchor, AudioError, TrackFiles, TrackKind, TrackRef, TrackStart};

const START: u64 = 9 * SECOND;

fn mic_ref() -> TrackRef {
    TrackRef {
        kind: TrackKind::Microphone,
        asset: "a".into(),
    }
}

/// Records 3 s and copies the files while the recording is still open, after the last page is
/// written. Returns the copy's folder.
fn crashed_copy(dir: &Path) -> tempfile::TempDir {
    let clock = ManualClock::new(START);
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir, clock)
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(3_000);
    wait_until(|| recording.health()[0].frames == 144_000);
    let copy = tempfile::tempdir().unwrap();
    for name in ["a-mic.ogg", "a-mic.timeline"] {
        std::fs::copy(dir.join(name), copy.path().join(name)).unwrap();
    }
    recording.stop().unwrap();
    copy
}

fn tear(path: &Path, bytes: u64) {
    let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_len(file.metadata().unwrap().len() - bytes).unwrap();
}

#[test]
fn every_written_page_survives_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let copy = crashed_copy(dir.path());
    assert_eq!(find_unfinished(copy.path()).unwrap(), vec![mic_ref()]);

    let files = TrackFiles::new(copy.path(), "a", TrackKind::Microphone).unwrap();
    let recovered = recover_track(&files).unwrap();
    assert!(!recovered.was_complete);
    assert_eq!(recovered.bytes_cut, 0);
    assert_eq!(recovered.timeline.frames, 144_000);
    assert_eq!(
        recovered.timeline.anchors,
        vec![Anchor {
            frame: 0,
            time_ns: START
        }]
    );
    let stream = read_stream(&files.audio);
    assert!(stream.closed);
    assert_eq!(stream.levels.len(), 150);
    assert!(find_unfinished(copy.path()).unwrap().is_empty());
}

#[test]
fn a_torn_last_page_costs_at_most_half_a_second() {
    let dir = tempfile::tempdir().unwrap();
    let copy = crashed_copy(dir.path());
    let files = TrackFiles::new(copy.path(), "a", TrackKind::Microphone).unwrap();
    tear(&files.audio, 7);

    let recovered = recover_track(&files).unwrap();
    assert!(recovered.bytes_cut > 0);
    // The torn page held 25 frames, which is 500 ms.
    assert_eq!(recovered.timeline.frames, 144_000 - 24_000);
    let stream = read_stream(&files.audio);
    assert!(stream.closed);
    assert_eq!(stream.frames, 120_000);
    assert_eq!(stream.levels.len(), 125);
    assert!(stream.levels.iter().all(|level| *level > 0.09));
}

#[test]
fn recovery_is_safe_to_repeat_and_leaves_finished_files_alone() {
    let dir = tempfile::tempdir().unwrap();
    let copy = crashed_copy(dir.path());
    let files = TrackFiles::new(copy.path(), "a", TrackKind::Microphone).unwrap();
    let first = recover_track(&files).unwrap();
    let bytes = std::fs::read(&files.audio).unwrap();
    let second = recover_track(&files).unwrap();
    assert!(second.was_complete);
    assert_eq!(second.timeline, first.timeline);
    assert_eq!(std::fs::read(&files.audio).unwrap(), bytes);

    // The original recording finished cleanly, so it has nothing to recover.
    assert!(find_unfinished(dir.path()).unwrap().is_empty());
    assert!(
        recover_track(&TrackFiles::new(dir.path(), "a", TrackKind::Microphone).unwrap())
            .unwrap()
            .was_complete
    );
}

#[test]
fn a_recording_is_summarized_after_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let copy = crashed_copy(dir.path());
    tear(&copy.path().join("a-mic.ogg"), 3);
    // A timeline record cut short by the crash is ignored too.
    let timeline = copy.path().join("a-mic.timeline");
    let mut file = std::fs::OpenOptions::new().append(true).open(&timeline).unwrap();
    std::io::Write::write_all(&mut file, &[1, 2, 3]).unwrap();

    let recovered = recover_recording(copy.path(), "rec", &[mic_ref()]).unwrap();
    assert!(recovered.has_clock);
    let summary = recovered.summary;
    assert!(summary.recovered);
    assert_eq!(summary.clock.capture_ns, START);
    assert_eq!(summary.started_ns, START);
    assert_eq!(summary.ended_ns, START + 2_500_000_000);
    assert_eq!(summary.tracks.len(), 1);
    assert_eq!(summary.tracks[0].audio_file, "a-mic.ogg");
    let missing = TrackRef {
        kind: TrackKind::SystemAudio,
        asset: "a".into(),
    };
    assert!(matches!(
        recover_recording(copy.path(), "rec", &[missing]),
        Err(AudioError::Missing(_))
    ));
}

/// F5-5: a file that is there but damaged from its first page was answered like a recording with no files, so
/// the page gave it up and called it missing while it sat on disk. Only no files at all is `Missing`.
#[test]
fn a_damaged_file_on_disk_is_corrupt_not_missing() {
    let dir = tempfile::tempdir().unwrap();
    let files = TrackFiles::new(dir.path(), "a", TrackKind::Microphone).unwrap();
    std::fs::write(&files.audio, b"not an ogg file at all").unwrap();
    assert!(matches!(
        recover_recording(dir.path(), "rec", &[mic_ref()]),
        Err(AudioError::Corrupt(_))
    ));
    assert!(files.audio.exists(), "recovery leaves the damaged file alone");
}

#[test]
fn a_file_with_no_header_pages_is_reported_not_guessed() {
    let dir = tempfile::tempdir().unwrap();
    let files = TrackFiles::new(dir.path(), "x", TrackKind::Microphone).unwrap();
    std::fs::write(&files.audio, b"not an ogg file at all").unwrap();
    assert!(recover_track(&files).is_err());
}

/// Recovery can't cut off a file the recorder is still writing, since the recorder doesn't let anyone
/// else write to it. The recording goes on and ends cleanly.
#[cfg(windows)]
#[test]
fn a_file_that_is_still_being_written_cannot_be_recovered() {
    let dir = tempfile::tempdir().unwrap();
    let (source, handle) = test_tone_source(START);
    let recording = recorder(dir.path(), ManualClock::new(START))
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(1_000);
    wait_until(|| recording.health()[0].frames == 48_000);
    let files = TrackFiles::new(dir.path(), "a", TrackKind::Microphone).unwrap();
    let error = recover_track(&files).unwrap_err();
    assert!(error.to_string().contains("used by another process"), "{error}");
    assert!(recover_recording(dir.path(), "a", &[mic_ref()]).is_err());
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();
    assert_eq!(summary.tracks[0].timeline.frames, 96_000);
    let recovered = recover_track(&files).unwrap();
    assert!(recovered.was_complete && recovered.bytes_cut == 0);
    assert_eq!(recovered.timeline.frames, 96_000);
}
