//! Protected sections (ADR 0042): a section whose files are sealed on disk, and opened only in memory.
//!
//! A protected section's folder holds two things on disk: a public `section.json` that keeps only what the tree
//! shows of a locked section (its title, color, and place) with the `encryption` header of spec 5.7, and a hidden
//! `.sealed` folder. In `.sealed`, `manifest` lists the section's files and folders, and each file is one blob
//! with a random name. The manifest and every blob are sealed under the section's content key (see [`crypto`]).
//!
//! [`SealedFs`] wraps the real file system. While a section is unlocked, every call for a path inside its folder
//! is served from the manifest and the blobs, so the core reads and writes the section as if it were plain, while
//! nothing but sealed bytes reaches the disk. Its `section.json` reads with `"unlocked": true` in the header,
//! which lets the core edit the section while it still keeps every other rule of spec 5.7: no `page.md`, no
//! `ink.svg`, no history, no cache entries, and nothing for the search index. Journals of its pages stay in
//! memory. While a section is locked, its folder reads as it is on disk: a section with no pages, read-only.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock};

use serde_json::Value;
use zeroize::Zeroizing;

use crate::error::{FsError, FsErrorKind};
use crate::id::PageId;
use crate::store::fs::Fs;
use crate::store::layout::SECTION_JSON;

pub mod crypto;
mod error;
mod fs_impl;
mod manifest;
mod section;
#[cfg(test)]
mod tests;

pub use crypto::{SealError, Secret};
pub use error::ProtectError;
use fs_impl::MemFile;
use manifest::{is_blob_name, Manifest};
use section::{with_encryption, OpenState, Unlocked};

/// The hidden folder of a protected section's sealed files.
pub const SEALED_DIR: &str = ".sealed";
/// The start of a folder's name beside [`SEALED_DIR`] that keeps another version of the section's sealed files,
/// which sync wrote when two devices changed the section before syncing (ADR 0049).
pub const SEALED_CONFLICT: &str = ".sealed-conflict-";
pub(crate) const MANIFEST: &str = "manifest";
/// The key in `section.json`'s `encryption` header that says the section is open in memory. It is never written.
pub const UNLOCKED: &str = "unlocked";

/// The file system as it is on disk, where protected sections are only ever sealed. Backups copy from it.
pub fn at_rest(fs: &dyn Fs) -> &dyn Fs {
    fs.sealed().map_or(fs, SealedFs::inner)
}

/// Whether a section's `encryption` header says it is unlocked in memory.
pub fn is_unlocked(encryption: Option<&Value>) -> bool {
    encryption.is_some_and(|e| e.get(UNLOCKED) == Some(&Value::Bool(true)))
}

pub(super) fn fs_error(kind: FsErrorKind, path: &Path) -> FsError {
    FsError::new(kind, path)
}

/// The unlocked sections and the journals of their pages.
#[derive(Default)]
pub struct Keyring {
    open: RwLock<Vec<Arc<Unlocked>>>,
    journals: Mutex<HashMap<PathBuf, MemFile>>,
}

/// The file system that seals protected sections. Every other path goes straight to the inner file system.
pub struct SealedFs {
    inner: Arc<dyn Fs>,
    keys: Keyring,
    journal_root: PathBuf,
}

/// Whether a section is protected, and whether it is open.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Protection {
    /// A plain section.
    None,
    /// Protected and locked.
    Locked,
    /// Protected and open in memory.
    Unlocked,
}

impl SealedFs {
    /// Wraps `inner`. `journal_root` is the data folder's `journal` folder, where page journals live.
    pub fn new(inner: Arc<dyn Fs>, journal_root: PathBuf) -> SealedFs {
        SealedFs {
            inner,
            keys: Keyring::default(),
            journal_root,
        }
    }

    /// The real file system, which only ever holds sealed bytes of protected sections. Backups copy from it.
    pub fn inner(&self) -> &dyn Fs {
        self.inner.as_ref()
    }

