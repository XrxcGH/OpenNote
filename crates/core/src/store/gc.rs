//! Deleting segments and assets that nothing refers to (spec 19). Owned by WP4.
//!
//! Only files whose names match the patterns of spec 19 are ever deleted. A file is deleted only when every
//! file that could refer to it was read: `page.json`, every history version, every file in `.conflicts/`, and
//! sync-tool conflict copies. The caller adds other references, such as journal base snapshots. If any of
//! these files can't be read, nothing is deleted. Call it only for a page that is not open, because undo can
//! bring back a deleted image.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use crate::error::{CoreError, FsErrorKind};
use crate::fail_point;
use crate::format::names::{check_asset_file_name, conflict_copy_kind, ConflictCopyOf};
use crate::id::{AssetId, Id, SegmentId};
use crate::limits::{Limits, Timings};
use crate::model::Page;
use crate::store::fs::DirEntry;
use crate::store::history::list_versions;
use crate::store::layout::{ASSETS_DIR, CONFLICTS_DIR, DAMAGED_DIR, HISTORY_DIR, INK_DIR, PAGE_JSON};
use crate::store::PageFiles;
use crate::time::Timestamp;

/// Segments and assets that something outside the page folder still needs, such as a journal base snapshot.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RefSet {
    /// Segments.
    pub segments: HashSet<SegmentId>,
    /// Assets.
    pub assets: HashSet<AssetId>,
}

impl RefSet {
    /// Adds the segments and assets a page refers to.
    pub fn add_page(&mut self, page: &Page) {
        self.segments.extend(page.ink.segments().iter().map(|s| s.id));
        self.assets.extend(page.assets.keys().copied());
    }
}

/// What garbage collection did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GcReport {
    /// Segments deleted.
    pub segments: Vec<SegmentId>,
    /// Assets deleted.
    pub assets: Vec<AssetId>,
    /// Bytes freed.
    pub bytes: u64,
}

/// Deletes unreferenced segments and assets of a page that is not open, once they are older than `grace`, and
/// damaged files moved aside more than 90 days ago.
///
/// Segment and asset files never change, so their age is the time in their ID.
pub fn collect_garbage(
    files: &PageFiles<'_>,
    extra: &RefSet,
    now: Timestamp,
    grace: Duration,
) -> Result<GcReport, CoreError> {
    let mut report = GcReport::default();
    let Some(refs) = references(files, extra)? else {
        return Ok(report);
    };
    let old =
        |id: Id| Timestamp::from_unix_ms(i64::try_from(id.time_ms()).unwrap_or(i64::MAX)).saturating_add(grace) <= now;
    for entry in list(files, INK_DIR)? {
        let Some(id) = entry.name.strip_suffix(".onk").and_then(|s| SegmentId::parse(s).ok()) else {
            continue;
        };
        if !refs.segments.contains(&id) && old(id.0) {
            remove(files, &files.dir.join(INK_DIR).join(&entry.name))?;
            report.segments.push(id);
            report.bytes = report.bytes.saturating_add(entry.len);
        }
    }
    for entry in list(files, ASSETS_DIR)? {
        let Some(id) = entry.name.get(..Id::TEXT_LEN).and_then(|s| AssetId::parse(s).ok()) else {
            continue;
        };
        if check_asset_file_name(id, &entry.name) && !refs.assets.contains(&id) && old(id.0) {
            remove(files, &files.dir.join(ASSETS_DIR).join(&entry.name))?;
            report.assets.push(id);
            report.bytes = report.bytes.saturating_add(entry.len);
        }
    }
    report.bytes = report.bytes.saturating_add(expire_damaged(files, now)?);
    Ok(report)
}

/// Every segment and asset that a file in the page folder or `extra` refers to, or `None` when one of those
/// files can't be read.
fn references(files: &PageFiles<'_>, extra: &RefSet) -> Result<Option<RefSet>, CoreError> {
    let limits = Limits::default();
    let mut refs = extra.clone();
    let Some(page) = read_page(files, &files.dir.join(PAGE_JSON), &limits) else {
        return Ok(None);
    };
    refs.add_page(&page);
    let snapshots = list(files, HISTORY_DIR)?
        .iter()
        .filter(|e| e.name.ends_with(".json.gz"))
        .count();
    let versions = list_versions(files, &limits)?;
    if versions.versions.len() != snapshots {
        return Ok(None);
    }
    for version in &versions.versions {
        refs.segments.extend(version.segments.iter().copied());
        refs.assets.extend(version.assets.iter().copied());
    }
    let conflicts = list(files, CONFLICTS_DIR)?
        .into_iter()
        .filter(|e| !e.is_dir && e.name.ends_with(".json"))
        .map(|e| files.dir.join(CONFLICTS_DIR).join(e.name));
    let copies = list(files, "")?
        .into_iter()
        .filter(|e| !e.is_dir && e.name != PAGE_JSON && conflict_copy_kind(&e.name) == Some(ConflictCopyOf::Page))
        .map(|e| files.dir.join(e.name));
    for path in conflicts.chain(copies) {
        let Some(other) = read_page(files, &path, &limits) else {
            return Ok(None);
        };
        refs.add_page(&other);
    }
    Ok(Some(refs))
}

fn read_page(files: &PageFiles<'_>, path: &Path, limits: &Limits) -> Option<Page> {
    let bytes = files.fs.read(path, limits.page_json_bytes).ok()?;
    Some(files.codec.read_page(&bytes, limits).ok()?.page)
}

/// The entries of a folder of the page, or none if it doesn't exist.
fn list(files: &PageFiles<'_>, name: &str) -> Result<Vec<DirEntry>, CoreError> {
    let dir = if name.is_empty() {
        files.dir.to_path_buf()
    } else {
        files.dir.join(name)
    };
    match files.fs.read_dir(&dir) {
        Ok(entries) => Ok(entries.into_iter().filter(|e| !e.is_dir || name.is_empty()).collect()),
        Err(err) if err.kind == FsErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err.into()),
    }
}

fn remove(files: &PageFiles<'_>, path: &Path) -> Result<(), CoreError> {
    match files.fs.remove_file(path) {
        Ok(()) => {}
        Err(err) if err.kind == FsErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }
    fail_point!("gc.deleted");
    Ok(())
}

/// Deletes files in `.damaged/` moved aside more than 90 days ago. Their names start with the time they were
/// moved, as `move_damaged` writes it. Returns the bytes freed.
fn expire_damaged(files: &PageFiles<'_>, now: Timestamp) -> Result<u64, CoreError> {
    let age = Timings::default().damaged_age;
    let mut freed = 0u64;
    for entry in list(files, DAMAGED_DIR)? {
        let Some(moved) = entry.name.get(..16).and_then(parse_file_time) else {
            continue;
        };
        if moved.saturating_add(age) <= now {
            remove(files, &files.dir.join(DAMAGED_DIR).join(&entry.name))?;
            freed = freed.saturating_add(entry.len);
        }
    }
    Ok(freed)
}

/// Reads a time written by `layout::file_time`, such as `20260930T140740Z`.
pub(crate) fn parse_file_time(text: &str) -> Option<Timestamp> {
    let (date, time) = text.strip_suffix('Z')?.split_once('T')?;
    let (year, rest) = date.split_at_checked(4)?;
    let (month, day) = rest.split_at_checked(2)?;
    let (hour, rest) = time.split_at_checked(2)?;
    let (minute, second) = rest.split_at_checked(2)?;
    Timestamp::parse(&format!("{year}-{month}-{day}T{hour}:{minute}:{second}Z")).ok()
}

#[cfg(test)]
mod tests;
