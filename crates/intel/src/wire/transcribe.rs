//! Transcribing recordings for the app's command layer: a source that turns the recording's 48 kHz audio into the
//! 16 kHz the model reads, and a hub that queues jobs, reports their progress, and applies the vocabulary to what
//! they hear. The command layer names only these types.

use std::collections::HashMap;
use std::f32::consts::PI;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::engines::Engines;
use crate::error::{ErrorInfo, IntelError};
use crate::geometry::Language;
use crate::settings::Feature;
use crate::transcribe::{
    AudioSource, Device, JobEventKind, JobHandle, JobRequest, TranscribeOptions, TranscriptionEngine,
    TranscriptionQueue,
};
use crate::vocabulary::Vocabulary;
use crate::whisper::{WhisperEngine, MAX_PROMPT_CHARS};

/// Taps of the low-pass filter applied before keeping every third sample.
const TAPS: usize = 63;

fn low_pass() -> Vec<f32> {
    // A windowed sinc with its cutoff at 7.6 kHz of 48 kHz, under the 8 kHz the 16 kHz output can hold.
    let cutoff = 7_600.0 / 48_000.0;
    let middle = (TAPS - 1) as f32 / 2.0;
    let mut taps: Vec<f32> = (0..TAPS)
        .map(|i| {
            let x = i as f32 - middle;
            let sinc = if x == 0.0 {
                2.0 * cutoff
            } else {
                (2.0 * PI * cutoff * x).sin() / (PI * x)
            };
            let window = 0.42 - 0.5 * (2.0 * PI * i as f32 / (TAPS - 1) as f32).cos()
                + 0.08 * (4.0 * PI * i as f32 / (TAPS - 1) as f32).cos();
            sinc * window
        })
        .collect();
    let sum: f32 = taps.iter().sum();
    taps.iter_mut().for_each(|t| *t /= sum);
    taps
}

type ReadFn = Box<dyn FnMut(&mut [f32]) -> Result<usize, String> + Send>;
type RewindFn = Box<dyn FnMut() -> Result<(), String> + Send>;

/// Mono audio at 48 kHz, as the recorder writes it, read as the 16 kHz the speech model needs.
pub struct Pcm48k {
    read: ReadFn,
    rewind: Option<RewindFn>,
    total: Option<u64>,
    taps: Vec<f32>,
    pending: Vec<f32>,
    scratch: Vec<f32>,
}

impl Pcm48k {
    /// A source over `read`, which fills a buffer with 48 kHz samples and returns how many, zero at the end.
    /// `total` is the length in 48 kHz samples, if known.
    pub fn new(total: Option<u64>, read: impl FnMut(&mut [f32]) -> Result<usize, String> + Send + 'static) -> Pcm48k {
        Pcm48k {
            read: Box::new(read),
            rewind: None,
            total,
            taps: low_pass(),
            pending: vec![0.0; TAPS - 1],
            scratch: Vec::new(),
        }
    }

    /// Lets a failed job start the audio again from the beginning.
    pub fn with_rewind(mut self, rewind: impl FnMut() -> Result<(), String> + Send + 'static) -> Pcm48k {
        self.rewind = Some(Box::new(rewind));
        self
    }

    /// Samples at 48 kHz held in memory.
    pub fn from_samples(samples: Vec<f32>) -> Pcm48k {
        let total = samples.len() as u64;
        let shared = Arc::new(Mutex::new((samples, 0_usize)));
        let reader = Arc::clone(&shared);
        Pcm48k::new(Some(total), move |out| {
            let mut held = reader.lock().unwrap_or_else(PoisonError::into_inner);
            let (samples, at) = &mut *held;
            let count = out.len().min(samples.len() - *at);
            out[..count].copy_from_slice(&samples[*at..*at + count]);
            *at += count;
            Ok(count)
        })
        .with_rewind(move || {
            shared.lock().unwrap_or_else(PoisonError::into_inner).1 = 0;
            Ok(())
        })
    }
}

impl AudioSource for Pcm48k {
    fn total_samples(&self) -> Option<u64> {
        self.total.map(|t| t / 3)
    }