    fn open_list(&self) -> Vec<Arc<Unlocked>> {
        self.keys.open.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    fn find(&self, dir: &Path) -> Option<Arc<Unlocked>> {
        self.open_list().into_iter().find(|u| u.dir == dir)
    }

    fn journals(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, MemFile>> {
        self.keys.journals.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether the section in `dir` is protected, and open.
    pub fn protection(&self, dir: &Path) -> Protection {
        if self.find(dir).is_some() {
            return Protection::Unlocked;
        }
        match self.public_header(dir) {
            Ok(Some(_)) => Protection::Locked,
            _ => Protection::None,
        }
    }

    fn public_header(&self, dir: &Path) -> Result<Option<Value>, FsError> {
        let path = dir.join(SECTION_JSON);
        let bytes = self.inner.read(&path, 4 * 1024 * 1024)?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| fs_error(FsErrorKind::Io, &path))?;
        Ok(value.get("encryption").filter(|e| e.is_object()).cloned())
    }

    /// Protects the plain section in `dir` with a password, and leaves it unlocked. The notebook is closed.
    ///
    /// Each file is sealed into `.sealed`, then the public `section.json` is written, which is the moment the
    /// section becomes protected, then the plain files are removed. Readable copies (`page.md`, `ink.svg`) and
    /// history are dropped, as spec 5.7 keeps none for encrypted sections. A crash before that moment leaves the
    /// section plain; after it, the plain leftovers are removed at the next unlock and never read meanwhile.
    pub fn protect(&self, dir: &Path, section: &str, password: &str) -> Result<(), ProtectError> {
        if self.public_header(dir)?.is_some() {
            return Err(ProtectError::Already);
        }
        let content = crypto::new_key()?;
        let header = crypto::new_header(section, &content, password)?;
        let sealed = dir.join(SEALED_DIR);
        if self.inner.metadata(&sealed).is_ok() {
            self.inner.remove_dir_all(&sealed)?;
        }
        self.inner.create_dir_durable(&sealed)?;
        let unlocked = Arc::new(Unlocked {
            id: section.to_owned(),
            dir: dir.to_path_buf(),
            key: content,
            state: Mutex::new(OpenState {
                header: header.clone(),
                manifest: Manifest::default(),
            }),
        });
        let mut files = Vec::new();
        self.collect(dir, "", &mut files, &mut unlocked.state().manifest.dirs)?;
        for rel in files {
            let bytes = Zeroizing::new(self.inner.read(&unlocked.path_of(&rel), u64::MAX)?);
            unlocked.write(self.inner.as_ref(), &rel, &bytes, false)?;
        }
        let section_json = self.inner.read(&dir.join(SECTION_JSON), 64 * 1024 * 1024)?;
        // Writing section.json seals the full file and then writes the public one: the commit point.
        unlocked.write(self.inner.as_ref(), SECTION_JSON, &section_json, false)?;
        self.remove_plain(dir);
        self.keys
            .open
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .push(unlocked);
        Ok(())
    }

    /// Lists the files to seal, and records the folders.
    fn collect(
        &self,
        dir: &Path,
        rel: &str,
        files: &mut Vec<String>,
        dirs: &mut BTreeSet<String>,
    ) -> Result<(), FsError> {
        for entry in self.inner.read_dir(&if rel.is_empty() {
            dir.to_path_buf()
        } else {
            dir.join(rel)
        })? {
            let name = entry.name.as_str();
            let top = rel.is_empty();
            let page_level = !top && !rel.contains('/');
            let skipped = name.starts_with('~')
                || (top && (name == SEALED_DIR || name == SECTION_JSON || !entry.is_dir))
                || (page_level && matches!(name, "page.md" | "ink.svg" | ".history" | ".damaged"));
            if skipped {
                continue;
            }
            let path = if top { name.to_owned() } else { format!("{rel}/{name}") };
            if entry.is_dir {
                dirs.insert(path.clone());
                self.collect(dir, &path, files, dirs)?;
            } else {
                files.push(path);
            }
        }
        Ok(())
    }

    /// Removes everything in a protected section's folder but `section.json`, `.sealed`, and the other versions of
    /// `.sealed` that sync kept, and blobs the manifest doesn't name.
    fn remove_plain(&self, dir: &Path) {
        let Ok(entries) = self.inner.read_dir(dir) else {
            return;
        };
        for entry in entries {
            let kept = entry.is_dir && entry.name.starts_with(SEALED_CONFLICT);
            if entry.name == SECTION_JSON || entry.name == SEALED_DIR || kept {
                continue;
            }
            let path = dir.join(&entry.name);
            let _ = if entry.is_dir {
                self.inner.remove_dir_all(&path)
            } else {
                self.inner.remove_file(&path)
            };
        }
    }

    /// Opens the protected section in `dir` with a secret, without changing anything: the costly key derivation
    /// and the manifest's check happen here, so a wrong password is known before the notebook closes.
    pub fn prepare_unlock(&self, dir: &Path, section: &str, secret: Secret<'_>) -> Result<Prepared, ProtectError> {
        let header = self.public_header(dir)?.ok_or(ProtectError::NotProtected)?;
        let key = crypto::open_slot(section, &header, secret)?;
        let path = dir.join(SEALED_DIR).join(MANIFEST);
        let bytes = self.inner.read(&path, 256 * 1024 * 1024)?;
        let plain = crypto::open(&key, &crypto::aad(section, MANIFEST), &bytes).map_err(|_| ProtectError::Damaged)?;
        let manifest = Manifest::from_json(&plain).ok_or(ProtectError::Damaged)?;
        Ok(Prepared(Arc::new(Unlocked {
            id: section.to_owned(),
            dir: dir.to_path_buf(),
            key,
            state: Mutex::new(OpenState { header, manifest }),
        })))
    }

    /// Unlocks a prepared section, once its notebook is closed. Plain leftovers of protecting it, and blobs its
    /// manifest doesn't name, are removed first.
    pub fn install(&self, prepared: Prepared) {
        let unlocked = prepared.0;
        if self.find(&unlocked.dir).is_some() {
            return;
        }
        let dir = unlocked.dir.clone();
        let named: BTreeSet<String> = unlocked
            .state()
            .manifest
            .files
            .values()
            .map(|e| e.blob.clone())
            .collect();
        self.remove_plain(&dir);
        if let Ok(blobs) = self.inner.read_dir(&dir.join(SEALED_DIR)) {
            for blob in blobs
                .iter()
                .filter(|b| is_blob_name(&b.name) && !named.contains(&b.name))
            {
                let _ = self.inner.remove_file(&dir.join(SEALED_DIR).join(&blob.name));
            }
        }
        self.keys
            .open
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .push(unlocked);
    }

    /// Unlocks the protected section in `dir`. The notebook is closed.
    pub fn unlock(&self, dir: &Path, section: &str, secret: Secret<'_>) -> Result<(), ProtectError> {
        if self.find(dir).is_none() {
            let prepared = self.prepare_unlock(dir, section, secret)?;
            self.install(prepared);
        }
        Ok(())
    }

    /// Locks the section in `dir`: its key and its pages' journals leave memory.
    pub fn lock(&self, dir: &Path) {
        let gone: Vec<Arc<Unlocked>> = {
            let mut open = self.keys.open.write().unwrap_or_else(PoisonError::into_inner);
            let (gone, kept) = open.drain(..).partition(|u| u.dir == dir);
            *open = kept;
            gone
        };
        self.forget_journals(&gone);
    }

    /// Locks every section inside `root`, as when its notebook closes. Returns how many were open.
    pub fn lock_under(&self, root: &Path) -> usize {
        let gone: Vec<Arc<Unlocked>> = {
            let mut open = self.keys.open.write().unwrap_or_else(PoisonError::into_inner);
            let (gone, kept) = open.drain(..).partition(|u| u.dir.starts_with(root));
            *open = kept;
            gone
        };
        self.forget_journals(&gone);
        gone.len()
    }

    /// Locks every section.
    pub fn lock_all(&self) -> usize {
        let gone: Vec<Arc<Unlocked>> = self
            .keys
            .open
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect();
        self.forget_journals(&gone);
        gone.len()
    }

    /// The unlocked sections inside `root`, to unlock again after their notebook closes and opens.
    pub fn keep_under(&self, root: &Path) -> Vec<Prepared> {
        self.open_list()
            .into_iter()
            .filter(|u| u.dir.starts_with(root))
            .map(Prepared)
            .collect()
    }

    /// The folders of the unlocked sections.
    pub fn unlocked(&self) -> Vec<PathBuf> {
        self.open_list().iter().map(|u| u.dir.clone()).collect()
    }

    fn forget_journals(&self, gone: &[Arc<Unlocked>]) {
        let pages: Vec<String> = gone.iter().flat_map(|u| u.pages()).map(|p| p.to_string()).collect();
        self.journals().retain(|path, _| {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            !pages.iter().any(|p| name.starts_with(p.as_str()))
        });
    }

    /// Writes the unlocked section in `dir` back as plain files and forgets its key. The notebook is closed.
    pub fn unprotect(&self, dir: &Path) -> Result<(), ProtectError> {
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        let (dirs, files): (Vec<String>, Vec<String>) = {
            let st = open.state();
            (
                st.manifest.dirs.iter().cloned().collect(),
                st.manifest.files.keys().cloned().collect(),
            )
        };
        for rel in &dirs {
            match self.inner.create_dir_durable(&open.path_of(rel)) {
                Err(e) if e.kind != FsErrorKind::AlreadyExists => return Err(e.into()),
                _ => {}
            }
        }
        for rel in files.iter().filter(|r| r.as_str() != SECTION_JSON) {
            let bytes = open.read(self.inner.as_ref(), rel)?;
            self.inner.replace_durable(&open.path_of(rel), &bytes)?;
        }
        let stored = open.read(self.inner.as_ref(), SECTION_JSON)?;
        self.inner
            .replace_durable(&dir.join(SECTION_JSON), &with_encryption(&stored, None))?;
        self.lock(dir);
        let _ = self.inner.remove_dir_all(&dir.join(SEALED_DIR));
        Ok(())
    }

    /// Adds or replaces the unlocked section's slot of the secret's kind. `salt` is the Hello challenge.
    pub fn set_slot(
        &self,
        dir: &Path,
        secret: Secret<'_>,
        salt: Option<[u8; crypto::SALT]>,
    ) -> Result<(), ProtectError> {
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        let slot = crypto::make_slot(&open.id, &open.key, secret, salt)?;
        self.rewrite_header(&open, |header| crypto::with_slot(header, slot))
    }

    /// Removes the unlocked section's slot of `kind`. The password slot always stays.
    pub fn remove_slot(&self, dir: &Path, kind: &str) -> Result<(), ProtectError> {
        if kind == "password" {
            return Err(ProtectError::NoSlot);
        }
        let open = self.find(dir).ok_or(ProtectError::Locked)?;
        self.rewrite_header(&open, |header| crypto::without_slot(header, kind))
    }

    fn rewrite_header(&self, open: &Arc<Unlocked>, edit: impl FnOnce(&Value) -> Value) -> Result<(), ProtectError> {
        let stored = open.read(self.inner.as_ref(), SECTION_JSON)?;
        {
            let mut st = open.state();
            st.header = edit(&st.header);
        }
        open.write(self.inner.as_ref(), SECTION_JSON, &stored, false)?;
        Ok(())
    }

    /// The challenge of the section's Hello slot, if it has one.
    pub fn hello_challenge(&self, dir: &Path) -> Option<Vec<u8>> {
        if let Some(open) = self.find(dir) {
            return crypto::hello_challenge(&open.state().header);
        }
        crypto::hello_challenge(&self.public_header(dir).ok()??)
    }

    /// The pages of unlocked sections.
    pub fn unlocked_pages(&self) -> Vec<PageId> {
        self.open_list().iter().flat_map(|u| u.pages()).collect()
    }
}

/// A section whose secret was right, ready to unlock once its notebook closes.
pub struct Prepared(Arc<Unlocked>);

impl Prepared {
    /// The section's folder.
    pub fn dir(&self) -> &Path {
        &self.0.dir
    }
}
