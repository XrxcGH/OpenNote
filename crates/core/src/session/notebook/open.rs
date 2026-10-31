//! Opening a notebook (its lock, tree intents, recovery, and the tree), opening its pages, and closing it.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::Instant;

use super::shared::{NotebookShared, TreeState};
use super::undo::TreeUndo;
use super::NotebookHandle;
use crate::error::CoreError;
use crate::id::{ClientId, NotebookId, PageId, SectionId};
use crate::model::{ReadOnlyReason, Warning};
use crate::session::backend::RecoverInput;
use crate::session::core::CoreCtx;
use crate::session::events::RecoveryOutcome;
use crate::session::journal_thread::JournalMeta;
use crate::session::page::save::Why;
use crate::session::page::{Opening, PageHandle, PageSession};
use crate::store::cache::PageCache;
use crate::store::fs::FsLock;
use crate::store::layout::{notebook_key, NotebookKey, NotebookLayout};
use crate::store::lock::{lock_notebook, lock_until, Held, NotebookLock};
use crate::store::notebook_store::{read_notebook_file, NotebookStore};
use crate::store::page_store::LoadedPage;
use crate::store::tree_log::{IntentLog, MemIntentLog};

/// Why a notebook opens read-only, besides its own files.
pub(crate) struct OpenAs {
    /// Another open notebook has the same ID: this is a copy (spec 20.2).
    pub(crate) copy_of_open: bool,
}

/// Opens a notebook folder: takes its locks, rolls tree intents forward, recovers its pages' journals, and
/// reads its tree. The scan and Trash expiry follow on the maintenance thread (plan 10.3).
pub(crate) fn open_notebook(ctx: &Arc<CoreCtx>, dir: &Path, how: &OpenAs) -> Result<NotebookHandle, CoreError> {
    let env = ctx.tree_env();
    let layout = NotebookLayout::new(dir);
    let file = read_notebook_file(&env, &layout)?;
    let fs = ctx.fs.as_ref();
    let identity = fs.folder_identity(dir)?;
    let key = notebook_key(file.id, &identity);
    let volume = fs.volume(dir).ok();
    let remote = volume.as_ref().is_some_and(|v| v.remote);
    // A backup set opens read-only without a lock, so it can sit on a drive nobody may write to.
    let backup = crate::store::backup::is_backup(fs, dir);
    // A notebook this core already has open by another path holds its own lock, which is never worth waiting for.
    let held_here = ctx.notebooks().iter().any(|n| n.key() == key);
    let deadline = if held_here { Instant::now() } else { ctx.lock_deadline };
    let (lock, held, tree_locks) = if backup {
        (None, None, Vec::new())
    } else {
        take_locks(ctx, (&key, &layout), remote, deadline)?
    };
    let mut notices = Vec::new();
    let read_only = if backup {
        notices.push(Warning::new("notebook.backup", dir.display().to_string()));
        Some(ReadOnlyReason::Backup)
    } else if held == Some(Held::Ending) && !held_here {
        notices.push(Warning::new("notebook.stillClosing", dir.display().to_string()));
        Some(ReadOnlyReason::StillClosing)
    } else if lock.is_none() {
        notices.push(Warning::new("notebook.lockedElsewhere", dir.display().to_string()));
        Some(ReadOnlyReason::LockedElsewhere)
    } else if how.copy_of_open {
        notices.push(Warning::new("notebook.sameId", file.id.to_string()));
        Some(ReadOnlyReason::LockedElsewhere)
    } else {
        None
    };
    let cache = PageCache::load(fs, &ctx.data, &key);
    let log = tree_log(
        ctx,
        (&key, journal_meta(ctx, file.id, dir, identity, None)),
        read_only.is_none(),
    );
    drop(tree_locks);
    let mut store = NotebookStore::open(env, dir, cache, log)?;
    store.sync_managed = volume.is_some_and(|v| v.sync_root.is_some());
    store.notices.extend(notices);
    // A reason of the notebook's own files, such as a newer format, stays: only a backup always says so.
    if store.read_only.is_none() || read_only == Some(ReadOnlyReason::Backup) {
        store.read_only = read_only;
    }
    let writable = store.check_writable().is_ok();
    if writable {
        let _ = store.roll_forward();
    }
    let shared = Arc::new_cyclic(|me| NotebookShared {
        ctx: ctx.clone(),
        root: dir.to_path_buf(),
        identity,
        key: RwLock::new(key),
        id: RwLock::new(file.id),
        tree: Mutex::new(TreeState {
            store,
            undo: TreeUndo::default(),
        }),
        pages: Mutex::new(HashMap::new()),
        lock: Mutex::new(lock),
        closed: AtomicBool::new(false),
        deferred: Mutex::new(HashMap::new()),
        recovered: Mutex::new(Vec::new()),
        me: me.clone(),
    });
    if writable {
        shared.recover_pages(deadline);
        let _ = shared.tree().store.finish_pending();
    }
    shared.schedule_open_work();
    Ok(NotebookHandle { inner: shared })
}

