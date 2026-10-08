//! A small fast Fourier transform for the voice enhancer, which works on frames of 512 samples.

use std::f32::consts::TAU;

/// A radix-2 transform of a fixed power-of-two size. The tables are made once and reused for every frame.
pub struct Fft {
    size: usize,
    cos: Vec<f32>,
    sin: Vec<f32>,
    reversed: Vec<usize>,
}

impl Fft {
    pub fn new(size: usize) -> Self {
        assert!(size.is_power_of_two() && size >= 2, "the size must be a power of two");
        let bits = size.trailing_zeros();
        Fft {
            size,
            cos: (0..size / 2).map(|k| (TAU * k as f32 / size as f32).cos()).collect(),
            sin: (0..size / 2).map(|k| -(TAU * k as f32 / size as f32).sin()).collect(),
            reversed: (0..size).map(|i| i.reverse_bits() >> (usize::BITS - bits)).collect(),
        }
    }

    /// Transforms in place: time to frequency.
    pub fn forward(&self, re: &mut [f32], im: &mut [f32]) {
        self.run(re, im, 1.0);
    }

    /// Transforms in place: frequency to time, scaled so that `inverse(forward(x)) == x`.
    pub fn inverse(&self, re: &mut [f32], im: &mut [f32]) {
        self.run(re, im, -1.0);
        let scale = 1.0 / self.size as f32;
        re.iter_mut().chain(im.iter_mut()).for_each(|value| *value *= scale);
    }

    fn run(&self, re: &mut [f32], im: &mut [f32], direction: f32) {
        assert!(re.len() == self.size && im.len() == self.size);
        for (i, &j) in self.reversed.iter().enumerate() {
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut half = 1;
        while half < self.size {
            let step = self.size / (2 * half);
            for start in (0..self.size).step_by(2 * half) {
                for k in 0..half {
                    let (wr, wi) = (self.cos[k * step], direction * self.sin[k * step]);
                    let (a, b) = (start + k, start + k + half);
                    let (tr, ti) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                    (re[b], im[b]) = (re[a] - tr, im[a] - ti);
                    (re[a], im[a]) = (re[a] + tr, im[a] + ti);
                }
            }
            half *= 2;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sine_lands_in_its_bin() {
        let fft = Fft::new(512);
        let mut re: Vec<f32> = (0..512).map(|n| (TAU * 40.0 * n as f32 / 512.0).sin()).collect();
        let mut im = vec![0.0; 512];
        fft.forward(&mut re, &mut im);
        let power: Vec<f32> = re.iter().zip(&im).map(|(r, i)| r * r + i * i).collect();
        let loudest = (0..256).max_by(|&a, &b| power[a].total_cmp(&power[b])).unwrap();
        assert_eq!(loudest, 40);
        assert!((power[40].sqrt() - 256.0).abs() < 0.01, "{}", power[40].sqrt());
    }

    #[test]
    fn the_inverse_undoes_the_transform() {
        let fft = Fft::new(64);
        let original: Vec<f32> = (0..64).map(|n| ((n * 37 % 17) as f32 - 8.0) / 8.0).collect();
        let (mut re, mut im) = (original.clone(), vec![0.0; 64]);
        fft.forward(&mut re, &mut im);
        fft.inverse(&mut re, &mut im);
        for (got, want) in re.iter().zip(&original) {
            assert!((got - want).abs() < 1e-5);
        }
        assert!(im.iter().all(|value| value.abs() < 1e-5));
    }
}
