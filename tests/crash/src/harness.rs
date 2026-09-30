//! The parent of the kill harness (plan 13.6). It starts one writer process per iteration. It kills the writer
//! at a random moment, at a fail point, or just after a save step, and then checks the notebook. Every
//! iteration continues on the same notebook, so damage would pile up and be caught.

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use opennote_core::store::failpoint;
use serde::Serialize;

use crate::hostile::Hostile;
use crate::markers::{Kind, Markers};
use crate::rng::Rng;
use crate::workload::core_script::Manifest;
use crate::workload::{Verifier, Workload};

/// How long a writer may run before an armed fail point counts as not reached.
const FAIL_POINT_WAIT: Duration = Duration::from_secs(4);

/// What `run` does.
#[derive(Clone, Debug)]
pub struct Config {
    /// The workload.
    pub workload: Workload,
    /// The notebook folder.
    pub notebook: PathBuf,
    /// The device-local data folder.
    pub data: PathBuf,
    /// How many writers to kill.
    pub iterations: u64,
    /// The seed of every choice.
    pub seed: u64,
    /// A fail point to arm in every iteration, instead of the usual mix.
    pub fail_point: Option<String>,
    /// Makes the writer damage pages on purpose, to test the harness itself.
    pub sabotage: bool,
    /// Whether the hostile reader runs.
    pub hostile: bool,
}

/// How an iteration's writer stops.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kill {
    /// Killed this many milliseconds after it starts.
    After(u64),
    /// Aborts the n-th time it reaches a fail point, or is killed if it never does.
    FailPoint(String, u64),
    /// Killed this many microseconds after its first save step.
    AfterSave(u64),
}

impl Kill {
    /// The plan for one iteration: half random moments, a quarter fail points, a quarter just after a save.
    pub fn choose(config: &Config, iteration: u64) -> Kill {
        let mut rng = Rng::derive(config.seed, &[iteration, 1]);
        let points = config.workload.fail_points();
        if let Some(name) = &config.fail_point {
            let max = points.iter().find(|(p, _)| p == name).map_or(3, |(_, max)| *max);
            return Kill::FailPoint(name.clone(), rng.range(1..max + 1));
        }
        match rng.below(4) {
            0 | 1 => Kill::After(rng.range(10..801)),
            2 => {
                let (name, max) = points[rng.below(points.len())];
                Kill::FailPoint(name.to_owned(), rng.range(1..max + 1))
            }
            _ => Kill::AfterSave(rng.range(0..2001)),
        }
    }
}

/// What happened in one iteration.
#[derive(Debug)]
struct Outcome {
    markers: Markers,
    killed: bool,
    fail_point_reached: bool,
    stderr: String,
    status: Option<i32>,
}

/// Totals over a run, written as JSON at the end.
#[derive(Debug, Default, Serialize)]
pub struct Summary {
    /// The workload.
    pub workload: String,
    /// Iterations run.
    pub iterations: u64,
    /// Writers killed at a random moment.
    pub killed_at_random: u64,
    /// Writers killed just after a save step.
    pub killed_after_save: u64,
    /// Iterations with a fail point armed.
    pub fail_points_armed: u64,
    /// Armed fail points the writer reached.
    pub fail_points_reached: u64,
    /// The sum of every page's highest acknowledged step in every iteration.
    pub acks: u64,
    /// Save steps the writers printed.
    pub save_steps: u64,
    /// Journal generations that ended in a torn record.
    pub torn_tails: u64,
    /// The most temporary files left in the notebook at once.
    pub temp_files_max: u32,
    /// Files the hostile reader held.
    pub hostile_holds: u64,
    /// Seconds the run took.
    pub seconds: f64,
    /// What went wrong. Empty when every iteration passed.
    pub failures: Vec<String>,
}

/// Runs the harness.
pub fn run(config: &Config) -> Result<Summary, String> {
    let started = Instant::now();
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    setup(&exe, config)?;
    let mut verifier = Verifier::new(config)?;
    let mut summary = Summary {
        workload: config.workload.name().to_owned(),
        ..Summary::default()
    };
    for iteration in 0..config.iterations {
        let kill = Kill::choose(config, iteration);
        let hostile = config
            .hostile
            .then(|| Hostile::start(&config.notebook, config.seed ^ iteration));
        let outcome = run_writer(&exe, config, iteration, &kill)?;
        summary.hostile_holds += hostile.map_or(0, Hostile::stop);
        summary.iterations += 1;
        tally(&mut summary, &kill, &outcome);
        if !outcome.killed && !outcome.fail_point_reached {
            let status = outcome.status;
            let stderr = outcome.stderr.trim();
            summary.failures.push(format!(
                "iteration {iteration}: the writer stopped by itself ({status:?}): {stderr}"
            ));
            break;
        }
        match verifier.verify(iteration, &outcome.markers) {
            Ok(verified) => {
                summary.torn_tails += u64::from(verified.torn_tails);
                summary.temp_files_max = summary.temp_files_max.max(verified.temp_files);
            }
            Err(problem) => {
                summary
                    .failures
                    .push(format!("iteration {iteration} ({kill:?}): {problem}"));
                break;
            }
        }
    }
    summary.seconds = started.elapsed().as_secs_f64();
    Ok(summary)
}

