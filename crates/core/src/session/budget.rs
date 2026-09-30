//! Memory budgets: closed pages, undo, and caches (plan 10.2). Owned by WP5.
//!
//! The core keeps recently closed clean pages for instant reopening, up to 24 MiB, dropping the least
//! recently used first. Undo stacks of all pages share one budget of 24 MiB, charged by the undo code for
//! what only undo keeps alive; over budget, the oldest entries of the least recently used page go first.
//! [`page_bytes`] estimates what an open page takes, for the memory report.

use std::collections::VecDeque;
use std::mem::size_of;

use crate::id::PageId;
use crate::model::{Block, BlockData, Page, Stroke};
use crate::store::layout::NotebookKey;
use crate::store::page_store::LoadedPage;

/// Bookkeeping per stroke besides its point data: the record, the `Arc`, and the maps that index it.
const STROKE_OVERHEAD: usize = size_of::<Stroke>() + 64;

/// Bookkeeping per block besides its text.
const BLOCK_OVERHEAD: usize = size_of::<Block>() + 96;

/// An estimate of the memory a page takes, with the `page.json` bytes kept for the envelope.
pub fn page_bytes(page: &Page, json_bytes: usize) -> usize {
    let strokes: usize = page
        .ink
        .strokes()
        .map(|s| s.points.len().saturating_add(STROKE_OVERHEAD))
        .fold(0, usize::saturating_add);
    let blocks: usize = page
        .blocks
        .iter()
        .map(|b| {
            let text = match &b.data {
                BlockData::Text(text) => text.markdown.len(),
                _ => 0,
            };
            text.saturating_add(BLOCK_OVERHEAD)
        })
        .fold(0, usize::saturating_add);
    strokes.saturating_add(blocks).saturating_add(json_bytes)
}

/// A clean page kept after its last client closed it.
#[derive(Clone, Debug)]
pub struct ClosedPage {
    /// The page as loaded or last saved.
    pub loaded: LoadedPage,
    /// Its estimated size.
    pub bytes: usize,
}

/// Recently closed clean pages, least recently used first out.
#[derive(Debug)]
pub struct ClosedPages {
    cap: usize,
    bytes: usize,
    pages: VecDeque<((NotebookKey, PageId), ClosedPage)>,
}

impl ClosedPages {
    /// An empty cache that holds at most `cap` bytes.
    pub fn new(cap: usize) -> ClosedPages {
        ClosedPages {
            cap,
            bytes: 0,
            pages: VecDeque::new(),
        }
    }

    /// Keeps a closed page. A page larger than the whole cap isn't kept.
    pub fn put(&mut self, key: (NotebookKey, PageId), page: ClosedPage) {
        self.take(&key);
        if page.bytes > self.cap {
            return;
        }
        self.bytes = self.bytes.saturating_add(page.bytes);
        self.pages.push_back((key, page));
        while self.bytes > self.cap {
            let Some((_, dropped)) = self.pages.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(dropped.bytes);
        }
    }

    /// Takes a closed page back, for reopening.
    pub fn take(&mut self, key: &(NotebookKey, PageId)) -> Option<ClosedPage> {
        let index = self.pages.iter().position(|(k, _)| k == key)?;
        let (_, page) = self.pages.remove(index)?;
        self.bytes = self.bytes.saturating_sub(page.bytes);
        Some(page)
    }

    /// Drops every page of a notebook, such as when it closes.
    pub fn forget_notebook(&mut self, key: &NotebookKey) {
        let before = self.pages.len();
        self.pages.retain(|((k, _), _)| k != key);
        if self.pages.len() != before {
            self.bytes = self.pages.iter().map(|(_, p)| p.bytes).fold(0, usize::saturating_add);
        }
    }

    /// The bytes held.
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    /// How many pages are held.
    pub fn len(&self) -> usize {
        self.pages.len()
    }

    /// Whether no page is held.
    pub fn is_empty(&self) -> bool {
        self.pages.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::id::Id;
    use crate::store::fs::FileStamp;
    use crate::testing::sample;

    fn closed(bytes: usize) -> ClosedPage {
        ClosedPage {
            loaded: LoadedPage {
                page: sample::sample_page(),
                stamp: FileStamp {
                    len: 0,
                    modified: 0,
                    file_id: 0,
                },
                bytes: Arc::from(Vec::new()),
                damaged: Vec::new(),
                missing: Vec::new(),
            },
            bytes,
        }
    }

    fn key(n: u64) -> (NotebookKey, PageId) {
        (NotebookKey("nb".into()), PageId(Id::from_parts(n, 0)))
    }

    #[test]
    fn the_least_recently_closed_page_goes_first() {
        let mut cache = ClosedPages::new(100);
        cache.put(key(1), closed(40));
        cache.put(key(2), closed(40));
        cache.put(key(3), closed(40));
        assert_eq!((cache.len(), cache.bytes()), (2, 80));
        assert!(cache.take(&key(1)).is_none());
        assert!(cache.take(&key(2)).is_some());
        cache.put(key(4), closed(500));
        assert_eq!(cache.len(), 1);
        cache.forget_notebook(&NotebookKey("nb".into()));
        assert!(cache.is_empty());
        assert_eq!(cache.bytes(), 0);
    }

    #[test]
    fn page_size_counts_points_and_text() {
        let page = sample::sample_page();
        let points: usize = page.ink.strokes().map(|s| s.points.len()).sum();
        assert!(page_bytes(&page, 1_000) > points + 1_000);
    }
}
