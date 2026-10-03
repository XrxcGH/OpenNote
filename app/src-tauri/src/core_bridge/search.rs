//! Search and linking for the interface (Phase 8; crates/search). One command, `search_call`, carries every
//! method, so the app's command list, the handler list, and the capability file each gain one line.
//!
//! The index follows the core the bridge starts. The core's save hook and events feed it, and it reads pages and
//! their titles from the notebooks the core has open, which are the notebook folders in the notes folder. The
//! interface's page IDs are the core's, so nothing maps between them, and the interface sends the index nothing.
//! The bridge tells the hub which notebooks are open after every notes command, so a notebook that opens (made,
//! restored, imported, or found in a copied notes folder) is indexed and a notebook that closes leaves the index.
//! The index file is a cache on this device (`search.db` beside the core's data), and the next start builds it
//! again if it is gone.

mod args;
mod calls;
mod events;
mod extras;
#[cfg(test)]
mod tests;

use std::{
    collections::BTreeSet,
    path::Path,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use opennote_core::{
    session::{core::Core, events::IndexSink},
    NotebookId, PageId,
};
use opennote_search::{
    BackgroundIndexer, CorePageSource, CoreSlot, IndexerConfig, IndexerHandle, SearchError, SearchIndex, SharedIndex,
    Switcher,
};
use serde_json::Value;
use tauri::{AppHandle, State};

use self::events::announce;
use super::{CoreBridge, Relay};
use crate::ipc::{codes, IpcError, IpcResult};

/// The event that tells the interface what the index changed.
pub const UPDATED_EVENT: &str = "search:updated";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn lock_index(index: &SharedIndex) -> MutexGuard<'_, SearchIndex> {
    index.lock().unwrap_or_else(PoisonError::into_inner)
}

fn internal(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::INTERNAL, error.to_string())
}

fn invalid(field: &str, error: impl std::fmt::Display) -> IpcError {
    IpcError::invalid(field, &error.to_string())
}

fn search_error(error: SearchError) -> IpcError {
    match error {
        SearchError::Pattern(message) => IpcError::invalid("pattern", &message),
        other => internal(other),
    }
}

struct Run {
    /// Taken at close.
    indexer: Option<BackgroundIndexer>,
    handle: IndexerHandle,
    /// The notebooks the indexer has been told are open. `None` until the first start.
    open: Option<BTreeSet<NotebookId>>,
}

/// The index, the way the bridge reaches it. The bridge owns one; its commands go through it.
#[derive(Default)]
pub(super) struct Hub {
    run: Mutex<Option<Run>>,
    slot: CoreSlot,
    switcher: Mutex<Switcher>,
}

impl Hub {
    /// Opens the index file and starts the indexer, before the core starts, because the core's save hook and
    /// events need its handle. A file that can't be opened leaves an index in memory, which the next start builds
    /// again, so search still works.
    pub(super) fn spawn(&self, root: &Path, relay: &Arc<Relay>) -> Result<IndexerHandle, IpcError> {
        let mut run = lock(&self.run);
        if let Some(run) = run.as_ref() {
            return Ok(run.handle.clone());
        }
        let index = SearchIndex::open(&root.join("search.db"))
            .or_else(|error| {
                ::log::warn!("The search index file couldn't be opened, so search starts empty: {error}");
                SearchIndex::open_in_memory()
            })
            .map_err(internal)?;
        let source = CorePageSource::production(self.slot.clone());
        let observer = {
            let relay = relay.clone();
            Box::new(move |event| announce(&relay, event))
        };
        let indexer = BackgroundIndexer::spawn(index, source, IndexerConfig::default(), Some(observer));
        let handle = indexer.handle();
        let _ = relay.index.set(handle.clone());
        *run = Some(Run {
            indexer: Some(indexer),
            handle: handle.clone(),
            open: None,
        });
        Ok(handle)
    }

    /// The hook the core calls after each save.
    pub(super) fn sink(&self) -> Option<Arc<dyn IndexSink>> {
        let handle = lock(&self.run).as_ref().map(|run| run.handle.clone())?;
        Some(Arc::new(handle))
    }

    /// The core is running: the indexer may read its notebooks.
    pub(super) fn attach(&self, core: &Core) {
        self.slot.set(core.clone());
    }

    /// Tells the indexer which notebooks are open. The first call starts the index with them, which drops any
    /// notebook the index holds that is not open and compares the rest with the files. Later calls reconcile a
    /// notebook that opened and drop one that closed. A backup notebook is not indexed.
    pub(super) fn notebooks_changed(&self, core: &Core) {
        // Safe mode turns the index's background work off (Phase 13): nothing is indexed while it is on.
        if crate::hardening::safe_mode() {
            return;
        }
        let now: BTreeSet<NotebookId> = core
            .notebooks()
            .into_iter()
            .filter(|notebook| !notebook.is_backup())
            .map(|notebook| notebook.id())
            .collect();
        let mut run = lock(&self.run);
        let Some(run) = run.as_mut() else {
            return;
        };
        match &run.open {
            None => run.handle.start(now.iter().copied().collect()),
            Some(before) => {
                for closed in before.difference(&now) {
                    run.handle.notebook_closed(*closed);
                }
                for opened in now.difference(before) {
                    run.handle.tree_changed(*opened);
                }
            }
        }
        run.open = Some(now);
    }

    /// Finishes the waiting jobs for a moment and closes the index file cleanly. The app calls it on exit.
    pub(super) fn close(&self) {
        let indexer = lock(&self.run).as_mut().and_then(|run| run.indexer.take());
        if let Some(indexer) = indexer {
            if let Err(error) = indexer.close() {
                ::log::warn!("The search index didn't close cleanly: {error}");
            }
        }
    }

    fn handle(&self) -> IpcResult<(IndexerHandle, Vec<NotebookId>)> {
        lock(&self.run)
            .as_ref()
            .map(|run| {
                let open = run.open.iter().flatten().copied().collect();
                (run.handle.clone(), open)
            })
            .ok_or_else(|| internal("The search index isn't running."))
    }

    fn core_page(&self, page: &str) -> IpcResult<PageId> {
        PageId::parse(page).map_err(|error| invalid("page", error))
    }

    /// Runs one method of the interface's search client.
    pub(super) fn call(&self, method: &str, args: Value) -> IpcResult<Value> {
        let (handle, notebooks) = self.handle()?;
        self.dispatch(&handle, &notebooks, method, &args)
    }
}

/// One method of the search client.
#[tauri::command]
pub async fn search_call(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    method: String,
    args: Value,
) -> IpcResult<Value> {
    bridge.listen_app(&app);
    // The first call starts the core, because the index follows it.
    bridge.with(|_| Ok(()))?;
    let hub = bridge.search.clone();
    hub.call(&method, args)
}
