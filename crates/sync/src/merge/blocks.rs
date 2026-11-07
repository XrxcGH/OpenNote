//! Block-level merge of a page that two devices changed, before the usual rules run (ADR 0089).

use std::collections::BTreeMap;

use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::id::RevisionId;
use opennote_core::merge::{merge_page, Mergers};
use opennote_core::model::{Page, Revision};
use opennote_core::Limits;

use super::{kind, maximal, read_any_page, split, Contents, Kind};
use crate::error::{Result, SyncError};
use crate::manifest::{join, Entry};

/// The newest revision both `a` and `b` started from, in the order the saves were made, not by the time in its ID.
///
/// IDs carry each device's own clock, so a later save made on a device whose clock runs behind can have a smaller
/// ID than the save it came from: the shared revision with the highest ID is then not the newest one. Each save
/// lists its parent first and then the parent's own list, so the first shared entry in either list is the newest
/// shared revision as that side saw it. `None` when the two sides disagree, so the page keeps the conflict copy.
fn newest_shared(a: &Revision, b: &Revision) -> Option<RevisionId> {
    let first = |x: &Revision, y: &Revision| x.ancestors.iter().find(|r| y.ancestors.contains(r)).copied();
    let from_a = first(a, b)?;
    (first(b, a)? == from_a).then_some(from_a)
}

/// The page saved as `.history/<revision>.json.gz` beside `path`, if both devices could see it.
fn snapshot_page(
    prefix: &str,
    revision: RevisionId,
    by_path: &BTreeMap<&str, Vec<Entry>>,
    contents: &dyn Contents,
) -> Result<Option<Page>> {
    let snapshot = format!("{prefix}.history/{revision}.json.gz");
    let Some(entry) = by_path.get(snapshot.as_str()).and_then(|e| e.iter().find(|e| e.live())) else {
        return Ok(None);
    };
    Ok(read_any_page(&contents.bytes(&entry.content)?))
}

/// The folder part of a page path with its slash, or nothing for a page at the top.
fn dir_prefix(path: &str) -> String {
    let (dir, _) = split(path);
    if dir.is_empty() {
        String::new()
    } else {
        format!("{dir}/")
    }
}

/// Two devices changed one page, and neither saw the other's save: the one page that block mergers make of the
/// two versions and the newest revision both started from (ADR 0089), or `None` to keep today's conflict copy.
/// The base is only that newest shared revision: an older one would turn a change one side undid into no change
/// and bring the old value back. Without its `.history` snapshot the result is `None`. With no merger registered
/// it is always `None`, so nothing changes.
///
/// The merged page comes with a `.history` snapshot of itself (path and entry), so the next merge of this page
/// has its base.
fn merge_page_blocks(
    path: &str,
    candidates: &[Entry],
    by_path: &BTreeMap<&str, Vec<Entry>>,
    contents: &dyn Contents,
    mergers: &Mergers,
) -> Result<Option<(Entry, String, Entry)>> {
    if mergers.is_empty() || kind(path) != Kind::Page {
        return Ok(None);
    }
    let top = maximal(candidates.to_vec());
    let [a, b] = &top[..] else { return Ok(None) };
    if a.deleted || b.deleted || a.content == b.content {
        return Ok(None);
    }
    let (Some(mine), Some(theirs)) = (
        read_any_page(&contents.bytes(&a.content)?),
        read_any_page(&contents.bytes(&b.content)?),
    ) else {
        return Ok(None);
    };
    let (ra, rb) = (&mine.revision, &theirs.revision);
    if ra.ancestors.contains(&rb.id) || rb.ancestors.contains(&ra.id) {
        return Ok(None);
    }
    let Some(newest) = newest_shared(ra, rb) else {
        return Ok(None);
    };
    let prefix = dir_prefix(path);
    let Some(base) = snapshot_page(&prefix, newest, by_path, contents)? else {
        return Ok(None);
    };
    let Some(merged) = merge_page(mergers, &base, &mine, &theirs) else {
        return Ok(None);
    };
    let bytes = write_page(&merged);
    if read_page(&bytes, &Limits::default()).is_err() {
        return Ok(None);
    }
    let vv = join(&a.vv, &b.vv);
    let snapshot = Entry {
        vv: vv.clone(),
        content: contents.make(gzip(&bytes)?),
        deleted: false,
    };
    let page = Entry {
        vv,
        content: contents.make(bytes),
        deleted: false,
    };
    Ok(Some((
        page,
        format!("{prefix}.history/{}.json.gz", merged.revision.id),
        snapshot,
    )))
}

/// Gzip of `bytes`, the same on every device.
fn gzip(bytes: &[u8]) -> Result<Vec<u8>> {
    use std::io::Write;
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(bytes).map_err(SyncError::local)?;
    gz.finish().map_err(SyncError::local)
}

/// Replaces each page that block mergers merge with the one merged version (ADR 0089). Returns the merged
/// revisions' `.history` snapshots that no input has yet.
pub(super) fn merge_blocks_first(
    by_path: &mut BTreeMap<&str, Vec<Entry>>,
    contents: &dyn Contents,
    mergers: &Mergers,
) -> Result<Vec<(String, Entry)>> {
    let mut snapshots = Vec::new();
    let mut block_merged = Vec::new();
    for (path, candidates) in by_path.iter() {
        if let Some((entry, at, snapshot)) = merge_page_blocks(path, candidates, by_path, contents, mergers)? {
            block_merged.push((*path, entry));
            if !by_path.contains_key(at.as_str()) {
                snapshots.push((at, snapshot));
            }
        }
    }
    for (path, entry) in block_merged {
        by_path.insert(path, vec![entry]);
    }
    Ok(snapshots)
}
