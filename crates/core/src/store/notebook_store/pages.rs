//! Reading and writing page folders without a session or a journal: the writer without a journal of spec
//! 17.7, used to create pages, duplicate them, and for importers and tools.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{CoreError, FormatError, FormatErrorKind, FsErrorKind};
use crate::format::{segment_footer_crc, DamagedRecord, SegmentHeader};
use crate::id::{PageId, RevisionId, SegmentId};
use crate::limits::Limits;
use crate::model::{
    Access, DeviceRef, FormatInfo, Ink, InkRecord, JsonMap, Page, ReadOnlyReason, Revision, SegmentRef,
};
use crate::seams::Codec;
use crate::store::fs::{Durability, FileStamp, Fs};
use crate::store::layout::NotebookLayout;
use crate::store::lock::ensure_dir_all;
use crate::store::page_store::{LoadError, LoadedPage};
use crate::store::PageFiles;
use crate::time::Clock;

/// Revisions kept in a revision's `ancestors` (spec 5.3).
const MAX_ANCESTORS: usize = 32;

/// What a write of a page folder did.
#[derive(Clone, Debug)]
pub struct WrittenPage {
    /// The revision written.
    pub revision: Revision,
    /// The exact bytes of `page.json`.
    pub bytes: Arc<[u8]>,
    /// The fingerprint of `page.json`.
    pub stamp: FileStamp,
    /// Whether the replace of `page.json` is confirmed on disk.
    pub durability: Durability,
    /// The segment list written.
    pub segments: Vec<SegmentRef>,
}

/// Writes a page folder as `revision`: a new segment from the pending ink records, a check that every asset
/// is there, and `page.json`, which is read back and compared before it replaces the old one (steps S2 to S5
/// and S8 of spec 17.7). The folder must exist.
pub fn write_page_files(
    files: &PageFiles<'_>,
    clock: &dyn Clock,
    page: &Page,
    revision: Revision,
) -> Result<WrittenPage, CoreError> {
    let pending = page.ink.pending();
    let mut segments = page.ink.segments().to_vec();
    if !pending.is_empty() {
        segments.push(write_segment(files, clock, page.id, pending)?);
    }
    check_assets(files, page)?;
    let mut out = page.clone();
    out.revision = revision;
    out.ink.commit(pending.len(), segments.clone(), page.ink.dead_bytes());
    let bytes = files.codec.write_page(&out);
    check_read_back(files.codec, &bytes, &out)?;
    let committed = files
        .fs
        .replace_durable(&NotebookLayout::page_json(files.dir), &bytes)?;
    Ok(WrittenPage {
        revision: out.revision,
        bytes: bytes.into(),
        stamp: committed.stamp,
        durability: committed.durability,
        segments,
    })
}

/// Writes records as a new segment file with `create_durable` (steps S2 and S3).
fn write_segment(
    files: &PageFiles<'_>,
    clock: &dyn Clock,
    page: PageId,
    records: &[InkRecord],
) -> Result<SegmentRef, CoreError> {
    let id = SegmentId::generate(clock);
    let header = SegmentHeader {
        id,
        page,
        created: clock.now(),
    };
    let bytes = files.codec.encode_segment(&header, records);
    let path = NotebookLayout::segment_path(files.dir, id);
    if let Some(dir) = path.parent() {
        ensure_dir_all(files.fs, dir)?;
    }
    files.fs.create_durable(&path, &bytes)?;
    let crc32 = segment_footer_crc(&bytes)
        .ok_or_else(|| FormatError::new(FormatErrorKind::Validation, "the new segment has no footer"))?;
    Ok(SegmentRef {
        id,
        bytes: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
        records: u32::try_from(records.len()).unwrap_or(u32::MAX),
        crc32,
        extra: JsonMap::new(),
    })
}

/// Checks that every asset the page refers to exists with its expected size (step S4). A recording that
/// is still being written has no final size yet, so it is left out.
fn check_assets(files: &PageFiles<'_>, page: &Page) -> Result<(), CoreError> {
    for asset in page.assets.values().filter(|asset| !asset.is_recording()) {
        let path = NotebookLayout::asset_path(files.dir, asset)?;
        let meta = files.fs.metadata(&path).map_err(|e| match e.kind {
            FsErrorKind::NotFound => CoreError::NotFound(format!("asset {}", asset.id)),
            _ => CoreError::Fs(e),
        })?;
        if meta.stamp.len != asset.bytes {
            let detail = format!("asset {} has {} bytes, not {}", asset.id, meta.stamp.len, asset.bytes);
            return Err(FormatError::new(FormatErrorKind::Validation, detail).into());
        }
    }
    Ok(())
}

