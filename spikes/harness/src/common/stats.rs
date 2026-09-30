//! Summary statistics for latency samples. Percentiles use linear interpolation between ranks.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Summary {
    pub count: usize,
    pub min: f64,
    pub p50: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
    pub mean: f64,
    pub stddev: f64,
}

/// Summarizes the samples that are finite numbers. Returns None when there are none.
pub fn summarize(samples: &[f64]) -> Option<Summary> {
    let mut sorted: Vec<f64> = samples.iter().copied().filter(|value| value.is_finite()).collect();
    if sorted.is_empty() {
        return None;
    }
    sorted.sort_by(f64::total_cmp);
    let count = sorted.len();
    let mean = sorted.iter().sum::<f64>() / count as f64;
    let variance = sorted.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / count as f64;
    Some(Summary {
        count,
        min: sorted[0],
        p50: percentile(&sorted, 50.0),
        p90: percentile(&sorted, 90.0),
        p95: percentile(&sorted, 95.0),
        p99: percentile(&sorted, 99.0),
        max: sorted[count - 1],
        mean,
        stddev: variance.sqrt(),
    })
}

/// The `p`th percentile (0 to 100) of sorted, non-empty samples.
pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    let rank = (p / 100.0).clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let (low, high) = (rank.floor() as usize, rank.ceil() as usize);
    sorted[low] + (sorted[high] - sorted[low]) * (rank - low as f64)
}

/// The share of samples at or under `limit`, from 0 to 1. Used to report how often a budget is met.
pub fn share_within(samples: &[f64], limit: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.iter().filter(|value| **value <= limit).count() as f64 / samples.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_samples() {
        let samples: Vec<f64> = (1..=100).map(f64::from).collect();
        let summary = summarize(&samples).unwrap();
        assert_eq!(summary.count, 100);
        assert_eq!(summary.min, 1.0);
        assert_eq!(summary.max, 100.0);
        assert!((summary.p50 - 50.5).abs() < 1e-9);
        assert!((summary.p99 - 99.01).abs() < 1e-9);
        assert!((summary.mean - 50.5).abs() < 1e-9);
    }

    #[test]
    fn ignores_values_that_are_not_finite() {
        let summary = summarize(&[f64::NAN, 4.0, f64::INFINITY, 2.0]).unwrap();
        assert_eq!(summary.count, 2);
        assert_eq!(summary.p50, 3.0);
        assert!(summarize(&[f64::NAN]).is_none());
        assert!(summarize(&[]).is_none());
    }

    #[test]
    fn reports_the_share_within_a_budget() {
        assert_eq!(share_within(&[10.0, 20.0, 30.0, 40.0], 25.0), 0.5);
        assert_eq!(share_within(&[], 25.0), 0.0);
    }
}
