//! `.history/versions.json` (spec 13.1). Owned by WP1.
//!
//! Versions are written in the order the file holds them, oldest first. Merging two copies sorts them by
//! save time, then revision.

use std::collections::BTreeMap;

use super::header;
use super::json::{self, Json, Obj};
use super::kinds;
use super::migrate::FileKind;
use super::page_json::{read_device, write_device};
use crate::error::FormatError;
use crate::id::RevisionId;
use crate::limits::Limits;
use crate::model::{VersionEntry, VersionsFile};

/// Reads `versions.json`.
pub fn read_versions(bytes: &[u8], limits: &Limits) -> Result<VersionsFile, FormatError> {
    let (mut fields, format) = header::read_file(bytes, limits, kinds::HISTORY, FileKind::Versions)?;
    let versions = fields
        .array("versions")?
        .into_iter()
        .enumerate()
        .map(|(index, item)| read_entry(item, index))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(VersionsFile {
        page: fields.id("page")?,
        versions,
        extra: fields.rest(),
        format,
    })
}

fn read_entry(value: serde_json::Value, index: usize) -> Result<VersionEntry, FormatError> {
    let context = format!("history.versions[{index}]");
    let mut fields = json::Fields::new(value, &context)?;
    let reason = fields
        .named("reason")?
        .ok_or_else(|| fields.error("reason", "missing"))?;
    Ok(VersionEntry {
        revision: fields.id("revision")?,
        saved_at: fields.time("savedAt")?,
        reason,
        name: fields.opt_str("name")?,
        keep: fields.bool_or("keep", false)?,
        device: read_device(fields.required("device")?, &format!("{context}.device"))?,
        bytes: fields.u64("bytes")?,
        segments: fields.ids("segments")?,
        assets: fields.ids("assets")?,
        extra: fields.rest(),
    })
}

/// Writes `versions.json` in canonical form.
pub fn write_versions(file: &VersionsFile) -> Vec<u8> {
    let mut obj = header::start(kinds::HISTORY);
    obj.put("page", Json::string(file.page.to_string()));
    let versions: Vec<Json<'_>> = file.versions.iter().map(write_entry).collect();
    obj.unless("versions", versions.is_empty(), || Json::Array(versions));
    json::write_document(&obj.finish(&file.extra))
}

fn write_entry(entry: &VersionEntry) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("revision", Json::string(entry.revision.to_string()))
        .put("savedAt", Json::string(entry.saved_at.to_rfc3339()))
        .put("reason", Json::str(entry.reason.as_str()))
        .opt("name", entry.name.as_deref().map(Json::str))
        .unless("keep", !entry.keep, || Json::Bool(true))
        .put("device", write_device(&entry.device))
        .put("bytes", Json::Int(entry.bytes.into()))
        .unless("segments", entry.segments.is_empty(), || Json::strings(&entry.segments))
        .unless("assets", entry.assets.is_empty(), || Json::strings(&entry.assets));
    obj.finish(&entry.extra)
}

/// Merges two copies of `versions.json` by revision (spec 13.1).
///
/// A version in both copies is kept once. Its fields come from the copy whose canonical bytes, without the
/// name and the `keep` mark, sort later. A name and a `keep` mark from either copy are never lost. The file's
/// own fields come from the copy whose bytes sort later. The result is sorted by save time, then revision, and
/// is the same in either order and when merged again.
pub fn merge_versions(ours: &VersionsFile, theirs: &VersionsFile) -> VersionsFile {
    let mut by_revision: BTreeMap<RevisionId, VersionEntry> = BTreeMap::new();
    for entry in ours.versions.iter().chain(&theirs.versions) {
        let merged = match by_revision.remove(&entry.revision) {
            Some(existing) => merge_entry(&existing, entry),
            None => entry.clone(),
        };
        by_revision.insert(entry.revision, merged);
    }
    let mut versions: Vec<VersionEntry> = by_revision.into_values().collect();
    versions.sort_by_key(|v| (v.saved_at, v.revision));
    let base = if file_bytes(theirs) > file_bytes(ours) {
        theirs
    } else {
        ours
    };
    VersionsFile {
        page: base.page,
        versions,
        extra: base.extra.clone(),
        format: base.format.clone(),
    }
}

fn merge_entry(a: &VersionEntry, b: &VersionEntry) -> VersionEntry {
    let base_bytes = |e: &VersionEntry| {
        let base = VersionEntry {
            name: None,
            keep: false,
            ..e.clone()
        };
        json::write_document(&write_entry(&base))
    };
    let winner = if base_bytes(b) > base_bytes(a) { b } else { a };
    VersionEntry {
        name: a.name.clone().max(b.name.clone()),
        keep: a.keep || b.keep,
        ..winner.clone()
    }
}

/// The file's own fields, whose bytes decide which copy's page ID and unknown keys stay.
fn file_bytes(file: &VersionsFile) -> Vec<u8> {
    write_versions(&VersionsFile {
        page: file.page,
        versions: Vec::new(),
        extra: file.extra.clone(),
        format: file.format.clone(),
    })
}
