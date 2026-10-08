//! On-device speech to text with the Whisper models that whisper.cpp publishes (the ggml files the app downloads
//! with the person's consent). The model runs here, in plain Rust on the processor: no native library, no network,
//! and nothing written to disk. It reads the same model files as whisper.cpp and follows the same decoding rules.
//!
//! [`WhisperEngine`] is a [`TranscriptionEngine`] for the job queue. It loads its model on first use and keeps one
//! model in memory for later jobs, dictation, and live captions.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::IntelError;
use crate::geometry::Language;
use crate::transcribe::{
    enter_background_mode, AudioSource, Device, EngineSettings, JobControl, Segment, Transcript, TranscriptionEngine,
    SAMPLES_PER_SECOND,
};

mod decode;
mod forward;
mod math;
mod mel;
mod model;
mod tokens;

pub(crate) use decode::{DecodeOptions, Line, Session};
pub(crate) use model::Model;
pub(crate) use tokens::{Special, Tokenizer};

/// The most characters of vocabulary prompt given to the model. Its prompt holds about 220 tokens in all, and the
/// rest is for the words just heard.
pub const MAX_PROMPT_CHARS: usize = 400;

/// The one model kept in memory, by its file.
static LOADED: Mutex<Option<(PathBuf, Arc<Model>)>> = Mutex::new(None);

/// The model in `path`, loaded once and shared.
pub(crate) fn load(path: &Path) -> Result<Arc<Model>, IntelError> {
    let mut loaded = LOADED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((held, model)) = loaded.as_ref() {
        if held == path {
            return Ok(Arc::clone(model));
        }
    }
    // Free the old model before reading the new one, so two never sit in memory together.
    *loaded = None;
    let model = Arc::new(Model::load(path)?);
    *loaded = Some((path.to_path_buf(), Arc::clone(&model)));
    Ok(model)
}

/// Forgets the model kept in memory, as when the person removes it or turns transcription off.
pub fn unload() {
    *LOADED.lock().unwrap_or_else(PoisonError::into_inner) = None;
}

/// The Whisper engine over one model file.
#[derive(Clone, Debug)]
pub struct WhisperEngine {
    path: PathBuf,
}

impl WhisperEngine {
    /// An engine for the model file at `path`. Nothing is read until the first job.
    pub fn new(path: impl Into<PathBuf>) -> WhisperEngine {
        WhisperEngine { path: path.into() }
    }

    /// The model file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Transcribes 16 kHz mono samples held in memory, such as a short clip of dictation. `prompt` is the
    /// vocabulary hint. Times are from the start of `samples`.
    pub fn transcribe_samples(
        &self,
        samples: &[f32],
        language: Option<&Language>,
        prompt: &str,
    ) -> Result<Vec<Segment>, IntelError> {
        let model = load(&self.path)?;
        let options = options_for(&model, language, prompt);
        Ok(decode::transcribe(&model, samples, &options)
            .into_iter()
            .map(segment_of)
            .collect())
    }
}

fn options_for(model: &Model, language: Option<&Language>, prompt: &str) -> DecodeOptions {
    let special = Special::of(&model.hparams);
    let tokenizer = Tokenizer::new(&model.vocab, special);
    let hint: String = prompt.chars().take(MAX_PROMPT_CHARS).collect();
    DecodeOptions {
        language: language.map(Language::primary),
        prompt: if hint.trim().is_empty() {
            Vec::new()
        } else {
            tokenizer.encode(&format!(" {}", hint.trim()))
        },
    }
}

fn segment_of(line: Line) -> Segment {
    Segment {
        start_ms: line.start_ms,
        end_ms: line.end_ms,
        text: line.text,
    }
}

impl TranscriptionEngine for WhisperEngine {
    fn name(&self) -> String {
        let file = self
            .path
            .file_stem()
            .map_or_else(String::new, |s| s.to_string_lossy().into_owned());
        format!("Whisper {}", file.trim_start_matches("ggml-"))
    }

    fn devices(&self) -> Vec<Device> {
        vec![Device::Cpu]
    }

    fn model_file(&self) -> Option<PathBuf> {
        Some(self.path.clone())
    }

