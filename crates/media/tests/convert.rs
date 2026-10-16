//! Compressing, enhancing, and measuring recordings. The stand-in codec keeps the samples, so the
//! pipeline tests compare audio to the sample. The test with real Opus runs with `--features opus`.

mod common;

use std::path::Path;
use std::sync::Arc;

use common::{noise, pcm_recorder, SECOND};
use opennote_media::audio::encoder::{EncoderFactory, FrameEncoder};
use opennote_media::audio::synthetic::{synthetic, ManualClock, Signal};
use opennote_media::audio::{AudioError, RecordingSummary, SourceFormat, TrackKind, TrackRef, TrackStart};
use opennote_media::convert::{enhance, transcode, Settings};
use opennote_media::layout::RecordingPlan;
use opennote_media::pcm_codec::{pcm_decoder_factory, pcm_encoder_factory};
use opennote_media::playback::{open_recording, Player};
use opennote_media::storage::{delete_audio, space_freed_by_compressing, usage};
use sha2::{Digest, Sha256};

const START: u64 = 7 * SECOND;
const MONO: SourceFormat = SourceFormat {
    rate: 48_000,
    channels: 1,
};

fn plan(id: &str, asset: &str) -> RecordingPlan {
    RecordingPlan {
        id: id.into(),
        tracks: vec![TrackRef {
            kind: TrackKind::Microphone,
            asset: asset.into(),
        }],
    }
}

fn record_signal(dir: &Path, signal: Signal, seconds: u64) -> RecordingSummary {
    let (source, handle) = synthetic(MONO, signal, START);
    let track = TrackStart::new(TrackKind::Microphone, "a", Box::new(source));
    let recording = pcm_recorder(dir, ManualClock::new(START))
        .start("rec", vec![track])
        .unwrap();
    handle.produce_ms(seconds * 1_000);
    recording.stop().unwrap()
}

fn play_all(dir: &Path, summary: &RecordingSummary) -> Vec<f32> {
    let mut player: Player = open_recording(dir, summary, &pcm_decoder_factory()).unwrap();
    let mut audio = Vec::new();
    let mut block = vec![0.0; 4_800];
    loop {
        let count = player.render(&mut block).unwrap();
        audio.extend_from_slice(&block[..count]);
        if count < block.len() {
            return audio;
        }
    }
}

fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

#[test]
fn a_copy_with_no_processor_is_exact_and_keeps_the_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_signal(dir.path(), noise(), 3);
    let audio = dir.path().join(&summary.tracks[0].audio_file);
    let before = Sha256::digest(std::fs::read(&audio).unwrap());

    let copy = transcode(
        dir.path(),
        &summary,
        &plan("copy", "c"),
        &pcm_decoder_factory(),
        &pcm_encoder_factory(),
        &|_| None,
    )
    .unwrap();

    assert_eq!(copy.id, "copy");
    assert_eq!(copy.tracks[0].asset, "c");
    assert_eq!(copy.tracks[0].timeline, summary.tracks[0].timeline);
    assert_eq!(Sha256::digest(std::fs::read(&audio).unwrap()), before);
    let (old, new) = (play_all(dir.path(), &summary), play_all(dir.path(), &copy));
    assert_eq!(new.len(), old.len());
    for (index, (a, b)) in old.iter().zip(&new).enumerate() {
        assert!((a - b).abs() < 1e-4, "sample {index}: {a} and {b}");
    }
}

/// Hiss all the way through, and a voice-like tone between 3 s and 5 s.
fn room_with_voice() -> Signal {
    Arc::new(|frame| {
        let t = frame as f32 / 48_000.0;
        let hiss = (noise()(frame)) * 0.03;
        let voice = if (3.0..5.0).contains(&t) {
            0.1 * ((std::f32::consts::TAU * 220.0 * t).sin() + 0.5 * (std::f32::consts::TAU * 660.0 * t).sin())
        } else {
            0.0
        };
        hiss + voice
    })
}

#[test]
fn enhancing_makes_a_quieter_room_with_the_same_length_and_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_signal(dir.path(), room_with_voice(), 8);
    let copy = enhance(
        dir.path(),
        &summary,
        &plan("better", "e"),
        &pcm_decoder_factory(),
        &pcm_encoder_factory(),
        Settings {
            level_voice: false,
            ..Settings::default()
        },
    )
    .unwrap();

    assert_eq!(copy.tracks[0].timeline, summary.tracks[0].timeline);
    let (old, new) = (play_all(dir.path(), &summary), play_all(dir.path(), &copy));
    assert_eq!(new.len(), old.len());
    let room = 6 * 48_000..8 * 48_000;
    let cut = 20.0 * (rms(&old[room.clone()]) / rms(&new[room])).log10();
    assert!(cut > 10.0, "the room fell by only {cut:.1} dB");
    let speech = 3 * 48_000 + 24_000..5 * 48_000 - 24_000;
    let change = 20.0 * (rms(&new[speech.clone()]) / rms(&old[speech])).log10();
    assert!(change.abs() < 1.5, "the voice changed by {change:.1} dB");
}

