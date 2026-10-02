//! Readable copies (spec 11): `page.md`, `ink.svg`, `index.md`, and `README.md`. Owned by WP1.
//!
//! Nothing here is written for pages in encrypted sections (spec 5.7). The callers enforce that.
//!
//! `page.md`, `ink.svg`, and `index.md` carry a CRC-32 of the whole file, computed with its 8 digits written as
//! `00000000` (spec 11.1). That tells a copy OpenNote wrote apart from one a person edited (spec 11.2).

mod index;
mod page_md;
mod svg;

use crate::format::ReadableState;
use crate::id::RevisionId;

pub use index::render_index_md;
pub use page_md::{body_parts, render_page_md, BodyPart};
pub use svg::render_ink_svg;

/// The text before a checksum's 8 digits: in front matter, and in the comment of `ink.svg`. Titles are written
/// as JSON strings, with their quotes escaped, so a title can never hold either.
const CHECKSUM_MARKERS: [&str; 2] = ["checksum: \"crc32:", "checksum\": \"crc32:"];

/// Where the checksum's 8 digits start.
fn checksum_digits(text: &str) -> Option<usize> {
    CHECKSUM_MARKERS
        .iter()
        .filter_map(|marker| text.find(marker).map(|at| at.saturating_add(marker.len())))
        .min()
}

/// Fills in the checksum of a readable copy, written with `crc32:00000000`: the CRC-32 of the file with the
/// checksum's digits as zeros.
fn seal(text: String) -> Vec<u8> {
    let crc = crc32fast::hash(text.as_bytes());
    let mut bytes = text.into_bytes();
    if let Some(at) = std::str::from_utf8(&bytes).ok().and_then(checksum_digits) {
        if let Some(slot) = bytes.get_mut(at..at.saturating_add(8)) {
            slot.copy_from_slice(format!("{crc:08x}").as_bytes());
        }
    }
    bytes
}

/// A string as JSON writes it, for YAML front matter and the comment in `ink.svg`. C1 control characters and
/// line separators are escaped too, so the string is also valid YAML.
fn quoted(text: &str) -> String {
    let mut out = String::new();
    crate::format::json::write_string(&mut out, text);
    let mut safe = String::with_capacity(out.len());
    for c in out.chars() {
        if ('\u{7f}'..='\u{9f}').contains(&c) || matches!(c, '\u{2028}' | '\u{2029}' | '\u{feff}') {
            safe.push_str(&format!("\\u{:04x}", u32::from(c)));
        } else {
            safe.push(c);
        }
    }
    safe
}

/// Renders the notebook's `README.md` (spec 11.4).
pub fn render_readme(title: &str) -> Vec<u8> {
    let title = crate::format::markdown::one_line(title);
    let heading = if title.trim().is_empty() {
        "Untitled".to_owned()
    } else {
        crate::format::markdown::escape_text(&title, true)
    };
    format!(
        "# {heading}\n\n\
         This folder is a notebook made with OpenNote, an open-source note app. You can read all of it without \
         OpenNote.\n\n\
         - Open index.md for a list of every page.\n\
         - Each page folder has page.md, a readable copy of the page, and ink.svg, a picture of its handwriting. \
         Pictures and attachments are in its assets folder.\n\
         - page.json holds the full page. The format is described in .opennote/FORMAT.md.\n\n\
         {README_MARK}\n"
    )
    .into_bytes()
}

/// The last line of a `README.md` that OpenNote may rewrite (spec 11.4).
pub const README_MARK: &str = "<!-- Written by OpenNote. OpenNote only rewrites this file while this line is here. -->";

/// Tells a readable copy on disk apart: missing, damaged by a power cut, ours, or edited (spec 11.2).
///
/// No bytes at all count as damaged: the caller knows whether the file exists. A copy without a revision,
/// such as `index.md`, is ours at revision zero when its checksum matches.
pub fn classify_readable(bytes: &[u8]) -> ReadableState {
    if bytes.is_empty() || bytes.contains(&0) {
        return ReadableState::Damaged;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return ReadableState::Damaged;
    };
    let Some(digits_at) = checksum_digits(text) else {
        return ReadableState::Edited;
    };
    let digits = text.get(digits_at..digits_at.saturating_add(8)).unwrap_or_default();
    let Some(stored) = crate::format::page_json::parse_crc(digits) else {
        return ReadableState::Edited;
    };
    let mut zeroed = text.as_bytes().to_vec();
    if let Some(slot) = zeroed.get_mut(digits_at..digits_at.saturating_add(8)) {
        slot.copy_from_slice(b"00000000");
    }
    if crc32fast::hash(&zeroed) != stored {
        return ReadableState::Edited;
    }
    ReadableState::Ours {
        revision: revision_in(text).unwrap_or(RevisionId::ZERO),
    }
}

/// The revision a readable copy names: `revision: "<ID>"` in front matter, or `"revision": "<ID>"` in the
/// comment of `ink.svg`.
fn revision_in(text: &str) -> Option<RevisionId> {
    let markers = ["\n  revision: \"", "\"revision\": \""];
    let (at, marker) = markers.iter().find_map(|m| text.find(m).map(|at| (at, m)))?;
    let open = at.saturating_add(marker.len());
    let id = text.get(open..open.saturating_add(crate::id::Id::TEXT_LEN))?;
    RevisionId::parse(id).ok()
}

#[cfg(test)]
mod tests;
