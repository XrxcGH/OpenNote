//! Scheduled backups: a thread checks once a minute whether a backup is due, and copies each notebook's changed
//! files into a folder the person picked (a USB drive or a second disk) with the core's `backup_notebook`. Daily,
//! weekly, and monthly sets are kept. Files are copied byte for byte, so protected sections stay encrypted. The
//! choices live in `qol.json` under `backup`, and the last run under `backupLast`, which Settings shows.

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use opennote_core::{
    store::{
        backup::{backup_due, backup_notebook, BackupPolicy},
        std_fs::StdFs,
    },
    Clock, SystemClock, Timestamp, Timings,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use super::{arg, emit, out, prefs};
use crate::{
    core_bridge::{run_notes, CoreBridge},
    ipc::{IpcError, IpcResult},
};

/// How often the thread checks.
const CHECK: Duration = Duration::from_secs(60);

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub enabled: bool,
    pub destination: String,
    /// Hours between backups: 1 (hourly) to 168 (weekly).
    pub every_hours: u32,
    pub daily: usize,
    pub weekly: usize,
    pub monthly: usize,
}

impl Default for Config {
    fn default() -> Config {
        let policy = BackupPolicy::default();
        Config {
            enabled: false,
            destination: String::new(),
            every_hours: 24,
            daily: policy.daily,
            weekly: policy.weekly,
            monthly: policy.monthly,
        }
    }
}

impl Config {
    /// The values kept within what the schedule allows.
    pub fn clamped(mut self) -> Config {
        self.every_hours = self.every_hours.clamp(1, 168);
        self.daily = self.daily.clamp(1, 60);
        self.weekly = self.weekly.clamp(0, 52);
        self.monthly = self.monthly.clamp(0, 60);
        self
    }

    pub fn policy(&self) -> BackupPolicy {
        BackupPolicy {
            daily: self.daily,
            weekly: self.weekly,
            monthly: self.monthly,
        }
    }

    pub fn every(&self) -> Duration {
        Duration::from_secs(u64::from(self.every_hours) * 3600)
    }

    /// Whether a backup should run now.
    pub fn due(&self, last: Option<Timestamp>, now: Timestamp) -> bool {
        self.enabled && !self.destination.trim().is_empty() && backup_due(last, self.every(), now)
    }
}

fn config(app: &AppHandle) -> Config {
    prefs::read(app)
        .get("backup")
        .and_then(|value| serde_json::from_value::<Config>(value.clone()).ok())
        .unwrap_or_default()
        .clamped()
}

fn last_run(app: &AppHandle) -> Option<Value> {
    prefs::read(app).get("backupLast").cloned()
}

fn last_time(app: &AppHandle) -> Option<Timestamp> {
    last_run(app)?
        .get("at")?
        .as_str()
        .and_then(|text| Timestamp::parse(text).ok())
}

/// Minutes east of UTC, so a backup set is named for the person's own day.
#[cfg(windows)]
fn utc_offset_minutes() -> i32 {
    use windows::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};

    let mut zone = TIME_ZONE_INFORMATION::default();
    // SAFETY: `zone` is a valid TIME_ZONE_INFORMATION for the call to fill.
    let id = unsafe { GetTimeZoneInformation(&mut zone) };
    // 2 is TIME_ZONE_ID_DAYLIGHT.
    let bias = zone.Bias + if id == 2 { zone.DaylightBias } else { 0 };
    -bias
}

#[cfg(not(windows))]
fn utc_offset_minutes() -> i32 {
    0
}

/// What a run did, for the last-backup line.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub notebooks: u32,
    pub copied_files: u32,
    pub error: Option<String>,
}

/// Backs up every notebook of the library, then records the run.
pub fn run(app: &AppHandle) -> IpcResult<Value> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(json!({ "running": true }));
    }
    let result = run_inner(app);
    RUNNING.store(false, Ordering::SeqCst);
    result
}

