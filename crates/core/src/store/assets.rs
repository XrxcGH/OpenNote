//! Importing and reading assets (spec 10). Owned by WP4.

use std::collections::BTreeMap;
use std::ops::Range;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, FsError};
use crate::id::AssetId;
use crate::model::Asset;
use crate::store::fs::Fs;
use crate::time::Clock;

/// Where an imported file comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssetSource {
    /// Bytes from the interface, such as a pasted image.
    Bytes {
        /// The original file name.
        name: String,
        /// The media type.
        mime: String,
        /// The file's bytes.
        bytes: Vec<u8>,
    },
    /// A file on disk, copied in the background.
    Path(PathBuf),
}

/// What an import needs besides the page folder and the source.
pub struct ImportCtx<'a> {
    /// The page's asset table, to reuse an asset with the same hash.
    pub existing: &'a BTreeMap<AssetId, Asset>,
    /// The clock for the asset's ID and `created` time.
    pub clock: &'a dyn Clock,
    /// Reports bytes copied and bytes in all.
    pub progress: &'a dyn Fn(u64, u64),
}

/// Writes an asset file durably and returns its table entry. Reuses an existing asset with the same hash.
pub fn import_asset(
    _fs: &dyn Fs,
    _page_dir: &Path,
    _source: AssetSource,
    _ctx: &ImportCtx<'_>,
) -> Result<Asset, CoreError> {
    unimplemented!("WP4: import_asset")
}

/// Reads an asset, or a byte range of it, and closes the file at once.
pub fn read_asset(
    _fs: &dyn Fs,
    _page_dir: &Path,
    _asset: &Asset,
    _range: Option<Range<u64>>,
) -> Result<Vec<u8>, FsError> {
    unimplemented!("WP4: read_asset")
}