/// Takes a notebook's lock, waiting until `deadline` for a previous run of this profile that is ending (spec
/// 20.3). Then it waits the same way for the tree journal's generations, which that run may let go of later,
/// unless this core opened that tree journal already. Their locks are kept while the tree journal reads them. A
/// generation still held at the deadline means no lock, as the ending run still holds the notebook.
#[allow(clippy::type_complexity)]
fn take_locks(
    ctx: &CoreCtx,
    (key, layout): (&NotebookKey, &NotebookLayout),
    remote: bool,
    deadline: Instant,
) -> Result<(Option<NotebookLock>, Option<Held>, Vec<Box<dyn FsLock>>), CoreError> {
    let fs = ctx.fs.as_ref();
    let lock = match lock_notebook(fs, &ctx.data, key, layout, (remote, deadline))? {
        Ok(lock) => lock,
        Err(held) => return Ok((None, Some(held), Vec::new())),
    };
    let opened_here = ctx
        .tree_journals
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains(key);
    let tree = (!opened_here)
        .then(|| ctx.backend.journals().ok())
        .flatten()
        .unwrap_or_default()
        .into_iter()
        .find(|k| &k.key == key)
        .map(|k| k.tree)
        .unwrap_or_default();
    let mut locks = Vec::new();
    for generation in &tree {
        // A generation gone since the listing holds nothing, and locking it would create it.
        if fs.metadata(generation).is_err() {
            continue;
        }
        match lock_until(fs, generation, deadline)? {
            Some(held) => locks.push(held),
            None => return Ok((None, Some(Held::Ending), Vec::new())),
        }
    }
    Ok((Some(lock), None, locks))
}

/// The header metadata of a notebook's journals (spec 20.5). `section` is the page's section for a page
/// journal, and `None` for the tree journal.
pub(crate) fn journal_meta(
    ctx: &CoreCtx,
    notebook: NotebookId,
    root: &Path,
    identity: crate::store::fs::FolderIdentity,
    section: Option<SectionId>,
) -> JournalMeta {
    JournalMeta {
        notebook,
        notebook_path: root.to_path_buf(),
        identity,
        section,
        app: ctx.writer.clone(),
        device: ctx.device().id,
        boot: ctx.boot.clone(),
        page_format: u16::try_from(crate::FORMAT_VERSION).unwrap_or(1),
    }
}

/// A notebook's tree journal, or a log in memory while the notebook is read-only or the journal can't be
/// written.
fn tree_log(ctx: &CoreCtx, (key, meta): (&NotebookKey, JournalMeta), writable: bool) -> Box<dyn IntentLog> {
    if !writable {
        return Box::new(MemIntentLog::new());
    }
    match ctx.backend.open_tree_journal(key, meta) {
        Ok(log) => {
            let mut opened = ctx.tree_journals.lock().unwrap_or_else(PoisonError::into_inner);
            opened.insert(key.clone());
            log
        }
        Err(_) => Box::new(MemIntentLog::new()),
    }
}

impl NotebookShared {
    /// Recovers every page of this notebook whose journal generations wait (spec 20.10), waiting until
    /// `deadline` for a generation that a previous run that is ending still holds (spec 20.3). Pages whose
    /// recovery has to wait open read-only.
    fn recover_pages(&self, deadline: Instant) {
        let Ok(journals) = self.ctx.backend.journals() else {
            return;
        };
        let key = self.key();
        let Some(ours) = journals.into_iter().find(|k| k.key == key) else {
            return;
        };
        let layout = NotebookLayout::new(&self.root);
        for (page, generations) in &ours.pages {
            let outcome = {
                let tree = self.tree();
                let locate = |id: PageId| tree.store.page_dir(id);
                let input = RecoverInput {
                    layout: &layout,
                    identity: &self.identity,
                    locate: &locate,
                    page: *page,
                    generations,
                    lock_until: deadline,
                };
                self.ctx.backend.recover_page(&input)
            };
            let outcome = outcome.unwrap_or(RecoveryOutcome::Deferred {
                reason: crate::session::events::DeferReason::PageUnavailable,
            });
            let waits = match outcome {
                RecoveryOutcome::OwnerAlive => Some(ReadOnlyReason::StillClosing),
                RecoveryOutcome::Deferred { .. } => Some(ReadOnlyReason::PendingJournal),
                _ => None,
            };
            match waits {
                Some(reason) => self.deferred().insert(*page, reason),
                None => self.deferred().remove(page),
            };
            self.recovered().push((*page, outcome));
        }
    }

