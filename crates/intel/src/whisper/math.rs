//! The dense math the speech model needs: matrix products spread over the processor's cores, layer norm, GELU,
//! and softmax. Plain Rust that the compiler vectorizes, with no native library and no unsafe code.

use std::thread;

/// Work below this many multiply-adds runs on one thread, because starting threads costs more.
const SPLIT_ABOVE: usize = 1 << 21;

/// How many threads the products use. The speech job already runs at background priority, so it may use them all.
pub(crate) fn threads() -> usize {
    thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, 16)
}

/// Lanes the dot products keep apart, so the compiler can hold them in vector registers.
const LANES: usize = 16;

/// The dot product of two equal-length slices.
#[inline]
pub(crate) fn dot(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let (a, b) = (&a[..n], &b[..n]);
    let mut acc = [0.0_f32; LANES];
    let ((ca, ra), (cb, rb)) = (a.as_chunks::<LANES>(), b.as_chunks::<LANES>());
    for (x, y) in ca.iter().zip(cb) {
        for k in 0..LANES {
            acc[k] += x[k] * y[k];
        }
    }
    let mut sum: f32 = acc.iter().sum();
    for (x, y) in ra.iter().zip(rb) {
        sum += x * y;
    }
    sum
}

/// Four dot products of four rows against one row, sharing the loads of `w`.
#[inline]
fn dot4(rows: [&[f32]; 4], w: &[f32]) -> [f32; 4] {
    let n = w.len();
    let mut a = [[0.0_f32; LANES]; 4];
    let whole = n / LANES * LANES;
    for ((((wc, c0), c1), c2), c3) in w[..whole]
        .as_chunks::<LANES>()
        .0
        .iter()
        .zip(rows[0][..whole].as_chunks::<LANES>().0)
        .zip(rows[1][..whole].as_chunks::<LANES>().0)
        .zip(rows[2][..whole].as_chunks::<LANES>().0)
        .zip(rows[3][..whole].as_chunks::<LANES>().0)
    {
        for k in 0..LANES {
            a[0][k] += c0[k] * wc[k];
            a[1][k] += c1[k] * wc[k];
            a[2][k] += c2[k] * wc[k];
            a[3][k] += c3[k] * wc[k];
        }
    }
    let mut out = [0.0_f32; 4];
    for (r, (o, acc)) in out.iter_mut().zip(a.iter()).enumerate() {
        let mut sum: f32 = acc.iter().sum();
        for j in whole..n {
            sum += rows[r][j] * w[j];
        }
        *o = sum;
    }
    out
}

/// A fully connected layer: `out = x · Wᵀ + b`, where `w` holds `n_out` rows of `n_in` weights.
#[derive(Clone, Debug, Default)]
pub(crate) struct Linear {
    pub w: Vec<f32>,
    pub b: Option<Vec<f32>>,
    pub n_in: usize,
    pub n_out: usize,
}

impl Linear {
    /// Applies the layer to `rows` rows of `x`, each `n_in` long, and returns `rows` rows of `n_out`.
    pub(crate) fn forward(&self, x: &[f32], rows: usize) -> Vec<f32> {
        let mut out = vec![0.0_f32; rows * self.n_out];
        matmul(x, rows, &self.w, self.n_in, self.n_out, &mut out);
        if let Some(bias) = &self.b {
            for row in out.chunks_exact_mut(self.n_out) {
                for (o, b) in row.iter_mut().zip(bias) {
                    *o += b;
                }
            }
        }
        out
    }
}

/// `out[r][j] = x[r] · w[j]`, for `rows` rows of `x` and `n_out` rows of `w`, each `n_in` long.
pub(crate) fn matmul(x: &[f32], rows: usize, w: &[f32], n_in: usize, n_out: usize, out: &mut [f32]) {
    debug_assert!(x.len() >= rows * n_in && w.len() >= n_out * n_in && out.len() >= rows * n_out);
    let work = rows * n_in * n_out;
    let threads = if work < SPLIT_ABOVE { 1 } else { threads() };
    if rows >= threads * 4 {
        // Many rows, as in the encoder: each thread takes whole rows of the answer.
        let per = rows.div_ceil(threads).div_ceil(4) * 4;
        thread::scope(|scope| {
            for (index, chunk) in out[..rows * n_out].chunks_mut(per * n_out).enumerate() {
                let first = index * per;
                let count = chunk.len() / n_out;
                let x = &x[first * n_in..(first + count) * n_in];
                if threads == 1 {
                    rows_block(x, count, w, n_in, n_out, chunk);
                } else {
                    scope.spawn(move || rows_block(x, count, w, n_in, n_out, chunk));
                }
            }
        });
    } else {
        // Few rows, as in the decoder: the threads split the columns of each row.
        for r in 0..rows {
            let xr = &x[r * n_in..(r + 1) * n_in];
            let row = &mut out[r * n_out..(r + 1) * n_out];
            let per = n_out.div_ceil(threads).max(1);
            thread::scope(|scope| {
                for (index, chunk) in row.chunks_mut(per).enumerate() {
                    let first = index * per;
                    let mut work = move || {
                        for (j, o) in chunk.iter_mut().enumerate() {
                            let k = first + j;
                            *o = dot(xr, &w[k * n_in..(k + 1) * n_in]);
                        }
                    };
                    if threads == 1 {
                        work();
                    } else {
                        scope.spawn(work);
                    }
                }
            });
        }
    }
}

