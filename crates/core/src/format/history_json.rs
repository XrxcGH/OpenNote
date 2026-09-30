//! `.history/versions.json` (spec 13.1). Owned by WP1.

use crate::error::FormatError;
use crate::limits::Limits;
use crate::model::VersionsFile;

/// Reads `versions.json`.
pub fn read_versions(_bytes: &[u8], _limits: &Limits) -> Result<VersionsFile, FormatError> {
    unimplemented!("WP1: read_versions")
}

/// Writes `versions.json` in canonical form.
pub fn write_versions(_file: &VersionsFile) -> Vec<u8> {
    unimplemented!("WP1: write_versions")
}

/// Merges two copies of `versions.json` by revision (spec 13.1).
pub fn merge_versions(_ours: &VersionsFile, _theirs: &VersionsFile) -> VersionsFile {
    unimplemented!("WP1: merge_versions")
}