fn run_inner(app: &AppHandle) -> IpcResult<Value> {
    let config = config(app);
    if config.destination.trim().is_empty() {
        return Err(IpcError::invalid("destination", "Pick a folder for the backups first."));
    }
    emit(app, "backup", json!({ "running": true }));
    let bridge = app.state::<CoreBridge>();
    // Saving first puts every open page's latest edits in the files the copy reads.
    let roots: Vec<PathBuf> = run_notes(app, &bridge, |b| {
        let _ = b.core.flush_all(Duration::from_secs(10));
        Ok(b.notebooks().iter().filter(|nb| !nb.is_backup()).map(|nb| nb.path().to_path_buf()).collect())
    })?;
    let fs = StdFs::new(&Timings::default());
    let destination = PathBuf::from(config.destination.trim());
    let (now, offset, policy) = (SystemClock::new().now(), utc_offset_minutes(), config.policy());
    let mut outcome = Outcome::default();
    for root in &roots {
        match backup_notebook(&fs, root, &destination, now, offset, &policy) {
            Ok(report) => {
                outcome.notebooks += 1;
                outcome.copied_files += report.copied_files;
            }
            Err(error) => {
                outcome.error = Some(error.to_string());
                break;
            }
        }
    }
    let record = json!({
        "at": now.to_rfc3339(),
        "ok": outcome.error.is_none(),
        "notebooks": outcome.notebooks,
        "copiedFiles": outcome.copied_files,
        "error": outcome.error,
    });
    let mut patch = Map::new();
    patch.insert("backupLast".to_owned(), record.clone());
    prefs::write(app, &patch)?;
    emit(app, "backup", json!({ "running": false, "last": record }));
    Ok(record)
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("opennote-backup".into()).spawn(move || loop {
        std::thread::sleep(CHECK);
        let config = config(&app);
        if config.due(last_time(&app), SystemClock::new().now()) {
            if let Err(error) = run(&app) {
                ::log::warn!("The scheduled backup didn't run: {error}");
            }
        }
    });
    if let Err(error) = spawned {
        ::log::warn!("Couldn't start the backup schedule: {error}");
    }
}

pub fn call(app: &AppHandle, _bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "backup.status" => Ok(json!({
            "config": config(app),
            "last": last_run(app),
            "running": RUNNING.load(Ordering::SeqCst),
        })),
        "backup.configure" => {
            let next = arg::<Config>(args, "config")?.clamped();
            let mut patch = Map::new();
            patch.insert("backup".to_owned(), out(&next)?);
            prefs::write(app, &patch)?;
            out(next)
        }
        "backup.run" => run(app),
        _ => Err(IpcError::invalid("name", "isn't a backup call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> Timestamp {
        Timestamp::parse(text).expect("a time")
    }

    #[test]
    fn the_schedule_stays_between_hourly_and_weekly() {
        let slow = Config {
            every_hours: 9000,
            ..Config::default()
        }
        .clamped();
        assert_eq!(slow.every_hours, 168);
        let fast = Config {
            every_hours: 0,
            ..Config::default()
        }
        .clamped();
        assert_eq!(fast.every_hours, 1);
    }

    #[test]
    fn a_backup_is_due_when_the_time_has_passed_and_a_folder_is_set() {
        let config = Config {
            enabled: true,
            destination: "E:\\Backups".to_owned(),
            every_hours: 24,
            ..Config::default()
        };
        let last = at("2026-10-01T08:00:00Z");
        assert!(!config.due(Some(last), at("2026-10-02T07:59:00Z")));
        assert!(config.due(Some(last), at("2026-10-02T08:00:00Z")));
        assert!(config.due(None, at("2026-10-02T08:00:00Z")));
        let off = Config {
            enabled: false,
            ..config.clone()
        };
        assert!(!off.due(None, at("2026-10-02T08:00:00Z")));
        let nowhere = Config {
            destination: "  ".to_owned(),
            ..config
        };
        assert!(!nowhere.due(None, at("2026-10-02T08:00:00Z")));
    }

    #[test]
    fn a_config_reads_with_missing_fields() {
        let config: Config = serde_json::from_value(json!({ "enabled": true, "destination": "D:\\B" })).expect("reads");
        assert!(config.enabled);
        assert_eq!((config.every_hours, config.daily, config.weekly, config.monthly), (24, 7, 4, 12));
    }
}
