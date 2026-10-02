//! Scheduled backups of a notebook to a folder the person picks, such as a USB drive or a second disk.
//!
//! Each day gets one backup set: a complete copy of the notebook folder, named by the local date, that opens
//! read-only like any notebook. Runs on the same day update that day's set, copying only the files that
//! changed since its last run and removing files the notebook no longer has. Daily, weekly, and monthly sets
//! are kept. Files are copied byte for byte, so protected sections stay encrypted in the copy.
//!
//! A set belongs to the notebook its marker names. Only those sets are updated, counted, or deleted, so the
//! destination can hold other folders and other notebooks' sets. When the date's name is taken, the set is
//! named like `2026-09-30 (2)`.

use std::collections::{BTreeMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::{ensure_all, notebook_files};
use crate::error::{CoreError, FsError, FsErrorKind};
use crate::store::fs::Fs;
use crate::time::Timestamp;

/// The marker file at the root of every backup set. A notebook folder that holds it opens read-only.
pub const MARKER: &str = ".opennote-backup.json";

/// The most sets of one day under one destination: one for each notebook backed up there.
const SETS_PER_DAY: u32 = 32;

/// How many backup sets are kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BackupPolicy {
    /// The newest sets, one per day.
    pub daily: usize,
    /// The newest set of each of this many weeks.
    pub weekly: usize,
    /// The newest set of each of this many months.
    pub monthly: usize,
}

impl Default for BackupPolicy {
    fn default() -> BackupPolicy {
        BackupPolicy {
            daily: 7,
            weekly: 4,
            monthly: 12,
        }
    }
}

/// What a backup run did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BackupReport {
    /// The set it updated.
    pub set: PathBuf,
    /// When it finished, for "Last backup" in Settings.
    pub finished: Option<Timestamp>,
    /// Files copied because they were new or changed.
    pub copied_files: u32,
    /// Bytes copied.
    pub copied_bytes: u64,
    /// Files removed from the set because the notebook no longer has them.
    pub removed_files: u32,
    /// Older sets deleted by the policy.
    pub dropped_sets: Vec<PathBuf>,
}

/// The marker's content: whether the set is complete, and the source fingerprint of every file it copied.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    complete: bool,
    finished: Option<Timestamp>,
    source: String,
    files: BTreeMap<String, (u64, i64)>,
}

/// Whether a backup is due: never run, or `every` has passed since the last run.
pub fn backup_due(last: Option<Timestamp>, every: Duration, now: Timestamp) -> bool {
    last.is_none_or(|last| last.saturating_add(every) <= now)
}

/// Whether a notebook folder is a backup set, which opens read-only.
pub fn is_backup(fs: &dyn Fs, notebook_root: &Path) -> bool {
    fs.metadata(&notebook_root.join(MARKER)).is_ok()
}

/// When the newest complete backup set of the notebook at `root` under `dest` finished.
pub fn last_backup(fs: &dyn Fs, root: &Path, dest: &Path) -> Option<Timestamp> {
    sets(fs, root, dest)
        .into_iter()
        .filter(|(_, marker)| marker.complete)
        .filter_map(|(_, marker)| marker.finished)
        .max()
}

/// Backs up the notebook at `root` into today's set under `dest`, then applies the policy.
/// `utc_offset_minutes` places the day in local time.
pub fn backup_notebook(
    fs: &dyn Fs,
    root: &Path,
    dest: &Path,
    now: Timestamp,
    utc_offset_minutes: i32,
    policy: &BackupPolicy,
) -> Result<BackupReport, CoreError> {
    let day = local_day(now, utc_offset_minutes);
    ensure_all(fs, dest)?;
    let set = day_set(fs, root, dest, &day)?;
    ensure_all(fs, &set)?;
    let mut marker = read_marker(fs, &set).unwrap_or_default();
    marker.complete = false;
    marker.source = source_of(root);
    write_marker(fs, &set, &marker)?;
    let mut report = BackupReport {
        set: set.clone(),
        ..BackupReport::default()
    };
    let files = notebook_files(fs, root)?;
    copy_changed(fs, root, &set, &files, &mut marker, &mut report)?;
    remove_gone(fs, &set, &files, &mut marker, &mut report)?;
    marker.complete = true;
    marker.finished = Some(now);
    write_marker(fs, &set, &marker)?;
    report.finished = Some(now);
    report.dropped_sets = prune(fs, root, dest, policy)?;
    Ok(report)
}