    pub(crate) fn deferred(&self) -> std::sync::MutexGuard<'_, HashMap<PageId, ReadOnlyReason>> {
        self.deferred.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn recovered(&self) -> std::sync::MutexGuard<'_, Vec<(PageId, RecoveryOutcome)>> {
        self.recovered.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Queues what runs after the notebook is on screen: the scan and Trash expiry.
    fn schedule_open_work(&self) {
        let me = self.me.clone();
        let key = Some(format!("open:{}", self.root.display()));
        self.ctx
            .maintenance
            .after(self.ctx.clock.as_ref(), std::time::Duration::ZERO, key, move || {
                let Some(shared) = me.upgrade() else { return };
                let handle = NotebookHandle { inner: shared };
                let _ = handle.scan();
                let _ = handle.change(false, |t| t.store.purge_expired());
            });
    }

    /// Retries folder moves that failed because a file inside was held open.
    pub(crate) fn schedule_retry(&self) {
        let me = self.me.clone();
        let key = Some(format!("retry:{}", self.root.display()));
        self.ctx
            .maintenance
            .after(self.ctx.clock.as_ref(), RETRY_DELAY, key, move || {
                let Some(shared) = me.upgrade() else { return };
                let handle = NotebookHandle { inner: shared };
                let _ = handle.change(true, |t| t.store.finish_pending());
            });
    }

    /// Opens a page for a client. A page open in another window shares its session. A page closed recently
    /// comes back from memory if its file didn't change.
    pub(crate) fn open_page(&self, page: PageId, client: ClientId) -> Result<PageHandle, CoreError> {
        self.check_open()?;
        let existing = self.pages().get(&page).cloned();
        if let Some(session) = existing.filter(|s| !s.state().closed) {
            session.add_client(&client);
            return Ok(PageHandle { session, client });
        }
        let _pause = self.ctx.maintenance.pause();
        let (dir, read_only, encrypted, locked) = self.page_place(page)?;
        if locked {
            return Err(CoreError::ReadOnly(ReadOnlyReason::Encrypted));
        }
        let loaded = self.load_page(page, &dir)?;
        let opening = Opening {
            loaded,
            dir,
            read_only,
            encrypted,
        };
        let fresh = PageSession::new(self.ctx.clone(), self.me.clone(), opening);
        let session = {
            let mut pages = self.pages();
            let current = pages.get(&page).filter(|s| !s.state().closed).cloned();
            match current {
                Some(open) => open,
                None => {
                    pages.insert(page, fresh.clone());
                    fresh
                }
            }
        };
        self.ctx.register_session(&session);
        session.add_client(&client);
        Ok(PageHandle { session, client })
    }

    /// Where a shown page's folder is, and whether it opens read-only or is encrypted.
    fn page_place(&self, page: PageId) -> Result<(std::path::PathBuf, Option<ReadOnlyReason>, bool, bool), CoreError> {
        let tree = self.tree();
        let store = &tree.store;
        let section = store
            .section_of(page)
            .filter(|_| !store.hidden.contains(&page.0))
            .ok_or_else(|| CoreError::NotFound(format!("page {page}")))?;
        let state = store.section(section)?;
        let dir = store
            .page_dir(page)
            .ok_or_else(|| CoreError::NotFound(format!("page {page}")))?;
        let mut read_only = store.read_only.clone();
        if let Some(reason) = self.deferred().get(&page) {
            read_only.get_or_insert(reason.clone());
        }
        Ok((dir, read_only, state.encrypted(), state.locked()))
    }

    fn load_page(&self, page: PageId, dir: &Path) -> Result<LoadedPage, CoreError> {
        let closed = self.ctx.closed_pages().take(&(self.key(), page));
        if let Some(closed) = closed {
            if self.ctx.backend.fingerprint(dir).ok().flatten() == Some(closed.loaded.stamp) {
                return Ok(closed.loaded);
            }
        }
        self.ctx
            .backend
            .load(dir)
            .map_err(|e| crate::store::notebook_store::load_failed(page, e))
    }

