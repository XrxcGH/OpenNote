//! Dumb storage: anything that can store, read, list, and delete named blobs. The engine never needs more, so the
//! same sync runs over a synced folder, a WebDAV server, and (later) a bucket in S3-compatible storage.
//!
//! Names are short paths of lower-case letters, digits, and slashes, such as `c/ab/ab12...` or `h/0f3a.../7`.
//! Anything else a listing returns, such as a sync tool's conflict copy or a stray file, is skipped, so hostile
//! names never reach a path.

use crate::crypto::{padded_len, OVERHEAD};
use crate::error::{Result, SyncError};
use crate::local::CHUNK;
use crate::manifest::MAX_HEAD;

mod folder;
mod memory;
mod webdav;

pub use folder::FolderBackend;
#[cfg(feature = "testing")]
pub use memory::Faults;
pub use memory::MemoryBackend;
pub use webdav::{WebDavBackend, WebDavConfig};

/// Storage the engine can use.
pub trait Backend: Send + Sync {
    /// The blob's bytes, or `None` when there is none.
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>>;
    /// Stores the blob whole, or not at all: a reader never sees part of it.
    fn put(&self, name: &str, bytes: &[u8]) -> Result<()>;
    /// Whether the blob exists.
    fn exists(&self, name: &str) -> Result<bool>;
    /// Every valid name under `prefix` (such as `h/`), at any depth.
    fn list(&self, prefix: &str) -> Result<Vec<String>>;
    /// Removes the blob. Removing one that is gone is not an error.
    fn delete(&self, name: &str) -> Result<()>;
}

/// Whether `name` is a name the engine writes: 1 to 160 characters of `a-z`, `0-9`, and single slashes, not
/// starting or ending with a slash.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 160
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains("//")
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'/')
}

/// The most bytes a blob under `name` holds when OpenNote wrote it. A reader refuses a longer one before reading it
/// whole, so damaged or hostile storage can't make the app run out of memory.
pub fn max_size(name: &str) -> u64 {
    let sealed = |plain: u64| plain + OVERHEAD as u64;
    match name.split_once('/').map_or(name, |(kind, _)| kind) {
        "vault" => crate::vault::MAX_HEADER as u64,
        "c" => sealed(padded_len(CHUNK) as u64),
        // A compressed head is no longer than its JSON, give or take deflate's few bytes per block.
        "h" => sealed(padded_len(MAX_HEAD as usize + 64 * 1024) as u64),
        // Device slots, pairing slots, and removal notes are a few hundred bytes.
        _ => 16 * 1024,
    }
}

/// The error for a blob longer than [`max_size`].
pub(crate) fn too_large() -> SyncError {
    SyncError::Tampered("A file in the sync storage is larger than OpenNote ever writes.".into())
}

pub(crate) fn check(name: &str) -> Result<()> {
    if valid_name(name) {
        Ok(())
    } else {
        Err(SyncError::Storage("an invalid name was asked for".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_engine_names_are_valid() {
        for good in ["vault", "c/ab/0123", "h/0f3a/12"] {
            assert!(valid_name(good), "{good}");
        }
        for bad in [
            "",
            "/vault",
            "vault/",
            "c//ab",
            "../vault",
            "c/AB",
            "h/x/1 (conflicted copy)",
            "c\\ab",
            "vault-LAPTOP",
            "c/ab/x.tmp",
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(!valid_name(&"a".repeat(161)));
    }

    #[test]
    fn each_kind_of_blob_has_a_size_limit() {
        // A 1 MiB chunk with its 4-byte length pads to 17 steps of 64 KiB, and sealing adds a 24-byte nonce and a
        // 16-byte tag.
        assert_eq!(max_size("c/ab/0123"), 17 * 65_536 + 40);
        assert_eq!(max_size("k/0f3a"), 16_384);
        assert_eq!(max_size("vault"), crate::vault::MAX_HEADER as u64);
        assert!(max_size("h/0f3a/7") > MAX_HEAD && max_size("h/0f3a/7") < MAX_HEAD + 200 * 1024);
    }
}
