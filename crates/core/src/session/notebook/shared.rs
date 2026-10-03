//! An open notebook's shared state: its tree behind the tree lock, its open pages, its lock, and the work its
//! pages hand it after saves.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, Weak};

use super::undo::TreeUndo;
use crate::error::CoreError;
use crate::id::{NotebookId, PageId, SectionId};
use crate::model::{Page, ReadOnlyReason};
use crate::session::core::CoreCtx;
use crate::session::events::{CoreEvent, ExternalAction};
use crate::session::journal_thread::JournalMeta;
use crate::session::page::{PageLinks, PageSession};
use crate::store::cache::CachedPage;
use crate::store::fs::FolderIdentity;
use crate::store::layout::{NotebookKey, INDEX_MD};
use crate::store::lock::NotebookLock;
use crate::store::notebook_store::NotebookStore;

/// The tree of an open notebook, behind its tree lock.
pub(crate) struct TreeState {
    pub(crate) store: NotebookStore,
    pub(crate) undo: TreeUndo,
}

/// What every handle of an open notebook shares.
pub(crate) struct NotebookShared {
    pub(crate) ctx: Arc<CoreCtx>,
    pub(crate) root: PathBuf,
    pub(crate) identity: FolderIdentity,
    pub(crate) key: RwLock<NotebookKey>,
    pub(crate) id: RwLock<NotebookId>,
    pub(crate) tree: Mutex<TreeState>,
    pub(crate) pages: Mutex<HashMap<PageId, Arc<PageSession>>>,
    pub(crate) lock: Mutex<Option<NotebookLock>>,
    pub(crate) closed: AtomicBool,
    /// Pages whose journals couldn't be recovered yet. They open read-only (spec 20.4).
    pub(crate) deferred: Mutex<HashMap<PageId, ()>>,
    /// What recovery did when the notebook opened.
    pub(crate) recovered: Mutex<Vec<(PageId, crate::session::events::RecoveryOutcome)>>,
    pub(crate) me: Weak<NotebookShared>,
}

impl NotebookShared {
    pub(crate) fn id(&self) -> NotebookId {
        *self.id.read().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn key(&self) -> NotebookKey {
        self.key.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub(crate) fn tree(&self) -> MutexGuard<'_, TreeState> {
        self.tree.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn pages(&self) -> MutexGuard<'_, HashMap<PageId, Arc<PageSession>>> {
        self.pages.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Every open page session.
    pub(crate) fn sessions(&self) -> Vec<Arc<PageSession>> {
        self.pages().values().cloned().collect()
    }

    pub(crate) fn check_open(&self) -> Result<(), CoreError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(CoreError::NotFound(format!(
                "notebook {} is closed",
                self.root.display()
            )));
        }
        Ok(())
    }

    /// The key and the header metadata of a page journal in this notebook (spec 20.5).
    pub(crate) fn journal_meta(&self, section: Option<SectionId>) -> (NotebookKey, JournalMeta) {
        let meta = super::open::journal_meta(&self.ctx, self.id(), &self.root, self.identity, section);
        (self.key(), meta)
    }

    /// Queues the work of step S11 that can wait: readable copies, the title copy and the cache, and the
    /// checks for sync-tool conflict copies 5 and 60 seconds after the save.
    pub(crate) fn page_saved(&self, session: &PageSession, page: &Page, encrypted: bool) {
        let dir = session.state().dir.clone();
        let (me, id) = (self.me.clone(), page.id);
        let maintenance = &self.ctx.maintenance;
        let clock = self.ctx.clock.as_ref();
        if !encrypted {
            let page = page.clone();
            let (me, dir) = (me.clone(), dir.clone());
            let key = Some(format!("readable:{}", session.serial));
            maintenance.after(clock, std::time::Duration::ZERO, key, move || {
                if let Some(notebook) = me.upgrade() {
                    let links = notebook.links(&dir, &page);
                    let _ = notebook.ctx.backend.write_readable(&dir, &page, &links);
                }
            });
        }
        let (title, created, modified, revision) = (page.title.clone(), page.created, page.modified, page.revision.id);
        let tree_me = me.clone();
        maintenance.after(clock, std::time::Duration::ZERO, None, move || {
            if let Some(notebook) = tree_me.upgrade() {
                let cached = CachedPage {
                    title,
                    created,
                    modified,
                    revision: Some(revision),
                };
                notebook.refresh_title(id, cached, encrypted);
            }
        });
        for delay in self.ctx.timings.conflict_copy_checks {
            let (me, dir) = (me.clone(), dir.clone());
            let key = Some(format!("conflicts:{}:{}", session.serial, delay.as_millis()));
            maintenance.after(clock, delay, key, move || {
                if let Some(notebook) = me.upgrade() {
                    notebook.check_conflict_copies(id, &dir);
                }
            });
        }
    }

