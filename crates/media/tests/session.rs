//! A playback session with a test standing in for the sound device. The test pulls audio the way a
//! device callback would, and checks what comes out and what the status says.

mod common;

use std::path::Path;
use std::time::Duration;

use common::{noise, pcm_recorder, wait_until, SECOND};
use opennote_media::audio::synthetic::{synthetic, ManualClock};
use opennote_media::audio::{SourceFormat, TrackKind, TrackStart};
use opennote_media::pcm_codec::pcm_decoder_factory;
use opennote_media::playback::open_recording;
use opennote_media::playback::session::{PlayState, PlaybackSession};
use opennote_media::playback::{ManualOutput, OutputFormat};

const START: u64 = 7 * SECOND;
const STEREO: OutputFormat = OutputFormat {
    rate: 48_000,
    channels: 2,
};

fn session(dir: &Path, seconds: u64) -> (PlaybackSession, ManualOutput) {
    let (source, handle) = synthetic(
        SourceFormat {
            rate: 48_000,
            channels: 1,
        },
        noise(),
        START,
    );
    let recording = pcm_recorder(dir, ManualClock::new(START))
        .start(
            "rec",
            vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))],
        )
        .unwrap();
    handle.produce_ms(seconds * 1_000);
    let summary = recording.stop().unwrap();
    let player = open_recording(dir, &summary, &pcm_decoder_factory()).unwrap();
    let output = ManualOutput::new(STEREO);
    (
        PlaybackSession::start(player, Box::new(output.clone())).unwrap(),
        output,
    )
}

/// Takes the next `frames` frames of sound from the device, one frame at a time. A frame of zeros means
/// the session had nothing queued yet, and is skipped, since the signal is never zero.
fn take(output: &ManualOutput, frames: usize) -> Vec<f32> {
    let mut taken = Vec::with_capacity(frames * 2);
    wait_until(|| {
        while taken.len() < frames * 2 {
            let frame = output.pull(1);
            if frame[0] == 0.0 {
                return false;
            }
            taken.extend(frame);
        }
        true
    });
    taken
}

fn left(block: &[f32]) -> Vec<f32> {
    block.chunks(2).map(|frame| frame[0]).collect()
}

fn assert_noise(block: &[f32], first_frame: u64) {
    let signal = noise();
    for (index, sample) in left(block).iter().enumerate() {
        let expected = signal(first_frame + index as u64);
        assert!(
            (sample - expected).abs() < 5e-5,
            "frame {} was {sample}",
            first_frame + index as u64
        );
    }
}

#[test]
fn playing_sends_the_recording_to_both_channels() {
    let dir = tempfile::tempdir().unwrap();
    let (session, output) = session(dir.path(), 4);
    assert_eq!(session.status().state, PlayState::Paused);
    assert!(output.pull(480).iter().all(|sample| *sample == 0.0));

    session.play();
    let block = take(&output, 960);
    assert_noise(&block, 0);
    assert!(block.chunks(2).all(|frame| frame[0] == frame[1]));
    assert_noise(&take(&output, 960), 960);
    wait_until(|| session.status().state == PlayState::Playing);
    session.stop();
}

#[test]
fn a_seek_replaces_what_was_already_queued() {
    let dir = tempfile::tempdir().unwrap();
    let (session, output) = session(dir.path(), 4);
    session.play();
    take(&output, 960);
    // Without more pulls the ring fills with audio from the start.
    std::thread::sleep(Duration::from_millis(100));
    session.seek_ns(3 * SECOND);
    wait_until(|| session.status().position_ns >= 3 * SECOND - 50_000_000);
    std::thread::sleep(Duration::from_millis(100));
    assert_noise(&take(&output, 960), 3 * 48_000);
}

#[test]
fn pausing_silences_at_once_and_playing_goes_back_two_seconds() {
    let dir = tempfile::tempdir().unwrap();
    let (session, output) = session(dir.path(), 8);
    session.play();
    // Listen to three seconds.
    take(&output, 3 * 48_000);
    session.pause();
    wait_until(|| session.status().state == PlayState::Paused);
    let paused_at = session.status().position_ns;
    assert!(
        output.pull(960).iter().all(|sample| *sample == 0.0),
        "audio after the pause"
    );
    assert!((2_900_000_000..3_100_000_000).contains(&paused_at), "{paused_at}");

    // Playing again goes back two seconds from where the listener was.
    session.play();
    let block = take(&output, 960);
    let expected_frame = (paused_at - 2 * SECOND) * 48_000 / SECOND;
    let signal = noise();
    let first = left(&block)[0];
    assert!(
        (signal(expected_frame) - first).abs() < 5e-5,
        "playback did not resume at frame {expected_frame}"
    );
}

#[test]
fn playback_ends_and_can_start_over() {
    let dir = tempfile::tempdir().unwrap();
    let (session, output) = session(dir.path(), 1);
    session.play();
    assert_noise(&take(&output, 48_000), 0);
    wait_until(|| {
        output.pull(960);
        session.status().state == PlayState::Ended
    });
    assert_eq!(session.status().position_ns, SECOND);

    session.play();
    assert_noise(&take(&output, 960), 0);
}

#[test]
fn speed_and_skipping_are_reported_and_move_the_position() {
    let dir = tempfile::tempdir().unwrap();
    let (session, output) = session(dir.path(), 8);
    session.set_speed(2.0);
    session.set_skip_silence(true);
    wait_until(|| {
        let status = session.status();
        status.speed == 2.0 && status.skip_silence
    });
    session.play();
    // A second of output at double speed covers two seconds of the recording.
    take(&output, 48_000);
    let position = session.status().position_ns;
    assert!((1_700_000_000..2_400_000_000).contains(&position), "{position}");

    session.skip_ns(3 * SECOND as i64);
    wait_until(|| session.status().position_ns >= position + 2_500_000_000);
}
