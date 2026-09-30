//! Fuzz entry points for the byte formats (plan 13.3). Owned by WP1.
//!
//! Whatever parses must validate and round-trip, and re-encoding a parsed segment must give the same bytes.
//! A panic here is a finding: the assertions are the properties each target checks.

mod pages;

use crate::error::FormatErrorKind;
use crate::format::history_json::{read_versions, write_versions};
use crate::format::json;
use crate::format::migrate::{upgrade, FileKind};
use crate::format::page_json::{read_page, write_page};
use crate::format::segment::{decode_records, decode_segment, encode_records, encode_segment};
use crate::format::segment_footer_crc;
use crate::format::trash_json::{read_trash_item, write_trash_item};
use crate::format::tree_json::{read_notebook, read_section, write_notebook, write_section};
use crate::id::{Id, PageId, SegmentId};
use crate::limits::Limits;
use crate::model::validate::validate_page;
use crate::model::SegmentRef;

/// Limits small enough that no input can use much memory.
fn limits() -> Limits {
    Limits {
        page_json_bytes: 4 << 20,
        segment_bytes: 16 << 20,
        ..Limits::default()
    }
}

/// Checks that bytes written from a value read back, and that writing again gives the same bytes.
fn stable<T>(bytes: &[u8], read: impl Fn(&[u8]) -> Option<T>, write: impl Fn(&T) -> Vec<u8>, name: &str) {
    let Some(value) = read(bytes) else {
        return;
    };
    let written = write(&value);
    let again = read(&written).unwrap_or_else(|| panic!("{name}: what this crate wrote doesn't read back"));
    assert_eq!(write(&again), written, "{name}: writing is not stable");
}

/// `page.json` reading.
pub fn page_json(data: &[u8]) {
    let limits = limits();
    if let Ok(read) = read_page(data, &limits) {
        if !read.page.format.access.is_read_only() {
            assert!(
                validate_page(&read.page, &limits).is_valid(),
                "a writable page validates"
            );
        }
    }
    stable(data, |b| read_page(b, &limits).ok().map(|r| r.page), write_page, "page");
}

/// `section.json` reading.
pub fn section_json(data: &[u8]) {
    stable(data, |b| read_section(b, &limits()).ok(), write_section, "section");
}

/// `notebook.json` reading.
pub fn notebook_json(data: &[u8]) {
    stable(data, |b| read_notebook(b, &limits()).ok(), write_notebook, "notebook");
}

/// `item.json` reading.
pub fn trash_item(data: &[u8]) {
    stable(
        data,
        |b| read_trash_item(b, &limits()).ok(),
        write_trash_item,
        "trash item",
    );
}

/// `versions.json` reading.
pub fn versions(data: &[u8]) {
    stable(data, |b| read_versions(b, &limits()).ok(), write_versions, "versions");
}

/// Segment decoding. The entry and page are taken from the file itself, so the checks against them pass and
/// the fuzzer reaches the records.
pub fn segment(data: &[u8]) {
    let id = |at: usize| {
        data.get(at..at.saturating_add(16))
            .and_then(|b| <[u8; 16]>::try_from(b).ok())
            .map_or(Id::ZERO, Id::from_bytes)
    };
    let records = data
        .get(12..16)
        .and_then(|b| <[u8; 4]>::try_from(b).ok())
        .map_or(0, u32::from_le_bytes);
    let expect = SegmentRef {
        id: SegmentId(id(16)),
        bytes: data.len() as u64,
        records,
        crc32: segment_footer_crc(data).unwrap_or(0),
        extra: Default::default(),
    };
    let Ok(decoded) = decode_segment(data, &expect, PageId(id(32)), &limits()) else {
        return;
    };
    if decoded.footer_ok && decoded.damaged.is_empty() && decoded.unknown_records == 0 {
        assert_eq!(
            encode_segment(&decoded.header, &decoded.records),
            data,
            "a clean segment re-encodes exactly"
        );
    }
}

/// Record decoding.
pub fn records(data: &[u8]) {
    match decode_records(data, &limits()) {
        Ok(records) => assert_eq!(encode_records(&records), data, "records re-encode exactly"),
        Err(error) => assert_ne!(
            error.kind,
            FormatErrorKind::Syntax,
            "records fail as damage, not syntax"
        ),
    }
}

/// Rendering an arbitrary page, and classifying arbitrary bytes as a readable copy.
pub fn readable(data: &[u8]) {
    pages::readable(data);
}

/// Migrating arbitrary JSON with any `formatVersion`.
pub fn migrate(data: &[u8]) {
    let mut value = match json::parse(data, &limits()) {
        Ok(value) => value,
        Err(_) => {
            let version = data
                .get(..4)
                .map_or(0, |b| b.iter().fold(0u32, |v, &x| v.wrapping_mul(256) | u32::from(x)));
            serde_json::json!({ "formatVersion": version })
        }
    };
    for kind in FileKind::ALL {
        let mut copy = value.clone();
        if let Ok(report) = upgrade(kind, &mut copy) {
            assert!(report.to >= report.from, "migrations only go forward");
        }
    }
    let _ = upgrade(FileKind::Page, &mut value);
}
