//! Keeping the index current from the core's notifications.
//!
//! The core tells the index about changes in three ways, and each becomes a [`Job`]. When a page is saved, the
//! core calls [`IndexSink::page_saved`] with an [`IndexHint`], and the job is to read the page again. When the
//! tree changes, a page changes on disk, or recovery finishes, a [`CoreEvent`] arrives, and the app passes it
//! to [`IndexerHandle::on_event`]. A tree change reconciles the whole notebook. The indexer lists the pages of
//! the tree, compares them with what the index holds, and fixes every difference.
//!
//! When the app starts, or a notebook opens or closes, the app calls [`IndexerHandle::start`],
//! [`IndexerHandle::tree_changed`], or [`IndexerHandle::notebook_closed`]. Starting is the same reconcile. It
//! catches a save that the app made just before a crash and never indexed.
//!
//! Jobs about the same page or notebook merge while they wait, so a burst of saves costs one read of the page.
//! A page is always read whole, so an index update can never apply half a change.
//!
//! The indexer does not know how notes are stored. It reads them through a [`PageSource`], which the app
//! implements over the core. A read that fails for a reason that may pass is tried again with a growing delay.
//! A read that cannot be fixed is listed in [`IndexerHandle::failures`]. A page the source says is gone leaves
//! the index.
//!
//! # Threads
//!
//! [`Indexer`] is the single-threaded engine: queue jobs, call [`Indexer::run`]. [`BackgroundIndexer`] runs it
//! on its own thread behind an [`IndexerHandle`] that is cheap to clone and never blocks the caller. The index
//! sits in a [`SharedIndex`], a mutex around the [`SearchIndex`]. The indexer holds the lock only while it
//! writes a batch, never while it reads a page, so a search waits for at most one batch.
//!
//! # What the app sees
//!
//! After each batch the indexer calls the observer with an [`IndexEvent`]. An [`IndexUpdate`] lists the pages
//! added, updated, and removed. It holds a [`RenamePlan`] for each page whose title changed, with the edits that
//! bring the links to it up to date. The app applies the edits as ordinary page edits, and the saves bring the
//! index up to date again.

mod background;
mod engine;
mod job;
mod reconcile;
mod source;
mod types;

pub use background::{BackgroundIndexer, IndexerHandle};
pub use engine::Indexer;
pub use job::{jobs_for_event, Job};
pub use source::{PageSource, PageStamp, SourceError};
pub use types::{IndexEvent, IndexUpdate, IndexerConfig, IndexerStats, Observer, RenamePlan};

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::index::SearchIndex;

/// The index behind a lock, shared by the indexer, which writes, and the app, which searches.
pub type SharedIndex = Arc<Mutex<SearchIndex>>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
