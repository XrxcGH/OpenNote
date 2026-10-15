//! The Whisper engine on real speech. The clips in `fixtures/speech` were made with the voices built into Windows,
//! so their words are known exactly. The model is not in the repository (it is 75 MB and the person downloads it
//! with consent). Set OPENNOTE_SPEECH_MODEL to a ggml model file, such as ggml-tiny.en.bin, to run these tests;
//! without it they say so and pass.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use opennote_intel::transcribe::{
    JobRequest, JobStatus, MemoryAudio, TranscribeOptions, TranscriptionEngine, TranscriptionQueue,
};
use opennote_intel::whisper::WhisperEngine;
use opennote_intel::IntelError;

fn model() -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os("OPENNOTE_SPEECH_MODEL")?);
    path.is_file().then_some(path)
}

/// Reads a 16-bit mono WAV file into samples from -1 to 1.
fn wav(name: &str) -> Vec<f32> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/speech")
        .join(name);
    let bytes = std::fs::read(&path).unwrap();
    assert_eq!(&bytes[..4], b"RIFF");
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let len = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        if id == b"data" {
            let data = &bytes[at + 8..(at + 8 + len).min(bytes.len())];
            return data
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0)
                .collect();
        }
        at += 8 + len + (len & 1);
    }
    panic!("{name} has no data");
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

/// The word error rate: edits to turn `heard` into `said`, over the words said.
fn word_error_rate(said: &str, heard: &str) -> f32 {
    let (a, b) = (words(said), words(heard));
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut previous = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let current = row[j];
            row[j] = (row[j] + 1)
                .min(row[j - 1] + 1)
                .min(previous + usize::from(a[i - 1] != b[j - 1]));
            previous = current;
        }
    }
    row[b.len()] as f32 / a.len() as f32
}

const LECTURE: &str =
    "Today we will talk about the mitochondria. It is the powerhouse of the cell, and it makes energy \
                       for the body.";

#[test]
fn the_model_hears_a_lecture_clip_accurately() {
    let Some(path) = model() else {
        eprintln!("OPENNOTE_SPEECH_MODEL is not set, so the accuracy test did not run.");
        return;
    };
    let engine = WhisperEngine::new(path);
    let started = std::time::Instant::now();
    let segments = engine.transcribe_samples(&wav("lecture.wav"), None, "").unwrap();
    eprintln!("heard {segments:?} in {:?}", started.elapsed());
    let text: Vec<&str> = segments.iter().map(|s| s.text.as_str()).collect();
    let heard = text.join(" ");
    let rate = word_error_rate(LECTURE, &heard);
    assert!(rate <= 0.15, "word error rate {rate} for {heard:?}");
    // Times run forward and stay inside the clip, which is under eight seconds.
    let mut last = 0;
    for segment in &segments {
        assert!(
            segment.start_ms >= last && segment.end_ms > segment.start_ms,
            "{segments:?}"
        );
        assert!(segment.end_ms <= 8_500, "{segments:?}");
        last = segment.start_ms;
    }
}

#[test]
fn silence_gives_no_lines() {
    let Some(path) = model() else {
        return;
    };
    let engine = WhisperEngine::new(path);
    let segments = engine.transcribe_samples(&vec![0.0; 16_000 * 5], None, "").unwrap();
    assert!(segments.is_empty(), "{segments:?}");
}

#[test]
fn the_vocabulary_prompt_is_accepted() {
    let Some(path) = model() else {
        return;
    };
    let engine = WhisperEngine::new(path);
    let segments = engine
        .transcribe_samples(&wav("lecture.wav"), None, "mitochondria, ATP, Krebs cycle")
        .unwrap();
    let heard: String = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    assert!(heard.to_lowercase().contains("mitochondria"), "{heard}");
}

#[test]
fn jobs_queue_one_at_a_time_and_can_be_canceled() {
    let Some(path) = model() else {
        return;
    };
    let engine: Arc<dyn TranscriptionEngine> = Arc::new(WhisperEngine::new(path));
    let queue = TranscriptionQueue::new(engine);
    let first = queue.submit(JobRequest {
        audio: Box::new(MemoryAudio::new(wav("david.wav"))),
        options: TranscribeOptions::default(),
    });
    let second = queue.submit(JobRequest {
        audio: Box::new(MemoryAudio::new(wav("zira.wav"))),
        options: TranscribeOptions::default(),
    });
    let third = queue.submit(JobRequest {
        audio: Box::new(MemoryAudio::new(wav("lecture.wav"))),
        options: TranscribeOptions::default(),
    });
    // The third waits behind the others, and a canceled job never runs.
    assert!(matches!(third.status(), JobStatus::Queued { .. }));
    third.cancel();
    let heard = first.wait().unwrap().text().to_lowercase();
    assert!(heard.contains("good morning"), "{heard}");
    let heard = second.wait().unwrap().text().to_lowercase();
    assert!(heard.contains("temperature"), "{heard}");
    assert_eq!(
        third.wait_timeout(Duration::from_secs(5)),
        Some(Err(IntelError::Canceled))
    );
}

#[test]
fn a_running_job_stops_when_canceled() {
    let Some(path) = model() else {
        return;
    };
    let engine: Arc<dyn TranscriptionEngine> = Arc::new(WhisperEngine::new(path));
    let queue = TranscriptionQueue::new(engine);
    // Three minutes of a clip played over and over, so the job is still running when the cancel comes.
    let clip = wav("lecture.wav");
    let long: Vec<f32> = clip.iter().copied().cycle().take(16_000 * 180).collect();
    let job = queue.submit(JobRequest {
        audio: Box::new(MemoryAudio::new(long)),
        options: TranscribeOptions::default(),
    });
    std::thread::sleep(Duration::from_millis(300));
    job.cancel();
    assert_eq!(
        job.wait_timeout(Duration::from_secs(60)),
        Some(Err(IntelError::Canceled))
    );
}

#[test]
fn the_word_error_rate_counts_edits() {
    assert_eq!(word_error_rate("a b c d", "a b c d"), 0.0);
    assert_eq!(word_error_rate("a b c d", "a x c"), 0.5);
}
