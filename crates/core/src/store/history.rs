//! Page history (spec 13): writing, listing, opening, and thinning saved versions. Owned by WP4.
//!
//! A version is the exact bytes of `page.json` at one revision, gzipped, in `.history/<revision>.json.gz`.
//! Versions share the page's immutable segments and assets. `versions.json` lists them and can always be
//! rebuilt from the snapshots. History is best effort: losing a version never loses the page's content.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use crate::error::{CoreError, FsErrorKind};
use crate::fail_point;
use crate::format::gzip::{gunzip, gzip};
use crate::format::ReadPage;
use crate::id::{PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{FormatInfo, JsonMap, Named, Page, VersionEntry, VersionReason, VersionsFile};
use crate::store::layout::{NotebookLayout, HISTORY_DIR};
use crate::store::page_store::{ensure_dir, load_ink};
use crate::store::PageFiles;
use crate::time::Timestamp;

mod thinning;

pub use thinning::bucket;

/// How long versions are kept (spec 13.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Retention {
    /// 30 days.
    Days30,
    /// 1 year, the default.
    Year1,
    /// Forever.
    Forever,
}

/// What thinning did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThinReport {
    /// Versions kept.
    pub kept: u32,
    /// Versions dropped.
    pub dropped: Vec<RevisionId>,
}

/// The reason a rebuilt list gives a version it finds without an entry (spec 13.1).
const UNKNOWN_REASON: &str = "unknown";

/// Saves `page_bytes`, the exact bytes of `page.json` at this revision, as a version.
///
/// Writing the same revision again adds nothing, except that a `name` names the existing version. Pages of
/// encrypted sections keep no plain-text history (spec 5.7).
pub fn write_version(
    files: &PageFiles<'_>,
    page_bytes: &[u8],
    page: &Page,
    reason: VersionReason,
    name: Option<String>,
) -> Result<(), CoreError> {
    if page.encryption.is_some() {
        return Ok(());
    }
    ensure_dir(files.fs, &files.dir.join(HISTORY_DIR))?;
    let mut list = list_versions(files, &Limits::default())?;
    let snapshot = gzip(page_bytes);
    let path = NotebookLayout::version_path(files.dir, page.revision.id);
    match files.fs.create_durable(&path, &snapshot) {
        // Another snapshot of the same revision already holds that revision's bytes.
        Ok(_) => {}
        Err(err) if err.kind == FsErrorKind::AlreadyExists => {}
        Err(err) => return Err(err.into()),
    }
    fail_point!("save.history.written");
    list.page = page.id;
    match list.versions.iter_mut().find(|v| v.revision == page.revision.id) {
        Some(existing) => {
            if existing.reason.known().is_none() {
                existing.reason = Named::Known(reason);
            }
            if name.is_some() {
                existing.name = name;
            }
        }
        None => list.versions.push(entry(page, reason, name, snapshot.len() as u64)),
    }
    sort(&mut list.versions);
    write_list(files, &list)
}

fn entry(page: &Page, reason: VersionReason, name: Option<String>, bytes: u64) -> VersionEntry {
    VersionEntry {
        revision: page.revision.id,
        saved_at: page.revision.saved_at,
        reason: Named::Known(reason),
        name,
        keep: false,
        device: page.revision.device.clone(),
        bytes,
        segments: page.ink.segments().iter().map(|s| s.id).collect(),
        assets: page.assets.keys().copied().collect(),
        extra: JsonMap::new(),
    }
}

fn sort(versions: &mut [VersionEntry]) {
    versions.sort_by_key(|v| (v.saved_at, v.revision));
}

/// Writes `versions.json`, unless it already holds exactly these bytes.
fn write_list(files: &PageFiles<'_>, list: &VersionsFile) -> Result<(), CoreError> {
    let bytes = files.codec.write_versions(list);
    let path = NotebookLayout::versions_json(files.dir);
    if files.fs.read(&path, bytes.len() as u64).ok().as_deref() == Some(&bytes[..]) {
        return Ok(());
    }
    files.fs.replace_durable(&path, &bytes)?;
    Ok(())
}

/// Reads `versions.json`, rebuilding it from the snapshots if it is missing or damaged.
///
/// Entries whose snapshot is gone are left out, and snapshots without an entry are added with the reason
/// `unknown`, so the list always matches the files. A changed list is written back.
pub fn list_versions(files: &PageFiles<'_>, limits: &Limits) -> Result<VersionsFile, CoreError> {
    let snapshots = snapshot_files(files)?;
    let listed = files
        .fs
        .read(&NotebookLayout::versions_json(files.dir), limits.page_json_bytes)
        .ok()
        .and_then(|bytes| files.codec.read_versions(&bytes, limits).ok());
    let original = listed.as_ref().map(|list| list.versions.clone());
    let mut list = listed.unwrap_or_else(|| VersionsFile {
        page: page_id_of(files.dir),
        versions: Vec::new(),
        extra: JsonMap::new(),
        format: FormatInfo::default(),
    });
    list.versions.retain(|v| snapshots.contains_key(&v.revision));
    let unlisted: Vec<(RevisionId, u64)> = snapshots
        .iter()
        .filter(|(rev, _)| !list.versions.iter().any(|v| v.revision == **rev))
        .map(|(rev, len)| (*rev, *len))
        .collect();
    for (revision, len) in unlisted {
        if let Some(found) = rebuilt_entry(files, revision, len, limits) {
            list.versions.push(found);
        }
    }
    sort(&mut list.versions);
    if original.as_ref() != Some(&list.versions) && !list.versions.is_empty() {
        // Best effort: the list is rebuilt again next time if this write fails.
        let _ = write_list(files, &list);
    }
    Ok(list)
}

