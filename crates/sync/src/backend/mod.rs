//! Dumb storage: anything that can store, read, list, and delete named blobs. The engine never needs more, so the
//! same sync runs over a synced folder, a WebDAV server, and (later) a bucket in S3-compatible storage.
//!
//! Names are short paths of lower-case letters, digits, and slashes, such as `c/ab/ab12...` or `h/0f3a.../7`.
//! Anything else a listing returns, such as a sync tool's conflict copy or a stray file, is skipped, so hostile
//! names never reach a path.

use crate::error::{Result, SyncError};

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
}
