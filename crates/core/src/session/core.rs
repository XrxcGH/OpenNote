//! The running core: configuration, threads, notebooks, and flushing on exit (plan 9 and 10). Owned by WP5.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{CoreError, FsErrorKind};
use crate::format::CanonicalCodec;
use crate::id::{NotebookId, PageId};
use crate::limits::{Limits, Timings};
use crate::model::DeviceRef;
use crate::ops::apply::OpsApplier;
use crate::seams::{Applier, Codec};
use crate::session::autosave::Saver;
use crate::session::backend::{Backend, StoreBackend, StoreConfig};
use crate::session::budget::ClosedPages;
use crate::session::events::{CoreEvent, EventSink, IndexSink, RecoveryReport, WaitingJournal};
use crate::session::library::{same_path, Library, LibraryEntry};
use crate::session::maintenance::Maintenance;
use crate::session::notebook::open::OpenAs;
use crate::session::notebook::{open_notebook, NotebookHandle};
use crate::session::page::save::Why;
use crate::store::fs::Fs;
use crate::store::history::Retention;
use crate::store::layout::{DataLayout, NotebookLayout};
use crate::store::notebook_store::{
    convert_to_notebook, create_notebook, read_notebook_file, CanonicalFormats, TreeFormats,
};
use crate::store::std_fs::StdFs;
use crate::time::{Clock, SystemClock};

pub(crate) mod ctx;
pub(crate) mod device;
mod library_api;
#[cfg(test)]
mod tests;

pub(crate) use ctx::CoreCtx;
pub use library_api::{LibraryInfo, LibraryNotebook};

const MIB: usize = 1024 * 1024;

/// What the core runs with.
#[derive(Clone)]
pub struct CoreConfig {
    /// The device-local data folder (spec 20.1).
    pub data_dir: PathBuf,
    /// This device.
    pub device: DeviceRef,
    /// The app version, for revisions' `writer`.
    pub app_version: String,
    /// The file system.
    pub fs: Arc<dyn Fs>,
    /// The codec.
    pub codec: Arc<dyn Codec>,
    /// The applier.
    pub applier: Arc<dyn Applier>,
    /// The clock.
    pub clock: Arc<dyn Clock>,
    /// Reader limits.
    pub limits: Limits,
    /// Save and journal timings.
    pub timings: Timings,
    /// Memory caps.
    pub caps: MemoryCaps,
}

impl CoreConfig {
    /// `StdFs`, `CanonicalCodec`, `OpsApplier`, `SystemClock`, and the device from `device.json`.
    pub fn production(data_dir: PathBuf, app_version: String) -> Result<CoreConfig, CoreError> {
        let timings = Timings::default();
        let fs: Arc<dyn Fs> = Arc::new(StdFs::new(&timings));
        let clock: Arc<dyn Clock> = Arc::new(SystemClock::new());
        let device = device::load_or_create(fs.as_ref(), &DataLayout::new(&data_dir), clock.as_ref())?;
        Ok(CoreConfig {
            data_dir,
            device,
            app_version,
            fs,
            codec: Arc::new(CanonicalCodec),
            applier: Arc::new(OpsApplier),
            clock,
            limits: Limits::default(),
            timings,
            caps: MemoryCaps::default(),
        })
    }
}

/// Memory caps of the core (plan 10.2), in bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MemoryCaps {
    /// Recently closed clean pages kept for instant reopening.
    pub closed_pages: usize,
    /// Undo stacks of all pages together.
    pub undo: usize,
    /// Asset bytes cached for the asset protocol.
    pub asset_cache: usize,
    /// Journal and save buffers.
    pub journal_buffers: usize,
}

impl Default for MemoryCaps {
    fn default() -> MemoryCaps {
        MemoryCaps {
            closed_pages: 24 * MIB,
            undo: 24 * MIB,
            asset_cache: 8 * MIB,
            journal_buffers: 8 * MIB,
        }
    }
}

/// How the core does work that can wait: on its own threads, or when the embedder asks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkMode {
    /// The saver and maintenance threads run on their own. The app uses this.
    Threads,
    /// Nothing runs until [`Core::run_pending_work`], so tests and tools control time.
    Manual,
}

/// The running core. Cloning shares it.
#[derive(Clone)]
pub struct Core {
    inner: Arc<CoreInner>,
}

struct CoreInner {
    ctx: Arc<CoreCtx>,
    library: Mutex<Library>,
    mode: WorkMode,
    unclean_exit: bool,
    stopped: AtomicBool,
}

