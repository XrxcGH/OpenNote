//! Translation with a Marian model in ONNX form.
//!
//! A pack is a folder with `encoder.onnx`, `decoder.onnx`, `tokenizer.json`, `config.json`, and
//! `generation_config.json`. The decoder here has no cache of past work, so each new word is found by running it on
//! all the words so far; for sentences this is quick enough and needs nothing more than the plain files.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use super::decode::{greedy, Step};
use super::{open, runtime, tokenizer, OnnxError};

/// The most words of one line sent to the model. A longer line is cut, and the rest keeps its original words.
pub const MAX_SOURCE_TOKENS: usize = 400;
/// The most characters of one line.
const MAX_LINE_CHARS: usize = 4000;

/// A translator for one pair of languages.
pub struct Translator {
    encoder: Mutex<Session>,
    decoder: Mutex<Session>,
    tokenizer: Tokenizer,
    start: i64,
    eos: i64,
    pad: i64,
}

fn id_of(config: &serde_json::Value, key: &str) -> Result<i64, OnnxError> {
    config
        .get(key)
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| OnnxError::Model(format!("config.json has no {key}")))
}

fn tensor(shape: &[i64], data: Vec<i64>) -> Result<Tensor<i64>, OnnxError> {
    Tensor::from_array((shape.to_vec(), data)).map_err(runtime)
}

/// The decoder for one line, asked for the scores of the next word.
struct Decoder<'a> {
    session: &'a mut Session,
    hidden: Vec<f32>,
    hidden_shape: Vec<i64>,
    mask: Vec<i64>,
}

impl Step for Decoder<'_> {
    fn next_scores(&mut self, decoded: &[i64]) -> Result<Vec<f32>, OnnxError> {
        let mask = tensor(&[1, self.mask.len() as i64], self.mask.clone())?;
        let ids = tensor(&[1, decoded.len() as i64], decoded.to_vec())?;
        let hidden = Tensor::from_array((self.hidden_shape.clone(), self.hidden.clone())).map_err(runtime)?;
        let outputs = self
            .session
            .run(ort::inputs![
                "encoder_attention_mask" => mask,
                "input_ids" => ids,
                "encoder_hidden_states" => hidden,
            ])
            .map_err(runtime)?;
        let (shape, logits) = outputs["logits"].try_extract_tensor::<f32>().map_err(runtime)?;
        let vocabulary = usize::try_from(*shape.last().ok_or_else(|| OnnxError::Runtime("no scores".to_owned()))?)
            .map_err(runtime)?;
        let rows = logits.len() / vocabulary.max(1);
        if rows == 0 {
            return Err(OnnxError::Runtime("the decoder gave no scores".to_owned()));
        }
        Ok(logits[(rows - 1) * vocabulary..rows * vocabulary].to_vec())
    }
}

impl Translator {
    /// Opens the pack in `dir`.
    ///
    /// # Errors
    /// [`OnnxError::Model`] when a file is missing or unreadable.
    pub fn open(dir: &Path) -> Result<Translator, OnnxError> {
        let config: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.join("config.json")).map_err(|error| OnnxError::Model(error.to_string()))?,
        )
        .map_err(|error| OnnxError::Model(error.to_string()))?;
        let pad = id_of(&config, "pad_token_id")?;
        Ok(Translator {
            encoder: Mutex::new(open(&dir.join("encoder.onnx"))?),
            decoder: Mutex::new(open(&dir.join("decoder.onnx"))?),
            tokenizer: tokenizer(&dir.join("tokenizer.json"))?,
            start: config
                .get("decoder_start_token_id")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(pad),
            eos: id_of(&config, "eos_token_id")?,
            pad,
        })
    }

    /// Translates one line. An empty or blank line comes back as it is.
    ///
    /// # Errors
    /// [`OnnxError::Runtime`] when the model fails.
    pub fn translate_line(&self, line: &str) -> Result<String, OnnxError> {
        let text: String = line.chars().take(MAX_LINE_CHARS).collect();
        if text.trim().is_empty() {
            return Ok(line.to_owned());
        }
        let encoding = self
            .tokenizer
            .encode(text.as_str(), true)
            .map_err(|error| OnnxError::Input(error.to_string()))?;
        let mut source: Vec<i64> = encoding.get_ids().iter().map(|&id| i64::from(id)).collect();
        if source.len() > MAX_SOURCE_TOKENS {
            source.truncate(MAX_SOURCE_TOKENS);
            if let Some(last) = source.last_mut() {
                *last = self.eos;
            }
        }
        let length = source.len() as i64;
        let mask = vec![1_i64; source.len()];
        let (hidden_shape, hidden) = {
            let mut encoder = self.encoder.lock().unwrap_or_else(PoisonError::into_inner);
            let outputs = encoder
                .run(ort::inputs![
                    "input_ids" => tensor(&[1, length], source)?,
                    "attention_mask" => tensor(&[1, length], mask.clone())?,
                ])
                .map_err(runtime)?;
            let (shape, data) = outputs["last_hidden_state"]
                .try_extract_tensor::<f32>()
                .map_err(runtime)?;
            (shape.iter().copied().collect::<Vec<i64>>(), data.to_vec())
        };
        let max_new = (mask.len() * 2 + 10).min(512);
        let mut session = self.decoder.lock().unwrap_or_else(PoisonError::into_inner);
        let mut decoder = Decoder {
            session: &mut session,
            hidden,
            hidden_shape,
            mask,
        };
        let words = greedy(&mut decoder, self.start, self.eos, self.pad, max_new)?;
        let ids: Vec<u32> = words.iter().filter_map(|&id| u32::try_from(id).ok()).collect();
        let translated = self
            .tokenizer
            .decode(&ids, true)
            .map_err(|error| OnnxError::Runtime(error.to_string()))?;
        Ok(translated.trim().to_owned())
    }

    /// Translates each line, in order. A line the model fails on is an error for the whole call, so no line is
    /// ever matched to the wrong translation.
    ///
    /// # Errors
    /// [`OnnxError::Runtime`] when the model fails.
    pub fn translate(&self, lines: &[String]) -> Result<Vec<String>, OnnxError> {
        lines.iter().map(|line| self.translate_line(line)).collect()
    }
}
