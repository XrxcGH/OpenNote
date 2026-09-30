//! What every notebook and page of a running core shares. That is the seams, the settings, both work queues,
//! the memory budgets, and the registry of open notebooks and pages.

use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, Weak};

use super::MemoryCaps;
use crate::limits::{Limits, Policy, Timings};
use crate::model::DeviceRef;
use crate::seams::{Applier, Codec};
use crate::session::autosave::Saver;
use crate::session::backend::Backend;
use crate::session::budget::{page_bytes, ClosedPages};
use crate::session::events::{EventSink, IndexSink};
use crate::session::library::same_path;
use crate::session::maintenance::Maintenance;
use crate::session::notebook::NotebookShared;
use crate::session::page::PageSession;
use crate::store::fs::Fs;
use crate::store::layout::DataLayout;
use crate::store::notebook_store::{TreeEnv, TreeFormats};
use crate::time::Clock;

/// The shared context of a running core.
pub(crate) struct CoreCtx {
    pub(crate) fs: Arc<dyn Fs>,
    pub(crate) codec: Arc<dyn Codec>,
    pub(crate) applier: Arc<dyn Applier>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) limits: Limits,
    pub(crate) timings: Timings,
    pub(crate) caps: MemoryCaps,
    pub(crate) data: DataLayout,
    pub(crate) backend: Arc<dyn Backend>,
    pub(crate) formats: Arc<dyn TreeFormats>,
    pub(crate) events: Arc<dyn EventSink>,
    pub(crate) index: Option<Arc<dyn IndexSink>>,
    pub(crate) device: RwLock<DeviceRef>,
    /// The app and version, such as `OpenNote 0.4.0 (windows)`.
    pub(crate) writer: String,
    pub(crate) boot: String,
    pub(crate) saver: Arc<Saver>,
    pub(crate) maintenance: Arc<Maintenance>,
    pub(crate) closed: Mutex<ClosedPages>,
    pub(crate) notebooks: Mutex<Vec<Arc<NotebookShared>>>,
    pub(crate) sessions: Mutex<Vec<Weak<PageSession>>>,
    pub(crate) undo_bytes: AtomicUsize,
    pub(crate) serial: AtomicU64,
}

impl CoreCtx {
    /// This device.
    pub(crate) fn device(&self) -> DeviceRef {
        self.device.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// A new serial number for a page session.
    pub(crate) fn next_serial(&self) -> u64 {
        self.serial.fetch_add(1, Ordering::Relaxed).saturating_add(1)
    }

    /// What tree code works with.
    pub(crate) fn tree_env(&self) -> Arc<TreeEnv> {
        Arc::new(TreeEnv {
            fs: self.fs.clone(),
            codec: self.codec.clone(),
            formats: self.formats.clone(),
            clock: self.clock.clone(),
            limits: self.limits.clone(),
            timings: self.timings.clone(),
            policy: Policy::default(),
            device: self.device(),
            writer: self.writer.clone(),
        })
    }

    /// The cache of recently closed clean pages.
    pub(crate) fn closed_pages(&self) -> MutexGuard<'_, ClosedPages> {
        self.closed.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The open notebooks.
    pub(crate) fn notebooks(&self) -> Vec<Arc<NotebookShared>> {
        self.notebooks.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Forgets a notebook that closed.
    pub(crate) fn forget_notebook(&self, root: &Path) {
        self.notebooks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|n| !same_path(&n.root, root));
    }

    /// Adds a page session to the registry that the memory report and the undo budget walk.
    pub(crate) fn register_session(&self, session: &Arc<PageSession>) {
        let mut sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions.retain(|s| s.strong_count() > 0);
        sessions.push(Arc::downgrade(session));
    }

    /// Every live page session.
    pub(crate) fn live_sessions(&self) -> Vec<Arc<PageSession>> {
        let sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions
            .iter()
            .filter_map(Weak::upgrade)
            .filter(|s| !s.state().closed)
            .collect()
    }

    /// Charges or refunds bytes of the shared undo budget.
    pub(crate) fn charge_undo(&self, delta: isize) {
        if delta >= 0 {
            self.undo_bytes.fetch_add(delta.unsigned_abs(), Ordering::SeqCst);
        } else {
            self.release_undo(delta.unsigned_abs());
        }
    }

    /// Refunds bytes of the shared undo budget.
    pub(crate) fn release_undo(&self, bytes: usize) {
        let _ = self
            .undo_bytes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| Some(v.saturating_sub(bytes)));
    }

    /// Keeps undo stacks within their shared budget: over it, the oldest entries of the least recently used
    /// page go first (plan 7.3). Each page is locked on its own, so this never waits while holding a page.
    pub(crate) fn enforce_undo_budget(&self) {
        if self.undo_bytes.load(Ordering::SeqCst) <= self.caps.undo {
            return;
        }
        let mut sessions: Vec<(std::time::Duration, Arc<PageSession>)> = self
            .live_sessions()
            .into_iter()
            .map(|s| (s.state().used, s.clone()))
            .collect();
        sessions.sort_by_key(|(used, _)| *used);
        for (_, session) in sessions {
            let over = self.undo_bytes.load(Ordering::SeqCst).saturating_sub(self.caps.undo);
            if over == 0 {
                break;
            }
            let mut st = session.state();
            let mut freed: usize = 0;
            for client in st.clients.values_mut() {
                if let Some(stack) = client.undo.as_mut() {
                    freed = freed.saturating_add(stack.drop_oldest(over.saturating_sub(freed)));
                }
            }
            st.undo_bytes = st.undo_bytes.saturating_sub(freed);
            drop(st);
            self.release_undo(freed);
        }
    }

    /// Bytes the open pages take, by estimate.
    pub(crate) fn open_page_bytes(&self) -> usize {
        self.live_sessions()
            .iter()
            .map(|s| {
                let st = s.state();
                page_bytes(&st.page, st.bytes.len())
            })
            .fold(0, usize::saturating_add)
    }
}
