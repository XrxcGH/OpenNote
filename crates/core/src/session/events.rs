//! Events the core reports to the app, and the hook the search index listens on (plan 4.6 and 11.2).

use std::path::PathBuf;
use std::time::Duration;

use serde::{Serialize, Serializer};

use crate::error::FsErrorKind;
use crate::id::{AssetId, BlockId, ClientId, NotebookId, PageId, RevisionId};
use crate::model::ReadOnlyReason;
use crate::ops::AppliedChanges;
use crate::time::Timestamp;

/// Something the interface should know about. The app turns each into a `core:*` event.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CoreEvent {
    /// A page was saved (`core:saved`).
    Saved {
        /// The page.
        page: PageId,
        /// The new revision.
        revision: RevisionId,
        /// When it was saved.
        at: Timestamp,
    },
    /// A save failed (`core:save-failed`, spec 17.6).
    SaveFailed {
        /// The page.
        page: PageId,
        /// What went wrong.
        kind: FsErrorKind,
        /// A description for logs, never shown as is.
        message: String,
        /// When autosave tries again, if it does on its own.
        #[serde(rename = "retryInMs", serialize_with = "duration_ms")]
        retry_in: Option<Duration>,
    },
    /// Another window changed a page this window shows (`core:txn-applied`).
    TxnApplied {
        /// The page.
        page: PageId,
        /// The window that made the change.
        #[serde(rename = "sourceClient")]
        source: ClientId,
        /// What changed.
        changes: AppliedChanges,
    },
    /// The page changed on disk (`core:external-change`).
    ExternalChange {
        /// The page.
        page: PageId,
        /// What the core did about it.
        action: ExternalAction,
    },
    /// A page became read-only, or writable again (`core:read-only`).
    ReadOnly {
        /// The page.
        page: PageId,
        /// Why it is read-only.
        reason: ReadOnlyReason,
    },
    /// The navigation tree changed, including from a scan or a sync tool (`core:tree-changed`).
    TreeChanged {
        /// The notebook.
        notebook: NotebookId,
    },
    /// Start-up recovery finished (`core:recovered`).
    Recovered(RecoveryReport),
    /// The journal can't be written (`core:journal-degraded`, spec 20.12).
    JournalDegraded {
        /// A description for logs.
        message: String,
    },
    /// Progress of a large import (`core:import-progress`).
    ImportProgress {
        /// The page.
        page: PageId,
        /// The asset being imported.
        asset: AssetId,
        /// Bytes copied.
        done: u64,
        /// Bytes in all.
        total: u64,
    },
}

fn duration_ms<S: Serializer>(value: &Option<Duration>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(d) => serializer.serialize_u64(u64::try_from(d.as_millis()).unwrap_or(u64::MAX)),
        None => serializer.serialize_none(),
    }
}

/// What the core did about a change on disk (spec 14.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ExternalAction {
    /// The page had no unsaved edits, so it was reloaded.
    Reloaded,
    /// Both versions were kept.
    Conflict {
        /// The label of the device that made the other version.
        other_device: String,
    },
    /// A save may have replaced a change made at the same moment (spec 17.9).
    SuspectOverwrite,
}

/// What start-up recovery did.
#[derive(Clone, Debug, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    /// Each page with journals, and what happened to it.
    pub pages: Vec<(PageId, RecoveryOutcome)>,
    /// Journals waiting for a notebook that isn't available.
    pub waiting: Vec<WaitingJournal>,
    /// The time of the latest recovered change, for "Changes up to 2:03 PM were recovered."
    pub latest_change: Option<Timestamp>,
}

/// What recovery did for one page (spec 20.10).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RecoveryOutcome {
    /// Nothing needed replaying.
    Nothing,
    /// Journal records were applied and saved.
    Replayed {
        /// Transactions applied.
        txns: u32,
        /// Strokes recovered from progress records.
        strokes: u32,
    },
    /// The page on disk was an ancestor of this device's version, which was saved.
    FastForward,
    /// Both versions were kept as a conflict.
    KeptBoth {
        /// The revision kept in `.conflicts/`.
        conflict: RevisionId,
    },
    /// A damaged `page.json` was moved aside and replaced.
    ReplacedDamaged,
    /// The page was found in another section or in Trash, and recovered there.
    Relocated,
    /// The page was missing everywhere and was created again.
    Recreated,
    /// Some changes couldn't be applied. They are in a recovery file.
    PartlyApplied {
        /// The recovery file.
        recovery_file: PathBuf,
    },
    /// Recovery has to wait.
    Deferred {
        /// Why.
        reason: DeferReason,
    },
    /// Another running process owns the journal.
    OwnerAlive,
}

/// Journals whose notebook isn't available (spec 20.12).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitingJournal {
    /// The notebook.
    pub notebook: NotebookId,
    /// Where the notebook was.
    pub notebook_path: PathBuf,
    /// How many pages have journals.
    pub pages: u32,
    /// The oldest journal's time.
    pub since: Timestamp,
}

/// Why recovery of a page has to wait.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeferReason {
    /// A journal from a newer app version.
    NewerJournal,
    /// The notebook isn't available.
    NotebookUnavailable,
    /// The page's file isn't available, such as a cloud file while offline.
    PageUnavailable,
    /// The page was written by a newer app version.
    NewerPage,
    /// The folder's identity doesn't match the journal's (spec 20.2).
    IdentityMismatch,
}

/// Receives events. The app implements it with `AppHandle::emit`.
pub trait EventSink: Send + Sync + 'static {
    /// Reports an event. Must not block.
    fn emit(&self, event: CoreEvent);
}

/// What a save changed, for the search index.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexHint {
    /// The notebook.
    pub notebook: NotebookId,
    /// The page.
    pub page: PageId,
    /// The saved revision. The index stores it, so it can catch a crash between a save and indexing.
    pub revision: RevisionId,
    /// Blocks added or changed since the last save.
    pub changed_blocks: Vec<BlockId>,
    /// Blocks removed since the last save.
    pub removed_blocks: Vec<BlockId>,
    /// Whether the title changed.
    pub title_changed: bool,
}

/// The search index's hook. It is never called for pages in encrypted sections (spec 5.7).
pub trait IndexSink: Send + Sync + 'static {
    /// A page was saved.
    fn page_saved(&self, hint: &IndexHint);
}

#[cfg(test)]
mod tests;