/// Every snapshot file in `.history/`, with its size.
fn snapshot_files(files: &PageFiles<'_>) -> Result<HashMap<RevisionId, u64>, CoreError> {
    match files.fs.read_dir(&files.dir.join(HISTORY_DIR)) {
        Ok(entries) => Ok(entries
            .into_iter()
            .filter(|e| !e.is_dir)
            .filter_map(|e| {
                let revision = e.name.strip_suffix(".json.gz")?;
                Some((RevisionId::parse(revision).ok()?, e.len))
            })
            .collect()),
        Err(err) if err.kind == FsErrorKind::NotFound => Ok(HashMap::new()),
        Err(err) => Err(err.into()),
    }
}

/// An entry for a snapshot without one, read from the snapshot itself.
fn rebuilt_entry(files: &PageFiles<'_>, revision: RevisionId, len: u64, limits: &Limits) -> Option<VersionEntry> {
    let page = read_snapshot(files, revision, limits).ok()?.page;
    let mut found = entry(&page, VersionReason::Closed, None, len);
    found.reason = Named::Unknown(UNKNOWN_REASON.into());
    found.revision = revision;
    Some(found)
}

fn page_id_of(dir: &Path) -> PageId {
    dir.file_name()
        .and_then(|name| PageId::parse(&name.to_string_lossy()).ok())
        .unwrap_or(PageId::ZERO)
}

fn read_snapshot(files: &PageFiles<'_>, rev: RevisionId, limits: &Limits) -> Result<ReadPage, CoreError> {
    let path = NotebookLayout::version_path(files.dir, rev);
    let packed = files.fs.read(&path, limits.page_json_bytes)?;
    let bytes = gunzip(&packed, limits.gunzip_bytes)?;
    Ok(files.codec.read_page(&bytes, limits)?)
}

/// Reads one version, upgrading it in memory if it is older, with its ink.
pub fn open_version(files: &PageFiles<'_>, rev: RevisionId, limits: &Limits) -> Result<ReadPage, CoreError> {
    let mut read = read_snapshot(files, rev, limits)?;
    let ink = load_ink(files.fs, files.codec, files.dir, &mut read.page, limits);
    if !ink.missing.is_empty() || !ink.damaged.is_empty() {
        let detail = format!("{} missing, {} damaged", ink.missing.len(), ink.damaged.len());
        read.warnings
            .push(crate::model::Warning::new("history.inkIncomplete", detail));
    }
    Ok(read)
}

/// Thins the versions of a page (spec 13.3). `utc_offset_minutes` places day boundaries in local time.
///
/// Named versions, versions marked `keep`, the newest version, and `protected` revisions always stay. The
/// history of a page, with the ink and assets only history uses, stays within 50 MiB. The new list is written
/// before the dropped snapshots are deleted.
pub fn thin(
    files: &PageFiles<'_>,
    now: Timestamp,
    utc_offset_minutes: i32,
    keep: Retention,
    protected: &[RevisionId],
) -> Result<ThinReport, CoreError> {
    let limits = Limits::default();
    let mut list = list_versions(files, &limits)?;
    let plan = thinning::Plan {
        now,
        offset_minutes: utc_offset_minutes,
        max_age: match keep {
            Retention::Days30 => Some(thinning::MONTH),
            Retention::Year1 => Some(thinning::YEAR),
            Retention::Forever => None,
        },
        protected,
    };
    let mut dropped = plan.drop_by_age(&list.versions);
    let sizes = thinning::shared_sizes(files, &limits);
    dropped.extend(plan.drop_by_size(&list.versions, &dropped, &sizes));
    let dropped_set: BTreeSet<RevisionId> = dropped.iter().copied().collect();
    list.versions.retain(|v| !dropped_set.contains(&v.revision));
    if !dropped.is_empty() {
        write_list(files, &list)?;
        for revision in &dropped {
            match files
                .fs
                .remove_file(&NotebookLayout::version_path(files.dir, *revision))
            {
                Ok(()) => {}
                Err(err) if err.kind == FsErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
        }
    }
    Ok(ThinReport {
        kept: u32::try_from(list.versions.len()).unwrap_or(u32::MAX),
        dropped,
    })
}

#[cfg(test)]
mod tests;
