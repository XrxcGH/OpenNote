//! Loading a page folder: `page.json`, its segments, and a check of its assets (plan 8.1, spec 9.6 and 14.5).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{LoadError, LoadedPage, PageStore};
use crate::error::{FormatError, FormatErrorKind, FsError, FsErrorKind};
use crate::format::DamagedRecord;
use crate::limits::Limits;
use crate::model::{Access, Ink, Page, ReadOnlyReason};
use crate::seams::Codec;
use crate::store::fs::{FileStamp, Fs};
use crate::store::layout::{NotebookLayout, ASSETS_DIR};

/// How often `page.json` is read again when it changes during the read.
const STABLE_READS: usize = 3;

/// What reading a page's segments found.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InkLoad {
    /// Records that failed their checks.
    pub damaged: Vec<DamagedRecord>,
    /// How many strokes the damage affects, counting every record of a segment that failed as a whole.
    pub damaged_strokes: u32,
    /// Segment files that are listed but can't be read now.
    pub missing: Vec<PathBuf>,
    /// Records, flags, or segment versions from a newer writer.
    pub newer: bool,
}

impl PageStore {
    pub(super) fn load_page(&self, dir: &Path) -> Result<LoadedPage, LoadError> {
        let config = &self.config;
        let path = NotebookLayout::page_json(dir);
        let (bytes, stamp) = read_stable(&*config.fs, &path, config.limits.page_json_bytes)?;
        let read = config
            .codec
            .read_page(&bytes, &config.limits)
            .map_err(|err| match err.kind {
                FormatErrorKind::NewerVersion(version) => LoadError::NewerFormat(version),
                _ => LoadError::Damaged(err),
            })?;
        let mut page = read.page;
        for warning in read.warnings {
            if !page.format.warnings.contains(&warning) {
                page.format.warnings.push(warning);
            }
        }
        let ink = load_ink(&*config.fs, &*config.codec, dir, &mut page, &config.limits);
        let mut missing = ink.missing.clone();
        missing.extend(missing_assets(&*config.fs, dir, &page));
        if !page.format.access.is_read_only() {
            if let Some(reason) = ink_access(&ink, !missing.is_empty()) {
                page.format.access = Access::ReadOnly(reason);
            }
        }
        Ok(LoadedPage {
            page,
            stamp,
            bytes: Arc::from(bytes),
            damaged: ink.damaged,
            missing,
        })
    }
}

/// The read-only reason that a page's ink and files call for, if any.
pub fn ink_access(ink: &InkLoad, files_missing: bool) -> Option<ReadOnlyReason> {
    if ink.newer {
        Some(ReadOnlyReason::UnknownInkData)
    } else if ink.damaged_strokes > 0 || !ink.damaged.is_empty() {
        Some(ReadOnlyReason::DamagedInk {
            strokes: ink.damaged_strokes.max(1),
        })
    } else if files_missing {
        Some(ReadOnlyReason::WaitingForSync)
    } else {
        None
    }
}

/// Reads a file and its fingerprint, reading again if the file changes meanwhile.
pub(crate) fn read_stable(fs: &dyn Fs, path: &Path, max: u64) -> Result<(Vec<u8>, FileStamp), LoadError> {
    let unavailable = |err: FsError| match err.kind {
        FsErrorKind::NotFound => LoadError::Missing,
        FsErrorKind::TooLarge => LoadError::Damaged(FormatError::new(FormatErrorKind::Limit, "page.json is too large")),
        _ => LoadError::Unavailable(err),
    };
    for _ in 0..STABLE_READS {
        let before = fs.metadata(path).map_err(unavailable)?;
        let bytes = fs.read(path, max).map_err(unavailable)?;
        let after = fs.metadata(path).map_err(unavailable)?;
        if before.stamp == after.stamp && after.stamp.len == bytes.len() as u64 {
            return Ok((bytes, after.stamp));
        }
    }
    Err(LoadError::Unavailable(FsError::new(FsErrorKind::Busy, path)))
}

/// Reads and replays the segments `page` lists, replacing its ink. Never fails: damaged and missing segments
/// are reported, and their strokes are left out.
pub fn load_ink(fs: &dyn Fs, codec: &dyn Codec, dir: &Path, page: &mut Page, limits: &Limits) -> InkLoad {
    let mut found = InkLoad::default();
    let segments = page.ink.segments().to_vec();
    let mut records = Vec::with_capacity(segments.len());
    for segment in &segments {
        let path = NotebookLayout::segment_path(dir, segment.id);
        let bytes = match fs.read(&path, limits.segment_bytes) {
            Ok(bytes) => bytes,
            Err(err) if err.kind == FsErrorKind::TooLarge => {
                found.whole_segment_damaged(segment.records, format!("segment {} is too large", segment.id));
                records.push(Vec::new());
                continue;
            }
            Err(_) => {
                found.missing.push(path);
                records.push(Vec::new());
                continue;
            }
        };
        match codec.decode_segment(&bytes, segment, page.id, limits) {
            Ok(decoded) => {
                found.newer |= decoded.unknown_records > 0;
                found.damaged_strokes = found.damaged_strokes.saturating_add(count(decoded.damaged.len()));
                found.damaged.extend(decoded.damaged);
                records.push(decoded.records);
            }
            Err(err) if matches!(err.kind, FormatErrorKind::NewerVersion(_)) => {
                found.newer = true;
                records.push(Vec::new());
            }
            Err(err) => {
                found.whole_segment_damaged(segment.records, format!("segment {}: {err}", segment.id));
                records.push(Vec::new());
            }
        }
    }
    let (ink, warnings) = Ink::replay(segments, records);
    page.ink = ink;
    page.format.warnings.extend(warnings);
    found
}

impl InkLoad {
    fn whole_segment_damaged(&mut self, records: u32, reason: String) {
        self.damaged_strokes = self.damaged_strokes.saturating_add(records.max(1));
        self.damaged.push(DamagedRecord {
            index: 0,
            offset: 0,
            stroke: None,
            reason,
        });
    }
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Assets in the table whose file is missing, has another size, or has a name that fails its check.
pub fn missing_assets(fs: &dyn Fs, dir: &Path, page: &Page) -> Vec<PathBuf> {
    if page.assets.is_empty() {
        return Vec::new();
    }
    let assets_dir = dir.join(ASSETS_DIR);
    let listing: HashMap<String, u64> = fs
        .read_dir(&assets_dir)
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !entry.is_dir)
        .map(|entry| (entry.name, entry.len))
        .collect();
    page.assets
        .values()
        .filter_map(|asset| match NotebookLayout::asset_path(dir, asset) {
            Ok(path) => (listing.get(&asset.file) != Some(&asset.bytes)).then_some(path),
            Err(_) => Some(assets_dir.join(asset.id.to_string())),
        })
        .collect()
}
