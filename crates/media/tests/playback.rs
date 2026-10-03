//! Playback of real recordings: the audio that comes out is the audio that went in, at the right
//! place, through pauses, two tracks, seeks, and speed changes. The stand-in codec keeps the samples,
//! so every comparison is to the sample.

mod common;

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use common::{noise, pcm_recorder, SECOND};
use opennote_media::audio::ogg::scan_pages;
use opennote_media::audio::recovery::recover_recording;
use opennote_media::audio::synthetic::{synthetic, ManualClock, SyntheticHandle};
use opennote_media::audio::{RecordingSummary, SourceFormat, TrackKind, TrackRef, TrackStart};
use opennote_media::pcm_codec::pcm_decoder_factory;
use opennote_media::playback::{open_recording, Player, TrackReader};

const START: u64 = 7 * SECOND;
const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};
/// The stand-in codec keeps 16 bits.
const TOLERANCE: f32 = 5e-5;

fn source(start_ns: u64) -> (TrackStart, SyntheticHandle) {
    let (source, handle) = synthetic(MONO, noise(), start_ns);
    (TrackStart::new(TrackKind::Microphone, "a", Box::new(source)), handle)
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

fn assert_noise(audio: &[f32], first_frame: u64) {
    let signal = noise();
    for (index, sample) in audio.iter().enumerate() {
        let expected = signal(first_frame + index as u64);
        assert!(
            (sample - expected).abs() < TOLERANCE,
            "sample {index} from frame {first_frame}: {sample} is not {expected}"
        );
    }
}

fn record_three_seconds(dir: &Path) -> RecordingSummary {
    let (track, handle) = source(START);
    let recording = pcm_recorder(dir, ManualClock::new(START))
        .start("rec", vec![track])
        .unwrap();
    handle.produce_ms(3_000);
    recording.stop().unwrap()
}

#[test]
fn what_was_recorded_is_what_plays() {
    let dir = tempfile::tempdir().unwrap();
    let mut player = open(dir.path(), &record_three_seconds(dir.path()));
    assert_eq!(player.duration_ns(), 3 * SECOND);
    let audio = render(&mut player, 200_000);
    assert_eq!(audio.len(), 144_000);
    assert_noise(&audio, 0);
    assert!(player.is_ended());
    assert_eq!(player.position_ns(), 3 * SECOND);
}

#[test]
fn a_seek_lands_on_the_right_sample_from_any_direction() {
    let dir = tempfile::tempdir().unwrap();
    let mut player = open(dir.path(), &record_three_seconds(dir.path()));
    for (seconds_ns, first_frame) in [
        (1_500_000_000u64, 72_000u64),
        (250_000_000, 12_000),
        (2_999_000_000, 143_952),
    ] {
        player.seek_ns(seconds_ns);
        let audio = render(&mut player, 960);
        assert_noise(&audio, first_frame);
    }
    // Reading on past a seek continues without a gap or a repeat.
    player.seek_ns(SECOND);
    let audio = render(&mut player, 5_000);
    assert_noise(&audio, 48_000);
    assert!((player.position_ns() as i64 - (SECOND as i64 + 104_166_666)).abs() < 100_000);
}

#[test]
fn skips_move_by_the_asked_time_and_stop_at_the_ends() {
    let dir = tempfile::tempdir().unwrap();
    let mut player = open(dir.path(), &record_three_seconds(dir.path()));
    player.seek_ns(SECOND);
    player.skip_ns(500_000_000);
    assert_eq!(player.position_ns(), 1_500_000_000);
    player.skip_ns(-2_000_000_000);
    assert_eq!(player.position_ns(), 0);
    player.skip_ns(60_000_000_000);
    assert_eq!(player.position_ns(), 3 * SECOND);
    assert!(render(&mut player, 100).is_empty());
    player.seek_ns(2 * SECOND);
    player.rewind_for_resume();
    assert_eq!(player.position_ns(), 0);
}

#[test]
fn a_pause_is_skipped_and_the_audio_on_each_side_is_exact() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (track, handle) = source(START);
    let mut recording = pcm_recorder(dir.path(), clock.clone())
        .start("rec", vec![track])
        .unwrap();
    handle.produce_ms(1_000);
    clock.set_ns(handle.now_ns());
    recording.pause().unwrap();
    handle.produce_ms(30_000);
    clock.set_ns(handle.now_ns());
    recording.resume().unwrap();
    handle.produce_ms(1_000);
    let summary = recording.stop().unwrap();

    let mut player = open(dir.path(), &summary);
    assert_eq!(player.duration_ns(), 2 * SECOND);
    let before = render(&mut player, 48_000);
    assert_noise(&before, 0);
    let after = render(&mut player, 48_000);
    assert_noise(&after, 48_000 + 30 * 48_000);
    assert!(render(&mut player, 10).is_empty());
}