/// Reads the written bytes back and compares them with the page (step S5). Ink is compared by its segment
/// list, because the reader returns the list without strokes.
fn check_read_back(codec: &dyn Codec, bytes: &[u8], expect: &Page) -> Result<(), CoreError> {
    let read = codec.read_page(bytes, &Limits::default())?;
    let normalize = |page: &Page| {
        let mut page = page.clone();
        let segments = page.ink.segments().to_vec();
        let empty = vec![Vec::new(); segments.len()];
        page.ink = Ink::replay(segments, empty).0;
        page.format = FormatInfo::default();
        page
    };
    if normalize(&read.page) != normalize(expect) {
        let detail = format!("page {} didn't read back as written", expect.id);
        return Err(FormatError::new(FormatErrorKind::Validation, detail).into());
    }
    Ok(())
}

/// The next revision of a page: a new ID whose parent is the page's revision (spec 5.3).
pub fn next_revision(page: &Page, clock: &dyn Clock, device: &DeviceRef, writer: &str) -> Revision {
    let old = &page.revision;
    let parents = if old.id.0.is_zero() { Vec::new() } else { vec![old.id] };
    let mut ancestors = parents.clone();
    ancestors.extend(old.ancestors.iter().filter(|a| **a != old.id).copied());
    ancestors.truncate(MAX_ANCESTORS);
    Revision {
        id: RevisionId::generate(clock),
        parents,
        ancestors,
        saved_at: clock.now(),
        device: device.clone(),
        writer: writer.to_owned(),
        extra: JsonMap::new(),
    }
}

/// Reads a page folder: `page.json`, every segment, and the live ink. Reports damaged records and missing
/// files instead of failing, and sets the page read-only when it has either (spec 9.6 and 14.5).
pub fn read_page_files(fs: &dyn Fs, codec: &dyn Codec, dir: &Path, limits: &Limits) -> Result<LoadedPage, LoadError> {
    let path = NotebookLayout::page_json(dir);
    let meta = fs.metadata(&path).map_err(load_error)?;
    let bytes: Arc<[u8]> = fs.read(&path, limits.page_json_bytes).map_err(load_error)?.into();
    let read = codec.read_page(&bytes, limits).map_err(|e| match e.kind {
        FormatErrorKind::NewerVersion(v) => LoadError::NewerFormat(v),
        _ => LoadError::Damaged(e),
    })?;
    let mut page = read.page;
    page.format.warnings.extend(read.warnings);
    let (damaged, missing) = load_ink(&PageFiles { fs, codec, dir }, &mut page, limits).map_err(LoadError::Damaged)?;
    set_access(&mut page, &damaged, &missing, meta.read_only);
    Ok(LoadedPage {
        page,
        stamp: meta.stamp,
        bytes,
        damaged,
        missing,
    })
}

/// Reads the segments a page lists from its folder and replays them into its live ink. Returns the damaged
/// records, and the segments and assets that are missing. Fails only for an asset name that breaks the rules.
pub fn load_ink(
    files: &PageFiles<'_>,
    page: &mut Page,
    limits: &Limits,
) -> Result<(Vec<DamagedRecord>, Vec<PathBuf>), FormatError> {
    let segments = page.ink.segments().to_vec();
    let mut reader = SegmentReader {
        fs: files.fs,
        codec: files.codec,
        dir: files.dir,
        page: page.id,
        limits,
        damaged: Vec::new(),
        missing: Vec::new(),
    };
    let records = segments.iter().map(|s| reader.records(s)).collect();
    let (ink, warnings) = Ink::replay(segments, records);
    page.ink = ink;
    page.format.warnings.extend(warnings);
    for asset in page.assets.values() {
        let asset_path = NotebookLayout::asset_path(files.dir, asset)?;
        if files.fs.metadata(&asset_path).is_err() {
            reader.missing.push(asset_path);
        }
    }
    Ok((reader.damaged, reader.missing))
}

/// Reads the segments of one page, collecting what is damaged or missing.
struct SegmentReader<'a> {
    fs: &'a dyn Fs,
    codec: &'a dyn Codec,
    dir: &'a Path,
    page: PageId,
    limits: &'a Limits,
    damaged: Vec<DamagedRecord>,
    missing: Vec<PathBuf>,
}

impl SegmentReader<'_> {
    /// Reads one segment's records. A missing file is recorded as missing, and one that can't be read as a
    /// damaged record covering the whole segment.
    fn records(&mut self, segment: &SegmentRef) -> Vec<InkRecord> {
        let path = NotebookLayout::segment_path(self.dir, segment.id);
        let bytes = match self.fs.read(&path, self.limits.segment_bytes) {
            Ok(bytes) => bytes,
            Err(_) => {
                self.missing.push(path);
                return Vec::new();
            }
        };
        match self.codec.decode_segment(&bytes, segment, self.page, self.limits) {
            Ok(decoded) => {
                self.damaged.extend(decoded.damaged);
                decoded.records
            }
            Err(e) => {
                self.damaged.push(DamagedRecord {
                    index: 0,
                    offset: e.offset.unwrap_or(0),
                    stroke: None,
                    reason: format!("segment {}: {e}", segment.id),
                });
                Vec::new()
            }
        }
    }
}

