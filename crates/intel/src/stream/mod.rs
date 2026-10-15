//! Speech to text while the person is still talking (dictation and live captions).
//!
//! A [`Streamer`] takes 16 kHz mono audio as it arrives and finds where each stretch of speech starts and ends by
//! its loudness against the room's quiet. While someone is speaking it asks the speech model for a rough reading of
//! the whole stretch about once a second (a [`StreamEvent::Partial`]), and when they pause it asks once more for the
//! finished words (a [`StreamEvent::Final`]). The model is slow on a slow PC; the streamer never drops audio, it
//! just reads later, so captions run behind instead of missing words.
//!
//! The audio lives only in the streamer's buffer, which is emptied at the end of every stretch. Nothing is written
//! to disk and nothing leaves the process.

use crate::error::IntelError;
use crate::transcribe::SAMPLES_PER_SECOND;

const RATE: usize = SAMPLES_PER_SECOND as usize;
/// A frame of 20 ms.
const FRAME: usize = RATE / 50;
/// Audio kept from before speech was noticed, so the first word is not clipped.
const PRE_ROLL_FRAMES: usize = 15;
/// Loud frames in a row that start a stretch of speech.
const START_FRAMES: usize = 5;
/// The quietest a frame can be and still count as speech, as a sample amplitude.
const MIN_SPEECH_LEVEL: f32 = 0.004;
/// How many times louder than the room's quiet speech has to be.
const SPEECH_OVER_QUIET: f32 = 3.0;
/// The least loud audio in a stretch (200 ms) worth reading at all.
const MIN_LOUD_FRAMES: usize = 10;

/// Turns a live 48 kHz mono stream into the 16 kHz the speech model reads, a packet at a time.
pub struct Decimator {
    taps: Vec<f32>,
    pending: Vec<f32>,
}

impl Default for Decimator {
    fn default() -> Decimator {
        Decimator::new()
    }
}

impl Decimator {
    /// A converter at the start of a stream.
    pub fn new() -> Decimator {
        Decimator {
            taps: crate::wire::low_pass(),
            pending: vec![0.0; crate::wire::TAPS - 1],
        }
    }

    /// Adds 48 kHz samples and appends the 16 kHz samples they complete to .
    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.pending.extend_from_slice(input);
        let taps = self.taps.len();
        let mut at = 0;
        while at + taps <= self.pending.len() {
            out.push(
                self.taps
                    .iter()
                    .zip(&self.pending[at..at + taps])
                    .map(|(t, s)| t * s)
                    .sum(),
            );
            at += 3;
        }
        self.pending.drain(..at);
    }
}

/// Reads a stretch of audio. The speech model is one; tests use a stand-in.
pub trait Recognizer: Send {
    /// The words in `samples` (16 kHz mono), or empty when there are none.
    ///
    /// # Errors
    /// Returns the engine's error, such as a missing model.
    fn recognize(&mut self, samples: &[f32]) -> Result<String, IntelError>;
}

impl<F: FnMut(&[f32]) -> Result<String, IntelError> + Send> Recognizer for F {
    fn recognize(&mut self, samples: &[f32]) -> Result<String, IntelError> {
        self(samples)
    }
}

impl Recognizer for Box<dyn Recognizer> {
    fn recognize(&mut self, samples: &[f32]) -> Result<String, IntelError> {
        (**self).recognize(samples)
    }
}

/// When to read and when to stop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StreamOptions {
    /// A pause this long ends a stretch of speech.
    pub pause_ms: u64,
    /// A stretch this long ends even without a pause, because the model reads 30 seconds at most.
    pub longest_ms: u64,
    /// How much new speech to wait for before the next rough reading. Zero for none.
    pub partial_every_ms: u64,
}