    fn transcribe(
        &self,
        audio: &mut dyn AudioSource,
        settings: &EngineSettings,
        control: &JobControl,
    ) -> Result<Transcript, IntelError> {
        enter_background_mode();
        let model = load(&self.path)?;
        control.check_canceled()?;
        let mut session = Session::new(options_for(&model, settings.language.as_ref(), &settings.prompt));
        let total = audio.total_samples().filter(|&t| t > 0);
        let window = mel::N_SAMPLES;
        let mut buffer: Vec<f32> = Vec::with_capacity(window * 2);
        // The sample number of buffer[0], and of the next window's start.
        let (mut base, mut seek) = (0_usize, 0_usize);
        let mut ended = false;
        let mut chunk = vec![0.0_f32; SAMPLES_PER_SECOND as usize * 5];
        let mut segments = Vec::new();
        loop {
            control.check_canceled()?;
            while !ended && base + buffer.len() < seek + window {
                let count = audio.read(&mut chunk)?;
                if count == 0 {
                    ended = true;
                } else {
                    buffer.extend_from_slice(&chunk[..count]);
                }
            }
            let start = seek - base;
            if start + mel::HOP >= buffer.len() {
                break;
            }
            let (lines, advance) = session.window(&model, &buffer[start..], seek);
            for line in lines {
                let segment = segment_of(line);
                control.emit_segment(segment.clone());
                segments.push(segment);
            }
            seek += advance;
            if let Some(total) = total {
                control.report_progress((seek as f32 / total as f32).min(1.0));
            }
            // Forget what is behind the next window.
            let drop = (seek - base).min(buffer.len());
            buffer.drain(..drop);
            base += drop;
        }
        control.report_progress(1.0);
        let language = settings
            .language
            .clone()
            .or_else(|| session.language().and_then(|code| Language::new(code).ok()));
        Ok(Transcript {
            language,
            device: settings.device,
            segments,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a tiny English-only model in the ggml layout with made-up weights: one layer each side, a width of
    /// eight. It hears nothing real, but it runs every step of loading, the encoder, and decoding.
    fn tiny_model() -> Vec<u8> {
        let (vocab, audio_ctx, width, heads, text_ctx, mels, bins) = (51_864_u32, 1500, 8, 2, 448, 80, 201);
        let mut out = Vec::new();
        let put = |out: &mut Vec<u8>, v: u32| out.extend_from_slice(&v.to_le_bytes());
        put(&mut out, 0x6767_6d6c);
        for v in [vocab, audio_ctx, width, heads, 1, text_ctx, width, heads, 1, mels, 1] {
            put(&mut out, v);
        }
        put(&mut out, mels);
        put(&mut out, bins);
        let mut seed = 7_u32;
        let mut next = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1 << 24) as f32 - 0.5
        };
        for _ in 0..mels * bins {
            out.extend_from_slice(&next().abs().to_le_bytes());
        }
        put(&mut out, 256);
        for byte in 0..=255_u8 {
            put(&mut out, 1);
            out.push(byte);
        }
        let (w, v) = (width as usize, vocab as usize);
        let mut tensors: Vec<(String, Vec<usize>)> = vec![
            ("encoder.conv1.weight".into(), vec![3, mels as usize, w]),
            ("encoder.conv1.bias".into(), vec![w]),
            ("encoder.conv2.weight".into(), vec![3, w, w]),
            ("encoder.conv2.bias".into(), vec![w]),
            ("encoder.positional_embedding".into(), vec![w, audio_ctx as usize]),
            ("encoder.ln_post.weight".into(), vec![w]),
            ("encoder.ln_post.bias".into(), vec![w]),
            ("decoder.token_embedding.weight".into(), vec![w, v]),
            ("decoder.positional_embedding".into(), vec![w, text_ctx as usize]),
            ("decoder.ln.weight".into(), vec![w]),
            ("decoder.ln.bias".into(), vec![w]),
        ];
        for (side, cross) in [("encoder", false), ("decoder", true)] {
            let p = format!("{side}.blocks.0");
            let mut lists = vec!["attn_ln", "mlp_ln"];
            if cross {
                lists.push("cross_attn_ln");
            }
            for norm in lists {
                tensors.push((format!("{p}.{norm}.weight"), vec![w]));
                tensors.push((format!("{p}.{norm}.bias"), vec![w]));
            }
            let mut attentions = vec!["attn"];
            if cross {
                attentions.push("cross_attn");
            }
            for attn in attentions {
                for part in ["query", "key", "value", "out"] {
                    tensors.push((format!("{p}.{attn}.{part}.weight"), vec![w, w]));
                    if part != "key" {
                        tensors.push((format!("{p}.{attn}.{part}.bias"), vec![w]));
                    }
                }
            }
            tensors.push((format!("{p}.mlp.0.weight"), vec![w, 4 * w]));
            tensors.push((format!("{p}.mlp.0.bias"), vec![4 * w]));
            tensors.push((format!("{p}.mlp.2.weight"), vec![4 * w, w]));
            tensors.push((format!("{p}.mlp.2.bias"), vec![w]));
        }
        for (i, (name, shape)) in tensors.iter().enumerate() {
            put(&mut out, shape.len() as u32);
            put(&mut out, name.len() as u32);
            // Every other tensor is half precision, as in the published files.
            let half = i % 2 == 1;
            put(&mut out, u32::from(half));
            for &n in shape {
                put(&mut out, n as u32);
            }
            out.extend_from_slice(name.as_bytes());
            for _ in 0..shape.iter().product::<usize>() {
                let value = next() * 0.2;
                if half {
                    // A half float near `value`: sign, a fixed exponent for 1/8 to 1/4, and the top mantissa bits.
                    let magnitude = (value.abs().clamp(0.125, 0.249) - 0.125) / 0.125;
                    let bits = (u16::from(value < 0.0) << 15) | (12 << 10) | ((magnitude * 1023.0) as u16);
                    out.extend_from_slice(&bits.to_le_bytes());
                } else {
                    out.extend_from_slice(&value.to_le_bytes());
                }
            }
        }
        out
    }

    #[test]
    fn a_model_file_runs_from_loading_to_lines() {
        let model = Model::read(&tiny_model()[..]).expect("the tiny model loads");
        let options = options_for(&model, None, "mitochondria");
        assert!(!options.prompt.is_empty(), "the vocabulary becomes prompt tokens");
        // Two seconds of a tone, then the loop of windows ends; random weights hear random text, but every line
        // has times in order and inside the clip.
        let samples: Vec<f32> = (0..32_000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let lines = decode::transcribe(&model, &samples, &options);
        for line in &lines {
            assert!(line.start_ms <= line.end_ms && line.end_ms <= 30_000, "{lines:?}");
        }
        // Silence is never decoded.
        assert!(decode::transcribe(&model, &vec![0.0; 16_000], &options).is_empty());
    }
}
