//! Reads a speech model in the ggml file format that whisper.cpp publishes: the sizes, the mel filters, the token
//! list, and the weights. Weights stored as 16-bit floats are widened to 32 bits as they load. Every size read from
//! the file is checked before anything is allocated, so a damaged or hostile file fails with an error instead of
//! exhausting memory.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use super::math::{Linear, Norm};
use crate::error::IntelError;

/// "ggml" as the file's first four bytes, read little-endian.
const MAGIC: u32 = 0x6767_6d6c;
/// The largest token list, model width, and layer count any published model has, with room to spare.
const MAX_VOCAB: usize = 60_000;
const MAX_STATE: usize = 2048;
const MAX_LAYERS: usize = 64;
const MAX_CTX: usize = 4096;
/// The most bytes in one token.
const MAX_TOKEN_BYTES: usize = 256;

/// The model's sizes, as the file states them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Hparams {
    pub n_vocab: usize,
    pub n_audio_ctx: usize,
    pub n_audio_state: usize,
    pub n_audio_head: usize,
    pub n_audio_layer: usize,
    pub n_text_ctx: usize,
    pub n_text_state: usize,
    pub n_text_head: usize,
    pub n_text_layer: usize,
    pub n_mels: usize,
}

impl Hparams {
    /// Whether the model knows many languages. English-only models have one token fewer.
    pub fn multilingual(&self) -> bool {
        self.n_vocab >= 51_865
    }
}

/// One attention layer's projections. The key has no bias.
#[derive(Debug, Default)]
pub(crate) struct Attention {
    pub query: Linear,
    pub key: Linear,
    pub value: Linear,
    pub out: Linear,
}

/// A residual block: attention, cross-attention for the decoder, and the two-layer MLP.
#[derive(Debug, Default)]
pub(crate) struct Block {
    pub attn_ln: Norm,
    pub attn: Attention,
    pub cross_ln: Option<Norm>,
    pub cross: Option<Attention>,
    pub mlp_ln: Norm,
    pub mlp_up: Linear,
    pub mlp_down: Linear,
}

/// The audio encoder.
#[derive(Debug, Default)]
pub(crate) struct Encoder {
    /// `n_state` rows of `n_mels × 3` weights.
    pub conv1: Linear,
    /// `n_state` rows of `n_state × 3` weights.
    pub conv2: Linear,
    pub positions: Vec<f32>,
    pub blocks: Vec<Block>,
    pub ln_post: Norm,
}

/// The text decoder.
#[derive(Debug, Default)]
pub(crate) struct Decoder {
    /// `n_vocab` rows of `n_state`, used both to embed tokens and to score them.
    pub tokens: Vec<f32>,
    pub positions: Vec<f32>,
    pub blocks: Vec<Block>,
    pub ln: Norm,
}

/// A loaded model.
#[derive(Debug)]
pub(crate) struct Model {
    pub hparams: Hparams,
    /// `n_mels` rows of `n_bins` filter weights.
    pub filters: Vec<f32>,
    pub n_bins: usize,
    /// The bytes of each token, by ID.
    pub vocab: Vec<Vec<u8>>,
    pub encoder: Encoder,
    pub decoder: Decoder,
}

fn damaged(what: &str) -> IntelError {
    IntelError::Engine(format!("the speech model file is damaged ({what})"))
}

/// One tensor of the file: its name, its shape, and its values.
type Tensor = (String, Vec<usize>, Vec<f32>);

struct Reader<R: Read> {
    inner: R,
}

impl<R: Read> Reader<R> {
    fn bytes(&mut self, n: usize) -> Result<Vec<u8>, IntelError> {
        let mut buffer = vec![0_u8; n];
        self.inner
            .read_exact(&mut buffer)
            .map_err(|_| damaged("it ends early"))?;
        Ok(buffer)
    }

    fn u32(&mut self) -> Result<u32, IntelError> {
        let mut b = [0_u8; 4];
        self.inner.read_exact(&mut b).map_err(|_| damaged("it ends early"))?;
        Ok(u32::from_le_bytes(b))
    }

    /// A count or size that must lie in `1..=max`.
    fn size(&mut self, max: usize, what: &str) -> Result<usize, IntelError> {
        let value = self.u32()? as usize;
        if value == 0 || value > max {
            return Err(damaged(what));
        }
        Ok(value)
    }

    fn f32s(&mut self, n: usize) -> Result<Vec<f32>, IntelError> {
        let raw = self.bytes(n * 4)?;
        Ok(raw.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect())
    }

