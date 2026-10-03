//! Journal files on disk: finding a page's or notebook's generations, and creating new ones.

use std::path::{Path, PathBuf};

use crate::error::{FsError, FsErrorKind};
use crate::fail_point;
use crate::id::PageId;
use crate::limits::Limits;
use crate::model::asset::hex;
use crate::seams::Codec;
use crate::session::journal_thread::JournalMeta;
use crate::store::fs::{AppendFile, Fs};
use crate::store::journal::format::{decode_header, encode_header, next_frame, Frame, HeaderMeta};
use crate::store::journal::reader::{read_generation, JournalGen, JournalHeader};
use crate::store::layout::{journal_file_name, parse_journal_file_name};
use crate::time::Timestamp;

/// The existing generations of one page, or of a tree journal when `page` is `None`, oldest first.
pub fn generations(fs: &dyn Fs, dir: &Path, page: Option<PageId>) -> Result<Vec<(u64, PathBuf)>, FsError> {
    let entries = match fs.read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind == FsErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut found: Vec<(u64, PathBuf)> = entries
        .into_iter()
        .filter(|e| !e.is_dir)
        .filter_map(|e| {
            let (owner, generation) = parse_journal_file_name(&e.name)?;
            (owner == page).then(|| (generation, dir.join(&e.name)))
        })
        .collect();
    found.sort_by_key(|(generation, _)| *generation);
    Ok(found)
}

/// The highest sequence number in a generation file: its anchor, or its last intact record. A file whose
/// header can't be read counts as zero, and its generation number still counts.
pub fn highest_seq(fs: &dyn Fs, path: &Path, limits: &Limits) -> Result<u64, FsError> {
    let bytes = fs.read(path, u64::MAX)?;
    let Ok(decoded) = decode_header(&bytes, limits.gunzip_bytes) else {
        return Ok(0);
    };
    let mut highest = decoded.header.anchor;
    let mut at = decoded.len;
    while let Frame::Record(raw) = next_frame(&bytes, at, limits.journal_payload) {
        highest = highest.max(raw.seq);
        at = at.saturating_add(raw.bytes.len());
    }
    Ok(highest)
}

/// Reads a whole tree generation, for its intents.
pub fn read_tree(fs: &dyn Fs, path: &Path, codec: &dyn Codec, limits: &Limits) -> Option<JournalGen> {
    let bytes = fs.read(path, u64::MAX).ok()?;
    read_generation(&bytes, codec, limits).ok()
}

/// Creates a folder and its parent if they are missing.
pub fn ensure_dirs(fs: &dyn Fs, dir: &Path) -> Result<(), FsError> {
    if let Some(parent) = dir.parent() {
        ensure_one(fs, parent)?;
    }
    ensure_one(fs, dir)
}

fn ensure_one(fs: &dyn Fs, dir: &Path) -> Result<(), FsError> {
    match fs.metadata(dir) {
        Ok(_) => Ok(()),
        Err(err) if err.kind == FsErrorKind::NotFound => match fs.create_dir_durable(dir) {
            Ok(_) => Ok(()),
            Err(err) if err.kind == FsErrorKind::AlreadyExists => Ok(()),
            Err(err) => Err(err),
        },
        Err(err) => Err(err),
    }
}

/// What a new generation holds.
pub struct NewGeneration<'a> {
    /// The folder of the notebook key.
    pub dir: &'a Path,
    /// The page, or `None` for a tree journal.
    pub page: Option<PageId>,
    /// The generation number.
    pub generation: u64,
    /// Every record in it has a larger sequence number.
    pub anchor: u64,
    /// The base revision and the exact bytes of its `page.json`, gzipped. Empty for a tree journal.
    pub base: (crate::id::RevisionId, &'a [u8]),
    /// The header's metadata.
    pub meta: &'a JournalMeta,
    /// When it is created.
    pub created: Timestamp,
    /// Records to copy into it, already framed.
    pub records: &'a [&'a [u8]],
}

/// Creates a generation durably with its records, and opens it for appending. The open file holds the
/// generation's lock (spec 20.3).
pub fn create_generation(fs: &dyn Fs, new: &NewGeneration<'_>) -> Result<(PathBuf, Box<dyn AppendFile>), FsError> {
    ensure_dirs(fs, new.dir)?;
    let meta = HeaderMeta {
        app: new.meta.app.clone(),
        boot: new.meta.boot.clone(),
        device: new.meta.device,
        notebook_identity: hex(&new.meta.identity.0),
        notebook_path: new.meta.notebook_path.to_string_lossy().into_owned(),
        section: new.page.and(new.meta.section),
    };
    let header = JournalHeader {
        version: crate::JOURNAL_VERSION,
        notebook: new.meta.notebook,
        page: new.page.unwrap_or_default(),
        base: new.base.0,
        generation: new.generation,
        anchor: new.anchor,
        created: new.created,
        page_format: new.meta.page_format,
        meta: meta.to_value(),
    };
    let mut bytes = encode_header(&header, new.base.1);
    for record in new.records {
        bytes.extend_from_slice(record);
    }
    let path = new.dir.join(journal_file_name(new.page, new.generation));
    fs.create_durable(&path, &bytes)?;
    fail_point!("journal.rotate.created");
    let file = fs.open_append(&path, false)?;
    Ok((path, file))
}

/// Appends a record. With fail points compiled in, the record goes in two halves with the
/// `journal.half_record` point between them, so the kill harness can leave a torn record.
pub fn write_record(file: &mut dyn AppendFile, bytes: &[u8]) -> Result<(), FsError> {
    #[cfg(feature = "failpoints")]
    {
        let (first, second) = bytes.split_at(bytes.len() / 2);
        file.append(first)?;
        fail_point!("journal.half_record");
        file.append(second)
    }
    #[cfg(not(feature = "failpoints"))]
    file.append(bytes)
}
