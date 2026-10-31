//! Storage in memory, shared by every clone. Tests use it as the "server" that several devices sync through, and
//! the `testing` feature adds faults: a put or delete that fails after a number of successful ones.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, PoisonError};

use super::{check, max_size, too_large, valid_name, Backend};
use crate::error::{Result, SyncError};

/// Faults to inject.
#[derive(Clone, Debug, Default)]
pub struct Faults {
    /// Puts that succeed before every later one fails.
    pub puts_left: Option<usize>,
    /// Deletes that succeed before every later one fails.
    pub deletes_left: Option<usize>,
}

#[derive(Default)]
struct Inner {
    blobs: BTreeMap<String, Vec<u8>>,
    faults: Faults,
    puts: usize,
}

/// In-memory storage.
#[derive(Clone, Default)]
pub struct MemoryBackend {
    inner: Arc<Mutex<Inner>>,
}

impl MemoryBackend {
    /// Empty storage.
    pub fn new() -> MemoryBackend {
        MemoryBackend::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Every blob, for tests that change or inspect them.
    pub fn snapshot(&self) -> BTreeMap<String, Vec<u8>> {
        self.lock().blobs.clone()
    }

    /// Replaces a blob's bytes without any check, as a hostile server could.
    pub fn set_raw(&self, name: &str, bytes: Vec<u8>) {
        self.lock().blobs.insert(name.to_owned(), bytes);
    }

    /// Removes a blob without any check.
    pub fn remove_raw(&self, name: &str) {
        self.lock().blobs.remove(name);
    }

    /// How many puts succeeded.
    pub fn puts(&self) -> usize {
        self.lock().puts
    }

    /// Sets the faults to inject.
    #[cfg(feature = "testing")]
    pub fn set_faults(&self, faults: Faults) {
        self.lock().faults = faults;
    }
}

fn spend(budget: &mut Option<usize>) -> Result<()> {
    match budget {
        Some(0) => Err(SyncError::Interrupted),
        Some(left) => {
            *left -= 1;
            Ok(())
        }
        None => Ok(()),
    }
}

impl Backend for MemoryBackend {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>> {
        check(name)?;
        // The same limits as real storage, so every test also checks that what the engine writes fits them.
        match self.lock().blobs.get(name) {
            Some(bytes) if bytes.len() as u64 > max_size(name) => Err(too_large()),
            found => Ok(found.cloned()),
        }
    }

    fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
        check(name)?;
        let mut inner = self.lock();
        spend(&mut inner.faults.puts_left)?;
        inner.blobs.insert(name.to_owned(), bytes.to_vec());
        inner.puts += 1;
        Ok(())
    }

    fn exists(&self, name: &str) -> Result<bool> {
        check(name)?;
        Ok(self.lock().blobs.contains_key(name))
    }

    fn list(&self, prefix: &str) -> Result<Vec<String>> {
        Ok(self
            .lock()
            .blobs
            .keys()
            .filter(|name| name.starts_with(prefix) && valid_name(name))
            .cloned()
            .collect())
    }

    fn sizes(&self, prefix: &str) -> Result<Option<Vec<(String, u64)>>> {
        Ok(Some(
            self.lock()
                .blobs
                .iter()
                .filter(|(name, _)| name.starts_with(prefix) && valid_name(name))
                .map(|(name, bytes)| (name.clone(), bytes.len() as u64))
                .collect(),
        ))
    }

    fn delete(&self, name: &str) -> Result<()> {
        check(name)?;
        let mut inner = self.lock();
        spend(&mut inner.faults.deletes_left)?;
        inner.blobs.remove(name);
        Ok(())
    }
}