/// An encoder that works for a while and then fails, as a full disk or a bad frame would.
struct Breaks {
    inner: Box<dyn FrameEncoder>,
    left: usize,
}

impl FrameEncoder for Breaks {
    fn pre_skip(&self) -> u16 {
        self.inner.pre_skip()
    }

    fn encode(&mut self, pcm: &[f32], out: &mut Vec<u8>) -> opennote_media::audio::Result<()> {
        if self.left == 0 {
            return Err(AudioError::Encoder("broken".into()));
        }
        self.left -= 1;
        self.inner.encode(pcm, out)
    }

    fn delays_output(&self) -> bool {
        self.inner.delays_output()
    }
}

#[test]
fn a_copy_that_fails_part_way_leaves_no_files_behind() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_signal(dir.path(), noise(), 3);
    let names = std::fs::read_dir(dir.path()).unwrap().count();
    let broken: EncoderFactory = Arc::new(|| {
        Ok(Box::new(Breaks {
            inner: pcm_encoder_factory()()?,
            left: 50,
        }) as Box<dyn FrameEncoder>)
    });
    let result = transcode(
        dir.path(),
        &summary,
        &plan("x", "x"),
        &pcm_decoder_factory(),
        &broken,
        &|_| None,
    );
    assert!(result.is_err());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), names);
}

#[test]
fn usage_counts_the_files_and_deleting_the_audio_frees_them() {
    let dir = tempfile::tempdir().unwrap();
    let summary = record_signal(dir.path(), noise(), 2);
    let used = usage(dir.path(), &summary);
    assert_eq!(used.duration_ns, 2 * SECOND);
    assert!(used.tracks[0].audio_bytes > 0 && used.tracks[0].timeline_bytes > 0);
    assert_eq!(
        used.total_bytes,
        used.tracks[0].audio_bytes + used.tracks[0].timeline_bytes
    );

    assert_eq!(delete_audio(dir.path(), &summary).unwrap(), used.total_bytes);
    assert_eq!(usage(dir.path(), &summary).total_bytes, 0);
    // Deleting again is not an error.
    assert_eq!(delete_audio(dir.path(), &summary).unwrap(), 0);
    assert_eq!(
        space_freed_by_compressing(dir.path(), &summary, opennote_media::convert::Quality::Smaller),
        0
    );
}

#[cfg(feature = "opus")]
mod with_opus {
    use super::*;
    use opennote_media::audio::encoder::opus_factory;
    use opennote_media::convert::{compress, Quality};
    use opennote_media::playback::opus_decoder_factory;
    use opennote_media::storage::estimated_size;

    #[test]
    fn compressing_halves_the_file_and_keeps_the_length_and_timeline() {
        let dir = tempfile::tempdir().unwrap();
        let (source, handle) = synthetic(MONO, room_with_voice(), START);
        let track = TrackStart::new(TrackKind::Microphone, "a", Box::new(source));
        let recording = pcm_recorder(dir.path(), ManualClock::new(START))
            .with_encoder(opus_factory())
            .start("rec", vec![track])
            .unwrap();
        handle.produce_ms(60_000);
        let summary = recording.stop().unwrap();

        let copy = compress(
            dir.path(),
            &summary,
            &plan("small", "s"),
            &opus_decoder_factory(),
            Quality::Smaller,
        )
        .unwrap();
        assert_eq!(copy.tracks[0].timeline, summary.tracks[0].timeline);
        let (old, new) = (usage(dir.path(), &summary), usage(dir.path(), &copy));
        assert_eq!(old.duration_ns, new.duration_ns);
        let ratio = new.tracks[0].audio_bytes as f64 / old.tracks[0].audio_bytes as f64;
        assert!(ratio < 0.65, "the copy is {ratio:.2} of the original");
        let estimate = estimated_size(&summary, Quality::Smaller) as f64 / new.tracks[0].audio_bytes as f64;
        assert!(
            (0.85..1.15).contains(&estimate),
            "the estimate is {estimate:.2} of the real size"
        );
        let freed = space_freed_by_compressing(dir.path(), &summary, Quality::Smaller);
        assert!(freed > old.tracks[0].audio_bytes / 3);

        // The copy plays to the end.
        let mut player = open_recording(dir.path(), &copy, &opus_decoder_factory()).unwrap();
        assert_eq!(player.duration_ns(), 60 * SECOND);
        let mut block = vec![0.0; 48_000];
        player.seek_ns(59 * SECOND);
        assert_eq!(player.render(&mut block).unwrap(), 48_000);
    }
}
