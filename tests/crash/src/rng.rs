//! A small deterministic generator (SplitMix64), so a seed replays the same iteration.

/// The generator.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    /// A generator for `seed`.
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    /// A generator for one part of one iteration, independent of the others.
    pub fn derive(seed: u64, parts: &[u64]) -> Rng {
        let mut rng = Rng::new(seed);
        for &part in parts {
            rng = Rng::new(rng.next() ^ part.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        }
        rng
    }

    /// The next 64 random bits.
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number in `range`, which must not be empty.
    pub fn range(&mut self, range: std::ops::Range<u64>) -> u64 {
        range.start + self.next() % (range.end - range.start).max(1)
    }

    /// An index below `n`, which must not be zero.
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }

    /// Fills `out` with random bytes.
    pub fn fill(&mut self, out: &mut [u8]) {
        for chunk in out.chunks_mut(8) {
            let bytes = self.next().to_le_bytes();
            chunk.copy_from_slice(&bytes[..chunk.len()]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deterministic_and_stays_in_range() {
        let (mut a, mut b) = (Rng::derive(7, &[1, 2]), Rng::derive(7, &[1, 2]));
        assert_eq!(a.next(), b.next());
        assert_ne!(Rng::derive(7, &[1, 3]).next(), Rng::derive(7, &[1, 2]).next());
        for _ in 0..1000 {
            let n = a.range(10..800);
            assert!((10..800).contains(&n));
            assert!(a.below(3) < 3);
        }
        let mut bytes = [0u8; 13];
        a.fill(&mut bytes);
        assert!(bytes.iter().any(|&b| b != 0));
    }
}
