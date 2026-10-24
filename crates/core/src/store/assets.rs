//! Importing and reading assets (spec 10). Owned by WP4.
//!
//! An asset file is written durably when it is imported, before any block or journal record refers to it
//! (spec 10.3). The same file added twice to a page reuses the first asset.

use std::collections::BTreeMap;
use std::ops::Range;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, EditError, FsError, FsErrorKind};
use crate::format::names::asset_file_name;
use crate::id::AssetId;
use crate::model::{Asset, JsonMap};
use crate::store::fs::Fs;
use crate::store::layout::{NotebookLayout, ASSETS_DIR};
use crate::store::page_store::ensure_dir;
use crate::time::Clock;

mod image;

pub use image::{image_size, matches_declared_type, mime_for_name};

/// How much of a source file an import reads at a time, between progress reports.
const CHUNK: u64 = 1024 * 1024;

/// The pixel size of an image, as the interface measured it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageSize {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
}

/// The largest side of an image the table will record. A claim beyond it is ignored.
const MAX_IMAGE_SIDE: u32 = 1_000_000;

impl ImageSize {
    /// Whether both sides are positive and within the limit.
    fn is_plausible(self) -> bool {
        (1..=MAX_IMAGE_SIDE).contains(&self.width) && (1..=MAX_IMAGE_SIDE).contains(&self.height)
    }
}

/// Where an imported file comes from. Either source may bring `image`, the size the interface measured
/// when it decoded the picture. The core reads sizes from the headers of PNG, GIF, JPEG, and BMP files itself
/// and trusts those over `image`. For every other image type, such as WebP, SVG, and HEIC, it records `image`
/// in the asset table, so a page shows the picture's real shape before the picture loads.
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
        /// The size of the picture, when it is an image the interface decoded.
        image: Option<ImageSize>,
    },
    /// A file on disk, copied in the background.
    Path {
        /// Where the file is.
        path: PathBuf,
        /// The size the interface measured, for an image it decoded.
        image: Option<ImageSize>,
    },
}

impl AssetSource {
    /// Bytes from the interface, without a measured size.
    pub fn bytes(name: impl Into<String>, mime: impl Into<String>, bytes: Vec<u8>) -> AssetSource {
        AssetSource::Bytes {
            name: name.into(),
            mime: mime.into(),
            bytes,
            image: None,
        }
    }

    /// A file on disk, without a measured size.
    pub fn path(path: impl Into<PathBuf>) -> AssetSource {
        AssetSource::Path {
            path: path.into(),
            image: None,
        }
    }
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

/// Writes an asset file durably and returns its table entry. Reuses an existing asset with the same hash,
/// writing its file again if it went missing.
pub fn import_asset(
    fs: &dyn Fs,
    page_dir: &Path,
    source: AssetSource,
    ctx: &ImportCtx<'_>,
) -> Result<Asset, CoreError> {
    let (name, mime, bytes, claimed) = match source {
        AssetSource::Bytes {
            name,
            mime,
            bytes,
            image,
        } => {
            let len = bytes.len() as u64;
            (ctx.progress)(len, len);
            (name, mime, bytes, image)
        }
        AssetSource::Path { path, image } => {
            let (name, mime, bytes) = read_source(fs, &path, ctx.progress)?;
            (name, mime, bytes, image)
        }
    };
    check_declared_type(&bytes, &mime)?;
    let sha256: [u8; 32] = Sha256::digest(&bytes).into();
    let len = bytes.len() as u64;
    // A recording still being written carries the hash of nothing, which is no file's hash yet.
    let same = |a: &&Asset| !a.is_recording() && a.sha256 == sha256 && a.bytes == len;
    if let Some(existing) = ctx.existing.values().find(same) {
        let path = NotebookLayout::asset_path(page_dir, existing)?;
        if fs.metadata(&path).map(|meta| meta.stamp.len) != Ok(len) {
            write_file(fs, page_dir, &path, &bytes)?;
        }
        return Ok(existing.clone());
    }
    let id = AssetId::generate(ctx.clock);
    let (width, height) = picture_size(&bytes, &mime, claimed).map_or((None, None), |(w, h)| (Some(w), Some(h)));
    let asset = Asset {
        id,
        file: asset_file_name(id, &name, &mime),
        mime,
        bytes: len,
        sha256,
        name,
        width,
        height,
        created: ctx.clock.now(),
        extra: JsonMap::new(),
    };
    let path = NotebookLayout::asset_path(page_dir, &asset)?;
    write_file(fs, page_dir, &path, &bytes)?;
    Ok(asset)
}

/// An `image/*` file must start with the bytes of its type, so a file named `leaf.png` that holds anything else
/// never gets a picture's place in a page. Media types the core doesn't know are taken as declared.
pub(crate) fn check_declared_type(bytes: &[u8], mime: &str) -> Result<(), CoreError> {
    if matches_declared_type(bytes, mime) == Some(false) {
        let detail = format!("assetType: the file's first bytes are not those of {mime}");
        return Err(CoreError::Edit(EditError::Invalid(detail)));
    }
    Ok(())
}

/// The size of a picture: the one its header gives, else the one the interface measured, when it makes sense.
pub(crate) fn picture_size(bytes: &[u8], mime: &str, claimed: Option<ImageSize>) -> Option<(u32, u32)> {
    if !mime.to_ascii_lowercase().starts_with("image/") {
        return None;
    }
    image_size(bytes, mime).or_else(|| {
        claimed
            .filter(|size| size.is_plausible())
            .map(|size| (size.width, size.height))
    })
}

fn write_file(fs: &dyn Fs, page_dir: &Path, path: &Path, bytes: &[u8]) -> Result<(), FsError> {
    ensure_dir(fs, &page_dir.join(ASSETS_DIR))?;
    fs.create_durable(path, bytes).map(|_| ())
}

/// Reads a source file in chunks, reporting progress. Its name and media type come from its file name.
fn read_source(fs: &dyn Fs, path: &Path, progress: &dyn Fn(u64, u64)) -> Result<(String, String, Vec<u8>), FsError> {
    let total = fs.metadata(path)?.stamp.len;
    let mut bytes = Vec::with_capacity(usize::try_from(total).unwrap_or(0));
    let mut done = 0u64;
    while done < total {
        let end = done.saturating_add(CHUNK).min(total);
        let chunk = fs.read_range(path, done..end)?;
        if chunk.is_empty() {
            // The file shrank while it was read.
            return Err(FsError::new(FsErrorKind::Busy, path));
        }
        done = done.saturating_add(chunk.len() as u64);
        bytes.extend_from_slice(&chunk);
        progress(done, total);
    }
    if total == 0 {
        progress(0, 0);
    }
    let name = path
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let mime = mime_for_name(&name).to_owned();
    Ok((name, mime, bytes))
}

/// Reads an asset, or a byte range of it, and closes the file at once. A file name that fails its check is a
/// missing file (spec 10.1).
pub fn read_asset(fs: &dyn Fs, page_dir: &Path, asset: &Asset, range: Option<Range<u64>>) -> Result<Vec<u8>, FsError> {
    let path = NotebookLayout::asset_path(page_dir, asset)
        .map_err(|_| FsError::new(FsErrorKind::NotFound, page_dir.join(ASSETS_DIR)))?;
    match range {
        Some(range) => fs.read_range(&path, range),
        None => fs.read(&path, u64::MAX),
    }
}

#[cfg(test)]
mod tests;
