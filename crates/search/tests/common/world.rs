//! A pretend set of notebooks for the indexer tests: pages the "disk" holds, and a source that reads them.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use opennote_core::{Id, NotebookId, PageId, RevisionId};
use opennote_search::{PageDoc, PageSource, PageStamp, SourceError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    /// Fails this many reads with a transient error, then works.
    Transient(u32),
    /// Fails every read for good.
    Permanent,
}

#[derive(Default)]
pub struct World {
    pub pages: BTreeMap<PageId, PageDoc>,
    pub unavailable_pages: BTreeSet<PageId>,
    pub unavailable_notebooks: BTreeSet<NotebookId>,
    pub locked_sections: BTreeSet<opennote_core::SectionId>,
    pub faults: HashMap<PageId, Fault>,
    pub reads: Vec<PageId>,
    pub stamp_calls: usize,
    /// Revisions are never reused, as in the core.
    pub revisions: u64,
}

impl World {
    /// Saves a page: a new revision every time, as the core does.
    pub fn save(&mut self, mut doc: PageDoc) {
        self.revisions += 1;
        doc.revision = Some(RevisionId::from(Id::from_parts(self.revisions, 1)));
        self.pages.insert(doc.page, doc);
    }

    pub fn remove(&mut self, page: PageId) {
        self.pages.remove(&page);
    }

    pub fn reads_of(&self, page: PageId) -> usize {
        self.reads.iter().filter(|read| **read == page).count()
    }
}

#[derive(Clone, Default)]
pub struct MemSource(pub Arc<Mutex<World>>);

impl MemSource {
    pub fn world(&self) -> std::sync::MutexGuard<'_, World> {
        self.0.lock().unwrap()
    }
}

impl PageSource for MemSource {
    fn stamps(&mut self, notebook: NotebookId) -> Result<Option<Vec<PageStamp>>, SourceError> {
        let mut world = self.0.lock().unwrap();
        world.stamp_calls += 1;
        if world.unavailable_notebooks.contains(&notebook) {
            return Ok(None);
        }
        let stamps = world
            .pages
            .values()
            .filter(|doc| doc.notebook == notebook)
            .map(|doc| PageStamp {
                page: doc.page,
                section: doc.section,
                title: doc.title.clone(),
                modified: Some(doc.modified),
                revision: doc.revision,
                fingerprint: doc.fingerprint.clone(),
                locked: doc.locked || world.locked_sections.contains(&doc.section),
                available: !world.unavailable_pages.contains(&doc.page),
            })
            .collect();
        Ok(Some(stamps))
    }

    fn read(&mut self, notebook: NotebookId, page: PageId) -> Result<Option<PageDoc>, SourceError> {
        let mut world = self.0.lock().unwrap();
        world.reads.push(page);
        match world.faults.get(&page).copied() {
            Some(Fault::Permanent) => return Err(SourceError::permanent("the file is damaged")),
            Some(Fault::Transient(left)) if left > 0 => {
                world.faults.insert(page, Fault::Transient(left - 1));
                return Err(SourceError::transient("the file is busy"));
            }
            _ => {}
        }
        Ok(world
            .pages
            .get(&page)
            .filter(|doc| doc.notebook == notebook)
            .map(|doc| {
                let mut doc = doc.clone();
                doc.locked |= world.locked_sections.contains(&doc.section);
                doc
            }))
    }
}
