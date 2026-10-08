//! Turning audio into timed text with the model: 30-second windows, greedy decoding with the timestamp rules the
//! model was trained with, and a seek that starts each window where the last complete line ended.

use super::forward::{encode, Decoding};
use super::math::log_softmax;
use super::mel::{log_mel, HOP, N_FRAMES, N_SAMPLES};
use super::model::Model;
use super::tokens::{Special, Tokenizer};

/// Milliseconds in one timestamp step.
const MS_PER_STEP: u64 = 20;
/// Mel frames in one timestamp step.
const FRAMES_PER_STEP: usize = 2;
/// The latest the first line of a window may start, in timestamp steps (one second).
const MAX_INITIAL_STEPS: u32 = 50;
/// Below this loudness (root mean square) a window is treated as silence and not decoded.
const SILENCE_RMS: f32 = 3e-4;

/// One line the model heard, with times from the start of the audio it was given.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Line {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// What one window gave.
pub(crate) struct Window {
    /// Lines with times from the window's start.
    pub lines: Vec<Line>,
    /// How far to move before the next window, in mel frames.
    pub advance: usize,
    /// The text tokens heard, to prompt the next window with.
    pub tokens: Vec<u32>,
}

/// Choices for decoding.
#[derive(Clone, Debug, Default)]
pub(crate) struct DecodeOptions {
    /// The language's primary subtag, or none to detect it (multilingual models only).
    pub language: Option<String>,
    /// Text that comes before the audio: the vocabulary, and the end of the last window.
    pub prompt: Vec<u32>,
}

fn suppress(logits: &mut [f32], range: std::ops::Range<usize>) {
    let end = range.end.min(logits.len());
    for v in &mut logits[range.start.min(end)..end] {
        *v = f32::NEG_INFINITY;
    }
}

/// The rules that keep timestamps well formed, applied to the scores of the next token.
fn apply_rules(logits: &mut [f32], sampled: &[u32], special: &Special, last_step: u32) {
    let (eot, begin) = (special.eot as usize, special.timestamp_begin as usize);
    // Special tokens other than the end are never written.
    suppress(logits, eot + 1..begin);
    // Nothing after the end of the audio in this window.
    suppress(logits, begin + last_step as usize + 1..logits.len());
    let is_time = |t: &u32| *t >= special.timestamp_begin;
    let last_was_time = sampled.last().is_some_and(is_time);
    let before_was_time = sampled.len() < 2 || is_time(&sampled[sampled.len() - 2]);
    if last_was_time {
        if before_was_time {
            suppress(logits, begin..logits.len());
        } else {
            suppress(logits, 0..eot);
        }
    }
    if let Some(&last) = sampled.iter().rev().find(|t| is_time(t)) {
        // Times never go back, and every line lasts at least one step.
        let floor = if last_was_time && !before_was_time {
            last
        } else {
            last + 1
        };
        suppress(logits, begin..floor as usize);
    }
    if sampled.is_empty() {
        // A window starts with a time, within its first second.
        suppress(logits, 0..begin);
        suppress(logits, begin + MAX_INITIAL_STEPS as usize + 1..logits.len());
    }
    // When a time is likelier than any one word, write the time.
    let logprobs = log_softmax(logits);
    let max_text = logprobs[..eot].iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let times = &logprobs[begin..];
    let top = times.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if top.is_finite() {
        let time_mass = top + times.iter().map(|v| (v - top).exp()).sum::<f32>().ln();
        if time_mass > max_text {
            suppress(logits, 0..eot);
        }
    }
}

fn argmax(values: &[f32]) -> u32 {
    let mut best = 0;
    for (i, v) in values.iter().enumerate() {
        if *v > values[best] {
            best = i;
        }
    }
    best as u32
}

/// Whether the text tokens end in the same run of up to eight tokens four times over, which is the model stuck.
fn repeating(tokens: &[u32]) -> Option<usize> {
    for k in 1..=8 {
        if tokens.len() < 4 * k {
            break;
        }
        let tail = &tokens[tokens.len() - k..];
        if (1..4).all(|n| &tokens[tokens.len() - (n + 1) * k..tokens.len() - n * k] == tail) {
            return Some(3 * k);
        }
    }
    None
}

/// The language a multilingual model hears in the window, as its primary subtag.
pub(crate) fn detect_language(model: &Model, features: &[f32]) -> String {
    let special = Special::of(&model.hparams);
    let mut decoding = Decoding::new(model, features);
    let logits = decoding.feed(&[special.sot]);
    let first = special.sot as usize + 1;
    let languages = &logits[first..first + super::tokens::LANGUAGES.len()];
    super::tokens::LANGUAGES[argmax(languages) as usize].to_owned()
}

