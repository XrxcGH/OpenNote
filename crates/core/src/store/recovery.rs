//! Crash recovery of one page from its journal generations (spec 20.10 and 20.11). Owned by WP4.

use std::path::{Path, PathBuf};

use crate::error::CoreError;
use crate::id::PageId;
use crate::seams::{Applier, Codec};
use crate::session::events::RecoveryOutcome;
use crate::store::fs::{FolderIdentity, Fs};
use crate::store::layout::NotebookLayout;
use crate::store::page_store::PageStore;
use crate::time::Clock;

/// What recovery needs.
pub struct RecoverCtx<'a> {
    /// The file system.
    pub fs: &'a dyn Fs,
    /// The codec.
    pub codec: &'a dyn Codec,
    /// The applier for replayed transactions.
    pub applier: &'a dyn Applier,
    /// The page store that saves the recovered page.
    pub store: &'a PageStore,
    /// The notebook's layout.
    pub layout: &'a NotebookLayout,
    /// The notebook folder's identity, which the journal must match.
    pub identity: &'a FolderIdentity,
    /// The current boot identifier.
    pub boot: &'a str,
    /// The clock.
    pub clock: &'a dyn Clock,
    /// Finds a page folder by ID, in any section or in Trash.
    pub locate: &'a dyn Fn(PageId) -> Option<PathBuf>,
    /// Where changes that couldn't be applied go.
    pub recovery_dir: &'a Path,
}

/// Recovers one page from its journal generations.
pub fn recover_page(_ctx: &RecoverCtx, _page: PageId, _generations: &[PathBuf]) -> Result<RecoveryOutcome, CoreError> {
    unimplemented!("WP4: recover_page")
}