#[test]
fn two_tracks_are_added_where_they_overlap() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (mic, mic_handle) = source(START);
    let (system, system_handle) = synthetic(MONO, noise(), START + SECOND);
    let system = TrackStart::new(TrackKind::SystemAudio, "b", Box::new(system));
    let recording = pcm_recorder(dir.path(), clock).start("rec", vec![mic, system]).unwrap();
    mic_handle.produce_ms(2_000);
    system_handle.produce_ms(2_000);
    let summary = recording.stop().unwrap();

    // The microphone covers 0 to 2 s and system audio 1 to 3 s, so the recording is 3 s long.
    let mut player = open(dir.path(), &summary);
    assert_eq!(player.duration_ns(), 3 * SECOND);
    let audio = render(&mut player, 144_000);
    let signal = noise();
    for frame in [
        100usize, 20_000, 47_999, 48_000, 60_000, 95_999, 96_000, 120_000, 143_999,
    ] {
        let mic_part = if frame < 96_000 { signal(frame as u64) } else { 0.0 };
        let system_part = if frame >= 48_000 {
            signal(frame as u64 - 48_000)
        } else {
            0.0
        };
        let expected = (mic_part + system_part).clamp(-1.0, 1.0);
        assert!((audio[frame] - expected).abs() < 2.0 * TOLERANCE, "frame {frame}");
    }
}

#[test]
fn double_speed_halves_the_time_and_seeking_still_works() {
    let dir = tempfile::tempdir().unwrap();
    let mut player = open(dir.path(), &record_three_seconds(dir.path()));
    player.set_speed(2.0);
    let audio = render(&mut player, 200_000);
    let expected = 72_000i64;
    assert!((audio.len() as i64 - expected).abs() < 6_000, "{} samples", audio.len());
    assert!(player.is_ended());

    player.set_speed(1.0);
    player.seek_ns(2 * SECOND);
    assert_noise(&render(&mut player, 480), 96_000);
}

#[test]
fn the_position_follows_the_audio_at_other_speeds() {
    let dir = tempfile::tempdir().unwrap();
    let mut player = open(dir.path(), &record_three_seconds(dir.path()));
    player.set_speed(1.5);
    player.seek_ns(SECOND);
    render(&mut player, 48_000);
    // A second of output at 1.5x covers 1.5 s of the recording.
    let position = player.position_ns() as i64;
    assert!((position - 2_500_000_000).abs() < 150_000_000, "{position}");
    assert_eq!(player.speed(), 1.5);
}

#[test]
fn a_damaged_page_plays_as_silence_and_the_rest_plays_on() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_three_seconds(dir.path());
    let path = dir.path().join(&summary.tracks[0].audio_file);
    let scan = scan_pages(BufReader::new(File::open(&path).unwrap())).unwrap();
    // Two header pages, and then pages of 25 packets. Damage the third audio page: packets 50 to 74.
    let at = scan.pages[4].offset as usize + 1_000;
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[at] ^= 0xFF;
    std::fs::write(&path, bytes).unwrap();

    let mut player = open(dir.path(), &summary);
    let audio = render(&mut player, 144_000);
    assert_eq!(audio.len(), 144_000);
    // The decoder's delay of 312 samples moves packet 50 to frame 47,688.
    assert_noise(&audio[..47_688], 0);
    assert!(audio[47_688..71_688].iter().all(|s| *s == 0.0));
    assert_noise(&audio[71_688..], 71_688);
}

#[test]
fn a_file_cut_short_by_a_crash_plays_up_to_where_it_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_three_seconds(dir.path());
    let path = dir.path().join(&summary.tracks[0].audio_file);
    let length = std::fs::metadata(&path).unwrap().len();
    // The last two pages go: the page with the final packet, and most of the one before it.
    let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(length - 50_000).unwrap();
    drop(file);
    let track = TrackRef {
        kind: TrackKind::Microphone,
        asset: "a".into(),
    };
    let recovered = recover_recording(dir.path(), "rec", &[track]).unwrap();

    let mut player = open(dir.path(), &recovered.summary);
    let audio = render(&mut player, 200_000);
    assert_eq!(audio.len(), 120_000);
    // The last 312 samples were still inside the encoder when the crash came.
    assert_noise(&audio[..119_688], 0);
    assert!(audio[119_688..].iter().all(|s| *s == 0.0));
}

#[test]
fn a_recording_can_be_followed_while_it_grows() {
    let dir = tempfile::tempdir().unwrap();
    let clock = ManualClock::new(START);
    let (track, handle) = source(START);
    let recording = pcm_recorder(dir.path(), clock).start("rec", vec![track]).unwrap();
    handle.produce_ms(1_000);
    common::wait_until(|| recording.health()[0].frames == 48_000);

    // Listening back while recording: the reader sees the pages that have been written so far.
    let path = dir.path().join("a-mic.ogg");
    let mut reader = TrackReader::open(&path, &pcm_decoder_factory()).unwrap();
    let first = reader.frames();
    assert!(first > 0 && first <= 48_000, "{first} frames");
    assert!(!reader.is_complete());
    let mut block = vec![0.0; 4_800];
    assert_eq!(reader.read(0, &mut block).unwrap(), 4_800);
    assert_noise(&block, 0);

    handle.produce_ms(1_000);
    common::wait_until(|| recording.health()[0].frames == 96_000);
    reader.refresh().unwrap();
    assert!(reader.frames() > first, "the reader should see the new pages");
    assert_eq!(reader.read(first - 1_000, &mut block).unwrap(), 4_800);
    assert_noise(&block, first - 1_000);

    recording.stop().unwrap();
    reader.refresh().unwrap();
    assert!(reader.is_complete());
    assert_eq!(reader.frames(), 96_000);
}
