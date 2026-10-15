//! Sentence vectors with a MiniLM model in ONNX form.
//!
//! A pack is a folder with `model.onnx` and `tokenizer.json`. A text becomes a vector of 384 numbers of length one,
//! so the dot product of two vectors is the cosine of the angle between them, which is how near two texts are.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use ort::session::Session;
use ort::value::Tensor;
use tokenizers::Tokenizer;

use super::{open, runtime, tokenizer, OnnxError};

/// The size of a vector.
pub const EMBED_DIM: usize = 384;
/// The most words of one text the model reads. The rest of a longer text is left out.
const MAX_TOKENS: usize = 256;
/// The most characters of one text.
const MAX_CHARS: usize = 4000;

/// The mean of the word vectors of one text, where `mask` is 1 for a real word and 0 for padding, scaled to length
/// one. `hidden` holds `mask.len()` rows of `dim` numbers. All zeros when there are no real words.
pub fn pool(hidden: &[f32], mask: &[i64], dim: usize) -> Vec<f32> {
    let mut sum = vec![0.0_f32; dim];
    let mut count = 0.0_f32;
    for (row, &keep) in hidden.chunks_exact(dim).zip(mask) {
        if keep == 0 {
            continue;
        }
        count += 1.0;
        for (total, value) in sum.iter_mut().zip(row) {
            *total += value;
        }
    }
    if count == 0.0 {
        return sum;
    }
    let norm = sum.iter().map(|v| (v / count) * (v / count)).sum::<f32>().sqrt();
    if norm == 0.0 || !norm.is_finite() {
        return vec![0.0; dim];
    }
    sum.iter().map(|v| (v / count) / norm).collect()
}

/// A sentence embedder.
pub struct Embedder {
    session: Mutex<Session>,
    tokenizer: Tokenizer,
    wants_types: bool,
}

impl Embedder {
    /// Opens the pack in `dir`.
    ///
    /// # Errors
    /// [`OnnxError::Model`] when a file is missing or unreadable.
    pub fn open(dir: &Path) -> Result<Embedder, OnnxError> {
        let session = open(&dir.join("model.onnx"))?;
        let wants_types = session.inputs().iter().any(|input| input.name() == "token_type_ids");
        Ok(Embedder {
            session: Mutex::new(session),
            tokenizer: tokenizer(&dir.join("tokenizer.json"))?,
            wants_types,
        })
    }

    /// The vector of one text. All zeros for a text with no words.
    ///
    /// # Errors
    /// [`OnnxError::Runtime`] when the model fails.
    pub fn embed_one(&self, text: &str) -> Result<Vec<f32>, OnnxError> {
        let text: String = text.chars().take(MAX_CHARS).collect();
        if text.trim().is_empty() {
            return Ok(vec![0.0; EMBED_DIM]);
        }
        let encoding = self
            .tokenizer
            .encode(text.as_str(), true)
            .map_err(|error| OnnxError::Input(error.to_string()))?;
        let take = encoding.get_ids().len().min(MAX_TOKENS);
        let ids: Vec<i64> = encoding.get_ids()[..take].iter().map(|&v| i64::from(v)).collect();
        let mask: Vec<i64> = encoding.get_attention_mask()[..take].iter().map(|&v| i64::from(v)).collect();
        let shape = vec![1_i64, take as i64];
        let make = |data: Vec<i64>| Tensor::from_array((shape.clone(), data)).map_err(runtime);
        let mut session = self.session.lock().unwrap_or_else(PoisonError::into_inner);
        let outputs = if self.wants_types {
            session.run(ort::inputs![
                "input_ids" => make(ids)?,
                "attention_mask" => make(mask.clone())?,
                "token_type_ids" => make(vec![0; take])?,
            ])
        } else {
            session.run(ort::inputs![
                "input_ids" => make(ids)?,
                "attention_mask" => make(mask.clone())?,
            ])
        }
        .map_err(runtime)?;
        let (shape, hidden) = outputs[0].try_extract_tensor::<f32>().map_err(runtime)?;
        let dim = usize::try_from(*shape.last().ok_or_else(|| OnnxError::Runtime("no output".to_owned()))?)
            .map_err(runtime)?;
        if dim != EMBED_DIM {
            return Err(OnnxError::Model(format!("the model gives vectors of {dim}, not {EMBED_DIM}")));
        }
        Ok(pool(hidden, &mask, dim))
    }

    /// The vector of each text, in order.
    ///
    /// # Errors
    /// [`OnnxError::Runtime`] when the model fails.
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, OnnxError> {
        texts.iter().map(|text| self.embed_one(text)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pooling_averages_the_real_words_and_scales_to_length_one() {
        // Two real words and one padding row of 3 numbers each.
        let hidden = [3.0, 0.0, 0.0, 1.0, 0.0, 0.0, 9.0, 9.0, 9.0];
        let vector = pool(&hidden, &[1, 1, 0], 3);
        assert!((vector[0] - 1.0).abs() < 1e-6 && vector[1] == 0.0 && vector[2] == 0.0);
        let hidden = [1.0, 1.0, 0.0, 1.0, 0.0, 0.0];
        let vector = pool(&hidden, &[1, 1], 3);
        let length = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((length - 1.0).abs() < 1e-6);
    }

    #[test]
    fn pooling_nothing_gives_zeros() {
        assert_eq!(pool(&[1.0, 2.0], &[0], 2), vec![0.0, 0.0]);
        assert_eq!(pool(&[], &[], 2), vec![0.0, 0.0]);
        assert_eq!(pool(&[0.0, 0.0], &[1], 2), vec![0.0, 0.0]);
    }
}