/// The folder of the day's set: the one this notebook already has, or else the first free name. A folder that
/// holds anything but this notebook's set is never written into.
fn day_set(fs: &dyn Fs, root: &Path, dest: &Path, day: &str) -> Result<PathBuf, CoreError> {
    let mut free = None;
    for n in 1..=SETS_PER_DAY {
        let set = dest.join(set_name(day, n));
        match fs.read_dir(&set) {
            Ok(_) if owns(fs, root, &set) => return Ok(set),
            Ok(entries) if entries.is_empty() => {
                free.get_or_insert(set);
            }
            Err(err) if err.kind == FsErrorKind::NotFound => {
                free.get_or_insert(set);
            }
            // Another folder, another notebook's set, or a file.
            Ok(_) | Err(_) => {}
        }
    }
    free.ok_or_else(|| FsError::new(FsErrorKind::AlreadyExists, dest.join(day)).into())
}

fn set_name(day: &str, n: u32) -> String {
    if n <= 1 {
        day.to_owned()
    } else {
        format!("{day} ({n})")
    }
}

/// How a set's marker names the notebook it copies.
fn source_of(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

/// Whether `set` is a backup set of the notebook at `root`.
fn owns(fs: &dyn Fs, root: &Path, set: &Path) -> bool {
    read_marker(fs, set).is_some_and(|marker| marker.source == source_of(root))
}

/// Copies the files that are new, or whose size or last-write time changed since the set's last run.
fn copy_changed(
    fs: &dyn Fs,
    root: &Path,
    set: &Path,
    files: &[(PathBuf, (u64, i64))],
    marker: &mut Marker,
    report: &mut BackupReport,
) -> Result<(), CoreError> {
    for (relative, stamp) in files.iter().filter(|(relative, _)| relative != Path::new(MARKER)) {
        let key = key_of(relative);
        let target = set.join(relative);
        let copied = marker.files.get(&key) == Some(stamp) && fs.metadata(&target).is_ok();
        if copied {
            continue;
        }
        let bytes = fs.read(&root.join(relative), u64::MAX)?;
        if let Some(parent) = target.parent() {
            ensure_all(fs, parent)?;
        }
        fs.replace_durable(&target, &bytes)?;
        marker.files.insert(key, *stamp);
        report.copied_files = report.copied_files.saturating_add(1);
        report.copied_bytes = report.copied_bytes.saturating_add(bytes.len() as u64);
    }
    Ok(())
}

/// Removes files the set copied earlier that the notebook no longer has. The marker sits on the destination
/// and can't be trusted (spec 2.10): a key that isn't a plain relative path inside the set is dropped from it
/// without touching the disk.
fn remove_gone(
    fs: &dyn Fs,
    set: &Path,
    files: &[(PathBuf, (u64, i64))],
    marker: &mut Marker,
    report: &mut BackupReport,
) -> Result<(), CoreError> {
    let present: HashSet<String> = files.iter().map(|(relative, _)| key_of(relative)).collect();
    let gone: Vec<String> = marker.files.keys().filter(|k| !present.contains(*k)).cloned().collect();
    for key in gone {
        let Some(relative) = relative_of(&key) else {
            marker.files.remove(&key);
            continue;
        };
        match fs.remove_file(&set.join(relative)) {
            Ok(()) => report.removed_files = report.removed_files.saturating_add(1),
            Err(err) if err.kind == FsErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
        marker.files.remove(&key);
    }
    Ok(())
}

/// The relative path of a marker key, or `None` unless every `/`-separated part is a plain name: no empty
/// part, `.`, `..`, root, drive, or separator of another platform.
fn relative_of(key: &str) -> Option<PathBuf> {
    let mut relative = PathBuf::new();
    for part in key.split('/') {
        let mut components = Path::new(part).components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) if name == part => relative.push(name),
            _ => return None,
        }
    }
    Some(relative)
}