/// Decodes one window of up to 30 seconds whose spectrogram the encoder turned into `features`. `frames` is how
/// many mel frames of it hold audio.
pub(crate) fn decode_window(model: &Model, features: &[f32], frames: usize, options: &DecodeOptions) -> Window {
    let special = Special::of(&model.hparams);
    let tokenizer = Tokenizer::new(&model.vocab, special);
    let mut decoding = Decoding::new(model, features);
    let half = decoding.capacity() / 2;
    let mut prefix = Vec::new();
    if !options.prompt.is_empty() {
        prefix.push(special.prev);
        let keep = options.prompt.len().min(half - 1);
        prefix.extend_from_slice(&options.prompt[options.prompt.len() - keep..]);
    }
    prefix.push(special.sot);
    let mut logits = decoding.feed(&prefix);
    let no_speech = {
        let mut probs = logits.clone();
        super::math::softmax(&mut probs);
        probs[special.no_speech as usize]
    };
    if special.multilingual {
        let language = options
            .language
            .as_deref()
            .and_then(|code| special.language(code))
            .or_else(|| special.language(&detect_language(model, features)))
            .unwrap_or(special.sot + 1);
        logits = decoding.feed(&[language, special.transcribe]);
    }
    let last_step = (frames / FRAMES_PER_STEP) as u32;
    let mut sampled: Vec<u32> = Vec::new();
    let mut logprob_sum = 0.0_f32;
    while sampled.len() < half && decoding.position + 1 < decoding.capacity() {
        apply_rules(&mut logits, &sampled, &special, last_step);
        let token = argmax(&logits);
        logprob_sum += log_softmax(&logits)[token as usize];
        if token == special.eot || !logits[token as usize].is_finite() {
            break;
        }
        sampled.push(token);
        let text: Vec<u32> = sampled.iter().copied().filter(|t| special.is_text(*t)).collect();
        if let Some(extra) = repeating(&text) {
            // Drop the repeats and end the window there.
            let mut drop = extra;
            while drop > 0 {
                if let Some(t) = sampled.pop() {
                    if special.is_text(t) {
                        drop -= 1;
                    }
                } else {
                    break;
                }
            }
            break;
        }
        logits = decoding.feed(&[token]);
    }
    let average = logprob_sum / (sampled.len() + 1) as f32;
    if no_speech > 0.6 && average < -1.0 {
        return Window {
            lines: Vec::new(),
            advance: frames,
            tokens: Vec::new(),
        };
    }
    lines_of(&sampled, &special, &tokenizer, frames)
}

/// Splits the sampled tokens into lines at their timestamps, and works out how far to move.
fn lines_of(sampled: &[u32], special: &Special, tokenizer: &Tokenizer<'_>, frames: usize) -> Window {
    let step_ms = |t: u32| u64::from(t - special.timestamp_begin) * MS_PER_STEP;
    let mut lines = Vec::new();
    let mut start: Option<u32> = None;
    let mut words: Vec<u32> = Vec::new();
    let mut last_end: Option<u32> = None;
    for &token in sampled {
        if token >= special.timestamp_begin {
            match start {
                Some(from) if !words.is_empty() => {
                    let text = tokenizer.text(&words).trim().to_owned();
                    if !text.is_empty() {
                        lines.push(Line {
                            start_ms: step_ms(from),
                            end_ms: step_ms(token),
                            text,
                        });
                    }
                    words.clear();
                    last_end = Some(token);
                    start = Some(token);
                }
                _ => start = Some(token),
            }
        } else if special.is_text(token) {
            words.push(token);
        }
    }
    let heard: Vec<u32> = sampled.iter().copied().filter(|t| special.is_text(*t)).collect();
    let window_ms = (frames * HOP) as u64 * 1000 / 16_000;
    let unfinished = !words.is_empty();
    let advance = match (unfinished, last_end) {
        // Lines ended, then more started: start the next window at the last end, so the cut line is heard whole.
        (true, Some(end)) if end > special.timestamp_begin => {
            ((end - special.timestamp_begin) as usize * FRAMES_PER_STEP).min(frames)
        }
        (true, _) => {
            let text = tokenizer.text(&words).trim().to_owned();
            if !text.is_empty() {
                lines.push(Line {
                    start_ms: start.map_or(0, step_ms),
                    end_ms: window_ms,
                    text,
                });
            }
            frames
        }
        _ => frames,
    };
    Window {
        lines,
        advance: advance.max(1),
        tokens: heard,
    }
}

/// Decoding that carries over from window to window: the language once heard, and the last window's words as the
/// next one's prompt.
pub(crate) struct Session {
    options: DecodeOptions,
    tail: Vec<u32>,
}