    /// Refreshes the title copy in `section.json` and the device-local cache after a save.
    pub(crate) fn refresh_title(&self, page: PageId, cached: CachedPage, encrypted: bool) {
        if self.check_open().is_err() {
            return;
        }
        let mut tree = self.tree();
        let before = tree
            .store
            .section_of(page)
            .and_then(|s| tree.store.sections.get(&s))
            .and_then(|s| s.entry(page))
            .map(|e| e.title.clone());
        let title_changed = before.is_some_and(|t| t != cached.title);
        if title_changed && tree.store.set_title_copy(page, &cached.title).is_ok() {
            self.ctx.events.emit(CoreEvent::TreeChanged { notebook: self.id() });
            self.schedule_index();
        }
        if !encrypted {
            tree.store.cache.record(page, cached);
            let _ = tree.store.cache.save(self.ctx.fs.as_ref());
        }
    }

    /// Moves sync-tool conflict copies aside and reports real divergences (spec 14.2).
    fn check_conflict_copies(&self, page: PageId, dir: &std::path::Path) {
        let Ok(revisions) = self.ctx.backend.absorb_conflict_copies(dir) else {
            return;
        };
        if revisions.is_empty() {
            return;
        }
        if let Some(session) = self.pages().get(&page).cloned() {
            let mut st = session.state();
            for revision in &revisions {
                if !st.conflicts.contains(revision) {
                    st.conflicts.push(*revision);
                }
            }
        }
        self.ctx.events.emit(CoreEvent::ExternalChange {
            page,
            action: ExternalAction::Conflict {
                other_device: String::new(),
            },
        });
    }

    /// Whether this notebook is a scheduled backup set, which opens read-only.
    pub(crate) fn is_backup(&self) -> bool {
        matches!(self.tree().store.read_only, Some(ReadOnlyReason::Backup))
    }

    /// Forgets a closed page session, and tidies the page's history and unused files a little later, if it
    /// isn't open again by then (spec 19).
    pub(crate) fn page_closed(&self, session: &PageSession) {
        {
            let mut pages = self.pages();
            if pages.get(&session.id).is_some_and(|s| s.serial == session.serial) {
                pages.remove(&session.id);
            }
        }
        let dir = session.state().dir.clone();
        let (me, id) = (self.me.clone(), session.id);
        let key = Some(format!("tidy:{id}"));
        self.ctx
            .maintenance
            .after(self.ctx.clock.as_ref(), TIDY_DELAY, key, move || {
                let Some(notebook) = me.upgrade() else { return };
                if notebook.pages().contains_key(&id) || notebook.check_open().is_err() {
                    return;
                }
                let now = notebook.ctx.clock.now();
                let _ = notebook.ctx.backend.tidy_page(&dir, id, now, notebook.ctx.retention());
            });
    }

    /// Links for `page.md`: where every page of the notebook is, and the page's asset files.
    pub(crate) fn links(&self, from: &std::path::Path, page: &Page) -> PageLinks {
        let pages = {
            let tree = self.tree();
            let store = &tree.store;
            store
                .sections
                .values()
                .filter(|s| !s.encrypted())
                .flat_map(|s| s.file.pages.iter().map(move |e| (e.id, s.dir.join(e.id.to_string()))))
                .collect()
        };
        PageLinks {
            from: from.to_path_buf(),
            pages,
            assets: page.assets.values().map(|a| (a.id, a.file.clone())).collect(),
        }
    }

    /// Rewrites `index.md` a few seconds after the tree last changed (spec 11.4). Encrypted sections list no
    /// pages.
    pub(crate) fn schedule_index(&self) {
        let me = self.me.clone();
        let key = Some(format!("index:{}", self.root.display()));
        let delay = self.ctx.timings.index_md_debounce;
        self.ctx
            .maintenance
            .after(self.ctx.clock.as_ref(), delay, key, move || {
                let Some(notebook) = me.upgrade() else { return };
                if notebook.check_open().is_err() {
                    return;
                }
                let mut tree = notebook.tree().store.tree();
                for section in tree.sections.iter_mut().filter(|s| s.encrypted) {
                    section.pages.clear();
                }
                let bytes = notebook.ctx.codec.render_index_md(&tree);
                let _ = notebook.ctx.fs.write_derived(&notebook.root.join(INDEX_MD), &bytes);
            });
    }

    /// Adds a page with a new ID right after `after`, holding `page`'s content: a restored version or the
    /// other side of a conflict kept as its own page.
    pub(crate) fn add_page_copy(&self, after: PageId, page: Page) -> Result<PageId, CoreError> {
        self.check_open()?;
        let mut tree = self.tree();
        let result = tree.store.add_copy(after, &page);
        drop(tree);
        self.tree_changed();
        result
    }

    /// Tells the app the tree changed, and schedules `index.md`.
    pub(crate) fn tree_changed(&self) {
        self.ctx.events.emit(CoreEvent::TreeChanged { notebook: self.id() });
        self.schedule_index();
    }
}

/// How long after a page closes its history is thinned and unused files are collected.
const TIDY_DELAY: std::time::Duration = std::time::Duration::from_secs(30);