/// The rows of the answer for a block of rows of `x`, a tile of `w` at a time so the tile stays in cache.
fn rows_block(x: &[f32], rows: usize, w: &[f32], n_in: usize, n_out: usize, out: &mut [f32]) {
    const TILE: usize = 64;
    for tile in (0..n_out).step_by(TILE) {
        let end = (tile + TILE).min(n_out);
        let mut r = 0;
        while r + 4 <= rows {
            let xs = [
                &x[r * n_in..(r + 1) * n_in],
                &x[(r + 1) * n_in..(r + 2) * n_in],
                &x[(r + 2) * n_in..(r + 3) * n_in],
                &x[(r + 3) * n_in..(r + 4) * n_in],
            ];
            for j in tile..end {
                let v = dot4(xs, &w[j * n_in..(j + 1) * n_in]);
                for (k, value) in v.iter().enumerate() {
                    out[(r + k) * n_out + j] = *value;
                }
            }
            r += 4;
        }
        while r < rows {
            let xr = &x[r * n_in..(r + 1) * n_in];
            for j in tile..end {
                out[r * n_out + j] = dot(xr, &w[j * n_in..(j + 1) * n_in]);
            }
            r += 1;
        }
    }
}

/// Layer normalization with a learned scale and shift.
#[derive(Clone, Debug, Default)]
pub(crate) struct Norm {
    pub w: Vec<f32>,
    pub b: Vec<f32>,
}

impl Norm {
    /// Normalizes each row of `x` (rows of `self.w.len()` values) into a new buffer.
    pub(crate) fn forward(&self, x: &[f32]) -> Vec<f32> {
        let n = self.w.len();
        let mut out = vec![0.0_f32; x.len()];
        for (row, dest) in x.chunks_exact(n).zip(out.chunks_exact_mut(n)) {
            let mean = row.iter().sum::<f32>() / n as f32;
            let var = row.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / n as f32;
            let scale = 1.0 / (var + 1e-5).sqrt();
            for (i, d) in dest.iter_mut().enumerate() {
                *d = (row[i] - mean) * scale * self.w[i] + self.b[i];
            }
        }
        out
    }
}

/// GELU, in the tanh form the reference engines use.
pub(crate) fn gelu(x: &mut [f32]) {
    const C: f32 = 0.797_884_6; // sqrt(2 / pi)
    for v in x {
        let u = *v;
        *v = 0.5 * u * (1.0 + (C * (u + 0.044_715 * u * u * u)).tanh());
    }
}

/// Softmax in place.
pub(crate) fn softmax(x: &mut [f32]) {
    let max = x.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if !max.is_finite() {
        let n = x.len() as f32;
        x.iter_mut().for_each(|v| *v = 1.0 / n);
        return;
    }
    let mut sum = 0.0;
    for v in x.iter_mut() {
        *v = (*v - max).exp();
        sum += *v;
    }
    for v in x.iter_mut() {
        *v /= sum;
    }
}

/// Log-softmax of `x` into a new buffer.
pub(crate) fn log_softmax(x: &[f32]) -> Vec<f32> {
    let max = x.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let sum: f32 = x.iter().map(|v| (v - max).exp()).sum();
    let log = max + sum.ln();
    x.iter().map(|v| v - log).collect()
}

/// Adds `b` to `a`, element by element.
pub(crate) fn add_into(a: &mut [f32], b: &[f32]) {
    for (x, y) in a.iter_mut().zip(b) {
        *x += y;
    }
}

