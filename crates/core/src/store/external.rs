//! Telling changes made elsewhere apart (spec 14.1). Owned by WP4.

use crate::id::RevisionId;
use crate::model::Revision;

/// What a changed `page.json` on disk means for this device.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalDecision {
    /// The revision this device wrote. A tool touched the file without changing it.
    Unchanged,
    /// An older revision of this device's, such as a sync tool's rollback. Saving goes ahead.
    OlderOfOurs,
    /// Another revision, with no unsaved edits here: reload the page.
    FastForward,
    /// Another revision, with unsaved edits here: keep both.
    Conflict,
}

/// Classifies the revision on disk against the base this device read and its own revision.
pub fn classify_change(_disk: &Revision, _base: RevisionId, _own: &Revision, _dirty: bool) -> ExternalDecision {
    unimplemented!("WP4: classify_change")
}