    fn read(&mut self, buffer: &mut [f32]) -> Result<usize, IntelError> {
        if buffer.is_empty() {
            return Ok(0);
        }
        loop {
            let available = self.pending.len().saturating_sub(TAPS - 1) / 3;
            if available >= buffer.len() {
                break;
            }
            self.scratch.resize((buffer.len() - available) * 3, 0.0);
            let count = (self.read)(&mut self.scratch).map_err(IntelError::Audio)?;
            if count == 0 {
                break;
            }
            self.pending.extend_from_slice(&self.scratch[..count]);
        }
        let mut written = 0;
        let mut at = 0;
        while written < buffer.len() && at + TAPS <= self.pending.len() {
            buffer[written] = self
                .taps
                .iter()
                .zip(&self.pending[at..at + TAPS])
                .map(|(t, s)| t * s)
                .sum();
            written += 1;
            at += 3;
        }
        self.pending.drain(..at);
        Ok(written)
    }

    fn rewind(&mut self) -> Result<(), IntelError> {
        let rewind = self
            .rewind
            .as_mut()
            .ok_or_else(|| IntelError::Audio("this audio can't be read again".to_owned()))?;
        rewind().map_err(IntelError::Audio)?;
        self.pending = vec![0.0; TAPS - 1];
        Ok(())
    }
}

/// The hint the model gets from a vocabulary list: its terms, comma-separated.
pub fn vocabulary_prompt(list: &str) -> String {
    Vocabulary::parse(list).prompt(MAX_PROMPT_CHARS)
}

/// One line of a transcript as the interface keeps it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    /// Speaker 1, 2, and so on, when voices were told apart.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub speaker: Option<u32>,
}

/// What to transcribe with, besides the audio.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TranscribeChoices {
    /// A BCP 47 tag, or none to let the model detect it.
    pub language: Option<String>,
    /// The notebook's vocabulary list, as plain text.
    pub vocabulary: String,
}

/// News of a job, for the interface.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscribeUpdate {
    /// The job started on a device.
    Started {
        device: Device,
    },
    /// The fraction done, from 0 to 1.
    Progress {
        fraction: f32,
    },
    /// A line heard before the whole job is done, for showing progress.
    Line {
        line: TranscriptLine,
    },
    /// The finished transcript, with the vocabulary applied.
    Done {
        language: Option<String>,
        lines: Vec<TranscriptLine>,
    },
    Failed {
        error: ErrorInfo,
    },
    Canceled,
}

type Notify = Arc<dyn Fn(&str, &TranscribeUpdate) + Send + Sync>;

/// After a job's lines are heard, changes them before they are handed over, such as by telling speakers apart.
pub type Finisher = Box<dyn FnOnce(&mut Vec<TranscriptLine>) + Send>;

struct Queue {
    model: PathBuf,
    queue: TranscriptionQueue,
}

/// The app's transcription jobs: one queue, which runs one job at a time in the background.
pub struct TranscribeHub {
    notify: Notify,
    queue: Mutex<Option<Queue>>,
    jobs: Arc<Mutex<HashMap<String, JobHandle>>>,
    generation: AtomicU64,
}

impl TranscribeHub {
    /// A hub that tells `notify` about every job, by its ID.
    pub fn new(notify: impl Fn(&str, &TranscribeUpdate) + Send + Sync + 'static) -> TranscribeHub {
        TranscribeHub {
            notify: Arc::new(notify),
            queue: Mutex::new(None),
            jobs: Arc::default(),
            generation: AtomicU64::new(0),
        }
    }