/// A relative path with `/` separators, as the marker stores it.
fn key_of(relative: &Path) -> String {
    relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn read_marker(fs: &dyn Fs, set: &Path) -> Option<Marker> {
    let bytes = fs.read(&set.join(MARKER), 64 * 1024 * 1024).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_marker(fs: &dyn Fs, set: &Path, marker: &Marker) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(marker).unwrap_or_default();
    fs.replace_durable(&set.join(MARKER), &bytes)?;
    Ok(())
}

/// The local date of a time, as `2026-09-30`.
fn local_day(at: Timestamp, offset_minutes: i32) -> String {
    let shift = i64::from(offset_minutes).saturating_mul(60_000);
    let text = Timestamp::from_unix_ms(at.unix_ms().saturating_add(shift)).to_rfc3339();
    text.get(..10).unwrap_or(&text).to_owned()
}

/// The backup sets of the notebook at `root` under `dest`, with their markers, newest first. A folder without
/// this notebook's marker is never one of them.
fn sets(fs: &dyn Fs, root: &Path, dest: &Path) -> Vec<(String, Marker)> {
    let source = source_of(root);
    let mut sets: Vec<(String, Marker)> = fs
        .read_dir(dest)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.is_dir && day_of(&e.name).is_some())
        .filter_map(|e| read_marker(fs, &dest.join(&e.name)).map(|marker| (e.name, marker)))
        .filter(|(_, marker)| marker.source == source)
        .collect();
    sets.sort_by(|a, b| b.0.cmp(&a.0));
    sets
}

/// The day of a set's name: `2026-09-30`, or `2026-09-30 (2)` when that name was taken.
fn day_of(name: &str) -> Option<Timestamp> {
    let (day, rest) = (name.get(..10)?, name.get(10..)?);
    let number = rest.strip_prefix(" (").and_then(|r| r.strip_suffix(')'));
    let numbered = number.is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    (rest.is_empty() || numbered).then_some(())?;
    Timestamp::parse(&format!("{day}T00:00:00Z")).ok()
}

/// Deletes the sets of the notebook at `root` the policy doesn't keep: the newest `daily` days, and the newest
/// set of each of the newest `weekly` weeks and `monthly` months.
fn prune(fs: &dyn Fs, root: &Path, dest: &Path, policy: &BackupPolicy) -> Result<Vec<PathBuf>, CoreError> {
    let names: Vec<String> = sets(fs, root, dest).into_iter().map(|(name, _)| name).collect();
    let mut weeks = Vec::new();
    let mut months = Vec::new();
    let mut dropped = Vec::new();
    for (index, name) in names.iter().enumerate() {
        let Some(day) = day_of(name) else {
            continue;
        };
        let week = day
            .unix_ms()
            .div_euclid(86_400_000)
            .checked_add(3)
            .map(|d| d.div_euclid(7));
        let month = name.get(..7).unwrap_or(name).to_owned();
        let new_week = !weeks.contains(&week);
        let new_month = !months.contains(&month);
        if new_week {
            weeks.push(week);
        }
        if new_month {
            months.push(month);
        }
        let keep = index < policy.daily
            || (new_week && weeks.len() <= policy.weekly)
            || (new_month && months.len() <= policy.monthly);
        if !keep {
            let path = dest.join(name);
            fs.remove_dir_all(&path)?;
            dropped.push(path);
        }
    }
    Ok(dropped)
}
