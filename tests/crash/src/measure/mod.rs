//! The week-one measurements of WP2 (plan 2):
//!
//! - M3: cold page opens with the planned number of files.
//! - M5: the cost of each write primitive and of a full save.
//! - M6: renames by handle while another process holds the target, and folder flushes.
//!
//! ```text
//! opennote-crashtest measure <m3|m5|m6|all> --dir <folder> [--label <drive>] [--runs <n>]
//!                            [--machine <name>] [--reference] [--out <report.json>]
//! ```
//!
//! `--dir` is a scratch folder on the drive under test. Results go into the benchmark harness's JSON report,
//! with `reference_laptop` false unless `--reference` is given on the reference laptop itself.

mod m3;
mod m5;
mod m6;

pub use m6::hold;

use std::path::{Path, PathBuf};
use std::time::Duration;

use opennote_perf::harness::{Report, Samples};

use crate::opts::Options;

/// What every measurement runs with.
pub struct Ctx {
    /// A scratch folder on the drive under test.
    pub dir: PathBuf,
    /// A short name for the drive, used in measurement names, such as `nvme` or `share`.
    pub label: String,
    /// Repetitions of each timing.
    pub runs: usize,
    /// Where results go.
    pub report: Report,
    /// Details that don't fit a number. They are printed and kept in the report file.
    pub notes: Vec<String>,
}

impl Ctx {
    /// Adds the 50th, 95th, and 99th percentiles of `samples`, in milliseconds. `gate` applies to the 95th.
    pub fn add_percentiles(&mut self, name: &str, samples: &Samples, gate: Option<f64>) {
        let ms = |d: Duration| d.as_secs_f64() * 1_000.0;
        let full = format!("{}.{}.{name}", self.label, name_prefix(name));
        self.report
            .add(&format!("{full}.p50"), "ms", ms(samples.percentile(50.0)), None);
        self.report
            .add(&format!("{full}.p95"), "ms", ms(samples.percentile(95.0)), gate);
        self.report
            .add(&format!("{full}.p99"), "ms", ms(samples.percentile(99.0)), None);
        println!(
            "{:<44} p50 {:>8.3} ms   p95 {:>8.3} ms   p99 {:>8.3} ms",
            format!("{}.{name}", self.label),
            ms(samples.percentile(50.0)),
            ms(samples.percentile(95.0)),
            ms(samples.percentile(99.0)),
        );
    }

    /// Adds a note.
    pub fn note(&mut self, text: String) {
        println!("  {text}");
        self.notes.push(text);
    }

    /// A fresh scratch folder for one measurement.
    pub fn scratch(&self, name: &str) -> Result<PathBuf, String> {
        let dir = self.dir.join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        Ok(dir)
    }
}

/// Measurement names start with their measurement's ID, which the name itself carries.
fn name_prefix(name: &str) -> &'static str {
    if name.starts_with("open") {
        "m3"
    } else if name.starts_with("probe") || name.starts_with("held") {
        "m6"
    } else {
        "m5"
    }
}

/// Runs `measure`.
pub fn run(options: &Options) -> Result<(), String> {
    let which = options.positionals.get(1).cloned().unwrap_or_else(|| "all".into());
    let mut ctx = Ctx {
        dir: options.path("dir")?,
        label: options.value("label").unwrap_or_else(|| "local".into()),
        runs: options.number("runs", 200)?,
        report: Report {
            machine: options.value("machine").unwrap_or_default(),
            reference_laptop: options.flag("reference"),
            results: Vec::new(),
        },
        notes: Vec::new(),
    };
    std::fs::create_dir_all(&ctx.dir).map_err(|e| e.to_string())?;
    let all = which == "all";
    if all || which == "m3" {
        m3::run(&mut ctx)?;
    }
    if all || which == "m5" {
        m5::run(&mut ctx)?;
    }
    if all || which == "m6" {
        m6::run(&mut ctx)?;
    }
    if !(all || ["m3", "m5", "m6"].contains(&which.as_str())) {
        return Err(format!("unknown measurement {which:?}: use m3, m5, m6, or all"));
    }
    write_report(&ctx, options.value("out").as_deref().map(Path::new))
}

fn write_report(ctx: &Ctx, out: Option<&Path>) -> Result<(), String> {
    let mut value = serde_json::to_value(&ctx.report).map_err(|e| e.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.insert("notes".into(), serde_json::json!(ctx.notes));
    }
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n";
    match out {
        Some(path) => std::fs::write(path, json).map_err(|e| format!("{}: {e}", path.display())),
        None => Ok(()),
    }
}
