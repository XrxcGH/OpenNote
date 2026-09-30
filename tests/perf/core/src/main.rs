//! `opennote-perf`: the sample notebook generator and the benchmarks of plan 13.9.
//!
//! ```text
//! opennote-perf generate --pages <n> --seed <s> [--one-section] <dir>
//! opennote-perf bench <suite> [--pages <n>] [--quick] [--reference] [--machine <name>] [--out <file>] <dir>
//! opennote-perf compare <results> <baseline> [--tolerance <percent>]
//! ```
//!
//! The suites are `format`, `ops`, `store`, `session`, `startup`, `memory`, and `all`. Results are JSON. A
//! result more than the tolerance worse than the baseline, 10% by default, fails the run.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ExitCode;

use opennote_perf::harness::{self, BenchCtx, GenerateArgs, Report};
use opennote_perf::{bench_format, bench_ops, bench_session, bench_startup, bench_store, generate, memory};

const USAGE: &str = "usage: opennote-perf generate --pages <n> --seed <s> [--one-section] <dir>
       opennote-perf bench <suite> [--pages <n>] [--quick] [--reference] [--machine <name>] [--out <file>] <dir>
       opennote-perf compare <results> <baseline> [--tolerance <percent>]";

/// A benchmark suite's entry point.
type Suite = fn(&mut BenchCtx) -> Result<(), String>;

/// Every suite, in the order `all` runs them.
const SUITES: [(&str, Suite); 6] = [
    ("format", bench_format::run),
    ("ops", bench_ops::run),
    ("store", bench_store::run),
    ("session", bench_session::run),
    ("startup", bench_startup::run),
    ("memory", memory::run),
];

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    let (command, rest) = args.split_first().ok_or(USAGE)?;
    let options = Options::parse(rest)?;
    match command.as_str() {
        "generate" => generate::run(&GenerateArgs {
            pages: options.number("pages", 1_000)?,
            seed: options.number("seed", 42)?,
            one_section: options.flag("one-section"),
            dir: options.positional(0)?,
        }),
        "bench" => bench(&options),
        "compare" => compare(&options),
        _ => Err(USAGE.to_owned()),
    }
}

fn bench(options: &Options) -> Result<(), String> {
    let suite = options.positionals.first().ok_or(USAGE)?.clone();
    let report = Report {
        machine: options.value("machine").unwrap_or_default(),
        reference_laptop: options.flag("reference"),
        results: Vec::new(),
    };
    let mut ctx = BenchCtx {
        pages: options.number("pages", 100)?,
        quick: options.flag("quick"),
        dir: options.positional(1)?,
        report,
    };
    let chosen: Vec<&(&str, Suite)> = SUITES
        .iter()
        .filter(|(name, _)| suite == "all" || *name == suite)
        .collect();
    if chosen.is_empty() {
        return Err(format!("unknown suite {suite:?}\n{USAGE}"));
    }
    for (_, run_suite) in chosen {
        run_suite(&mut ctx)?;
    }
    let json = serde_json::to_string_pretty(&ctx.report).map_err(|e| e.to_string())?;
    match options.value("out") {
        Some(out) => std::fs::write(&out, json + "\n").map_err(|e| format!("{out}: {e}"))?,
        None => println!("{json}"),
    }
    match ctx.report.over_budget().as_slice() {
        [] => Ok(()),
        over => Err(format!("{} measurements are over budget: {over:?}", over.len())),
    }
}

fn compare(options: &Options) -> Result<(), String> {
    let read = |i: usize| -> Result<Report, String> {
        let path = options.positional(i)?;
        let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
    };
    let regressions = harness::compare(&read(0)?, &read(1)?, options.number("tolerance", 10.0)?);
    for r in &regressions {
        eprintln!("{}: {} -> {} ({:+.1}%)", r.name, r.baseline, r.value, r.percent);
    }
    if regressions.is_empty() {
        Ok(())
    } else {
        Err(format!("{} measurements regressed", regressions.len()))
    }
}

/// Command-line options: `--name value`, `--flag`, and positional arguments.
#[derive(Debug, Default)]
struct Options {
    values: HashMap<String, String>,
    flags: Vec<String>,
    positionals: Vec<String>,
}

/// Options that take no value.
const FLAGS: [&str; 3] = ["one-section", "quick", "reference"];

impl Options {
    fn parse(args: &[String]) -> Result<Options, String> {
        let mut options = Options::default();
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            match arg.strip_prefix("--") {
                Some(name) if FLAGS.contains(&name) => options.flags.push(name.to_owned()),
                Some(name) => {
                    let value = args.next().ok_or_else(|| format!("--{name} needs a value"))?;
                    options.values.insert(name.to_owned(), value.clone());
                }
                None => options.positionals.push(arg.clone()),
            }
        }
        Ok(options)
    }

    fn flag(&self, name: &str) -> bool {
        self.flags.iter().any(|f| f == name)
    }

    fn value(&self, name: &str) -> Option<String> {
        self.values.get(name).cloned()
    }

    fn number<T: std::str::FromStr>(&self, name: &str, default: T) -> Result<T, String> {
        match self.values.get(name) {
            Some(text) => text
                .parse()
                .map_err(|_| format!("--{name} must be a number, not {text:?}")),
            None => Ok(default),
        }
    }

    fn positional(&self, index: usize) -> Result<PathBuf, String> {
        self.positionals
            .get(index)
            .map(PathBuf::from)
            .ok_or_else(|| USAGE.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn parses_options() {
        let options = Options::parse(&strings(&["--pages", "100", "--quick", "all", "out-dir"])).unwrap();
        assert_eq!(options.number("pages", 0usize).unwrap(), 100);
        assert!(options.flag("quick"));
        assert!(!options.flag("reference"));
        assert_eq!(options.positionals, ["all", "out-dir"]);
        assert_eq!(options.number("seed", 42u64).unwrap(), 42);
        assert!(Options::parse(&strings(&["--pages"])).is_err());
        assert!(Options::parse(&strings(&["--pages", "many"]))
            .unwrap()
            .number("pages", 0usize)
            .is_err());
    }

    #[test]
    fn rejects_unknown_commands_and_suites() {
        assert!(run(&strings(&["dance"])).is_err());
        assert!(run(&[]).is_err());
        assert!(run(&strings(&["bench", "nope", "dir"]))
            .unwrap_err()
            .contains("unknown suite"));
    }
}
