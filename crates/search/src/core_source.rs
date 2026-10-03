//! Reading notes through the core: a [`PageSource`] over a running [`Core`].
//!
//! The core wants its search hook when it starts. The indexer wants a way to read pages from the core. A
//! [`CoreSlot`] breaks the circle. The app makes a slot and builds the source from it. It starts the indexer,
//! then starts the core with the indexer's handle as its `IndexSink`, and finally puts the core in the slot.
//!
//! The source lists a notebook's pages from its tree. It reads one page from its folder with the core's own
//! page reader, so it sees exactly what the core saved. It never opens a page session, so reading for the index
//! cannot disturb a page the person is editing.
//!
//! Each stamp carries a fingerprint of the page's `page.json`: its size, last-write time, and file ID. The tree's
//! modified time comes from the device cache, which only learns of saves made on this device, so it cannot tell
//! whether a sync tool replaced the file. The fingerprint can, and a read records the fingerprint it saw before
//! reading, so the index compares like with like. A page whose file cannot be looked at now is left as it is.
//!
//! A notebook that is not open, or is a backup, has no stamps. The indexer leaves what it holds alone.
//! A page in an encrypted section is returned locked, without being read.
//! A page whose folder has not arrived, or whose file cannot be read now, is a read that may pass.
//! A page whose `page.json` is damaged or from a newer version is a failure that waiting will not fix.

use std::path::Path;
use std::sync::{Arc, OnceLock};

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::{Limits, Timings};
use opennote_core::model::{NotebookTree, PageNodeState};
use opennote_core::seams::Codec;
use opennote_core::session::core::Core;
use opennote_core::session::notebook::NotebookHandle;
use opennote_core::session::page::read_page_dir;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::page_store::LoadError;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{NotebookId, PageId, SectionId};

use crate::doc::PageDoc;
use crate::sync::{PageSource, PageStamp, SourceError};

/// A place for the core, filled once it has started.
#[derive(Clone, Default)]
pub struct CoreSlot {
    core: Arc<OnceLock<Core>>,
}

impl CoreSlot {
    /// An empty slot.
    pub fn new() -> CoreSlot {
        CoreSlot::default()
    }

    /// Puts the core in the slot. A second call has no effect.
    pub fn set(&self, core: Core) {
        let _ = self.core.set(core);
    }

    /// The open notebook with this ID, once the core is in the slot.
    pub fn notebook(&self, id: NotebookId) -> Option<NotebookHandle> {
        self.core
            .get()?
            .notebooks()
            .into_iter()
            .find(|notebook| notebook.id() == id)
    }
}

/// A [`PageSource`] over a running core.
pub struct CorePageSource {
    slot: CoreSlot,
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    limits: Limits,
}

impl CorePageSource {
    /// A source that reads with the given file system, codec, and limits, which should be the core's own.
    pub fn new(slot: CoreSlot, fs: Arc<dyn Fs>, codec: Arc<dyn Codec>, limits: Limits) -> CorePageSource {
        CorePageSource {
            slot,
            fs,
            codec,
            limits,
        }
    }

    /// A source with the file system, codec, and limits of the production core.
    pub fn production(slot: CoreSlot) -> CorePageSource {
        CorePageSource::new(
            slot,
            Arc::new(StdFs::new(&Timings::default())),
            Arc::new(CanonicalCodec),
            Limits::default(),
        )
    }
}

/// What the tree says of every page, without reading any page.
///
/// The tree has a title and a modified time for each page, from the device cache the core updates on this
/// device's saves, and not the revision. The stamps carry no fingerprint, so the index compares the modified time.
/// [`CorePageSource`] adds the fingerprints.
pub fn stamps_from_tree(tree: &NotebookTree) -> Vec<PageStamp> {
    let mut stamps = Vec::new();
    for section in &tree.sections {
        for page in &section.pages {
            stamps.push(PageStamp {
                page: page.id,
                section: section.id,
                title: page.title.clone(),
                modified: page.modified,
                revision: None,
                fingerprint: None,
                locked: section.encrypted,
                available: page.state == PageNodeState::Normal,
            });
        }
    }
    stamps
}

impl PageSource for CorePageSource {
    fn stamps(&mut self, notebook: NotebookId) -> Result<Option<Vec<PageStamp>>, SourceError> {
        let Some(handle) = self.slot.notebook(notebook) else {
            return Ok(None);
        };
        if handle.is_backup() {
            return Ok(None);
        }
        let mut stamps = stamps_from_tree(&handle.tree());
        for stamp in stamps.iter_mut().filter(|stamp| stamp.available && !stamp.locked) {
            stamp.fingerprint = fingerprint(self.fs.as_ref(), handle.path(), stamp.section, stamp.page);
            stamp.available = stamp.fingerprint.is_some();
        }
        Ok(Some(stamps))
    }

    fn read(&mut self, notebook: NotebookId, page: PageId) -> Result<Option<PageDoc>, SourceError> {
        let Some(handle) = self.slot.notebook(notebook) else {
            return Err(SourceError::transient("the notebook is not open"));
        };
        let tree = handle.tree();
        let Some((section, node)) = tree.find_page(page) else {
            return Ok(None);
        };
        if section.encrypted {
            return Ok(Some(PageDoc::locked_stub(page, notebook, section.id)));
        }
        if node.state != PageNodeState::Normal {
            return Err(SourceError::transient("the page is not ready"));
        }
        let dir = NotebookLayout::new(handle.path()).page_dir(section.id, page);
        // The fingerprint is taken before the read, so a change that lands during the read shows up next time.
        let seen = fingerprint(self.fs.as_ref(), handle.path(), section.id, page);
        match read_page_dir(self.fs.as_ref(), self.codec.as_ref(), &dir, &self.limits) {
            Ok(loaded) => {
                let mut doc = PageDoc::from_page(&loaded.page, notebook, section.id, false);
                doc.fingerprint = seen;
                Ok(Some(doc))
            }
            Err(LoadError::Missing) => Err(SourceError::transient("the page file has not arrived")),
            Err(LoadError::Unavailable(error)) => Err(SourceError::transient(format!("{error:?}"))),
            Err(LoadError::Damaged(error)) => Err(SourceError::permanent(format!("page.json is damaged: {error:?}"))),
            Err(LoadError::NewerFormat(version)) => Err(SourceError::permanent(format!(
                "page.json is from a newer version ({version})"
            ))),
        }
    }
}

/// The fingerprint of a page's `page.json`, or `None` when the file cannot be looked at now.
fn fingerprint(fs: &dyn Fs, notebook: &Path, section: SectionId, page: PageId) -> Option<String> {
    let dir = NotebookLayout::new(notebook).page_dir(section, page);
    let stamp = fs.metadata(&NotebookLayout::page_json(&dir)).ok()?.stamp;
    Some(format!("{}:{}:{:x}", stamp.len, stamp.modified, stamp.file_id))
}
