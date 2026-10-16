//! Comparing a notebook's tree with the index, and rebuilding the index file.

use std::collections::{BTreeSet, HashMap};
use std::time::Instant;

use opennote_core::{NotebookId, PageId, SectionId};

use super::engine::Indexer;
use super::job::Job;
use super::lock;
use super::source::{PageSource, PageStamp};
use super::types::IndexEvent;
use crate::doc::PageDoc;
use crate::error::Result;
use crate::index::IndexedPage;
use crate::persist::Rebuild;

/// What a notebook's tree and the index disagree about.
#[derive(Debug, Default)]
pub(super) struct Plan {
    /// Pages to read again: new ones, and ones whose content or title changed.
    pub(super) reload: Vec<PageId>,
    /// Pages that only moved, with the section they are in now. They need no read.
    pub(super) relocate: Vec<(PageId, SectionId)>,
    /// Empty locked documents that make the index forget pages that became encrypted.
    pub(super) purge: Vec<PageDoc>,
    /// Pages the index holds for this notebook and the tree no longer lists.
    pub(super) gone: Vec<PageId>,
}

/// Whether the index holds a different version of the page than the tree describes.
///
/// A fingerprint of the page file decides alone when the source gives one. The tree's modified time and title
/// come from the device cache, which knows only the saves made on this device, so they cannot be compared with
/// what the index read from the file.
fn changed(stamp: &PageStamp, held: &IndexedPage) -> bool {
    if let Some(fingerprint) = &stamp.fingerprint {
        return held.fingerprint.as_ref() != Some(fingerprint);
    }
    let same_content = match (stamp.revision, stamp.modified) {
        (Some(revision), _) => held.revision == Some(revision),
        (None, Some(modified)) => held.modified == modified,
        (None, None) => true,
    };
    !same_content || held.title != stamp.title
}

/// Compares the stamps of a notebook with the pages the index holds. A page that is not available keeps what
/// the index has of it.
pub(super) fn plan(notebook: NotebookId, stamps: &[PageStamp], held: &[IndexedPage]) -> Plan {
    let by_page: HashMap<PageId, &IndexedPage> = held.iter().map(|page| (page.page, page)).collect();
    let mut plan = Plan::default();
    for stamp in stamps.iter().filter(|stamp| stamp.available) {
        let current = by_page.get(&stamp.page).copied();
        match current {
            Some(_) if stamp.locked => plan
                .purge
                .push(PageDoc::locked_stub(stamp.page, notebook, stamp.section)),
            _ if stamp.locked => {}
            None => plan.reload.push(stamp.page),
            Some(current) if changed(stamp, current) => plan.reload.push(stamp.page),
            Some(current) if current.notebook != notebook || current.section != stamp.section => {
                plan.relocate.push((stamp.page, stamp.section));
            }
            Some(_) => {}
        }
    }
    let listed: BTreeSet<PageId> = stamps.iter().map(|stamp| stamp.page).collect();
    plan.gone = held
        .iter()
        .filter(|page| page.notebook == notebook && !listed.contains(&page.page))
        .map(|page| page.page)
        .collect();
    plan
}

impl<S: PageSource> Indexer<S> {
    /// Compares a notebook's tree with the index and fixes every difference.
    pub(super) fn reconcile(&mut self, notebook: NotebookId, now: Instant) {
        self.known.insert(notebook);
        let stamps = match self.source.stamps(notebook) {
            Ok(Some(stamps)) => stamps,
            Ok(None) => return,
            Err(error) => {
                if error.transient {
                    self.retry(Job::Reconcile { notebook }, now, &error.message);
                }
                return;
            }
        };
        self.stats.reconciles += 1;
        let listed_in_index = lock(&self.index).indexed_pages();
        let held = match listed_in_index {
            Ok(held) => held,
            Err(error) => {
                self.index_failed(&error);
                return;
            }
        };
        let plan = plan(notebook, &stamps, &held);
        if !self.relocate_all(notebook, &plan.relocate) {
            return;
        }
        if !plan.purge.is_empty() || !plan.gone.is_empty() {
            self.apply(plan.purge, plan.gone, now);
        }
        for page in plan.reload {
            self.queue.push(Job::Reload {
                page,
                notebook: Some(notebook),
            });
        }
    }

    /// Files pages under their new section. Returns false if the index failed.
    fn relocate_all(&mut self, notebook: NotebookId, moves: &[(PageId, SectionId)]) -> bool {
        if moves.is_empty() {
            return true;
        }
        let mut relocated = 0;
        let mut failure = None;
        {
            let mut index = lock(&self.index);
            for (page, section) in moves {
                match index.relocate(*page, notebook, *section) {
                    Ok(found) => relocated += u64::from(found),
                    Err(error) => {
                        failure = Some(error);
                        break;
                    }
                }
            }
        }
        self.stats.relocated += relocated;
        match failure {
            Some(error) => {
                self.index_failed(&error);
                false
            }
            None => true,
        }
    }

