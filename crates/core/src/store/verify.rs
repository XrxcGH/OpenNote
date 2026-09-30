//! Checking a whole notebook against invariant I1 (spec 17.1). Owned by WP4.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::CoreError;
use crate::limits::Limits;
use crate::model::Warning;
use crate::seams::Codec;
use crate::store::fs::Fs;

/// What "Check this notebook for problems" found.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    /// Files checked.
    pub files: u32,
    /// Problems, each with the file it is in.
    pub problems: Vec<(PathBuf, Warning)>,
}

impl VerifyReport {
    /// Whether nothing is wrong.
    pub fn is_clean(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Checks every JSON file, segment, and reference of a notebook, every ID's uniqueness, and every Trash item.
pub fn verify_notebook(
    _fs: &dyn Fs,
    _codec: &dyn Codec,
    _root: &Path,
    _limits: &Limits,
) -> Result<VerifyReport, CoreError> {
    unimplemented!("WP4: verify_notebook")
}
