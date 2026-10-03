//! A small deterministic random number generator (SplitMix64), so the same seed makes the same notebook.

use opennote_core::Id;

/// SplitMix64: fast, and good enough for sample data.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    /// A generator from a seed.
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9e37_79b9_7f4a_7c15)
    }

    /// The next 64 random bits.
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number below `n`, or 0 when `n` is 0.
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64().checked_rem(n).unwrap_or(0)
    }

    /// A number from `low` to `high`, both included.
    pub fn between(&mut self, low: u64, high: u64) -> u64 {
        low + self.below(high.saturating_sub(low) + 1)
    }

    /// A number from 0 to 1.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// A number from `low` to `high`.
    pub fn range(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.unit()
    }

    /// True with probability `p`.
    pub fn chance(&mut self, p: f64) -> bool {
        self.unit() < p
    }

    /// Roughly normal noise with standard deviation `sd`, from the sum of four uniform numbers.
    pub fn noise(&mut self, sd: f64) -> f64 {
        let sum: f64 = (0..4).map(|_| self.unit()).sum();
        (sum - 2.0) * sd * 1.732
    }

    /// An ID made at `time_ms`, with random bits from the generator.
    pub fn id<T: From<Id>>(&mut self, time_ms: u64) -> T {
        let random = (u128::from(self.next_u64()) << 64) | u128::from(self.next_u64());
        T::from(Id::from_parts(time_ms, random))
    }
}
