//! The running core: configuration, threads, notebooks, and flushing on exit (plan 9 and 10). Owned by WP5.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;

use crate::error::{CoreError, FsErrorKind};
use crate::id::PageId;
use crate::limits::{Limits, Timings};
use crate::model::DeviceRef;
use crate::seams::{Applier, Codec};
use crate::session::events::{EventSink, IndexSink, RecoveryReport};
use crate::session::notebook::NotebookHandle;
use crate::store::fs::Fs;
use crate::time::Clock;

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
    pub fn production(_data_dir: PathBuf, _app_version: String) -> Result<CoreConfig, CoreError> {
        unimplemented!("WP5: CoreConfig::production")
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

/// The running core. Cloning shares it.
#[derive(Clone)]
pub struct Core {
    _inner: Arc<()>,
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
        _config: CoreConfig,
        _events: Arc<dyn EventSink>,
        _index: Option<Arc<dyn IndexSink>>,
    ) -> Result<Core, CoreError> {
        unimplemented!("WP5: Core::start")
    }

    /// Recovers waiting journals: the notebook at `first` at once, the others in the background.
    pub fn recover_pending(&self, _first: Option<&Path>) -> Result<RecoveryReport, CoreError> {
        unimplemented!("WP5: Core::recover_pending")
    }

    /// Creates a notebook folder under `parent_dir`, named from `title` (spec 3.4).
    pub fn create_notebook(&self, _parent_dir: &Path, _title: &str) -> Result<NotebookHandle, CoreError> {
        unimplemented!("WP5: Core::create_notebook")
    }

    /// Opens the notebook at `dir`: its lock, recovery, the scan, and the tree.
    pub fn open_notebook(&self, _dir: &Path) -> Result<NotebookHandle, CoreError> {
        unimplemented!("WP5: Core::open_notebook")
    }

    /// Flushes every journal, for suspend and shutdown.
    pub fn flush_journals(&self, _timeout: Duration) -> Result<(), CoreError> {
        unimplemented!("WP5: Core::flush_journals")
    }

    /// Saves every dirty page and closes every journal, within `timeout`.
    pub fn flush_all(&self, _timeout: Duration) -> Result<FlushReport, CoreError> {
        unimplemented!("WP5: Core::flush_all")
    }

    /// Sets this device's label in `device.json`.
    pub fn set_device_label(&self, _label: &str) -> Result<(), CoreError> {
        unimplemented!("WP5: Core::set_device_label")
    }

    /// The core's memory use.
    pub fn memory(&self) -> MemoryReport {
        unimplemented!("WP5: Core::memory")
    }
}
