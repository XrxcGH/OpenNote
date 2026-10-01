//! The oracle: a full page after every step, to compare recovered pages against (plan 13.2). Owned by WP3.
//!
//! Pages are compared by content: everything a save writes and a load reads back. The comparison leaves out
//! the ink's bookkeeping, such as which segments hold the strokes and which records are pending. It also leaves
//! out the revision and what the reader found. A save changes those without changing the page.

use crate::error::ApplyError;
use crate::model::Page;
use crate::ops::Txn;

/// Keeps the page as it was after each transaction.
pub struct Oracle {
    /// The page after each step, starting with the start page.
    pub steps: Vec<Page>,
}

impl Oracle {
    /// An oracle at the start page.
    pub fn new(start: Page) -> Oracle {
        Oracle { steps: vec![start] }
    }

    /// Applies a transaction and keeps the result. A transaction that fails leaves the oracle as it was.
    pub fn push(&mut self, txn: &Txn) -> Result<(), ApplyError> {
        let mut next = self.latest().clone();
        next.apply(txn)?;
        self.steps.push(next);
        Ok(())
    }

    /// The page after the last step.
    pub fn latest(&self) -> &Page {
        self.steps.last().expect("the oracle always holds its start page")
    }

    /// How many transactions were pushed.
    pub fn len(&self) -> usize {
        self.steps.len() - 1
    }

    /// Whether no transaction was pushed.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The page after `step` transactions. Panics when `step` is past the last one.
    pub fn state_after(&self, step: usize) -> &Page {
        &self.steps[step]
    }

    /// The first step from `from` on whose page has the same content as `page`.
    pub fn matches_some_step(&self, page: &Page, from: usize) -> Option<usize> {
        self.find(page, from, same_content)
    }

    /// Like [`Oracle::matches_some_step`], but ignoring every timestamp, for a page rebuilt by another process
    /// whose clock gave its transactions other times.
    pub fn matches_some_step_ignoring_times(&self, page: &Page, from: usize) -> Option<usize> {
        self.find(page, from, same_content_ignoring_times)
    }

    fn find(&self, page: &Page, from: usize, same: fn(&Page, &Page) -> bool) -> Option<usize> {
        let start = from.min(self.steps.len());
        self.steps[start..]
            .iter()
            .position(|step| same(step, page))
            .map(|i| i + start)
    }
}

/// The page's view with only the reading-order IDs that name blocks. Others are ignored, and writers drop them.
fn view_without_dead_ids(page: &Page) -> crate::model::PageView {
    let mut view = page.view.clone();
    view.reading_order.retain(|id| page.blocks.contains(*id));
    view
}

/// Whether two pages have the same content: equal in everything but the ink's segments, pending records, and
/// dead bytes, the revision, and the format information. The reading order is compared without IDs that name
/// no block.
pub fn same_content(a: &Page, b: &Page) -> bool {
    a.id == b.id
        && a.title == b.title
        && a.created == b.created
        && a.modified == b.modified
        && a.tags == b.tags
        && view_without_dead_ids(a) == view_without_dead_ids(b)
        && a.blocks == b.blocks
        && a.assets == b.assets
        && a.ink.strokes().eq(b.ink.strokes())
        && a.recordings == b.recordings
        && a.encryption == b.encryption
        && a.extra == b.extra
}

/// Like [`same_content`], but ignoring the page's `modified` time, as undo sets it to the time of the undo.
pub fn same_content_but_modified(a: &Page, b: &Page) -> bool {
    let mut b = b.clone();
    b.modified = a.modified;
    same_content(a, &b)
}

/// Like [`same_content`], but ignoring the timestamps of the page, its blocks, and its assets.
pub fn same_content_ignoring_times(a: &Page, b: &Page) -> bool {
    same_content(&without_times(a), &without_times(b))
}

fn without_times(page: &Page) -> Page {
    let mut page = page.clone();
    page.created = crate::time::Timestamp::EPOCH;
    page.modified = crate::time::Timestamp::EPOCH;
    let blocks: Vec<_> = page.blocks.iter().cloned().collect();
    for block in blocks {
        let mut block = crate::model::Block::clone(&block);
        block.created = crate::time::Timestamp::EPOCH;
        block.modified = crate::time::Timestamp::EPOCH;
        let _ = page.blocks.replace(std::sync::Arc::new(block));
    }
    for asset in page.assets.values_mut() {
        asset.created = crate::time::Timestamp::EPOCH;
    }
    page
}

/// Whether replaying the page's pending ink records from nothing gives its live strokes. That holds for a page
/// whose strokes were all drawn since it was made, such as the generated pages.
pub fn pending_records_rebuild_ink(page: &Page) -> bool {
    let (rebuilt, _) = crate::model::Ink::replay(Vec::new(), vec![page.ink.pending().to_vec()]);
    rebuilt.strokes().eq(page.ink.strokes())
}
