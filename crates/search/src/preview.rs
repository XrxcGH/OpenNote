//! Link previews: the small card that shows a link's target when the pointer rests on the link.
//!
//! The card holds the first lines of a page, or the lines under a heading when the link names one, as plain
//! text. It reads the index, so a page in an encrypted section has no preview: the index never holds its text.
//! That makes the rule that previews never show locked text hold by construction.

use opennote_core::{BlockId, PageId};
use serde::Serialize;

use crate::doc::BlockKind;
use crate::error::Result;
use crate::graph::HeadingRef;
use crate::index::SearchIndex;
use crate::snippet::StoredBlock;
use crate::text::fold;

/// The most lines a preview shows.
pub const MAX_LINES: usize = 8;
/// The most characters a preview shows, not counting the ellipsis that marks a cut.
pub const MAX_CHARS: usize = 400;

/// What to show for a link.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// The heading the link names, if the page has it.
    pub heading: Option<String>,
    /// The block that holds that heading, or the first block of the preview, so opening the link can scroll to it.
    pub block: Option<BlockId>,
    /// The lines, joined by line breaks. It ends with `…` when more follows.
    pub text: String,
    /// The link names a heading that the page does not have, so the preview shows the start of the page.
    pub heading_missing: bool,
}

impl SearchIndex {
    /// The preview of a link to `page`, or to the heading of that page named `fragment`.
    ///
    /// Returns `None` when the index does not hold the page: it is gone, not indexed yet, or locked.
    pub fn link_preview(&self, page: PageId, fragment: Option<&str>) -> Result<Option<LinkPreview>> {
        let found: Option<(i64, String)> = {
            let mut statement = self.conn.prepare_cached("SELECT rid, title FROM pages WHERE id = ?1")?;
            let mut rows = statement.query_map([page.to_string()], |row| Ok((row.get(0)?, row.get(1)?)))?;
            rows.next().transpose()?
        };
        let Some((rid, title)) = found else {
            return Ok(None);
        };
        let blocks = self.stored_blocks(rid)?;
        let headings = self.headings(page)?;
        let wanted = fragment.map(fold).filter(|wanted| !wanted.is_empty());
        let target = wanted
            .as_ref()
            .and_then(|wanted| headings.iter().position(|heading| fold(&heading.text) == *wanted));
        let (heading, block, lines) = match target {
            Some(at) => {
                let (block, lines) = under_heading(&blocks, &headings, at);
                (Some(headings[at].text.clone()), Some(block), lines)
            }
            None => {
                let (block, lines) = start_of_page(&blocks);
                (None, block, lines)
            }
        };
        Ok(Some(LinkPreview {
            page,
            title,
            heading,
            block,
            text: cut(&lines),
            heading_missing: wanted.is_some() && target.is_none(),
        }))
    }
}

/// The lines of the first blocks, from the text blocks if there are any.
fn start_of_page(blocks: &[StoredBlock]) -> (Option<BlockId>, Vec<String>) {
    let text_only = blocks.iter().any(|block| block.kind == BlockKind::Text);
    let mut first = None;
    let mut lines = Vec::new();
    for block in blocks
        .iter()
        .filter(|block| !text_only || block.kind == BlockKind::Text)
    {
        for line in block.text.lines().map(str::trim).filter(|line| !line.is_empty()) {
            first.get_or_insert(block.id);
            lines.push(line.to_string());
            if lines.len() > MAX_LINES {
                return (first, lines);
            }
        }
    }
    (first, lines)
}

/// The lines after a heading, up to the next heading of the same level or a higher one.
fn under_heading(blocks: &[StoredBlock], headings: &[HeadingRef], target: usize) -> (BlockId, Vec<String>) {
    let level = headings[target].level;
    let mut next = 0;
    let mut lines = Vec::new();
    let mut inside = false;
    for block in blocks {
        for line in block.text.lines().map(str::trim).filter(|line| !line.is_empty()) {
            let is_heading = headings
                .get(next)
                .is_some_and(|heading| heading.block == block.id && heading.text == line);
            if is_heading {
                let this = next;
                next += 1;
                if this == target {
                    inside = true;
                    continue;
                }
                if inside && headings[this].level <= level {
                    return (headings[target].block, lines);
                }
            }
            if inside {
                lines.push(line.to_string());
                if lines.len() > MAX_LINES {
                    return (headings[target].block, lines);
                }
            }
        }
    }
    (headings[target].block, lines)
}

/// Joins the lines, and cuts them at the limits of lines or characters.
fn cut(lines: &[String]) -> String {
    let mut out = String::new();
    let mut more = lines.len() > MAX_LINES;
    for line in lines.iter().take(MAX_LINES) {
        if !out.is_empty() {
            out.push('\n');
        }
        let room = MAX_CHARS.saturating_sub(out.chars().count());
        if line.chars().count() > room {
            out.extend(line.chars().take(room));
            more = true;
            break;
        }
        out.push_str(line);
    }
    if more {
        out.push('\u{2026}');
    }
    out
}