    fn f16s(&mut self, n: usize) -> Result<Vec<f32>, IntelError> {
        let raw = self.bytes(n * 2)?;
        Ok(raw
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| f16_to_f32(u16::from_le_bytes(*b)))
            .collect())
    }

    /// The next tensor, or none at the end of the file.
    fn tensor(&mut self) -> Result<Option<Tensor>, IntelError> {
        let mut first = [0_u8; 4];
        match self.inner.read(&mut first[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => {}
            Err(_) => return Err(damaged("a tensor can't be read")),
        }
        self.inner
            .read_exact(&mut first[1..])
            .map_err(|_| damaged("it ends early"))?;
        let dims = u32::from_le_bytes(first) as usize;
        if !(1..=4).contains(&dims) {
            return Err(damaged("a tensor has a strange shape"));
        }
        let name_len = self.size(128, "a tensor name is too long")?;
        let kind = self.u32()?;
        let mut shape = Vec::with_capacity(dims);
        let mut count: usize = 1;
        for _ in 0..dims {
            let n = self.size(MAX_VOCAB.max(MAX_STATE * 4), "a tensor is too large")?;
            count = count
                .checked_mul(n)
                .filter(|&c| c <= 200_000_000)
                .ok_or_else(|| damaged("a tensor is too large"))?;
            shape.push(n);
        }
        let name = String::from_utf8(self.bytes(name_len)?).map_err(|_| damaged("a tensor name isn't text"))?;
        let data = match kind {
            0 => self.f32s(count)?,
            1 => self.f16s(count)?,
            _ => {
                return Err(IntelError::Engine(
                    "this speech model is compressed in a way OpenNote can't read. Choose another model".to_owned(),
                ))
            }
        };
        Ok(Some((name, shape, data)))
    }
}