impl Drop for CoreInner {
    fn drop(&mut self) {
        self.ctx.saver.stop();
        self.ctx.maintenance.stop();
    }
}

/// What `flush_all` did.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlushReport {
    /// Pages saved.
    pub saved: u32,
    /// Pages whose save failed. Their journals stay for the next start.
    pub failed: Vec<(PageId, FsErrorKind)>,
    /// Whether the time limit ran out.
    pub timed_out: bool,
}

/// The core's memory use (plan 10.2), in bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryReport {
    /// Open page sessions.
    pub open_pages: usize,
    /// Recently closed pages.
    pub closed_pages: usize,
    /// Undo stacks.
    pub undo: usize,
    /// Cached asset bytes.
    pub asset_cache: usize,
    /// Journal and save buffers.
    pub journal_buffers: usize,
}

impl Core {
    /// Reads `device.json` and starts the journal, saver, and maintenance threads.
    pub fn start(
        config: CoreConfig,
        events: Arc<dyn EventSink>,
        index: Option<Arc<dyn IndexSink>>,
    ) -> Result<Core, CoreError> {
        let boot = config.fs.boot_id().unwrap_or_default();
        let store = StoreConfig {
            fs: config.fs.clone(),
            codec: config.codec.clone(),
            applier: config.applier.clone(),
            clock: config.clock.clone(),
            limits: config.limits.clone(),
            timings: config.timings.clone(),
            device: config.device.clone(),
            writer: writer(&config.app_version),
            data: DataLayout::new(&config.data_dir),
            boot,
        };
        let backend = Arc::new(StoreBackend::start(store, events.clone())?);
        let parts = CoreParts {
            backend,
            formats: Arc::new(CanonicalFormats),
            mode: WorkMode::Threads,
        };
        Core::start_with(config, events, index, parts)
    }

    /// Starts a core on a chosen backend and formats, such as the in-memory backend of tests and benchmarks.
    pub fn start_with(
        config: CoreConfig,
        events: Arc<dyn EventSink>,
        index: Option<Arc<dyn IndexSink>>,
        parts: CoreParts,
    ) -> Result<Core, CoreError> {
        let data = DataLayout::new(&config.data_dir);
        let unclean_exit = device::mark_running(config.fs.as_ref(), &data, config.clock.now());
        let library = Library::load(config.fs.as_ref(), &data);
        let ctx = Arc::new(CoreCtx {
            boot: config.fs.boot_id().unwrap_or_default(),
            writer: writer(&config.app_version),
            fs: config.fs,
            codec: config.codec,
            applier: config.applier,
            clock: config.clock,
            limits: config.limits,
            timings: config.timings,
            caps: config.caps,
            data,
            backend: parts.backend,
            formats: parts.formats,
            events,
            index,
            device: RwLock::new(config.device),
            saver: Arc::new(Saver::default()),
            maintenance: Arc::new(Maintenance::default()),
            closed: Mutex::new(ClosedPages::new(config.caps.closed_pages)),
            notebooks: Mutex::new(Vec::new()),
            sessions: Mutex::new(Vec::new()),
            undo_bytes: AtomicUsize::new(0),
            serial: AtomicU64::new(0),
            retention: RwLock::new(Retention::default()),
        });
        if parts.mode == WorkMode::Threads {
            ctx.saver.start(ctx.clock.clone());
            ctx.maintenance.start(ctx.clock.clone());
        }
        Ok(Core {
            inner: Arc::new(CoreInner {
                ctx,
                library: Mutex::new(library),
                mode: parts.mode,
                unclean_exit,
                stopped: AtomicBool::new(false),
            }),
        })
    }

    pub(crate) fn ctx(&self) -> &Arc<CoreCtx> {
        &self.inner.ctx
    }

    fn library_mut(&self) -> MutexGuard<'_, Library> {
        self.inner.library.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether the last run of the app ended without a clean exit, for the start-up message.
    pub fn unclean_exit(&self) -> bool {
        self.inner.unclean_exit
    }

