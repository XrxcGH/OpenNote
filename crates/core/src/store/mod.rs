//! Storage: the file system seam, paths, page saves, the journal, recovery, and the notebook tree.
//!
//! Code here reads untrusted files, so the lints below forbid the usual ways to panic. The release build
//! aborts on a panic.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

pub mod assets;
pub mod backup;
pub mod cache;
pub mod compact;
pub mod external;
pub mod failpoint;
pub mod fs;
pub mod gc;
pub mod history;
pub mod journal;
pub mod layout;
pub mod lock;
pub mod notebook_store;
pub mod page_store;
pub mod recovery;
pub mod scan;
pub mod std_fs;
mod sys;
pub mod trash;
pub mod tree_log;
pub mod verify;

use std::path::Path;

use crate::seams::Codec;
use crate::store::fs::Fs;

/// The file system, the codec, and one page folder: what the history and clean-up functions work on.
#[derive(Clone, Copy)]
pub struct PageFiles<'a> {
    /// The file system.
    pub fs: &'a dyn Fs,
    /// The codec.
    pub codec: &'a dyn Codec,
    /// The page folder.
    pub dir: &'a Path,
}
