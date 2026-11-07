//! The `opennote-pack` scheme. It only reads. It serves a file only when three things hold: the catalog names the
//! path, the file sits inside the packs folder, and its bytes match the catalog's size and SHA-256. The bytes are
//! checked in memory and then sent, so a file changed on disk after its download is refused.

use std::{fs, path::Path};

use sha1::Sha1;
use sha2::{Digest as _, Sha256};
use tauri::http::{header, Method, Response, StatusCode};

use super::catalog;
use crate::intel::models::Digest;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Whether `bytes` are the file the catalog describes.
pub fn digest_matches(bytes: &[u8], digest: Digest) -> bool {
    match digest {
        Digest::Sha256(want) => hex(&Sha256::digest(bytes)) == want,
        Digest::GitBlob(want) => {
            let mut hasher = Sha1::new();
            hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
            hasher.update(bytes);
            hex(&hasher.finalize()) == want
        }
    }
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

/// Reads a catalog file from the packs folder, or none when it is missing, outside the folder, or not verified.
pub fn verified_bytes(dir: &Path, catalog: catalog::Catalog, path: &str) -> Option<Vec<u8>> {
    let path = plain_path(path)?;
    let part = catalog::part_at(catalog, path)?;
    // A link or junction inside the folder must not lead out of it.
    let root = fs::canonicalize(dir).ok()?;
    let file = fs::canonicalize(dir.join(part.file)).ok()?;
    if !file.starts_with(&root) || !fs::metadata(&file).ok()?.is_file() {
        return None;
    }
    let bytes = fs::read(&file).ok()?;
    (bytes.len() as u64 == part.size && digest_matches(&bytes, part.digest)).then_some(bytes)
}

/// The answer to one request.
pub fn answer(dir: &Path, catalog: catalog::Catalog, method: &Method, path: &str) -> Response<Vec<u8>> {
    if method != Method::GET && method != Method::HEAD {
        return refuse(StatusCode::METHOD_NOT_ALLOWED);
    }
    let Some(bytes) = verified_bytes(dir, catalog, path) else {
        return refuse(StatusCode::NOT_FOUND);
    };
    let body = if method == Method::HEAD { Vec::new() } else { bytes };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type(path))
        .header("X-Content-Type-Options", "nosniff")
        // The files are public open-source runtimes; the app's workers read them from their own origin.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| refuse(StatusCode::INTERNAL_SERVER_ERROR))
}