    /// Queues `audio` for transcription with the model in `model`, and returns the job's ID at once. Needs the
    /// `transcription` feature. `finish` runs on the finished lines, after the vocabulary.
    pub fn submit(
        &self,
        engines: &Engines,
        model: &Path,
        choices: &TranscribeChoices,
        audio: Pcm48k,
        finish: Option<Finisher>,
    ) -> Result<String, IntelError> {
        engines.require(Feature::Transcription)?;
        if !model.is_file() {
            return Err(IntelError::ModelMissing {
                model: model
                    .file_name()
                    .map_or_else(String::new, |n| n.to_string_lossy().into_owned()),
            });
        }
        let language = match choices.language.as_deref().filter(|tag| !tag.is_empty()) {
            Some(tag) => Some(Language::new(tag)?),
            None => None,
        };
        let mut held = self.queue.lock().unwrap_or_else(PoisonError::into_inner);
        if held.as_ref().is_none_or(|queue| queue.model != model) {
            let generation = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
            let notify = Arc::clone(&self.notify);
            let engine: Arc<dyn TranscriptionEngine> = Arc::new(WhisperEngine::new(model));
            let queue = TranscriptionQueue::with_observer(engines.gate_transcription(engine)?, move |event| {
                let id = format!("t{generation}-{}", event.job.0);
                let update = match &event.kind {
                    JobEventKind::Started { device } => TranscribeUpdate::Started { device: *device },
                    JobEventKind::Progress(fraction) => TranscribeUpdate::Progress { fraction: *fraction },
                    JobEventKind::Segment(segment) => TranscribeUpdate::Line {
                        line: TranscriptLine {
                            start_ms: segment.start_ms,
                            end_ms: segment.end_ms,
                            text: segment.text.clone(),
                            speaker: None,
                        },
                    },
                    // The waiter below reports the end, with the finished lines.
                    _ => return,
                };
                notify(&id, &update);
            });
            *held = Some(Queue {
                model: model.to_path_buf(),
                queue,
            });
        }
        let queue = held.as_ref().expect("the queue was just made");
        let handle = queue.queue.submit(JobRequest {
            audio: Box::new(audio),
            options: TranscribeOptions {
                language,
                prompt: vocabulary_prompt(&choices.vocabulary),
                ..TranscribeOptions::default()
            },
        });
        let id = format!("t{}-{}", self.generation.load(Ordering::Relaxed), handle.id().0);
        self.jobs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), handle.clone());
        let (jobs, notify, key) = (Arc::clone(&self.jobs), Arc::clone(&self.notify), id.clone());
        let vocabulary = Vocabulary::parse(&choices.vocabulary);
        std::thread::Builder::new()
            .name("opennote-transcribe-wait".to_owned())
            .spawn(move || {
                let update = match handle.wait() {
                    Ok(transcript) => {
                        let fixed = vocabulary.correct_transcript(&transcript);
                        let mut lines: Vec<TranscriptLine> = fixed
                            .segments
                            .into_iter()
                            .map(|segment| TranscriptLine {
                                start_ms: segment.start_ms,
                                end_ms: segment.end_ms,
                                text: segment.text,
                                speaker: None,
                            })
                            .collect();
                        if let Some(finish) = finish {
                            finish(&mut lines);
                        }
                        TranscribeUpdate::Done {
                            language: fixed.language.map(|l| l.to_string()),
                            lines,
                        }
                    }
                    Err(IntelError::Canceled) => TranscribeUpdate::Canceled,
                    Err(error) => TranscribeUpdate::Failed { error: error.info() },
                };
                jobs.lock().unwrap_or_else(PoisonError::into_inner).remove(&key);
                notify(&key, &update);
            })
            .map_err(|error| IntelError::Platform(error.to_string()))?;
        Ok(id)
    }

    /// Cancels a job, queued or running. Returns whether it was known.
    pub fn cancel(&self, id: &str) -> bool {
        let handle = self
            .jobs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(id)
            .cloned();
        handle.map(|handle| handle.cancel()).is_some()
    }

    /// The jobs not yet finished.
    pub fn running(&self) -> usize {
        self.jobs.lock().unwrap_or_else(PoisonError::into_inner).len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_low_tone_survives_the_rate_change_and_a_high_one_does_not() {
        let tone = |hz: f32| -> Vec<f32> {
            (0..48_000)
                .map(|i| (2.0 * PI * hz * i as f32 / 48_000.0).sin())
                .collect()
        };
        let rms = |samples: &[f32]| (samples.iter().map(|v| v * v).sum::<f32>() / samples.len() as f32).sqrt();
        let mut low = Pcm48k::from_samples(tone(440.0));
        let mut out = vec![0.0; 16_000];
        let mut got = 0;
        loop {
            let n = low.read(&mut out[got..]).unwrap();
            if n == 0 || got + n == out.len() {
                got += n;
                break;
            }
            got += n;
        }
        assert!(got > 15_900, "{got}");
        assert!((rms(&out[100..got]) - 0.707).abs() < 0.02, "{}", rms(&out[100..got]));
        let mut high = Pcm48k::from_samples(tone(12_000.0));
        let mut out = vec![0.0; 16_000];
        let n = high.read(&mut out).unwrap();
        assert!(rms(&out[100..n]) < 0.02, "{}", rms(&out[100..n]));
        assert_eq!(high.total_samples(), Some(16_000));
        high.rewind().unwrap();
        assert!(high.read(&mut out).unwrap() > 0);
    }

    #[test]
    fn the_prompt_lists_the_vocabulary() {
        assert_eq!(
            vocabulary_prompt("ATP\n# a note\nKrebs cycle | crabs cycle\n"),
            "ATP, Krebs cycle"
        );
    }
}