/// Converts an IEEE half-precision float to single precision.
pub(crate) fn f16_to_f32(h: u16) -> f32 {
    let sign = u32::from(h >> 15) << 31;
    let exponent = u32::from((h >> 10) & 0x1f);
    let mantissa = u32::from(h & 0x3ff);
    let bits = match (exponent, mantissa) {
        (0, 0) => sign,
        (0, m) => {
            // A subnormal: shift until the leading one is in place.
            let mut e = 127 - 15 + 1;
            let mut m = m;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
        (0x1f, m) => sign | 0x7f80_0000 | (m << 13),
        (e, m) => sign | ((e + 127 - 15) << 23) | (m << 13),
    };
    f32::from_bits(bits)
}

/// The named tensors, taken out one by one as the model is assembled.
struct Tensors(HashMap<String, (Vec<usize>, Vec<f32>)>);

impl Tensors {
    fn take(&mut self, name: &str, len: usize) -> Result<Vec<f32>, IntelError> {
        let (_, data) = self
            .0
            .remove(name)
            .ok_or_else(|| damaged(&format!("{name} is missing")))?;
        if data.len() != len {
            return Err(damaged(&format!("{name} has the wrong size")));
        }
        Ok(data)
    }

    fn linear(&mut self, prefix: &str, n_in: usize, n_out: usize, bias: bool) -> Result<Linear, IntelError> {
        Ok(Linear {
            w: self.take(&format!("{prefix}.weight"), n_in * n_out)?,
            b: if bias {
                Some(self.take(&format!("{prefix}.bias"), n_out)?)
            } else {
                None
            },
            n_in,
            n_out,
        })
    }

    fn norm(&mut self, prefix: &str, n: usize) -> Result<Norm, IntelError> {
        Ok(Norm {
            w: self.take(&format!("{prefix}.weight"), n)?,
            b: self.take(&format!("{prefix}.bias"), n)?,
        })
    }

    fn attention(&mut self, prefix: &str, n: usize) -> Result<Attention, IntelError> {
        Ok(Attention {
            query: self.linear(&format!("{prefix}.query"), n, n, true)?,
            key: self.linear(&format!("{prefix}.key"), n, n, false)?,
            value: self.linear(&format!("{prefix}.value"), n, n, true)?,
            out: self.linear(&format!("{prefix}.out"), n, n, true)?,
        })
    }

    fn block(&mut self, prefix: &str, n: usize, cross: bool) -> Result<Block, IntelError> {
        Ok(Block {
            attn_ln: self.norm(&format!("{prefix}.attn_ln"), n)?,
            attn: self.attention(&format!("{prefix}.attn"), n)?,
            cross_ln: if cross {
                Some(self.norm(&format!("{prefix}.cross_attn_ln"), n)?)
            } else {
                None
            },
            cross: if cross {
                Some(self.attention(&format!("{prefix}.cross_attn"), n)?)
            } else {
                None
            },
            mlp_ln: self.norm(&format!("{prefix}.mlp_ln"), n)?,
            mlp_up: self.linear(&format!("{prefix}.mlp.0"), n, 4 * n, true)?,
            mlp_down: self.linear(&format!("{prefix}.mlp.2"), 4 * n, n, true)?,
        })
    }
}

impl Model {
    /// Loads the model file at `path`. A missing file is [`IntelError::ModelMissing`].
    pub(crate) fn load(path: &Path) -> Result<Model, IntelError> {
        let file = File::open(path).map_err(|_| IntelError::ModelMissing {
            model: path
                .file_name()
                .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        })?;
        Model::read(BufReader::with_capacity(1 << 20, file))
    }

    /// Reads a model from any byte source.
    pub(crate) fn read(source: impl Read) -> Result<Model, IntelError> {
        let mut r = Reader { inner: source };
        if r.u32()? != MAGIC {
            return Err(damaged("it isn't a ggml speech model"));
        }
        let hparams = Hparams {
            n_vocab: r.size(MAX_VOCAB, "the token count")?,
            n_audio_ctx: r.size(MAX_CTX, "the audio length")?,
            n_audio_state: r.size(MAX_STATE, "the audio width")?,
            n_audio_head: r.size(64, "the audio heads")?,
            n_audio_layer: r.size(MAX_LAYERS, "the audio layers")?,
            n_text_ctx: r.size(MAX_CTX, "the text length")?,
            n_text_state: r.size(MAX_STATE, "the text width")?,
            n_text_head: r.size(64, "the text heads")?,
            n_text_layer: r.size(MAX_LAYERS, "the text layers")?,
            n_mels: r.size(256, "the mel bands")?,
        };
        let _ftype = r.u32()?;
        if !hparams.n_audio_state.is_multiple_of(hparams.n_audio_head)
            || !hparams.n_text_state.is_multiple_of(hparams.n_text_head)
        {
            return Err(damaged("the heads don't divide the width"));
        }
        let n_mels = r.size(256, "the filter bands")?;
        let n_bins = r.size(4096, "the filter width")?;
        if n_mels != hparams.n_mels {
            return Err(damaged("the filters don't match the model"));
        }
        let filters = r.f32s(n_mels * n_bins)?;
        let listed = r.size(MAX_VOCAB, "the token list")?;
        let mut vocab = Vec::with_capacity(hparams.n_vocab);
        for _ in 0..listed {
            let len = r.u32()? as usize;
            if len > MAX_TOKEN_BYTES {
                return Err(damaged("a token is too long"));
            }
            vocab.push(r.bytes(len)?);
        }
        // The special tokens past the listed ones have no text.
        vocab.resize(hparams.n_vocab.max(listed), Vec::new());
        let mut tensors = Tensors(HashMap::new());
        while let Some((name, shape, data)) = r.tensor()? {
            tensors.0.insert(name, (shape, data));
        }
        let h = hparams;
        let (a, t) = (h.n_audio_state, h.n_text_state);
        let mut encoder = Encoder {
            conv1: tensors.linear("encoder.conv1", h.n_mels * 3, a, false)?,
            conv2: tensors.linear("encoder.conv2", a * 3, a, false)?,
            positions: tensors.take("encoder.positional_embedding", h.n_audio_ctx * a)?,
            blocks: Vec::with_capacity(h.n_audio_layer),
            ln_post: tensors.norm("encoder.ln_post", a)?,
        };
        encoder.conv1.b = Some(tensors.take("encoder.conv1.bias", a)?);
        encoder.conv2.b = Some(tensors.take("encoder.conv2.bias", a)?);
        for i in 0..h.n_audio_layer {
            encoder
                .blocks
                .push(tensors.block(&format!("encoder.blocks.{i}"), a, false)?);
        }
        let mut decoder = Decoder {
            tokens: tensors.take("decoder.token_embedding.weight", h.n_vocab * t)?,
            positions: tensors.take("decoder.positional_embedding", h.n_text_ctx * t)?,
            blocks: Vec::with_capacity(h.n_text_layer),
            ln: tensors.norm("decoder.ln", t)?,
        };
        for i in 0..h.n_text_layer {
            decoder
                .blocks
                .push(tensors.block(&format!("decoder.blocks.{i}"), t, true)?);
        }
        Ok(Model {
            hparams,
            filters,
            n_bins,
            vocab,
            encoder,
            decoder,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_floats_widen_exactly() {
        assert_eq!(f16_to_f32(0x3c00), 1.0);
        assert_eq!(f16_to_f32(0xc000), -2.0);
        assert_eq!(f16_to_f32(0x0000), 0.0);
        assert_eq!(f16_to_f32(0x7bff), 65504.0);
        assert_eq!(f16_to_f32(0x0001), 2.0_f32.powi(-24));
        assert!(f16_to_f32(0x7c00).is_infinite());
    }

    #[test]
    fn a_file_that_isnt_a_model_is_refused() {
        let error = Model::read(&b"not a model at all"[..]).unwrap_err();
        assert!(error.to_string().contains("damaged"), "{error}");
    }

    #[test]
    fn a_huge_size_is_refused_before_anything_is_allocated() {
        let mut bytes = MAGIC.to_le_bytes().to_vec();
        bytes.extend_from_slice(&u32::MAX.to_le_bytes());
        let error = Model::read(&bytes[..]).unwrap_err();
        assert!(error.to_string().contains("token count"), "{error}");
    }

    #[test]
    fn a_missing_file_asks_for_the_model() {
        let error = Model::load(Path::new("no-such-dir/ggml-none.bin")).unwrap_err();
        assert_eq!(
            error,
            IntelError::ModelMissing {
                model: "ggml-none.bin".to_owned()
            }
        );
    }
}
