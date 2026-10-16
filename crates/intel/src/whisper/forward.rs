//! The model's two halves. The encoder turns 30 seconds of spectrogram into 1500 positions of features. The
//! decoder reads them and the tokens so far, keeps its own keys and values from step to step, and scores the next
//! token.

use super::math::{add_into, attention, gelu, Linear};
use super::mel::N_FRAMES;
use super::model::{Block, Model};

/// Applies a convolution of width 3 with padding 1 and the given stride to `input` (`len` rows of `channels`), and
/// returns `len / stride` rows of the layer's outputs, after GELU.
fn conv3(input: &[f32], len: usize, channels: usize, stride: usize, layer: &Linear) -> (Vec<f32>, usize) {
    let out_len = len / stride;
    let mut columns = vec![0.0_f32; out_len * channels * 3];
    for t in 0..out_len {
        let row = &mut columns[t * channels * 3..(t + 1) * channels * 3];
        for k in 0..3 {
            let source = (t * stride + k) as isize - 1;
            if source < 0 || source as usize >= len {
                continue;
            }
            let from = &input[source as usize * channels..(source as usize + 1) * channels];
            for (c, value) in from.iter().enumerate() {
                row[c * 3 + k] = *value;
            }
        }
    }
    let mut out = layer.forward(&columns, out_len);
    gelu(&mut out);
    (out, out_len)
}

/// Self-attention and the MLP of one encoder block, in place on `x` (`n` rows of `n_state`).
fn encoder_block(block: &Block, x: &mut [f32], n: usize, heads: usize) {
    let n_state = block.attn_ln.w.len();
    let h = block.attn_ln.forward(x);
    let q = block.attn.query.forward(&h, n);
    let k = block.attn.key.forward(&h, n);
    let v = block.attn.value.forward(&h, n);
    let mixed = attention(&q, n, &k, &v, n, n_state, heads, None);
    add_into(x, &block.attn.out.forward(&mixed, n));
    let h = block.mlp_ln.forward(x);
    let mut up = block.mlp_up.forward(&h, n);
    gelu(&mut up);
    add_into(x, &block.mlp_down.forward(&up, n));
}

/// The encoder's features for one window: [`N_FRAMES`]` / 2` rows of `n_audio_state`.
pub(crate) fn encode(model: &Model, mel: &[f32]) -> Vec<f32> {
    let h = &model.hparams;
    // The spectrogram is band by band; the convolution wants time by time.
    let mut frames = vec![0.0_f32; N_FRAMES * h.n_mels];
    for m in 0..h.n_mels {
        for t in 0..N_FRAMES {
            frames[t * h.n_mels + m] = mel[m * N_FRAMES + t];
        }
    }
    let (x, len) = conv3(&frames, N_FRAMES, h.n_mels, 1, &model.encoder.conv1);
    let (mut x, len) = conv3(&x, len, h.n_audio_state, 2, &model.encoder.conv2);
    let n = len.min(h.n_audio_ctx);
    x.truncate(n * h.n_audio_state);
    add_into(&mut x, &model.encoder.positions[..n * h.n_audio_state]);
    for block in &model.encoder.blocks {
        encoder_block(block, &mut x, n, h.n_audio_head);
    }
    model.encoder.ln_post.forward(&x)
}

/// One decoder layer's keys and values: its own, which grow a token at a time, and the encoder's, fixed per window.
struct LayerCache {
    keys: Vec<f32>,
    values: Vec<f32>,
    cross_keys: Vec<f32>,
    cross_values: Vec<f32>,
}

/// The decoder reading one window of audio.
pub(crate) struct Decoding<'m> {
    model: &'m Model,
    layers: Vec<LayerCache>,
    audio_len: usize,
    /// Tokens fed so far.
    pub position: usize,
}

impl<'m> Decoding<'m> {
    /// Starts decoding over the encoder's `features`.
    pub(crate) fn new(model: &'m Model, features: &[f32]) -> Decoding<'m> {
        let n_state = model.hparams.n_text_state;
        let audio_len = features.len() / model.hparams.n_audio_state;
        let layers = model
            .decoder
            .blocks
            .iter()
            .map(|block| {
                let cross = block.cross.as_ref().expect("decoder blocks have cross-attention");
                LayerCache {
                    keys: Vec::with_capacity(model.hparams.n_text_ctx * n_state),
                    values: Vec::with_capacity(model.hparams.n_text_ctx * n_state),
                    cross_keys: cross.key.forward(features, audio_len),
                    cross_values: cross.value.forward(features, audio_len),
                }
            })
            .collect();
        Decoding {
            model,
            layers,
            audio_len,
            position: 0,
        }
    }

    /// The most tokens the decoder can hold.
    pub(crate) fn capacity(&self) -> usize {
        self.model.hparams.n_text_ctx
    }

    /// Feeds `tokens` and returns the scores of the token after the last one.
    pub(crate) fn feed(&mut self, tokens: &[u32]) -> Vec<f32> {
        let model = self.model;
        let h = &model.hparams;
        let n_state = h.n_text_state;
        let n = tokens.len();
        let mut x = vec![0.0_f32; n * n_state];
        for (i, &token) in tokens.iter().enumerate() {
            let row = &mut x[i * n_state..(i + 1) * n_state];
            let token = (token as usize).min(h.n_vocab - 1);
            row.copy_from_slice(&model.decoder.tokens[token * n_state..(token + 1) * n_state]);
            let pos = (self.position + i).min(h.n_text_ctx - 1);
            add_into(row, &model.decoder.positions[pos * n_state..(pos + 1) * n_state]);
        }
        for (block, cache) in model.decoder.blocks.iter().zip(self.layers.iter_mut()) {
            let normed = block.attn_ln.forward(&x);
            let q = block.attn.query.forward(&normed, n);
            cache.keys.extend(block.attn.key.forward(&normed, n));
            cache.values.extend(block.attn.value.forward(&normed, n));
            let total = cache.keys.len() / n_state;
            let mixed = attention(
                &q,
                n,
                &cache.keys,
                &cache.values,
                total,
                n_state,
                h.n_text_head,
                Some(self.position),
            );
            add_into(&mut x, &block.attn.out.forward(&mixed, n));

            let (cross_ln, cross) = (
                block.cross_ln.as_ref().expect("decoder blocks have cross-attention"),
                block.cross.as_ref().expect("decoder blocks have cross-attention"),
            );
            let normed = cross_ln.forward(&x);
            let q = cross.query.forward(&normed, n);
            let mixed = attention(
                &q,
                n,
                &cache.cross_keys,
                &cache.cross_values,
                self.audio_len,
                n_state,
                h.n_text_head,
                None,
            );
            add_into(&mut x, &cross.out.forward(&mixed, n));

            let normed = block.mlp_ln.forward(&x);
            let mut up = block.mlp_up.forward(&normed, n);
            gelu(&mut up);
            add_into(&mut x, &block.mlp_down.forward(&up, n));
        }
        self.position += n;
        let last = model.decoder.ln.forward(&x[(n - 1) * n_state..]);
        let mut logits = vec![0.0_f32; h.n_vocab];
        super::math::matmul(&last, 1, &model.decoder.tokens, n_state, h.n_vocab, &mut logits);
        logits
    }
}
