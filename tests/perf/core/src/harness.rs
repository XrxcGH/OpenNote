//! A small timing harness that writes results as JSON and compares them with a baseline (plan 13.9).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Timings of repeated runs of one operation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Samples(Vec<Duration>);

impl Samples {
    /// Adds a timing.
    pub fn push(&mut self, sample: Duration) {
        self.0.push(sample);
    }

    /// How many timings there are.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether there are no timings.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The nearest-rank percentile, such as 95 for the 95th percentile. Zero without timings.
    pub fn percentile(&self, p: f64) -> Duration {
        let mut sorted = self.0.clone();
        sorted.sort_unstable();
        let rank = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
        sorted
            .get(rank.clamp(1, sorted.len().max(1)) - 1)
            .copied()
            .unwrap_or_default()
    }

    /// The mean. Zero without timings.
    pub fn mean(&self) -> Duration {
        let total: Duration = self.0.iter().sum();
        total
            .checked_div(u32::try_from(self.0.len()).unwrap_or(u32::MAX))
            .unwrap_or_default()
    }
}

/// Runs `f` and returns its result and how long it took.
pub fn time<T>(f: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let value = f();
    (value, start.elapsed())
}

/// Runs `f` `runs` times and collects the timings.
pub fn measure(runs: usize, mut f: impl FnMut()) -> Samples {
    let mut samples = Samples::default();
    for _ in 0..runs {
        samples.push(time(&mut f).1);
    }
    samples
}

/// One measured value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Measurement {
    /// A stable name, such as `open.budget_page.p95`.
    pub name: String,
    /// The unit, such as `ms` or `MB`.
    pub unit: String,
    /// The value. Lower is better.
    pub value: f64,
    /// The budget from plan 13.9, if the measure has one.
    pub gate: Option<f64>,
}

/// The results of one run of the benchmarks.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// The machine the numbers come from.
    pub machine: String,
    /// Whether that machine is the reference laptop of BRAND.md section 10. Numbers from any other machine,
    /// such as the faster laptop of the week-one measurements, are kept with that caveat and never count as
    /// a pass on the reference laptop.
    pub reference_laptop: bool,
    /// The measurements.
    pub results: Vec<Measurement>,
}

impl Report {
    /// Adds a measurement.
    pub fn add(&mut self, name: &str, unit: &str, value: f64, gate: Option<f64>) {
        self.results.push(Measurement {
            name: name.to_owned(),
            unit: unit.to_owned(),
            value,
            gate,
        });
    }

    /// Measurements over their budget.
    pub fn over_budget(&self) -> Vec<&Measurement> {
        self.results
            .iter()
            .filter(|m| m.gate.is_some_and(|gate| m.value > gate))
            .collect()
    }
}

/// A measurement that got worse than the baseline by more than the tolerance.
#[derive(Clone, Debug, PartialEq)]
pub struct Regression {
    /// The measurement's name.
    pub name: String,
    /// The baseline value.
    pub baseline: f64,
    /// The new value.
    pub value: f64,
    /// How much worse, in percent.
    pub percent: f64,
}

/// Measurements more than `tolerance_percent` worse than the baseline. Measurements missing on either side
/// are skipped.
pub fn compare(results: &Report, baseline: &Report, tolerance_percent: f64) -> Vec<Regression> {
    results
        .results
        .iter()
        .filter_map(|m| {
            let base = baseline.results.iter().find(|b| b.name == m.name)?;
            let percent = if base.value > 0.0 {
                (m.value - base.value) / base.value * 100.0
            } else {
                0.0
            };
            (percent > tolerance_percent).then(|| Regression {
                name: m.name.clone(),
                baseline: base.value,
                value: m.value,
                percent,
            })
        })
        .collect()
}

/// What `generate` makes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GenerateArgs {
    /// How many pages.
    pub pages: usize,
    /// The seed, so the same arguments make the same notebook.
    pub seed: u64,
    /// All pages in one section, instead of 20 sections of 50 pages in 3 groups.
    pub one_section: bool,
    /// Where to write the notebook.
    pub dir: PathBuf,
}

/// What a benchmark suite runs with.
#[derive(Debug)]
pub struct BenchCtx {
    /// The size of the sample notebook.
    pub pages: usize,
    /// The quick set for pull requests, with doubled limits.
    pub quick: bool,
    /// A scratch folder on the disk under test.
    pub dir: PathBuf,
    /// Where results go.
    pub report: Report,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(values: &[u64]) -> Samples {
        let mut samples = Samples::default();
        for &v in values {
            samples.push(Duration::from_millis(v));
        }
        samples
    }

    #[test]
    fn percentiles_use_the_nearest_rank() {
        let samples = ms(&[5, 1, 4, 2, 3, 10, 9, 8, 7, 6]);
        assert_eq!(samples.percentile(50.0), Duration::from_millis(5));
        assert_eq!(samples.percentile(95.0), Duration::from_millis(10));
        assert_eq!(samples.percentile(0.0), Duration::from_millis(1));
        assert_eq!(samples.mean(), Duration::from_micros(5_500));
        assert_eq!(Samples::default().percentile(99.0), Duration::ZERO);
        assert_eq!(Samples::default().mean(), Duration::ZERO);
    }

    #[test]
    fn measure_runs_and_times() {
        let mut runs = 0;
        let samples = measure(3, || runs += 1);
        assert_eq!((runs, samples.len()), (3, 3));
        assert_eq!(time(|| 7).0, 7);
    }

    #[test]
    fn reports_find_budget_misses_and_regressions() {
        let mut baseline = Report::default();
        baseline.add("open.p95", "ms", 20.0, Some(25.0));
        baseline.add("save.p95", "ms", 10.0, Some(25.0));
        let mut now = Report {
            machine: "test".into(),
            ..Report::default()
        };
        now.add("open.p95", "ms", 26.0, Some(25.0));
        now.add("save.p95", "ms", 10.5, Some(25.0));
        now.add("new.p95", "ms", 1.0, None);
        assert_eq!(now.over_budget().len(), 1);
        let regressions = compare(&now, &baseline, 10.0);
        assert_eq!(regressions.len(), 1);
        assert_eq!(regressions[0].name, "open.p95");
        assert!((regressions[0].percent - 30.0).abs() < 1e-9);
        let json = serde_json::to_string(&now).unwrap();
        assert_eq!(serde_json::from_str::<Report>(&json).unwrap(), now);
    }
}