impl Session {
    pub(crate) fn new(options: DecodeOptions) -> Session {
        Session {
            options,
            tail: Vec::new(),
        }
    }

    /// Decodes one window of up to 30 seconds that starts `offset` samples into the audio. Returns its lines, with
    /// times from the start of the audio, and how many samples to move before the next window.
    pub(crate) fn window(&mut self, model: &Model, window: &[f32], offset: usize) -> (Vec<Line>, usize) {
        let window = &window[..window.len().min(N_SAMPLES)];
        let frames = (window.len() / HOP).min(N_FRAMES);
        if frames == 0 {
            return (Vec::new(), window.len().max(1));
        }
        let rms = (window.iter().map(|v| v * v).sum::<f32>() / window.len() as f32).sqrt();
        if rms < SILENCE_RMS {
            self.tail.clear();
            return (Vec::new(), frames * HOP);
        }
        let t0 = std::time::Instant::now();
        let mel = log_mel(window, &model.filters, model.hparams.n_mels, model.n_bins);
        let t1 = std::time::Instant::now();
        let features = encode(model, &mel);
        let t2 = std::time::Instant::now();
        eprintln!("TIMING mel {:?} encode {:?}", t1 - t0, t2 - t1);
        if self.options.language.is_none() && Special::of(&model.hparams).multilingual {
            self.options.language = Some(detect_language(model, &features));
        }
        let mut prompt = self.options.prompt.clone();
        prompt.extend_from_slice(&self.tail);
        let decoded = decode_window(
            model,
            &features,
            frames,
            &DecodeOptions {
                language: self.options.language.clone(),
                prompt,
            },
        );
        let offset_ms = offset as u64 * 1000 / 16_000;
        let lines = decoded
            .lines
            .into_iter()
            .map(|line| Line {
                start_ms: line.start_ms + offset_ms,
                end_ms: line.end_ms + offset_ms,
                text: line.text,
            })
            .collect();
        eprintln!("TIMING decode {:?} tokens {}", t2.elapsed(), decoded.tokens.len());
        self.tail = decoded.tokens;
        (lines, decoded.advance * HOP)
    }

    /// The language heard, once a window has been decoded.
    pub(crate) fn language(&self) -> Option<&str> {
        self.options.language.as_deref()
    }
}

/// Decodes `samples` (16 kHz mono, any length) window by window, with times from the start of `samples`.
pub(crate) fn transcribe(model: &Model, samples: &[f32], options: &DecodeOptions) -> Vec<Line> {
    let mut session = Session::new(options.clone());
    let mut all = Vec::new();
    let mut seek = 0;
    while seek + HOP < samples.len() {
        let (lines, advance) = session.window(model, &samples[seek..], seek);
        all.extend(lines);
        seek += advance;
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn special() -> Special {
        Special {
            eot: 10,
            sot: 11,
            transcribe: 12,
            prev: 13,
            no_speech: 14,
            timestamp_begin: 20,
            multilingual: false,
        }
    }

    #[test]
    fn a_window_starts_with_a_time_in_its_first_second() {
        let mut logits = vec![0.0; 100];
        logits[3] = 9.0;
        apply_rules(&mut logits, &[], &special(), 70);
        assert!(logits[..20].iter().all(|v| v.is_infinite()));
        assert!(logits[20..=70].iter().all(|v| v.is_finite()));
        assert!(logits[71..].iter().all(|v| v.is_infinite()));
    }

    #[test]
    fn times_come_in_pairs_and_never_go_back() {
        let special = special();
        // After an opening time, text must follow.
        let mut logits = vec![0.0; 100];
        apply_rules(&mut logits, &[25], &special, 70);
        assert!(logits[20..].iter().all(|v| v.is_infinite()));
        // After text, a time may close the line, but not one earlier than the opening.
        let mut logits = vec![0.0; 100];
        apply_rules(&mut logits, &[25, 3], &special, 70);
        assert!(logits[20..26].iter().all(|v| v.is_infinite()));
        assert!(logits[26].is_finite());
        // After a closing time, only a time or the end may follow.
        let mut logits = vec![0.0; 100];
        apply_rules(&mut logits, &[25, 3, 30], &special, 70);
        assert!(logits[..10].iter().all(|v| v.is_infinite()));
        assert!(logits[10].is_finite() && logits[30].is_finite() && logits[29].is_infinite());
    }

    #[test]
    fn a_stuck_model_is_caught() {
        assert_eq!(repeating(&[1, 2, 3, 4]), None);
        assert_eq!(repeating(&[5, 5, 5, 5]), Some(3));
        assert_eq!(repeating(&[9, 1, 2, 1, 2, 1, 2, 1, 2]), Some(6));
    }
}