impl StreamOptions {
    /// Dictation: the finished words matter, and a short pause ends a phrase.
    pub const DICTATION: StreamOptions = StreamOptions {
        pause_ms: 700,
        longest_ms: 25_000,
        partial_every_ms: 1500,
    };
    /// Captions: rough words early, and a pause that follows how people read.
    pub const CAPTIONS: StreamOptions = StreamOptions {
        pause_ms: 900,
        longest_ms: 12_000,
        partial_every_ms: 1200,
    };
}

/// What a streamer reports.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StreamEvent {
    /// Speech began.
    Speaking,
    /// A rough reading of the stretch so far. Each replaces the one before it.
    Partial {
        /// The words so far.
        text: String,
    },
    /// The finished words of a stretch.
    Final {
        /// The words.
        text: String,
        /// Where the stretch began, in milliseconds from the start of the stream.
        start_ms: u64,
        /// Where it ended.
        end_ms: u64,
    },
}

/// Words the model writes for audio with no speech in it, which are not words.
fn is_noise(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.is_empty()
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
        || trimmed.chars().all(|c| !c.is_alphanumeric())
}

/// Finds stretches of speech in a stream of audio and reads them.
pub struct Streamer<R: Recognizer> {
    recognizer: R,
    options: StreamOptions,
    /// Samples that do not yet fill a frame.
    carry: Vec<f32>,
    /// The quietest recent frame level.
    quiet: f32,
    /// Frames of audio just before the present, while nobody is speaking.
    pre_roll: Vec<Vec<f32>>,
    /// The audio of the stretch being spoken. Empty when nobody is.
    stretch: Vec<f32>,
    speaking: bool,
    loud_run: usize,
    loud_total: usize,
    silent_run: usize,
    /// Frames of this stretch at the last rough reading.
    last_partial_frames: usize,
    /// Frames of the whole stream seen so far.
    frames: u64,
    /// The frame at which the stretch began.
    started_at: u64,
}

impl<R: Recognizer> Streamer<R> {
    /// A streamer that reads with `recognizer`.
    pub fn new(recognizer: R, options: StreamOptions) -> Streamer<R> {
        Streamer {
            recognizer,
            options,
            carry: Vec::new(),
            quiet: 0.01,
            pre_roll: Vec::new(),
            stretch: Vec::new(),
            speaking: false,
            loud_run: 0,
            loud_total: 0,
            silent_run: 0,
            last_partial_frames: 0,
            frames: 0,
            started_at: 0,
        }
    }

    /// Adds audio and reports what it finds through `emit`.
    ///
    /// # Errors
    /// Returns the recognizer's error. The streamer keeps its place, so the caller may stop or go on.
    pub fn push(&mut self, samples: &[f32], emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        self.carry.extend_from_slice(samples);
        let mut at = 0;
        while at + FRAME <= self.carry.len() {
            let frame = self.carry[at..at + FRAME].to_vec();
            at += FRAME;
            self.frame(frame, emit)?;
        }
        self.carry.drain(..at);
        Ok(())
    }

    /// Ends the stream: whatever was being said is read as finished.
    ///
    /// # Errors
    /// Returns the recognizer's error.
    pub fn finish(&mut self, emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        if self.speaking {
            self.end_stretch(emit)?;
        }
        Ok(())
    }

