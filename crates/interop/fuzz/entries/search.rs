//! The search indexer's fuzz entry (A4-36), shared by the `search_index` fuzz target and
//! `tests/fuzz_entries.rs`.
//!
//! The input becomes a page's title, tags, and block text, which the index stores, and then the same bytes are
//! searched as plain text, as a boolean query, and as a pattern. Every step may fail, but none may panic.

use opennote_core::{BlockId, Id, NotebookId, PageId, SectionId, Timestamp};
use opennote_search::{BlockKind, BlockText, PageDoc, Query, SearchIndex};

/// Indexes a page made from `data` and searches it with `data`.
pub fn search_index(data: &[u8]) {
    let text = String::from_utf8_lossy(data).into_owned();
    let Ok(mut index) = SearchIndex::open_in_memory() else {
        return;
    };
    let id = |n: u8| Id::from_bytes([n; 16]);
    let kinds = [BlockKind::Text, BlockKind::Table, BlockKind::Image, BlockKind::Ink];
    let blocks = text
        .split('\n')
        .take(64)
        .zip(kinds.iter().cycle())
        .enumerate()
        .map(|(n, (line, kind))| BlockText {
            id: BlockId::from(Id::from_bytes([n as u8 + 10; 16])),
            kind: *kind,
            text: line.to_owned(),
        })
        .collect();
    let doc = PageDoc {
        page: PageId::from(id(1)),
        notebook: NotebookId::from(id(2)),
        section: SectionId::from(id(3)),
        revision: None,
        title: text.chars().take(200).collect(),
        tags: text.split_whitespace().take(8).map(str::to_owned).collect(),
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        blocks,
        locked: false,
        fingerprint: None,
    };
    let _ = index.upsert(&doc);
    let query: String = text.chars().take(512).collect();
    let _ = index.search(&Query::text(query.clone()));
    let _ = index.search(&Query::boolean(query.clone()));
    let _ = index.search(&Query::regex(query));
}