/// The core workload's setup run, once per notebook: it makes the notebook and its pages.
fn setup(exe: &std::path::Path, config: &Config) -> Result<(), String> {
    if config.workload != Workload::Core || Manifest::path(&config.data).exists() {
        return Ok(());
    }
    let output = Command::new(exe)
        .args(["writer", "--setup", "--workload", "core"])
        .arg("--notebook")
        .arg(&config.notebook)
        .arg("--data")
        .arg(&config.data)
        .env_remove(failpoint::ENV_VAR)
        .output()
        .map_err(|e| format!("starting the setup: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "the setup failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn tally(summary: &mut Summary, kill: &Kill, outcome: &Outcome) {
    match kill {
        Kill::After(_) => summary.killed_at_random += 1,
        Kill::AfterSave(_) => summary.killed_after_save += 1,
        Kill::FailPoint(..) => summary.fail_points_armed += 1,
    }
    summary.fail_points_reached += u64::from(outcome.fail_point_reached);
    summary.acks += outcome.markers.acks.values().sum::<u64>();
    summary.save_steps += outcome.markers.saves.len() as u64;
}

/// The seed an iteration's writer gets, from which it draws its script. The core verifier replays the same
/// script, so it must use this seed too.
pub fn writer_seed(seed: u64, iteration: u64) -> u64 {
    Rng::derive(seed, &[iteration, 2]).next()
}

/// Starts one writer, stops it as `kill` says, and collects what it printed.
fn run_writer(exe: &std::path::Path, config: &Config, iteration: u64, kill: &Kill) -> Result<Outcome, String> {
    let mut command = Command::new(exe);
    command
        .arg("writer")
        .args(["--workload", config.workload.name()])
        .arg("--notebook")
        .arg(&config.notebook)
        .arg("--data")
        .arg(&config.data)
        .args(["--seed", &writer_seed(config.seed, iteration).to_string()])
        .args(["--iteration", &iteration.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove(failpoint::ENV_VAR);
    if config.sabotage {
        command.arg("--sabotage");
    }
    if let Kill::FailPoint(name, nth) = kill {
        command.env(failpoint::ENV_VAR, format!("{name}:{nth}"));
    }
    let started = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("starting the writer: {e}"))?;
    let lines = read_lines(&mut child);
    let stderr = read_all(child.stderr.take());
    let mut markers = Markers::default();
    let killed = stop(&mut child, kill, started, &lines, &mut markers);
    let status = child.wait().map_err(|e| e.to_string())?.code();
    while let Ok(line) = lines.recv() {
        markers.take(&line);
    }
    let stderr = stderr.join().unwrap_or_default();
    Ok(Outcome {
        fail_point_reached: stderr.contains("FAILPOINT "),
        markers,
        killed,
        stderr,
        status,
    })
}

/// Stops the writer as `kill` says. Returns whether it was killed, rather than stopping by itself.
fn stop(child: &mut Child, kill: &Kill, started: Instant, lines: &Receiver<String>, markers: &mut Markers) -> bool {
    let deadline = match kill {
        Kill::After(ms) => started + Duration::from_millis(*ms),
        Kill::FailPoint(..) | Kill::AfterSave(_) => started + FAIL_POINT_WAIT,
    };
    loop {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return false;
        }
        let now = Instant::now();
        if now >= deadline {
            return child.kill().is_ok();
        }
        let line = match lines.recv_timeout((deadline - now).min(Duration::from_millis(2))) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => continue,
        };
        let saved = markers.take(&line) == Kind::Save;
        if let (true, Kill::AfterSave(micros)) = (saved, kill) {
            spin(Duration::from_micros(*micros));
            return child.kill().is_ok();
        }
    }
}

/// Waits without sleeping, because a sleep can't be shorter than a millisecond on Windows.
fn spin(wait: Duration) {
    let start = Instant::now();
    while start.elapsed() < wait {
        std::hint::spin_loop();
    }
}

fn read_lines(child: &mut Child) -> Receiver<String> {
    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    rx
}

fn read_all(stream: Option<std::process::ChildStderr>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stream) = stream {
            let _ = stream.read_to_string(&mut text);
        }
        text
    })
}
