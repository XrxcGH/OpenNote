//! The `opennote-pack` scheme. It only reads. It serves a file only when three things hold: the catalog names the
//! path, the file sits inside the packs folder, and its bytes match the catalog's size and SHA-256. The file is hashed
//! in pieces, never whole in memory. A file that passed is remembered by its path, size and change time, so it is
//! hashed again only when it changes on disk. A file changed after its download is refused.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use tauri::http::{header, Method, Response, StatusCode};

use super::catalog;
use crate::intel::models::file_matches;

/// The files that passed the check, with the size and change time they had then.
fn verified() -> &'static Mutex<HashMap<PathBuf, (u64, SystemTime)>> {
    static VERIFIED: OnceLock<Mutex<HashMap<PathBuf, (u64, SystemTime)>>> = OnceLock::new();
    VERIFIED.get_or_init(Mutex::default)
}

/// The relative path a request names, when it is plain. Each segment is a plain file name (see
/// [`catalog::plain_file_name`]). So there is no empty, dot, or dot-dot segment, and no backslash, colon, or `%`.
pub fn plain_path(path: &str) -> Option<&str> {
    let path = path.strip_prefix('/')?;
    let ok = !path.is_empty() && path.split('/').all(catalog::plain_file_name);
    ok.then_some(path)
}

/// The type a worker needs: `application/wasm` lets `WebAssembly.instantiateStreaming` compile as bytes arrive.
pub fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "wasm" => "application/wasm",
        "mjs" | "js" => "text/javascript",
        "json" => "application/json",
        "zip" | "whl" => "application/zip",
        "tar" => "application/x-tar",
        _ => "application/octet-stream",
    }
}

/// An empty answer with this status.
pub fn refuse(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_default()
}

/// The size and change time of a file, the key of a past check.
fn stamp(file: &Path) -> Option<(u64, SystemTime)> {
    let metadata = fs::metadata(file).ok()?;
    metadata.is_file().then_some(())?;
    Some((metadata.len(), metadata.modified().ok()?))
}

/// The path of a catalog file in the packs folder and its size, when the file is there, inside the folder, and
/// verified. A file checked before and not changed since is not hashed again.
pub fn verified_file(dir: &Path, catalog: catalog::Catalog, path: &str) -> Option<(PathBuf, u64)> {
    let path = plain_path(path)?;
    let part = catalog::part_at(catalog, path)?;
    // A link or junction inside the folder must not lead out of it.
    let root = fs::canonicalize(dir).ok()?;
    let file = fs::canonicalize(dir.join(part.file)).ok()?;
    if !file.starts_with(&root) {
        return None;
    }
    let now = stamp(&file)?;
    if now.0 != part.size {
        return None;
    }
    let mut known = verified().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if known.get(&file) != Some(&now) {
        known.remove(&file);
        drop(known);
        if !file_matches(&file, part.size, part.digest).ok()? || stamp(&file)? != now {
            return None;
        }
        known = verified().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        known.insert(file.clone(), now);
    }
    Some((file, part.size))
}

/// The answer to one request.
pub fn answer(dir: &Path, catalog: catalog::Catalog, method: &Method, path: &str) -> Response<Vec<u8>> {
    if method != Method::GET && method != Method::HEAD {
        return refuse(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some((file, size)) = verified_file(dir, catalog, path) else {
        return refuse(StatusCode::NOT_FOUND);
    };
    let body = if method == Method::HEAD {
        Vec::new()
    } else {
        // The size is checked again, so bytes added after the check are never sent.
        match fs::read(&file) {
            Ok(bytes) if bytes.len() as u64 == size => bytes,
            _ => return refuse(StatusCode::NOT_FOUND),
        }
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type(path))
        .header(header::CONTENT_LENGTH, size)
        .header("X-Content-Type-Options", "nosniff")
        // The files are public open-source runtimes; the app's workers read them from their own origin.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| refuse(StatusCode::INTERNAL_SERVER_ERROR))
}