    /// Recovers waiting journals: the notebook at `first` at once, the others in the background.
    pub fn recover_pending(&self, first: Option<&Path>) -> Result<RecoveryReport, CoreError> {
        let mut report = RecoveryReport::default();
        if let Some(dir) = first {
            let notebook = self.open_notebook(dir)?;
            report.pages = notebook.inner.recovered().clone();
        }
        let open: Vec<_> = self.inner.ctx.notebooks().iter().map(|n| n.key()).collect();
        let library = self.library_mut().entries().to_vec();
        for keyed in self.inner.ctx.backend.journals()? {
            if open.contains(&keyed.key) {
                continue;
            }
            let id = keyed
                .key
                .0
                .get(..26)
                .and_then(|t| NotebookId::parse(t).ok())
                .unwrap_or_default();
            let entry = library.iter().find(|e| e.notebook == id);
            report.waiting.push(WaitingJournal {
                notebook: id,
                notebook_path: entry.map(|e| e.path.clone()).unwrap_or_default(),
                pages: u32::try_from(keyed.pages.len()).unwrap_or(u32::MAX),
                since: self.inner.ctx.clock.now(),
            });
            if let Some(entry) = entry {
                self.recover_in_background(entry.path.clone());
            }
        }
        self.inner.ctx.events.emit(CoreEvent::Recovered(report.clone()));
        Ok(report)
    }

    /// Opens a notebook in the background, which recovers its journals, and closes it again unless someone
    /// opened it meanwhile.
    fn recover_in_background(&self, path: PathBuf) {
        let core = Arc::downgrade(&self.inner);
        self.inner
            .ctx
            .maintenance
            .after(self.inner.ctx.clock.as_ref(), Duration::ZERO, None, move || {
                let Some(inner) = core.upgrade() else { return };
                let core = Core { inner };
                let was_open = core.find_open(&path).is_some();
                if let Ok(notebook) = core.open_notebook(&path) {
                    if !was_open {
                        let _ = notebook.close();
                    }
                }
            });
    }

    /// Creates a notebook folder under `parent_dir`, named from `title` (spec 3.4), and adds it to the library.
    pub fn create_notebook(&self, parent_dir: &Path, title: &str) -> Result<NotebookHandle, CoreError> {
        let env = self.inner.ctx.tree_env();
        let dir = create_notebook(&env, parent_dir, title)?;
        self.open_notebook(&dir)
    }

    /// Turns an existing folder into a notebook where it is, then opens it. Nothing else in the folder changes.
    pub fn convert_folder(&self, dir: &Path, title: &str) -> Result<NotebookHandle, CoreError> {
        let env = self.inner.ctx.tree_env();
        convert_to_notebook(&env, dir, title)?;
        self.open_notebook(dir)
    }

    /// Opens the notebook at `dir`: its lock, recovery, the scan, and the tree. A notebook already open
    /// returns the same handle. The notebook joins the library.
    pub fn open_notebook(&self, dir: &Path) -> Result<NotebookHandle, CoreError> {
        if let Some(open) = self.find_open(dir) {
            return Ok(open);
        }
        let ctx = &self.inner.ctx;
        let file = read_notebook_file(&ctx.tree_env(), &NotebookLayout::new(dir))?;
        let copy_of_open = ctx.notebooks().iter().any(|n| n.id() == file.id && !n.is_backup());
        let handle = open_notebook(ctx, dir, &OpenAs { copy_of_open })?;
        ctx.notebooks
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(handle.inner.clone());
        // A backup set shares its notebook's ID, so listing it would replace the notebook in the library.
        if handle.is_backup() {
            return Ok(handle);
        }
        let entry = LibraryEntry {
            path: dir.to_path_buf(),
            notebook: file.id,
            title: file.title,
        };
        let fs = ctx.fs.clone();
        self.library_mut().add(fs.as_ref(), entry, None)?;
        Ok(handle)
    }

    /// The open notebook at `dir`, if it is open.
    pub fn find_open(&self, dir: &Path) -> Option<NotebookHandle> {
        self.inner
            .ctx
            .notebooks()
            .into_iter()
            .find(|n| same_path(&n.root, dir))
            .map(|inner| NotebookHandle { inner })
    }

    /// Every open notebook.
    pub fn notebooks(&self) -> Vec<NotebookHandle> {
        self.inner
            .ctx
            .notebooks()
            .into_iter()
            .map(|inner| NotebookHandle { inner })
            .collect()
    }

    /// Flushes every journal, for suspend and shutdown.
    pub fn flush_journals(&self, timeout: Duration) -> Result<(), CoreError> {
        Ok(self.inner.ctx.backend.flush_journals(timeout)?)
    }

