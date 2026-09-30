//! Backups before a format upgrade (spec 15.4), and scheduled backups (FEATURES.md, Phase 3). Owned by WP4.
//!
//! The schedule, the folder picker, and the "last backup" line in Settings are WP5's and the interface's.
//! This module copies the files: [`backup_before_upgrade`] for migrations, and [`scheduled::backup_notebook`]
//! for the person's own backups.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, FsError, FsErrorKind};
use crate::fail_point;
use crate::store::fs::Fs;
use crate::store::layout::{file_time, parse_temp_name, OPENNOTE_DIR};
use crate::time::{Clock, SystemClock};

pub mod scheduled;

pub use scheduled::{backup_due, backup_notebook, is_backup, last_backup, BackupPolicy, BackupReport};

/// How many backup sets before upgrades each notebook keeps (spec 15.4).
const UPGRADE_SETS: usize = 3;

/// Copies every JSON file of the notebook at `root` into a new backup set under `backups`, and keeps the
/// newest 3 sets. Returns the new set's folder. Its name holds the time and the versions, such as
/// `20260930T140740Z-v1-to-v2`.
pub fn backup_before_upgrade(
    fs: &dyn Fs,
    root: &Path,
    backups: &Path,
    from: u32,
    to: u32,
) -> Result<PathBuf, CoreError> {
    ensure_all(fs, backups)?;
    let stem = format!("{}-v{from}-to-v{to}", file_time(SystemClock::new().now()));
    let set = create_new_dir(fs, backups, &stem)?;
    for (relative, _) in notebook_files(fs, root)? {
        if relative.extension().is_some_and(|e| e == "json") {
            let bytes = fs.read(&root.join(&relative), u64::MAX)?;
            let target = set.join(&relative);
            if let Some(parent) = target.parent() {
                ensure_all(fs, parent)?;
            }
            fs.create_durable(&target, &bytes)?;
        }
    }
    fail_point!("migration.backup.written");
    prune_upgrade_sets(fs, backups)?;
    Ok(set)
}

/// Creates `<parent>/<stem>`, or `<stem>-2` and so on when that name is taken.
fn create_new_dir(fs: &dyn Fs, parent: &Path, stem: &str) -> Result<PathBuf, CoreError> {
    for n in 1..=100u32 {
        let name = if n == 1 { stem.to_owned() } else { format!("{stem}-{n}") };
        let path = parent.join(name);
        match fs.create_dir_durable(&path) {
            Ok(_) => return Ok(path),
            Err(err) if err.kind == FsErrorKind::AlreadyExists => {}
            Err(err) => return Err(err.into()),
        }
    }
    Err(FsError::new(FsErrorKind::AlreadyExists, parent.join(stem)).into())
}

/// Deletes all but the newest upgrade backup sets. Only folders named as `backup_before_upgrade` names them go.
fn prune_upgrade_sets(fs: &dyn Fs, backups: &Path) -> Result<(), CoreError> {
    let mut sets: Vec<String> = fs
        .read_dir(backups)?
        .into_iter()
        .filter(|e| e.is_dir && is_upgrade_set(&e.name))
        .map(|e| e.name)
        .collect();
    sets.sort();
    let extra = sets.len().saturating_sub(UPGRADE_SETS);
    for name in sets.iter().take(extra) {
        fs.remove_dir_all(&backups.join(name))?;
    }
    Ok(())
}

/// `<time>-v<from>-to-v<to>`, with an optional `-<n>`.
fn is_upgrade_set(name: &str) -> bool {
    let Some((time, rest)) = name.split_at_checked(16) else {
        return false;
    };
    let time_ok = time.len() == 16 && time.ends_with('Z') && time.get(8..9) == Some("T");
    time_ok && rest.starts_with("-v") && rest.contains("-to-v")
}

/// Files relative to a notebook's root, with their size and last-write time.
pub(crate) type FileList = Vec<(PathBuf, (u64, i64))>;

/// Every file of a notebook, relative to its root, with its size and last-write time. Temporary files,
/// partial copies, and the writer lock are left out.
pub(crate) fn notebook_files(fs: &dyn Fs, root: &Path) -> Result<FileList, CoreError> {
    let mut files = Vec::new();
    let mut folders = vec![PathBuf::new()];
    while let Some(relative) = folders.pop() {
        for entry in fs.read_dir(&root.join(&relative))? {
            if entry.name.starts_with('~') || parse_temp_name(&entry.name).is_some() {
                continue;
            }
            let path = relative.join(&entry.name);
            if entry.is_dir {
                folders.push(path);
            } else if path != Path::new(OPENNOTE_DIR).join("lock") {
                files.push((path, (entry.len, entry.modified)));
            }
        }
    }
    files.sort();
    Ok(files)
}

/// Creates a folder and every missing parent.
pub(crate) fn ensure_all(fs: &dyn Fs, dir: &Path) -> Result<(), FsError> {
    let mut missing = Vec::new();
    let mut at = Some(dir);
    while let Some(path) = at {
        match fs.metadata(path) {
            Ok(_) => break,
            Err(err) if err.kind == FsErrorKind::NotFound => missing.push(path.to_path_buf()),
            Err(err) => return Err(err),
        }
        at = path.parent().filter(|p| !p.as_os_str().is_empty());
    }
    for path in missing.iter().rev() {
        match fs.create_dir_durable(path) {
            Ok(_) => {}
            Err(err) if err.kind == FsErrorKind::AlreadyExists => {}
            Err(err) => return Err(err),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
