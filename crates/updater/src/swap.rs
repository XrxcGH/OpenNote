//! Swapping the running exe: the previous copy, the staged copy next to the exe, `self_replace`, and restoring
//! the previous copy when a swap fails halfway (ARCHITECTURE.md section 18.7).

use std::{
    io,
    path::{Path, PathBuf},
};

/// Finds and replaces the running exe. Tests use a fake in temporary folders.
pub trait Replacer: Send + Sync {
    fn current_exe(&self) -> io::Result<PathBuf>;
    /// Replaces the running exe with a copy that already sits in the exe's folder.
    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()>;
}

/// The production replacer: the real exe path, and `self_replace` for the swap.
#[derive(Debug, Default, Clone, Copy)]
pub struct SelfReplace;

impl Replacer for SelfReplace {
    fn current_exe(&self) -> io::Result<PathBuf> {
        std::env::current_exe()
    }

    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()> {
        self_replace::self_replace(staged_next_to_exe)
    }
}
