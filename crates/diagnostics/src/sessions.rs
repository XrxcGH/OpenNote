//! Safe start after crashes: a small record of how each session ended.
//!
//! The app calls [`SessionLog::begin`] once at start-up and [`SessionLog::end_clean`] when the person quits. A
//! session that began and never ended cleanly crashed, or the computer lost power. After
//! [`SAFE_START_AFTER`] such sessions in a row, [`StartReport::offer_safe_mode`] is true, and the app offers
//! "Start in safe mode", which turns off background work, embeds, and on-device models for that session.
//!
//! The record holds counts and times only: no paths, names, or text. It works with crash reports on or off,
//! because it never leaves the computer and says nothing about what went wrong. The same record gives
//! the beta its local figure for "sessions that ended without a crash" ([`SessionStats`]).
//!
//! A damaged or missing record reads as a first start, so a bad file can never keep the app from opening.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Crashes in a row after which safe mode is offered.
pub const SAFE_START_AFTER: u32 = 2;
/// The newest session endings kept for [`SessionStats`].
pub const MAX_HISTORY: usize = 50;
/// A streak is capped, so a hand-edited file cannot overflow anything.
const MAX_STREAK: u32 = 1_000;
const FORMAT: u32 = 1;
const FILE_NAME: &str = "sessions.json";

/// How one session ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Ended {
    /// The person quit, and the app wrote the record.
    Clean,
    /// The record still said "running" at the next start.
    Crashed,
}

/// How the session before this one ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviousEnd {
    /// There is no earlier session on record.
    First,
    Clean,
    Crashed,
}

/// What start-up needs to know.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartReport {
    pub previous: PreviousEnd,
    /// Sessions in a row that ended in a crash, counting the one just found, if any.
    pub crashes_in_a_row: u32,
    /// Whether to offer "Start in safe mode" before opening the notebook.
    pub offer_safe_mode: bool,
    /// Whether the crashed session had been started in safe mode. If so, safe mode did not help, and the notice
    /// points the person to the feedback file instead.
    pub previous_was_safe: bool,
}

/// How the recent sessions ended, newest [`MAX_HISTORY`] at most.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    pub sessions: u32,
    pub clean: u32,
    pub crashed: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Record {
    format: u32,
    /// True from [`SessionLog::begin`] until [`SessionLog::end_clean`].
    running: bool,
    /// Whether the running session was started in safe mode.
    safe_mode: bool,
    started_unix: u64,
    crashes_in_a_row: u32,
    /// Oldest first.
    history: Vec<Ended>,
}

impl Default for Record {
    fn default() -> Self {
        Record {
            format: FORMAT,
            running: false,
            safe_mode: false,
            started_unix: 0,
            crashes_in_a_row: 0,
            history: Vec::new(),
        }
    }
}

impl Record {
    fn clamp(mut self) -> Record {
        self.crashes_in_a_row = self.crashes_in_a_row.min(MAX_STREAK);
        trim(&mut self.history);
        self
    }
}

fn trim(history: &mut Vec<Ended>) {
    if history.len() > MAX_HISTORY {
        history.drain(..history.len() - MAX_HISTORY);
    }
}

/// The session record in one folder.
#[derive(Clone, Debug)]
pub struct SessionLog {
    path: PathBuf,
}

impl SessionLog {
    /// The record in `dir`, which is normally the app's local data folder. Nothing is read or written yet.
    pub fn new(dir: &Path) -> SessionLog {
        SessionLog {
            path: dir.join(FILE_NAME),
        }
    }

    /// Reads the record. A missing file is `None`. A file that cannot be read or understood is also `None`, and
    /// the next write replaces it.
    fn read(&self) -> Option<Record> {
        let text = fs::read_to_string(&self.path).ok()?;
        let record: Record = serde_json::from_str(&text).ok()?;
        Some(record.clamp())
    }

    /// Writes the record through a temporary file, so a crash while writing leaves the old record whole.
    fn write(&self, record: &Record) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = self.path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(record).map_err(io::Error::other)?;
        fs::write(&temp, text + "\n")?;
        fs::rename(&temp, &self.path)
    }

    /// Records that a session has started, and reports how the one before it ended.
    ///
    /// Call it once, after the app has made sure it is the only copy running: a second copy would find the first
    /// still running and count a crash. It never fails. If the record cannot be written, the report is still
    /// right, and the next start reads the old record.
    pub fn begin(&self, now_unix: u64) -> StartReport {
        let found = self.read();
        let first = found.is_none();
        let mut record = found.unwrap_or_default();
        let previous_was_safe = record.running && record.safe_mode;
        let previous = if first {
            PreviousEnd::First
        } else if record.running {
            record.history.push(Ended::Crashed);
            record.crashes_in_a_row = record.crashes_in_a_row.saturating_add(1).min(MAX_STREAK);
            PreviousEnd::Crashed
        } else {
            PreviousEnd::Clean
        };
        trim(&mut record.history);
        let report = StartReport {
            previous,
            crashes_in_a_row: record.crashes_in_a_row,
            offer_safe_mode: record.crashes_in_a_row >= SAFE_START_AFTER,
            previous_was_safe,
        };
        record.format = FORMAT;
        record.running = true;
        record.safe_mode = false;
        record.started_unix = now_unix;
        let _ = self.write(&record);
        report
    }

    /// Marks the running session as started in safe mode. Call it when the person accepts the offer.
    pub fn enter_safe_mode(&self) -> io::Result<()> {
        let Some(mut record) = self.read() else {
            return Ok(());
        };
        if record.running {
            record.safe_mode = true;
            self.write(&record)?;
        }
        Ok(())
    }

    /// Records that the person quit. The streak ends, because this session did not crash. It does nothing when no
    /// session is running, so calling it twice is harmless.
    pub fn end_clean(&self) -> io::Result<()> {
        let Some(mut record) = self.read() else {
            return Ok(());
        };
        if !record.running {
            return Ok(());
        }
        record.running = false;
        record.safe_mode = false;
        record.crashes_in_a_row = 0;
        record.history.push(Ended::Clean);
        trim(&mut record.history);
        self.write(&record)
    }

    /// How the recent sessions ended. The session that is running now is not counted.
    pub fn stats(&self) -> SessionStats {
        let history = self.read().map(|record| record.history).unwrap_or_default();
        let crashed = history.iter().filter(|ended| **ended == Ended::Crashed).count() as u32;
        let clean = history.len() as u32 - crashed;
        SessionStats {
            sessions: history.len() as u32,
            clean,
            crashed,
        }
    }
}

#[cfg(test)]
#[path = "sessions_tests.rs"]
mod tests;
