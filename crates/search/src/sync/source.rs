//! Where the indexer reads notes.

use opennote_core::{NotebookId, PageId, RevisionId, SectionId, Timestamp};

use crate::doc::PageDoc;

/// Why a source could not read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceError {
    /// A description for logs.
    pub message: String,
    /// The read may work later, as when a sync tool is still writing the file.
    pub transient: bool,
}

impl SourceError {
    /// An error that may pass.
    pub fn transient(message: impl Into<String>) -> SourceError {
        SourceError {
            message: message.into(),
            transient: true,
        }
    }

    /// An error that will not pass by waiting.
    pub fn permanent(message: impl Into<String>) -> SourceError {
        SourceError {
            message: message.into(),
            transient: false,
        }
    }
}

impl std::fmt::Display for SourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SourceError {}

/// What the navigation tree and the device cache know of a page, without reading it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageStamp {
    /// The page.
    pub page: PageId,
    /// The section that holds it.
    pub section: SectionId,
    /// Its title.
    pub title: String,
    /// The last change to its content, if known.
    pub modified: Option<Timestamp>,
    /// Its saved revision, if known. The index compares it with the revision it indexed.
    pub revision: Option<RevisionId>,
    /// A fingerprint of the page file itself, such as its size, last-write time, and file ID, if the source can
    /// tell. When it is known, the index compares it with the fingerprint of the file it read, and nothing else.
    /// Unlike `modified` and `revision`, which may come from a device cache, it changes whenever the file does,
    /// even when a sync tool replaces the file while the app is closed.
    pub fingerprint: Option<String>,
    /// The page sits in an encrypted section, so the index must hold nothing of it.
    pub locked: bool,
    /// The page can be read now. A page that is moving, waiting for its folder, or duplicated is left as it is.
    pub available: bool,
}

/// Where the indexer reads notes. The app implements it over the core.
pub trait PageSource: Send + 'static {
    /// The pages of a notebook as its tree lists them, or `None` when the notebook is not open or not
    /// available. The indexer then leaves everything it holds of the notebook alone.
    fn stamps(&mut self, notebook: NotebookId) -> std::result::Result<Option<Vec<PageStamp>>, SourceError>;

    /// Reads a page for the index. `Ok(None)` says the page is gone. A page in an encrypted section may be
    /// returned locked (see [`PageDoc::from_page`]) or not at all.
    fn read(&mut self, notebook: NotebookId, page: PageId) -> std::result::Result<Option<PageDoc>, SourceError>;
}