/// Multi-head attention of `q` (`nq` rows) over `k` and `v` (`nk` rows), all `n_state` wide in `heads` heads. With
/// `causal`, query row `i` sees key rows up to `offset + i`. Returns `nq` rows of `n_state`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn attention(
    q: &[f32],
    nq: usize,
    k: &[f32],
    v: &[f32],
    nk: usize,
    n_state: usize,
    heads: usize,
    causal: Option<usize>,
) -> Vec<f32> {
    let d = n_state / heads;
    let scale = 1.0 / (d as f32).sqrt();
    let mut out = vec![0.0_f32; nq * n_state];
    let threads = if nq * nk * n_state < SPLIT_ABOVE { 1 } else { threads() };
    let per = nq.div_ceil(threads).max(1);
    thread::scope(|scope| {
        for (index, chunk) in out.chunks_mut(per * n_state).enumerate() {
            let first = index * per;
            let mut work = move || {
                let mut scores = vec![0.0_f32; nk];
                for (row, dest) in chunk.chunks_exact_mut(n_state).enumerate() {
                    let i = first + row;
                    let visible = causal.map_or(nk, |offset| (offset + i + 1).min(nk));
                    for h in 0..heads {
                        let qh = &q[i * n_state + h * d..i * n_state + (h + 1) * d];
                        for (j, s) in scores[..visible].iter_mut().enumerate() {
                            *s = dot(qh, &k[j * n_state + h * d..j * n_state + (h + 1) * d]) * scale;
                        }
                        softmax(&mut scores[..visible]);
                        let oh = &mut dest[h * d..(h + 1) * d];
                        for (j, p) in scores[..visible].iter().enumerate() {
                            let vh = &v[j * n_state + h * d..j * n_state + (h + 1) * d];
                            for (o, value) in oh.iter_mut().zip(vh) {
                                *o += p * value;
                            }
                        }
                    }
                }
            };
            if threads == 1 {
                work();
            } else {
                scope.spawn(work);
            }
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn naive(x: &[f32], rows: usize, w: &[f32], n_in: usize, n_out: usize) -> Vec<f32> {
        let mut out = vec![0.0; rows * n_out];
        for r in 0..rows {
            for j in 0..n_out {
                out[r * n_out + j] = (0..n_in).map(|i| x[r * n_in + i] * w[j * n_in + i]).sum();
            }
        }
        out
    }

    fn values(n: usize, seed: u32) -> Vec<f32> {
        let mut state = seed;
        (0..n)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 8) as f32 / (1 << 24) as f32 - 0.5
            })
            .collect()
    }

    #[test]
    fn the_product_matches_the_plain_sum_for_any_shape() {
        for (rows, n_in, n_out) in [(1, 5, 3), (7, 33, 70), (130, 64, 200), (3, 900, 4000), (600, 96, 96)] {
            let x = values(rows * n_in, 1);
            let w = values(n_out * n_in, 2);
            let mut out = vec![0.0; rows * n_out];
            matmul(&x, rows, &w, n_in, n_out, &mut out);
            let want = naive(&x, rows, &w, n_in, n_out);
            for (a, b) in out.iter().zip(&want) {
                assert!((a - b).abs() < 1e-3, "{rows}x{n_in}x{n_out}: {a} vs {b}");
            }
        }
    }

    #[test]
    fn softmax_sums_to_one_and_survives_minus_infinity() {
        let mut x = vec![1.0, 2.0, f32::NEG_INFINITY, 3.0];
        softmax(&mut x);
        assert!((x.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        assert_eq!(x[2], 0.0);
        let log = log_softmax(&[0.0, 0.0]);
        assert!((log[0] - (0.5_f32).ln()).abs() < 1e-6);
    }

    #[test]
    fn causal_attention_sees_only_earlier_rows() {
        // One head of width 1. The value of row j is j, so each answer is a mean of the rows it may see.
        let q = vec![0.0; 3];
        let k = vec![0.0; 3];
        let v = vec![0.0, 1.0, 2.0];
        let out = attention(&q, 3, &k, &v, 3, 1, 1, Some(0));
        assert_eq!(out, vec![0.0, 0.5, 1.0]);
        let all = attention(&q, 1, &k, &v, 3, 1, 1, None);
        assert!((all[0] - 1.0).abs() < 1e-6);
    }
}

#[cfg(test)]
mod speed {
    use super::*;

    #[test]
    #[ignore = "a timing, run by hand"]
    fn timing() {
        let (rows, n_in, n_out) = (1500, 384, 1536);
        let x = vec![0.5_f32; rows * n_in];
        let w = vec![0.25_f32; n_in * n_out];
        let mut out = vec![0.0; rows * n_out];
        let t = std::time::Instant::now();
        for _ in 0..5 {
            matmul(&x, rows, &w, n_in, n_out, &mut out);
        }
        let s = t.elapsed().as_secs_f64() / 5.0;
        eprintln!(
            "TIMING matmul {:.1} ms, {:.1} GMAC/s, threads {}",
            s * 1e3,
            (rows * n_in * n_out) as f64 / s / 1e9,
            threads()
        );
        let t = std::time::Instant::now();
        rows_block(&x[..96 * n_in], 96, &w, n_in, n_out, &mut out[..96 * n_out]);
        let s = t.elapsed().as_secs_f64();
        eprintln!("TIMING one thread {:.1} GMAC/s", (96 * n_in * n_out) as f64 / s / 1e9);
        let t = std::time::Instant::now();
        let mut sink = 0.0;
        for j in 0..n_out {
            sink += dot(&x[..n_in], &w[j * n_in..(j + 1) * n_in]);
        }
        let s = t.elapsed().as_secs_f64();
        eprintln!("TIMING dot {:.2} GMAC/s {sink}", (n_in * n_out) as f64 / s / 1e9);
        let q = vec![0.01_f32; 1500 * 384];
        let t = std::time::Instant::now();
        let _ = attention(&q, 1500, &q, &q, 1500, 384, 6, None);
        eprintln!("TIMING attention {:?}", t.elapsed());
    }
}