    fn frame(&mut self, frame: Vec<f32>, emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        let level = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
        self.quiet = if level < self.quiet {
            level
        } else {
            self.quiet * 1.001 + 1e-6
        };
        let loud = level > MIN_SPEECH_LEVEL.max(self.quiet * SPEECH_OVER_QUIET);
        self.frames += 1;
        if !self.speaking {
            self.pre_roll.push(frame);
            if self.pre_roll.len() > PRE_ROLL_FRAMES + START_FRAMES {
                self.pre_roll.remove(0);
            }
            self.loud_run = if loud { self.loud_run + 1 } else { 0 };
            if self.loud_run >= START_FRAMES {
                self.speaking = true;
                self.stretch = self.pre_roll.drain(..).flatten().collect();
                self.started_at = self.frames - (self.stretch.len() / FRAME) as u64;
                self.loud_total = self.loud_run;
                self.silent_run = 0;
                self.last_partial_frames = 0;
                emit(StreamEvent::Speaking);
            }
            return Ok(());
        }
        self.stretch.extend_from_slice(&frame);
        if loud {
            self.loud_total += 1;
            self.silent_run = 0;
        } else {
            self.silent_run += 1;
        }
        let ms = |frames: usize| frames as u64 * 20;
        let length = self.stretch.len() / FRAME;
        if ms(self.silent_run) >= self.options.pause_ms || ms(length) >= self.options.longest_ms {
            return self.end_stretch(emit);
        }
        let every = self.options.partial_every_ms;
        if every > 0 && self.silent_run == 0 && ms(length - self.last_partial_frames) >= every {
            self.last_partial_frames = length;
            let text = self.recognizer.recognize(&self.stretch)?;
            if !is_noise(&text) {
                emit(StreamEvent::Partial {
                    text: text.trim().to_owned(),
                });
            }
        }
        Ok(())
    }

    fn end_stretch(&mut self, emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        let stretch = std::mem::take(&mut self.stretch);
        let (loud, start) = (self.loud_total, self.started_at);
        self.speaking = false;
        self.loud_run = 0;
        self.loud_total = 0;
        self.silent_run = 0;
        self.pre_roll.clear();
        if loud < MIN_LOUD_FRAMES {
            return Ok(());
        }
        let text = self.recognizer.recognize(&stretch)?;
        if !is_noise(&text) {
            emit(StreamEvent::Final {
                text: text.trim().to_owned(),
                start_ms: start * 20,
                end_ms: (start + (stretch.len() / FRAME) as u64) * 20,
            });
        }
        Ok(())
    }
}

/// Live 48 kHz microphone audio in, speech events out: the whole path from a capture packet to words. Made by
/// [`crate::Engines::live_stream`], which checks that the person turned transcription on, and which stops it
/// reading the moment they turn it off.
pub struct LiveStream {
    decimator: Decimator,
    streamer: Streamer<Box<dyn Recognizer>>,
    scratch: Vec<f32>,
}

impl LiveStream {
    pub(crate) fn new(recognizer: Box<dyn Recognizer>, options: StreamOptions) -> LiveStream {
        LiveStream {
            decimator: Decimator::new(),
            streamer: Streamer::new(recognizer, options),
            scratch: Vec::new(),
        }
    }

    /// Adds 48 kHz mono samples and reports what they complete through `emit`.
    ///
    /// # Errors
    /// Returns the error of the speech model, or [`IntelError::Disabled`] once transcription is turned off.
    pub fn push_48k(&mut self, samples: &[f32], emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        self.scratch.clear();
        self.decimator.push(samples, &mut self.scratch);
        self.streamer.push(&self.scratch, emit)
    }

    /// Ends the stream; what was being said is read as finished.
    ///
    /// # Errors
    /// Returns the error of the speech model.
    pub fn finish(&mut self, emit: &mut dyn FnMut(StreamEvent)) -> Result<(), IntelError> {
        self.streamer.finish(emit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize)
            .map(|i| 0.2 * (i as f32 * 0.15).sin() * (1.0 + (i as f32 * 0.001).sin()) / 2.0)
            .collect()
    }

