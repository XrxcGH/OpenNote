//! `opennote-crashtest`: the kill harness of plan 13.6, and WP2's week-one measurements. Owned by WP2.
//!
//! ```text
//! opennote-crashtest run --notebook <dir> --data <dir> --iterations <n> --seed <s>
//!                        [--workload core|fs] [--failpoint <name>] [--sabotage] [--no-hostile] [--out <json>]
//!
//! opennote-crashtest measure <m3|m5|m6|all> --dir <dir> [--label <drive>] [--runs <n>] [--machine <name>]
//!                            [--out <json>]
//! ```
//!
//! `run` starts a writer process for each iteration, kills it at a random moment, at a fail point, or just
//! after a save step, and checks the notebook. It exits with 1 when a check fails. `writer` and `hold` are the
//! child processes that `run` and `measure` start.

mod harness;
mod hostile;
mod markers;
mod measure;
mod opts;
mod rng;
mod workload;

use std::process::ExitCode;

use opts::Options;
use workload::{Paths, Workload};

const USAGE: &str = "usage: opennote-crashtest run --notebook <dir> --data <dir> --iterations <n> --seed <s>
                          [--workload core|fs] [--failpoint <name>] [--sabotage] [--no-hostile] [--out <json>]
       opennote-crashtest measure <m3|m5|m6|all> --dir <dir> [--label <drive>] [--runs <n>]
                          [--machine <name>] [--out <json>]";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&args) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn dispatch(args: &[String]) -> Result<ExitCode, String> {
    let options = Options::parse(args)?;
    match options.positionals.first().map(String::as_str) {
        Some("run") => run(&options),
        Some("writer") => writer(&options).map(|()| ExitCode::SUCCESS),
        Some("hold") => measure::hold(&options).map(|()| ExitCode::SUCCESS),
        Some("measure") => measure::run(&options).map(|()| ExitCode::SUCCESS),
        _ => Err(USAGE.to_owned()),
    }
}

fn run(options: &Options) -> Result<ExitCode, String> {
    let config = harness::Config {
        workload: Workload::parse(&options.value("workload").unwrap_or_else(|| "core".into()))?,
        notebook: options.path("notebook")?,
        data: options.path("data")?,
        iterations: options.number("iterations", 50)?,
        seed: options.number("seed", 1)?,
        fail_point: options.value("failpoint"),
        sabotage: options.flag("sabotage"),
        hostile: !options.flag("no-hostile"),
    };
    let summary = harness::run(&config)?;
    let json = serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())?;
    println!("{json}");
    if let Some(out) = options.value("out") {
        std::fs::write(&out, json + "\n").map_err(|e| format!("{out}: {e}"))?;
    }
    Ok(if summary.failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

/// The child process of one iteration.
fn writer(options: &Options) -> Result<(), String> {
    opennote_core::store::failpoint::configure_from_env();
    let paths = Paths {
        notebook: options.path("notebook")?,
        data: options.path("data")?,
    };
    let seed = options.number("seed", 1)?;
    let sabotage = options.flag("sabotage");
    match Workload::parse(&options.value("workload").unwrap_or_else(|| "core".into()))? {
        Workload::Core if options.flag("setup") => workload::core::setup(&paths),
        Workload::Core => workload::core::write(&paths, seed, options.number("iteration", 0)?, sabotage),
        Workload::Fs => {
            let layout = workload::fs_format::Layout {
                notebook: paths.notebook,
                data: paths.data,
            };
            workload::fs::write(&layout, seed, sabotage)
        }
    }
}
