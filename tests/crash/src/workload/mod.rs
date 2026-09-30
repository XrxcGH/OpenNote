//! The workloads a writer runs, and the checks after each kill.
//!
//! `core` is the Phase 3 exit gate: the real `Core` from WP5, on the real disk. `fs` needs only WP2. It saves
//! pages through `StdFs` the way spec 17.7 does, so the kill harness tests the save primitives today.

pub mod core;
pub mod core_script;
pub mod core_verify;
pub mod fs;
pub mod fs_format;

use std::io::Write;
use std::path::PathBuf;

use crate::harness::Config;
use crate::markers::Markers;

/// Which workload a writer runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Workload {
    /// The real core. Needs WP3, WP4, and WP5.
    Core,
    /// Page saves through `StdFs` alone.
    Fs,
}

impl Workload {
    /// Parses `core` or `fs`.
    pub fn parse(text: &str) -> Result<Workload, String> {
        match text {
            "core" => Ok(Workload::Core),
            "fs" => Ok(Workload::Fs),
            _ => Err(format!("unknown workload {text:?}: use core or fs")),
        }
    }

    /// The workload's name.
    pub fn name(self) -> &'static str {
        match self {
            Workload::Core => "core",
            Workload::Fs => "fs",
        }
    }

    /// The fail points its writer reaches, and the highest hit number worth arming for each.
    pub fn fail_points(self) -> &'static [(&'static str, u64)] {
        match self {
            Workload::Core => &core::FAIL_POINTS,
            Workload::Fs => &fs::FAIL_POINTS,
        }
    }
}

/// Where a workload's files are.
#[derive(Clone, Debug)]
pub struct Paths {
    /// The notebook folder.
    pub notebook: PathBuf,
    /// The device-local data folder.
    pub data: PathBuf,
}

/// What a check found besides problems.
#[derive(Clone, Debug, Default)]
pub struct Verified {
    /// Pages checked.
    pub pages: u32,
    /// Journal generations that ended in a torn record.
    pub torn_tails: u32,
    /// Temporary files left in the notebook.
    pub temp_files: u32,
}

/// The checks of one workload, with what they remember between iterations.
pub enum Verifier {
    /// The core workload's checks.
    Core(Box<core_verify::VerifyState>),
    /// The file system workload's checks.
    Fs(fs_format::Layout, fs::VerifyState),
}

impl Verifier {
    /// The checks for a run, after the workload's setup.
    pub fn new(config: &Config) -> Result<Verifier, String> {
        let paths = Paths {
            notebook: config.notebook.clone(),
            data: config.data.clone(),
        };
        match config.workload {
            Workload::Core => Ok(Verifier::Core(Box::new(core_verify::VerifyState::new(
                &paths,
                config.seed,
            )?))),
            Workload::Fs => {
                let layout = fs_format::Layout {
                    notebook: paths.notebook,
                    data: paths.data,
                };
                Ok(Verifier::Fs(layout, fs::VerifyState::default()))
            }
        }
    }

    /// Checks the notebook after an iteration.
    pub fn verify(&mut self, iteration: u64, markers: &Markers) -> Result<Verified, String> {
        match self {
            Verifier::Core(state) => state.verify(iteration, markers),
            Verifier::Fs(layout, state) => fs::verify(layout, markers, state),
        }
    }
}

/// Prints a marker line for the parent, at once.
pub fn say(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}