    fn hush(seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize)
            .map(|i| 0.0005 * (i as f32 * 0.7).sin())
            .collect()
    }

    fn run(options: StreamOptions, audio: &[f32]) -> Vec<StreamEvent> {
        let mut reads = 0;
        let recognizer = move |samples: &[f32]| -> Result<String, IntelError> {
            reads += 1;
            Ok(format!(
                "words {reads} of {:.1} seconds",
                samples.len() as f32 / RATE as f32
            ))
        };
        let mut streamer = Streamer::new(recognizer, options);
        let mut events = Vec::new();
        for chunk in audio.chunks(1600) {
            streamer.push(chunk, &mut |e| events.push(e)).unwrap();
        }
        streamer.finish(&mut |e| events.push(e)).unwrap();
        events
    }

    fn finals(events: &[StreamEvent]) -> Vec<(u64, u64)> {
        events
            .iter()
            .filter_map(|e| match e {
                StreamEvent::Final { start_ms, end_ms, .. } => Some((*start_ms, *end_ms)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_pause_ends_a_stretch_and_each_stretch_is_read_once_more_when_it_ends() {
        let audio = [hush(1.0), tone(2.0), hush(1.2), tone(1.0), hush(1.5)].concat();
        let events = run(StreamOptions::DICTATION, &audio);
        let spans = finals(&events);
        assert_eq!(spans.len(), 2);
        // The first stretch starts near second 1, with a little audio kept from before it.
        assert!((700..=1100).contains(&spans[0].0), "{spans:?}");
        assert!((2900..=3900).contains(&spans[0].1), "{spans:?}");
        assert!(spans[1].0 > spans[0].1);
        assert_eq!(events.iter().filter(|e| matches!(e, StreamEvent::Speaking)).count(), 2);
    }

    #[test]
    fn a_long_stretch_gets_rough_readings_on_the_way() {
        let audio = [hush(0.5), tone(5.0), hush(1.2)].concat();
        let events = run(StreamOptions::DICTATION, &audio);
        let partials = events
            .iter()
            .filter(|e| matches!(e, StreamEvent::Partial { .. }))
            .count();
        assert!((2..=4).contains(&partials), "{partials}");
        assert_eq!(finals(&events).len(), 1);
    }

    #[test]
    fn a_room_with_no_speech_reads_nothing() {
        let events = run(StreamOptions::DICTATION, &hush(6.0));
        assert!(events.is_empty());
    }

    #[test]
    fn a_blip_shorter_than_a_fifth_of_a_second_is_not_read() {
        let audio = [hush(1.0), tone(0.12), hush(1.5)].concat();
        assert!(finals(&run(StreamOptions::DICTATION, &audio)).is_empty());
    }

    #[test]
    fn a_stretch_that_never_pauses_ends_at_the_longest() {
        let options = StreamOptions {
            longest_ms: 3000,
            partial_every_ms: 0,
            ..StreamOptions::DICTATION
        };
        let audio = [hush(0.5), tone(8.0), hush(1.0)].concat();
        assert!(finals(&run(options, &audio)).len() >= 2);
    }

    #[test]
    fn the_end_of_the_stream_finishes_what_was_being_said() {
        let audio = [hush(0.5), tone(2.0)].concat();
        assert_eq!(finals(&run(StreamOptions::DICTATION, &audio)).len(), 1);
    }

    #[test]
    fn words_the_model_makes_up_for_silence_are_dropped() {
        assert!(is_noise("[BLANK_AUDIO]"));
        assert!(is_noise(" (silence) "));
        assert!(is_noise("..."));
        assert!(!is_noise("Hello."));
    }

    #[test]
    fn forty_eight_thousand_samples_become_sixteen_thousand() {
        let mut decimator = Decimator::new();
        let mut out = Vec::new();
        for chunk in vec![0.1f32; 48_000].chunks(1000) {
            decimator.push(chunk, &mut out);
        }
        assert!((15_900..=16_000).contains(&out.len()), "{}", out.len());
        // A steady level passes through unchanged once the filter is full.
        assert!((out[out.len() / 2] - 0.1).abs() < 0.001);
    }

    #[test]
    fn a_recognizer_error_reaches_the_caller() {
        let failing = |_: &[f32]| -> Result<String, IntelError> { Err(IntelError::Canceled) };
        let mut streamer = Streamer::new(failing, StreamOptions::DICTATION);
        let audio = [hush(0.5), tone(2.0), hush(1.0)].concat();
        let result = audio.chunks(1600).try_for_each(|c| streamer.push(c, &mut |_| {}));
        assert_eq!(result, Err(IntelError::Canceled));
    }
}
