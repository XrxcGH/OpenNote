//! Turns a [`PageDoc`] into the rows the index stores: plain text, headings, links, and normal-form tags.

use std::collections::HashSet;

use opennote_core::BlockId;

use crate::doc::{BlockKind, BlockText, PageDoc};
use crate::links::{self, Link};
use crate::plain::{self, Heading};
use crate::tags;
use crate::text::fold;

/// One block, reduced to what the index keeps.
pub struct PreparedBlock {
    /// The block's ID.
    pub id: BlockId,
    /// The block's type.
    pub kind: BlockKind,
    /// The plain text.
    pub text: String,
    /// The headings of a text block.
    pub headings: Vec<Heading>,
    /// The page links in the block's Markdown.
    pub links: Vec<Link>,
}

/// A page, reduced to what the index keeps.
pub struct Prepared {
    /// The folded title, which title links match.
    pub title_norm: String,
    /// The page tags and the inline tags of its text, in normal form.
    pub tags: Vec<String>,
    /// The blocks that have text.
    pub blocks: Vec<PreparedBlock>,
}

/// The most tags the index keeps for one page: its own tags first, then the inline tags in the order they appear.
pub const MAX_PAGE_TAGS: usize = 500;

/// Prepares a page. The page must not be locked.
pub fn prepare(doc: &PageDoc) -> Prepared {
    let mut tag_list = tags::normalize_all(doc.tags.iter().map(String::as_str));
    tag_list.truncate(MAX_PAGE_TAGS);
    let mut seen: HashSet<String> = tag_list.iter().cloned().collect();
    let mut blocks = Vec::with_capacity(doc.blocks.len());
    for block in &doc.blocks {
        let (prepared, inline_tags) = prepare_block(block);
        for tag in inline_tags {
            if tag_list.len() < MAX_PAGE_TAGS && seen.insert(tag.clone()) {
                tag_list.push(tag);
            }
        }
        blocks.push(prepared);
    }
    Prepared {
        title_norm: fold(&doc.title),
        tags: tag_list,
        blocks,
    }
}

/// Reduces one block. Text and tables are Markdown, and the other kinds are plain text already.
/// Also returns the inline tags the Markdown holds.
fn prepare_block(block: &BlockText) -> (PreparedBlock, Vec<String>) {
    let (text, headings, links, tags) = match block.kind {
        BlockKind::Text | BlockKind::Table => {
            let found = plain::extract(&block.text);
            (found.text, found.headings, links::parse(&block.text), found.tags)
        }
        _ => (block.text.clone(), Vec::new(), Vec::new(), Vec::new()),
    };
    let prepared = PreparedBlock {
        id: block.id,
        kind: block.kind,
        text,
        headings,
        links,
    };
    (prepared, tags)
}

impl Prepared {
    /// The text of every block of one kind, for the matching column of the full-text table.
    pub fn column(&self, kind: BlockKind) -> String {
        let parts: Vec<&str> = self
            .blocks
            .iter()
            .filter(|b| b.kind == kind)
            .map(|b| b.text.as_str())
            .collect();
        parts.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use opennote_core::{BlockId, Id, NotebookId, PageId, SectionId, Timestamp};

    use super::*;

    #[test]
    fn many_inline_tags_are_kept_in_order_up_to_the_limit_and_quickly() {
        let text: String = (0..80_000).map(|n| format!("#t{n} ")).collect();
        let doc = PageDoc {
            page: PageId::from(Id::from_parts(1_001, 1)),
            notebook: NotebookId::from(Id::from_parts(3_001, 1)),
            section: SectionId::from(Id::from_parts(4_001, 1)),
            revision: None,
            title: "Tags".into(),
            tags: vec!["Own".into(), "t1".into()],
            created: Timestamp::from_unix_ms(0),
            modified: Timestamp::from_unix_ms(0),
            blocks: vec![BlockText {
                id: BlockId::from(Id::from_parts(2_001, 1)),
                kind: BlockKind::Text,
                text,
            }],
            locked: false,
            fingerprint: None,
        };
        let started = std::time::Instant::now();
        let prepared = prepare(&doc);
        let took = started.elapsed();
        assert!(took < std::time::Duration::from_secs(10), "{took:?}");
        assert_eq!(prepared.tags.len(), MAX_PAGE_TAGS);
        assert_eq!(prepared.tags[..3], ["own", "t1", "t0"]);
    }
}
