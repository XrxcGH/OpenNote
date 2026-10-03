//! Builders shared by the integration tests.
#![allow(dead_code)]

pub mod corpus;
pub mod spec;
pub mod world;

use opennote_core::{BlockId, Id, NotebookId, PageId, RevisionId, SectionId, Timestamp};
use opennote_search::{BlockKind, BlockText, PageDoc};

pub fn page_id(n: u64) -> PageId {
    PageId::from(Id::from_parts(1_000 + n, u128::from(n)))
}

pub fn block_id(page: u64, n: u64) -> BlockId {
    BlockId::from(Id::from_parts(2_000 + page, u128::from(n) + 1))
}

pub fn notebook_id(n: u64) -> NotebookId {
    NotebookId::from(Id::from_parts(3_000 + n, u128::from(n)))
}

pub fn section_id(n: u64) -> SectionId {
    SectionId::from(Id::from_parts(4_000 + n, u128::from(n)))
}

/// A page in notebook 1 and section 1, modified at `n` seconds after the epoch.
pub fn doc(n: u64, title: &str) -> PageDoc {
    PageDoc {
        page: page_id(n),
        notebook: notebook_id(1),
        section: section_id(1),
        revision: Some(RevisionId::from(Id::from_parts(5_000 + n, 1))),
        title: title.to_string(),
        tags: Vec::new(),
        created: Timestamp::from_unix_ms(n as i64 * 1000),
        modified: Timestamp::from_unix_ms(n as i64 * 1000),
        blocks: Vec::new(),
        locked: false,
        fingerprint: None,
    }
}

/// Chained edits for test documents.
pub trait DocExt: Sized {
    fn text(self, markdown: &str) -> Self;
    fn block(self, kind: BlockKind, text: &str) -> Self;
    fn tags(self, tags: &[&str]) -> Self;
    fn notebook(self, n: u64) -> Self;
    fn section(self, n: u64) -> Self;
    fn modified(self, ms: i64) -> Self;
    fn locked(self) -> Self;
}

impl DocExt for PageDoc {
    fn text(self, markdown: &str) -> Self {
        self.block(BlockKind::Text, markdown)
    }

    fn block(mut self, kind: BlockKind, text: &str) -> Self {
        let n = self.blocks.len() as u64;
        let page = self.page.id().time_ms() - 1_000;
        self.blocks.push(BlockText {
            id: block_id(page, n),
            kind,
            text: text.to_string(),
        });
        self
    }

    fn tags(mut self, tags: &[&str]) -> Self {
        self.tags = tags.iter().map(|t| t.to_string()).collect();
        self
    }

    fn notebook(mut self, n: u64) -> Self {
        self.notebook = notebook_id(n);
        self
    }

    fn section(mut self, n: u64) -> Self {
        self.section = section_id(n);
        self
    }

    fn modified(mut self, ms: i64) -> Self {
        self.modified = Timestamp::from_unix_ms(ms);
        self
    }

    fn locked(mut self) -> Self {
        self.locked = true;
        self
    }
}

/// The titles of search hits, in order.
pub fn titles(hits: &[opennote_search::SearchHit]) -> Vec<&str> {
    hits.iter().map(|hit| hit.title.as_str()).collect()
}
