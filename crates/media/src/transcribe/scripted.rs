//! A stand-in engine, for tests and for builds with no engine.

use std::sync::{Arc, Mutex};

use super::{Capabilities, Job, Outcome, PcmSource, Segment, Transcriber, TranscriptSink, TranscriptionHandle};
use crate::audio::Result;

/// An engine that reads the audio to its end, reports the segments it was given, and finishes.
/// Passing none makes it an engine that finds no speech.
pub struct ScriptedTranscriber {
    id: String,
    segments: Vec<Segment>,
}

impl ScriptedTranscriber {
    pub fn new(id: &str, segments: Vec<Segment>) -> Self {
        ScriptedTranscriber {
            id: id.to_owned(),
            segments,
        }
    }
}

struct Joined(Option<std::thread::JoinHandle<Outcome>>, Arc<Mutex<bool>>);

impl TranscriptionHandle for Joined {
    fn cancel(&mut self) {
        *self.1.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
    }

    fn wait(mut self: Box<Self>) -> Outcome {
        let handle = self.0.take().expect("the thread is joined once");
        handle.join().unwrap_or(Outcome::Failed {
            message: "The engine panicked.".into(),
        })
    }
}

impl Transcriber for ScriptedTranscriber {
    fn id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            live: false,
            word_times: false,
            speakers: false,
            languages: Vec::new(),
        }
    }

    fn start(
        &self,
        _job: Job,
        mut source: Box<dyn PcmSource>,
        mut sink: Box<dyn TranscriptSink>,
    ) -> Result<Box<dyn TranscriptionHandle>> {
        let segments = self.segments.clone();
        let cancelled = Arc::new(Mutex::new(false));
        let flag = Arc::clone(&cancelled);
        let thread = std::thread::spawn(move || run(&segments, source.as_mut(), sink.as_mut(), &flag));
        Ok(Box::new(Joined(Some(thread), cancelled)))
    }
}

/// Reads the source to its end, then reports the segments.
fn run(
    segments: &[Segment],
    source: &mut dyn PcmSource,
    sink: &mut dyn TranscriptSink,
    cancelled: &Mutex<bool>,
) -> Outcome {
    let total = source.total().map(|samples| samples * 1_000_000_000 / 48_000);
    let mut block = vec![0f32; 48_000];
    let outcome = loop {
        if *cancelled.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) {
            break Outcome::Cancelled;
        }
        match source.read(&mut block) {
            Ok(0) => break Outcome::Done,
            Ok(_) => sink.progress(source.position() * 1_000_000_000 / 48_000, total),
            Err(error) => {
                break Outcome::Failed {
                    message: error.to_string(),
                }
            }
        }
    };
    if outcome == Outcome::Done {
        for segment in segments {
            sink.segment(segment.clone());
        }
    }
    sink.finished(outcome.clone());
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(start_ms: u64, end_ms: u64, text: &str) -> Segment {
        Segment {
            start_ns: start_ms * 1_000_000,
            end_ns: end_ms * 1_000_000,
            text: text.to_owned(),
            speaker: Some(1),
            confidence: Some(0.9),
            words: Vec::new(),
        }
    }

    /// A source of silence, for a fixed number of samples.
    struct Silence(u64, u64);

    impl PcmSource for Silence {
        fn read(&mut self, out: &mut [f32]) -> Result<usize> {
            let count = out.len().min((self.1 - self.0) as usize);
            out[..count].fill(0.0);
            self.0 += count as u64;
            Ok(count)
        }

        fn position(&self) -> u64 {
            self.0
        }

        fn total(&self) -> Option<u64> {
            Some(self.1)
        }
    }

    #[derive(Default)]
    struct Collect(Arc<Mutex<Vec<String>>>);

    impl TranscriptSink for Collect {
        fn segment(&mut self, segment: Segment) {
            self.0.lock().unwrap().push(format!("segment {}", segment.text));
        }

        fn progress(&mut self, done_ns: u64, total_ns: Option<u64>) {
            self.0
                .lock()
                .unwrap()
                .push(format!("progress {done_ns} of {total_ns:?}"));
        }

        fn finished(&mut self, outcome: Outcome) {
            self.0.lock().unwrap().push(format!("finished {outcome:?}"));
        }
    }

    fn job() -> Job {
        Job {
            recording: "r".into(),
            track: None,
            language: None,
        }
    }

    #[test]
    fn an_engine_reads_the_audio_and_reports_in_order() {
        let engine = ScriptedTranscriber::new("scripted", vec![line(0, 1_000, "Hello"), line(1_000, 2_000, "again")]);
        let log = Arc::new(Mutex::new(Vec::new()));
        let handle = engine
            .start(job(), Box::new(Silence(0, 96_000)), Box::new(Collect(Arc::clone(&log))))
            .unwrap();
        assert_eq!(handle.wait(), Outcome::Done);
        let log = log.lock().unwrap();
        assert!(log[0].starts_with("progress"), "{log:?}");
        assert_eq!(
            &log[log.len() - 3..],
            ["segment Hello", "segment again", "finished Done"]
        );
    }

    #[test]
    fn an_engine_that_does_not_work_live_says_so() {
        let engine = ScriptedTranscriber::new("scripted", Vec::new());
        let sink: Box<dyn TranscriptSink> = Box::new(Collect::default());
        let error = engine.start_live(job(), sink).err().unwrap();
        assert!(
            error.to_string().contains("can't transcribe while recording"),
            "{error}"
        );
    }
}