fn set_access(page: &mut Page, damaged: &[DamagedRecord], missing: &[PathBuf], read_only_file: bool) {
    if page.format.access.is_read_only() {
        return;
    }
    let reason = if !damaged.is_empty() {
        let strokes = u32::try_from(damaged.len()).unwrap_or(u32::MAX);
        Some(ReadOnlyReason::DamagedInk { strokes })
    } else if !missing.is_empty() {
        Some(ReadOnlyReason::WaitingForSync)
    } else if read_only_file {
        Some(ReadOnlyReason::ReadOnlyFile)
    } else {
        None
    };
    if let Some(reason) = reason {
        page.format.access = Access::ReadOnly(reason);
    }
}

fn load_error(e: crate::error::FsError) -> LoadError {
    match e.kind {
        FsErrorKind::NotFound => LoadError::Missing,
        _ => LoadError::Unavailable(e),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use std::sync::Arc;

    use super::super::template::{merge_objects, template_view};
    use super::*;
    use crate::id::Id;
    use crate::testing::{sample, MemFs, RegistryCodec};

    #[test]
    fn a_page_with_ink_round_trips_through_its_folder() {
        let fs = MemFs::new();
        let codec = RegistryCodec::new();
        let clock = sample::test_clock();
        let dir = Path::new("/nb/s/p");
        fs.mkdir_all(dir);
        let mut page = sample::sample_page();
        page.assets.clear();
        for stroke in page.ink.strokes().cloned().collect::<Vec<_>>() {
            page.ink.push_pending(InkRecord::Stroke(stroke));
        }
        let strokes = page.ink.len();
        let files = PageFiles {
            fs: &fs,
            codec: &codec,
            dir,
        };
        let revision = next_revision(&page, &clock, &sample::sample_device(), "test");
        let written = write_page_files(&files, &clock, &page, revision.clone()).unwrap();
        assert_eq!(written.revision, revision);
        assert_eq!(written.segments.len(), page.ink.segments().len() + 1);
        let loaded = read_page_files(&fs, &codec, dir, &Limits::default()).unwrap();
        assert_eq!(loaded.page.ink.len(), strokes);
        assert_eq!(loaded.page.revision.parents, vec![page.revision.id]);
        assert!(loaded.missing.is_empty() || !page.ink.segments().is_empty());
    }

    #[test]
    fn a_missing_page_json_is_missing() {
        let fs = MemFs::new();
        let codec = RegistryCodec::new();
        let result = read_page_files(&fs, &codec, Path::new("/none"), &Limits::default());
        assert_eq!(result.unwrap_err(), LoadError::Missing);
    }

    #[test]
    fn missing_segments_make_the_page_wait_for_sync() {
        let fs = MemFs::new();
        let codec = RegistryCodec::new();
        let clock = sample::test_clock();
        let dir = Path::new("/nb/s/p");
        fs.mkdir_all(dir);
        let mut page = Page::new(
            PageId(Id::from_parts(1, 1)),
            clock.now(),
            sample::sample_page().revision,
        );
        let segment = SegmentRef {
            id: SegmentId(Id::from_parts(2, 2)),
            bytes: 10,
            records: 1,
            crc32: 0,
            extra: JsonMap::new(),
        };
        page.ink = Ink::replay(vec![segment], vec![Vec::new()]).0;
        fs.put(&NotebookLayout::page_json(dir), &codec.write_page(&page));
        let loaded = read_page_files(&fs, &codec, dir, &Limits::default()).unwrap();
        assert_eq!(loaded.missing.len(), 1);
        assert_eq!(
            loaded.page.format.access,
            Access::ReadOnly(ReadOnlyReason::WaitingForSync)
        );
    }

    #[test]
    fn revisions_chain_their_ancestors() {
        let clock = sample::test_clock();
        let page = sample::sample_page();
        let device = sample::sample_device();
        let first = next_revision(&page, &clock, &device, "w");
        assert_eq!(first.parents, vec![page.revision.id]);
        let mut next = page.clone();
        next.revision = first.clone();
        let second = next_revision(&next, &clock, &device, "w");
        assert_eq!(second.ancestors.first(), Some(&first.id));
        assert!(second.ancestors.contains(&page.revision.id));
        let codec: Arc<dyn Codec> = Arc::new(RegistryCodec::new());
        assert!(template_view(codec.as_ref(), &page, [None, None]).is_none());
    }

    #[test]
    fn merges_objects_field_by_field() {
        let mut into = serde_json::json!({"a": {"b": 1, "c": 2}, "d": 3});
        merge_objects(&mut into, &serde_json::json!({"a": {"b": 5}, "e": 6}));
        assert_eq!(into, serde_json::json!({"a": {"b": 5, "c": 2}, "d": 3, "e": 6}));
    }
}