    /// Gives a copied notebook a new notebook ID, so it no longer shares journals, locks, and caches with
    /// the original (spec 20.2). Its pages must be closed, and it must hold its lock. A copy opens read-only, so
    /// its journals from an earlier run are recovered first, and it refuses while any of them still waits: the
    /// new key would leave them behind.
    pub(crate) fn make_separate(&self) -> Result<NotebookId, CoreError> {
        self.check_open()?;
        if !self.pages().is_empty() {
            return Err(CoreError::Conflict("close the notebook's pages first".into()));
        }
        let reason = self.tree().store.read_only.clone();
        let locked = self.lock.lock().unwrap_or_else(PoisonError::into_inner).is_some();
        match reason {
            Some(reason) if !locked || reason != ReadOnlyReason::LockedElsewhere => {
                return Err(CoreError::ReadOnly(reason));
            }
            _ => {}
        }
        self.recover_pages(Instant::now());
        let mut tree = self.tree();
        if !self.pages().is_empty() {
            return Err(CoreError::Conflict("close the notebook's pages first".into()));
        }
        if self.journals_wait(&tree) {
            return Err(CoreError::ReadOnly(ReadOnlyReason::PendingJournal));
        }
        let id = NotebookId::generate(self.ctx.clock.as_ref());
        tree.store.notebook.id = id;
        tree.store.write_notebook()?;
        let key = notebook_key(id, &self.identity);
        let layout = NotebookLayout::new(&self.root);
        let remote = self.ctx.fs.volume(&self.root).is_ok_and(|v| v.remote);
        let lock = lock_notebook(
            self.ctx.fs.as_ref(),
            &self.ctx.data,
            &key,
            &layout,
            (remote, Instant::now()),
        )?
        .ok();
        tree.store.read_only = lock.is_none().then_some(ReadOnlyReason::LockedElsewhere);
        tree.store.notices.retain(|n| n.code != "notebook.sameId");
        tree.store.cache = PageCache::load(self.ctx.fs.as_ref(), &self.ctx.data, &key);
        *self.lock.lock().unwrap_or_else(PoisonError::into_inner) = lock;
        *self.id.write().unwrap_or_else(PoisonError::into_inner) = id;
        *self.key.write().unwrap_or_else(PoisonError::into_inner) = key;
        let writable = tree.store.read_only.is_none();
        let meta = journal_meta(&self.ctx, id, &self.root, self.identity, None);
        tree.store.log = tree_log(&self.ctx, (&self.key(), meta), writable);
        drop(tree);
        self.tree_changed();
        Ok(id)
    }

    /// Whether this notebook's key still has page journal generations, or tree intents that aren't done.
    fn journals_wait(&self, tree: &TreeState) -> bool {
        let key = self.key();
        let Ok(journals) = self.ctx.backend.journals() else {
            return true;
        };
        if journals.iter().any(|k| k.key == key && !k.pages.is_empty()) {
            return true;
        }
        if tree.store.read_only.is_none() {
            return !tree.store.log.unfinished().is_empty();
        }
        // A copy that opened read-only kept its tree journal closed.
        let meta = journal_meta(&self.ctx, self.id(), &self.root, self.identity, None);
        self.ctx
            .backend
            .open_tree_journal(&key, meta)
            .map_or(true, |log| !log.unfinished().is_empty())
    }

    /// Saves and closes every page, writes the cache, and releases the lock.
    pub(crate) fn close(&self) -> Result<(), CoreError> {
        if self.closed.load(Ordering::SeqCst) {
            return Ok(());
        }
        let mut first_error = None;
        for session in self.sessions() {
            if let Err(e) = session.finish(Why::Close) {
                first_error.get_or_insert(e);
            }
        }
        self.closed.store(true, Ordering::SeqCst);
        let _ = self.tree().store.cache.save(self.ctx.fs.as_ref());
        // A closing notebook locks its protected sections: their keys and journals leave memory (ADR 0042).
        if let Some(sealed) = self.ctx.fs.sealed() {
            sealed.lock_under(&self.root);
        }
        self.ctx.closed_pages().forget_notebook(&self.key());
        *self.lock.lock().unwrap_or_else(PoisonError::into_inner) = None;
        self.ctx.forget_notebook(&self.root);
        first_error.map_or(Ok(()), Err)
    }
}

impl PageSession {
    /// Adds a client, or one more handle of a client.
    pub(crate) fn add_client(&self, client: &ClientId) {
        let mut st = self.state();
        let entry = st.clients.entry(client.clone()).or_default();
        entry.opens = entry.opens.saturating_add(1);
        st.used = self.ctx.clock.monotonic();
    }
}

/// How long a folder move held open waits before it tries again.
const RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(2);
