//! Backups before a format upgrade (spec 15.4). Owned by WP4.

use std::path::{Path, PathBuf};

use crate::error::CoreError;
use crate::store::fs::Fs;

/// Copies every JSON file of the notebook at `root` into a new backup set under `backups`, and keeps the
/// newest 3 sets. Returns the new set's folder.
pub fn backup_before_upgrade(
    _fs: &dyn Fs,
    _root: &Path,
    _backups: &Path,
    _from: u32,
    _to: u32,
) -> Result<PathBuf, CoreError> {
    unimplemented!("WP4: backup_before_upgrade")
}
