//! What the indexer is configured with, and what it reports.

use std::time::Duration;

use opennote_core::PageId;

use crate::graph::LinkEdit;
use crate::links::Rename;

/// How the indexer paces itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IndexerConfig {
    /// How long the background thread waits after the first job before it starts, so a burst of saves merges.
    pub debounce: Duration,
    /// How many pages are read before they are written in one transaction.
    pub batch: usize,
    /// How many times a read that may pass is tried before it is given up.
    pub max_attempts: u32,
    /// The delay before the first retry. Each retry doubles it, up to ten seconds.
    pub retry_base: Duration,
    /// Rebuild the index file by itself when it turns out to be damaged. At most three times in a run.
    pub auto_rebuild: bool,
    /// How long a new title must stay before the links to the page follow it. Titles are saved while they are
    /// typed, and a title that lasts less is a step on the way. [`IndexerHandle::title_settled`] settles a title
    /// at once, as when the title field loses focus. Zero settles every title as soon as it is written.
    ///
    /// [`IndexerHandle::title_settled`]: crate::IndexerHandle::title_settled
    pub settle: Duration,
    /// How long the indexer goes on with its waiting jobs after it is asked to stop, as when the app quits. A
    /// short queue finishes. After this long, the indexer ends between two batches and drops a rebuild that was
    /// still filling, so quitting never waits for the first index of a large notebook. The next start compares
    /// the notes with the index and does the rest.
    pub shutdown_grace: Duration,
}

impl Default for IndexerConfig {
    fn default() -> IndexerConfig {
        IndexerConfig {
            debounce: Duration::from_millis(150),
            batch: 64,
            max_attempts: 6,
            retry_base: Duration::from_millis(250),
            auto_rebuild: true,
            settle: Duration::from_secs(20),
            shutdown_grace: Duration::from_secs(2),
        }
    }
}

/// What the indexer has done.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IndexerStats {
    /// Pages written to the index.
    pub written: u64,
    /// Pages removed from the index.
    pub removed: u64,
    /// Pages moved to another section or notebook without being read.
    pub relocated: u64,
    /// Notebooks compared with the index.
    pub reconciles: u64,
    /// Rebuilds finished.
    pub rebuilds: u64,
    /// Reads that failed and were scheduled again.
    pub retries: u64,
    /// Reads that were given up.
    pub failures: u64,
    /// Reload jobs for pages the index had never held and whose notebook was unknown.
    pub skipped: u64,
    /// Transactions written.
    pub batches: u64,
}

/// A page whose title settled on a new one, and the edits that keep the links to it alive.
///
/// The old title is the one the page had settled on before, not a title it had only while it was typed. The
/// edits only touch links that named that old title, which found this page before the rename began.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RenamePlan {
    /// The page, and its old and new titles.
    pub rename: Rename,
    /// The blocks whose link text changes. The app applies each as an ordinary edit of the block.
    pub edits: Vec<LinkEdit>,
}

impl RenamePlan {
    /// The pages other than the renamed one that the edits change, in order. The interface should ask before
    /// it changes them, since the person renamed only one page.
    pub fn other_pages(&self) -> Vec<PageId> {
        let mut pages: Vec<PageId> = self
            .edits
            .iter()
            .map(|edit| edit.page)
            .filter(|page| *page != self.rename.page)
            .collect();
        pages.sort();
        pages.dedup();
        pages
    }
}

/// What a batch changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IndexUpdate {
    /// Pages the index did not hold before.
    pub added: Vec<PageId>,
    /// Pages the index held and wrote again.
    pub updated: Vec<PageId>,
    /// Pages that left the index, because they are gone or locked.
    pub removed: Vec<PageId>,
    /// Pages whose title changed.
    pub renames: Vec<RenamePlan>,
    /// The index's generation after the batch, for caches such as the quick switcher.
    pub generation: u64,
}

/// What the indexer tells the app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IndexEvent {
    /// A batch was written.
    Updated(IndexUpdate),
    /// A rebuild finished and the new file is in use.
    Rebuilt,
    /// A page could not be read and will not be tried again until something changes.
    Failed {
        /// The page.
        page: PageId,
        /// A description for logs.
        message: String,
    },
    /// The index file is damaged. If the indexer may rebuild it, it does so next.
    Damaged {
        /// A description for logs.
        message: String,
    },
    /// Every job is done and none waits to be tried again.
    CaughtUp,
}

/// Receives what the indexer does.
pub type Observer = Box<dyn FnMut(IndexEvent) + Send>;
