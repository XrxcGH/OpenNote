//! Real Opus, end to end: a generated tone is recorded, then decoded with libopus. These tests need
//! the `opus` feature, which builds libopus with CMake: `cargo test -p opennote-media --features opus`.

#![cfg(feature = "opus")]

use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;

use opennote_media::audio::encoder::parse_pre_skip;
use opennote_media::audio::ogg::scan_pages;
use opennote_media::audio::synthetic::{sine, synthetic, ManualClock};
use opennote_media::audio::{Options, Recorder, SourceFormat, TrackKind, TrackStart};

const START: u64 = 3_000_000_000;

#[test]
fn a_recorded_tone_decodes_to_the_same_tone() {
    let dir = tempfile::tempdir().unwrap();
    let format = SourceFormat {
        rate: 48_000,
        channels: 1,
    };
    let (source, handle) = synthetic(format, sine(440.0, 0.1, 48_000), START);
    let options = Options {
        sync: false,
        ..Options::default()
    };
    let recorder = Recorder::new(dir.path())
        .with_clock(ManualClock::new(START))
        .with_options(options);
    let recording = recorder
        .start("a", vec![TrackStart::new(TrackKind::Microphone, "a", Box::new(source))])
        .unwrap();
    handle.produce_ms(5_000);
    let summary = recording.stop().unwrap();
    assert_eq!(summary.tracks[0].timeline.frames, 240_000);

    let path = dir.path().join(&summary.tracks[0].audio_file);
    let mut reader = ogg::PacketReader::new(BufReader::new(File::open(&path).unwrap()));
    let head = reader.read_packet().unwrap().unwrap().data;
    let pre_skip = usize::from(parse_pre_skip(&head).unwrap());
    reader.read_packet().unwrap().unwrap(); // the comment header
    let mut decoder = opus::Decoder::new(48_000, opus::Channels::Mono).unwrap();
    let (mut pcm, mut frame) = (Vec::new(), vec![0f32; 960]);
    while let Some(packet) = reader.read_packet().unwrap() {
        let samples = decoder.decode_float(&packet.data, &mut frame, false).unwrap();
        pcm.extend_from_slice(&frame[..samples]);
    }
    // The writer adds one frame of silence at the end, so libopus's lookahead comes out too.
    assert_eq!(pcm.len(), 251 * 960);
    let tail = &pcm[pre_skip + 239_000..pre_skip + 240_000];
    let tail_rms = (tail.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / tail.len() as f64).sqrt();
    assert!((tail_rms - 0.0707).abs() < 0.01, "RMS at the end {tail_rms}");

    // A sine at 0.1 has an RMS of 0.0707. Measure the middle two seconds.
    let middle = &pcm[pre_skip + 96_000..pre_skip + 192_000];
    let rms = (middle.iter().map(|s| f64::from(*s).powi(2)).sum::<f64>() / middle.len() as f64).sqrt();
    assert!((rms - 0.0707).abs() < 0.01, "RMS {rms}");

    // The last page's granule position trims the padding, so a decoder plays exactly 5 s.
    let scan = scan_pages(BufReader::new(File::open(&path).unwrap())).unwrap();
    assert_eq!(scan.pages.last().unwrap().granule, pre_skip as u64 + 240_000);
    // 32 kbps is 20 KB for 5 s. A pure tone takes less.
    let bytes = std::fs::metadata(&path).unwrap().len();
    assert!(bytes > 2_000 && bytes < 30_000, "{bytes} bytes");
}

/// The place of the burst in `record_burst`'s signal.
const BURST: std::ops::Range<u64> = 100_000..102_400;

/// Records 4 s of faint tone with a burst of noise at a known place.
fn record_burst(dir: &std::path::Path) -> opennote_media::audio::RecordingSummary {
    use opennote_media::audio::synthetic::Signal;
    use opennote_media::audio::TrackStart;

    let burst: Signal = Arc::new(|frame| {
        if BURST.contains(&frame) {
            let mixed = frame.wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(29);
            ((mixed >> 40) as f32 / 16_777_216.0 - 0.5) * 0.8
        } else {
            0.0005 * (frame as f32 * 0.05).sin()
        }
    });
    let format = SourceFormat {
        rate: 48_000,
        channels: 1,
    };
    let (source, handle) = synthetic(format, burst, START);
    let options = Options {
        sync: false,
        ..Options::default()
    };
    let recorder = Recorder::new(dir)
        .with_clock(ManualClock::new(START))
        .with_options(options);
    let track = TrackStart::new(TrackKind::Microphone, "a", Box::new(source));
    let recording = recorder.start("rec", vec![track]).unwrap();
    handle.produce_ms(4_000);
    recording.stop().unwrap()
}

/// Renders `samples` samples of a player.
fn render(player: &mut opennote_media::playback::Player, samples: usize) -> Vec<f32> {
    let mut audio = vec![0f32; samples];
    let mut done = 0;
    while done < samples {
        let count = player.render(&mut audio[done..]).unwrap();
        if count == 0 {
            break;
        }
        done += count;
    }
    audio.truncate(done);
    audio
}

/// Finds where the burst is in the decoded audio. A wrong pre-skip or a wrong seek lead-in would
/// move it.
#[test]
fn real_opus_plays_back_where_it_was_recorded() {
    use opennote_media::playback::{open_recording, opus_decoder_factory};

    let dir = tempfile::tempdir().unwrap();
    let summary = record_burst(dir.path());
    let mut player = open_recording(dir.path(), &summary, &opus_decoder_factory()).unwrap();
    let audio = render(&mut player, 200_000);
    assert_eq!(audio.len(), 192_000);
    // Opus is lossy, so the center is only found to within half a millisecond.
    let center = center_of_energy(&audio);
    assert!((center as i64 - 101_200).abs() <= 24, "the burst is at {center}");

    // Seeking into the middle of the burst, with the lead-in Opus needs, finds the same audio.
    player.seek_ns(2_000_000_000);
    let again = render(&mut player, 96_000);
    assert_eq!(again.len(), 96_000);
    let seeked = center_of_energy(&again) + 96_000;
    assert!(
        (seeked as i64 - 101_200).abs() <= 24,
        "the burst is at {seeked} after a seek"
    );
}

/// The frame at the middle of the signal's energy.
fn center_of_energy(audio: &[f32]) -> usize {
    let total: f64 = audio.iter().map(|s| f64::from(*s).powi(2)).sum();
    let mut running = 0.0;
    audio
        .iter()
        .position(|s| {
            running += f64::from(*s).powi(2);
            running >= total / 2.0
        })
        .unwrap()
}