    /// Saves every dirty page and closes every journal, within `timeout`. The shell calls it on exit with a
    /// 5-second limit. Pages that couldn't save keep their journals for the next start (plan 9.3).
    pub fn flush_all(&self, timeout: Duration) -> Result<FlushReport, CoreError> {
        let deadline = Instant::now().checked_add(timeout);
        let mut report = FlushReport::default();
        let ctx = &self.inner.ctx;
        let _ = ctx.backend.flush_journals(timeout);
        for session in ctx.live_sessions() {
            if deadline.is_some_and(|d| Instant::now() >= d) {
                report.timed_out = true;
                break;
            }
            match session.save(Why::Exit) {
                Ok(Some(_)) => report.saved = report.saved.saturating_add(1),
                Ok(None) => {}
                Err(e) => report.failed.push((session.id, error_kind(&e))),
            }
            session.close_journal();
        }
        if report.failed.is_empty() && !report.timed_out {
            device::mark_stopped(ctx.fs.as_ref(), &ctx.data, ctx.clock.now());
        }
        Ok(report)
    }

    /// Stops the saver and maintenance threads and the journal, after `flush_all`.
    pub fn shutdown(&self, timeout: Duration) {
        if self.inner.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        self.inner.ctx.saver.stop();
        self.inner.ctx.maintenance.stop();
        self.inner.ctx.backend.shutdown(timeout);
    }

    /// This device.
    pub fn device(&self) -> DeviceRef {
        self.inner.ctx.device()
    }

    /// Sets this device's label in `device.json`.
    pub fn set_device_label(&self, label: &str) -> Result<(), CoreError> {
        let ctx = &self.inner.ctx;
        let mut device = ctx.device();
        label.trim().clone_into(&mut device.label);
        if device.label.is_empty() {
            device.label = device::default_label(device.id);
        }
        device::save(ctx.fs.as_ref(), &ctx.data, &device)?;
        *ctx.device.write().unwrap_or_else(PoisonError::into_inner) = device;
        Ok(())
    }

    /// Sets how long page versions are kept (`settings.editing.history.keep`, spec 13.3). Versions are thinned
    /// to it when a page is tidied after it closes, so a shorter time takes effect page by page.
    pub fn set_retention(&self, keep: Retention) {
        *self.inner.ctx.retention.write().unwrap_or_else(PoisonError::into_inner) = keep;
    }

    /// How long page versions are kept.
    pub fn retention(&self) -> Retention {
        self.inner.ctx.retention()
    }

    /// The core's memory use.
    pub fn memory(&self) -> MemoryReport {
        let ctx = &self.inner.ctx;
        MemoryReport {
            open_pages: ctx.open_page_bytes(),
            closed_pages: ctx.closed_pages().bytes(),
            undo: ctx.undo_bytes.load(Ordering::SeqCst),
            asset_cache: 0,
            journal_buffers: 0,
        }
    }

    /// Runs the saves and maintenance jobs that are due, for a core started with [`WorkMode::Manual`].
    /// Returns how many ran. With threads, it runs nothing, because the threads do the work.
    pub fn run_pending_work(&self) -> u32 {
        if self.inner.mode == WorkMode::Threads {
            return 0;
        }
        let ctx = &self.inner.ctx;
        let mut ran: u32 = 0;
        loop {
            let step = ctx
                .saver
                .run_due(ctx.clock.as_ref())
                .saturating_add(ctx.maintenance.run_due(ctx.clock.as_ref()));
            if step == 0 {
                return ran;
            }
            ran = ran.saturating_add(step);
        }
    }

    /// Whether any change isn't saved yet, including after a failed save.
    pub fn has_unsaved(&self) -> bool {
        self.inner.ctx.live_sessions().iter().any(|s| s.state().dirty.is_some())
    }
}

/// The parts of a core that differ between the app and tests.
pub struct CoreParts {
    /// The storage behind sessions.
    pub backend: Arc<dyn Backend>,
    /// The format functions outside the codec.
    pub formats: Arc<dyn TreeFormats>,
    /// How work that can wait runs.
    pub mode: WorkMode,
}

/// The writer string of revisions (spec 5.3).
fn writer(app_version: &str) -> String {
    format!("OpenNote {app_version} ({})", std::env::consts::OS)
}

/// The error kind the flush report lists.
fn error_kind(error: &CoreError) -> FsErrorKind {
    match error {
        CoreError::Fs(e) => e.kind,
        CoreError::ReadOnly(_) => FsErrorKind::ReadOnlyFile,
        _ => FsErrorKind::Io,
    }
}
