//! The kill test: a process records in real time and is killed at an arbitrary moment. The files it
//! leaves must recover, play, and hold all but the last second of what was captured.
//!
//! The test runs itself as the child. The parent starts the test binary again with the `kill_child`
//! test selected, and reads the child's progress from its output. It then ends the process the hard
//! way (on Windows, TerminateProcess), so nothing in the child gets to clean up.

mod common;

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::noise;
use opennote_media::audio::recovery::{find_unfinished, recover_recording};
use opennote_media::audio::synthetic::synthetic;
use opennote_media::audio::{Clock, Recorder, SourceFormat, SystemClock, TrackKind, TrackStart};
use opennote_media::pcm_codec::{pcm_decoder_factory, pcm_encoder_factory};
use opennote_media::playback::TrackReader;

const CHILD_DIR: &str = "OPENNOTE_KILL_TEST_DIR";
const CHILD_CODEC: &str = "OPENNOTE_KILL_TEST_CODEC";

/// Which codec the child records with. The stand-in keeps the samples, so the test can compare them.
/// Real Opus is lossy, so the test only checks that its output decodes and has sound in it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Codec {
    Pcm,
    #[cfg(feature = "opus")]
    Opus,
}

impl Codec {
    fn name(self) -> &'static str {
        match self {
            Codec::Pcm => "pcm",
            #[cfg(feature = "opus")]
            Codec::Opus => "opus",
        }
    }
}
/// What a crash may lose, from the development plan.
const BUDGET_MS: u64 = 1_000;

/// The child: records until it is killed, and says how much audio it has captured.
#[test]
#[ignore = "runs only as the child of the kill test"]
fn kill_child() {
    let Ok(dir) = std::env::var(CHILD_DIR) else {
        return;
    };
    let clock = SystemClock;
    let format = SourceFormat {
        rate: 48_000,
        channels: 1,
    };
    let (source, handle) = synthetic(format, noise(), clock.now_ns());
    let recorder = Recorder::new(&dir);
    let recorder = match std::env::var(CHILD_CODEC).as_deref() {
        Ok("opus") => recorder,
        _ => recorder.with_encoder(pcm_encoder_factory()),
    };
    let track = TrackStart::new(TrackKind::Microphone, "a", Box::new(source));
    let _recording = recorder.start("rec", vec![track]).unwrap();
    let begun = Instant::now();
    let mut delivered_ms = 0;
    loop {
        // Deliver audio in step with the real clock, 10 ms at a time.
        let due_ms = begun.elapsed().as_millis() as u64 / 10 * 10;
        if due_ms > delivered_ms {
            handle.produce_ms(due_ms - delivered_ms);
            delivered_ms = due_ms;
            println!("T {delivered_ms}");
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// Starts the child, waits `after`, kills it, and returns the audio it reported capturing.
fn run_and_kill(dir: &Path, after: Duration, codec: Codec) -> u64 {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "kill_child", "--ignored", "--nocapture", "--test-threads=1"])
        .env(CHILD_DIR, dir)
        .env(CHILD_CODEC, codec.name())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let reported = Arc::new(AtomicU64::new(0));
    let stdout = child.stdout.take().unwrap();
    let seen = Arc::clone(&reported);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(ms) = line.strip_prefix("T ").and_then(|ms| ms.parse().ok()) {
                seen.store(ms, Ordering::SeqCst);
            }
        }
    });
    // The child needs a moment to start, so the wait begins at its first report.
    let started = Instant::now();
    while reported.load(Ordering::SeqCst) == 0 {
        assert!(started.elapsed() < Duration::from_secs(30), "the child never started");
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(after);
    child.kill().unwrap();
    child.wait().unwrap();
    reader.join().unwrap();
    reported.load(Ordering::SeqCst)
}

/// Recovers what the child left and checks it against what the child reported.
fn check_recovery(dir: &Path, reported_ms: u64, codec: Codec) -> u64 {
    let unfinished = find_unfinished(dir).unwrap();
    assert_eq!(unfinished.len(), 1, "the killed recording is unfinished");
    let recovered = recover_recording(dir, "rec", &unfinished).unwrap();
    assert!(recovered.has_clock);
    let summary = recovered.summary;
    let frames = summary.tracks[0].timeline.frames;
    let kept_ms = frames * 1_000 / 48_000;
    let lost_ms = reported_ms.saturating_sub(kept_ms);
    assert!(
        lost_ms <= BUDGET_MS,
        "{lost_ms} ms lost of {reported_ms} ms, which is over the budget"
    );
    assert!(
        kept_ms <= reported_ms + 100,
        "more audio ({kept_ms} ms) than was captured ({reported_ms} ms)"
    );

    check_playback(dir, &summary.tracks[0].audio_file, frames, codec);
    lost_ms
}

/// The recovered file plays from end to end.
fn check_playback(dir: &Path, file: &str, frames: u64, codec: Codec) {
    let audio = dir.join(file);
    let decoders = match codec {
        Codec::Pcm => pcm_decoder_factory(),
        #[cfg(feature = "opus")]
        Codec::Opus => opennote_media::playback::opus_decoder_factory(),
    };
    let mut reader = TrackReader::open(&audio, &decoders).unwrap();
    assert!(reader.is_complete());
    assert_eq!(reader.frames(), frames);
    let signal = noise();
    let (mut block, mut at, mut energy) = (vec![0.0; 4_800], 0, 0f64);
    while at < frames {
        let count = reader.read(at, &mut block).unwrap();
        assert!(count > 0);
        energy += block[..count].iter().map(|s| f64::from(*s).powi(2)).sum::<f64>();
        if codec == Codec::Pcm {
            // The last 312 samples were still inside the encoder, and read as silence.
            let verified = count.min(frames.saturating_sub(312).saturating_sub(at) as usize);
            for (index, sample) in block[..verified].iter().enumerate() {
                assert!(
                    (sample - signal(at + index as u64)).abs() < 5e-5,
                    "frame {}",
                    at + index as u64
                );
            }
        }
        at += count as u64;
    }
    assert_eq!(reader.damaged_packets(), 0);
    assert!(energy / frames as f64 > 0.01, "the recovered audio is silent");
}

fn kill_after(delays_ms: &[u64], codec: Codec) -> u64 {
    let mut worst = 0;
    for delay in delays_ms {
        let dir = tempfile::tempdir().unwrap();
        let reported = run_and_kill(dir.path(), Duration::from_millis(*delay), codec);
        worst = worst.max(check_recovery(dir.path(), reported, codec));
    }
    worst
}

#[test]
fn a_killed_recording_recovers_with_under_a_second_lost() {
    // Delays that are not multiples of the 500 ms page, so the kill falls in different places.
    let worst = kill_after(&[1_130, 1_870, 2_410], Codec::Pcm);
    println!("The worst loss was {worst} ms.");
}

#[cfg(feature = "opus")]
#[test]
fn a_killed_opus_recording_recovers_with_under_a_second_lost() {
    let worst = kill_after(&[1_340, 2_090], Codec::Opus);
    println!("The worst loss with Opus was {worst} ms.");
}

#[test]
#[ignore = "kills twenty recordings, which takes a minute"]
fn twenty_kills_at_random_moments_never_lose_a_second() {
    let delays: Vec<u64> = (0..20).map(|i: u64| 700 + (i * 7_919) % 4_300).collect();
    let worst = kill_after(&delays, Codec::Pcm);
    println!("The worst loss in {} kills was {worst} ms.", delays.len());
}