    /// Fills a new index file from the notebooks while the old one keeps answering, then swaps it in.
    pub(super) fn rebuild(&mut self, notebooks: Vec<NotebookId>, now: Instant) {
        let started = lock(&self.index).begin_rebuild();
        let mut rebuild = match started {
            Ok(rebuild) => rebuild,
            Err(error) => {
                self.emit(IndexEvent::Damaged {
                    message: error.to_string(),
                });
                return;
            }
        };
        let swapped = match self.fill(&mut rebuild, &notebooks) {
            Ok(true) => lock(&self.index).finish_rebuild(rebuild),
            // Asked to stop half way: the new file goes away with `rebuild`, and the old one stays. The next start
            // checks it again and rebuilds if it is still damaged.
            Ok(false) => return,
            Err(error) => Err(error),
        };
        match swapped {
            Ok(()) => {
                self.damaged = false;
                self.stats.rebuilds += 1;
                self.emit(IndexEvent::Rebuilt);
                // A page that changed or could not be read during the rebuild is caught by comparing again.
                for notebook in notebooks {
                    self.known.insert(notebook);
                    self.queue.push(Job::Reconcile { notebook });
                }
                self.release_retries(now);
            }
            Err(error) => self.emit(IndexEvent::Damaged {
                message: error.to_string(),
            }),
        }
    }

    /// Reads every available page of the notebooks into the new index. Returns false when the indexer was asked to
    /// stop before it was done.
    fn fill(&mut self, rebuild: &mut Rebuild, notebooks: &[NotebookId]) -> Result<bool> {
        for notebook in notebooks {
            let Ok(Some(stamps)) = self.source.stamps(*notebook) else {
                continue;
            };
            let pages: Vec<PageId> = stamps
                .iter()
                .filter(|stamp| stamp.available && !stamp.locked)
                .map(|stamp| stamp.page)
                .collect();
            for chunk in pages.chunks(self.config.batch.max(1)) {
                if self.stopping() {
                    return Ok(false);
                }
                let mut docs = self.read_chunk(*notebook, chunk);
                let prepared = self.prepare_all(&mut docs);
                rebuild.index().write_prepared(&docs, &prepared)?;
            }
        }
        Ok(true)
    }

    /// Reads some pages. One that cannot be read for good is listed as a failure, and one that may pass is
    /// left for the comparison that follows the rebuild.
    fn read_chunk(&mut self, notebook: NotebookId, pages: &[PageId]) -> Vec<PageDoc> {
        let mut docs = Vec::with_capacity(pages.len());
        for page in pages {
            match self.source.read(notebook, *page) {
                Ok(Some(doc)) => docs.push(doc),
                Ok(None) => {}
                Err(error) if error.transient => {}
                Err(error) => self.fail(*page, error.message),
            }
        }
        docs
    }
}

#[cfg(test)]
mod tests {
    use opennote_core::{Id, Timestamp};

    use super::*;

    fn stamp(fingerprint: Option<&str>, modified: i64, title: &str) -> PageStamp {
        PageStamp {
            page: PageId::from(Id::from_parts(1_001, 1)),
            section: SectionId::from(Id::from_parts(4_001, 1)),
            title: title.into(),
            modified: Some(Timestamp::from_unix_ms(modified)),
            revision: None,
            fingerprint: fingerprint.map(String::from),
            locked: false,
            available: true,
        }
    }

    fn held(fingerprint: Option<&str>, modified: i64, title: &str) -> IndexedPage {
        IndexedPage {
            page: PageId::from(Id::from_parts(1_001, 1)),
            notebook: NotebookId::from(Id::from_parts(3_001, 1)),
            section: SectionId::from(Id::from_parts(4_001, 1)),
            revision: None,
            modified: Timestamp::from_unix_ms(modified),
            title: title.into(),
            fingerprint: fingerprint.map(String::from),
        }
    }

    fn reloads(stamp: PageStamp, held: IndexedPage) -> bool {
        let notebook = held.notebook;
        !plan(notebook, &[stamp], &[held]).reload.is_empty()
    }

    #[test]
    fn a_page_the_cache_has_only_seen_is_not_read_again() {
        // The device cache holds the creation time and an old title. The index read the file, which says more.
        assert!(!reloads(
            stamp(Some("10:5:1"), 1, "Draft"),
            held(Some("10:5:1"), 9, "Final")
        ));
    }

    #[test]
    fn a_file_another_device_replaced_is_read_again() {
        // The cache did not hear of the new file, so its time and title still match the index.
        assert!(reloads(
            stamp(Some("12:7:2"), 9, "Final"),
            held(Some("10:5:1"), 9, "Final")
        ));
        assert!(reloads(stamp(Some("12:7:2"), 9, "Final"), held(None, 9, "Final")));
    }

    #[test]
    fn without_a_fingerprint_the_time_and_title_decide() {
        assert!(!reloads(stamp(None, 9, "Final"), held(None, 9, "Final")));
        assert!(reloads(stamp(None, 10, "Final"), held(None, 9, "Final")));
    }
}
