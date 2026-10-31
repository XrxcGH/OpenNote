//! Protected sections through the core (ADR 0042). Protecting, unlocking, locking, and removing protection each
//! close the notebook first, which saves and closes its pages and journals, and open it again afterwards, so the
//! tree reads the section as it now is. A wrong password is found before the notebook closes.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::Core;
use crate::error::CoreError;
use crate::id::SectionId;
use crate::store::fs::Fs;
use crate::store::sealed::crypto::SALT;
use crate::store::sealed::{at_rest, crypto, ProtectError, Protection, Secret, SEALED_CONFLICT, SEALED_DIR};

impl Core {
    fn sealed_fs(&self) -> Result<Arc<dyn Fs>, ProtectError> {
        let fs = self.ctx().fs.clone();
        if fs.sealed().is_none() {
            return Err(ProtectError::Core(CoreError::Fs(crate::error::FsError::new(
                crate::error::FsErrorKind::Unsupported,
                PathBuf::new(),
            ))));
        }
        Ok(fs)
    }

    /// The folder of a section of the open notebook at `notebook`.
    fn section_dir(&self, notebook: &Path, section: SectionId) -> Result<PathBuf, CoreError> {
        let open = self
            .find_open(notebook)
            .ok_or_else(|| CoreError::NotFound(format!("open notebook {}", notebook.display())))?;
        let tree = open.inner.tree();
        Ok(tree.store.section(section)?.dir.clone())
    }

    /// Whether a section is protected, and whether it is open.
    pub fn section_protection(&self, notebook: &Path, section: SectionId) -> Result<Protection, CoreError> {
        let dir = self.section_dir(notebook, section)?;
        Ok(self.ctx().fs.sealed().map_or(Protection::None, |s| s.protection(&dir)))
    }

    /// Closes the notebook, runs `op`, and opens it again, whatever `op` returned.
    fn closed<T>(&self, notebook: &Path, op: impl FnOnce() -> Result<T, ProtectError>) -> Result<T, ProtectError> {
        let open = self.writable_open(notebook)?;
        open.close()?;
        let result = op();
        self.open_notebook(notebook)?;
        result
    }

    /// Protects a plain section with a password, and leaves it unlocked.
    pub fn protect_section(&self, notebook: &Path, section: SectionId, password: &str) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        if sealed.protection(&dir) != Protection::None {
            return Err(ProtectError::Already);
        }
        let id = section.to_string();
        // The notebook closes, which locks its other protected sections; they open again after.
        let others = self.unlocked_in(notebook);
        self.closed(notebook, || {
            sealed.protect(&dir, &id, password)?;
            for prepared in others {
                sealed.install(prepared);
            }
            Ok(())
        })
    }

    /// The prepared unlocks of the notebook's unlocked sections, to install again after a close.
    fn unlocked_in(&self, notebook: &Path) -> Vec<crate::store::sealed::Prepared> {
        self.ctx()
            .fs
            .sealed()
            .map(|s| s.keep_under(notebook))
            .unwrap_or_default()
    }

    /// Unlocks a protected section with its password or a Windows Hello signature.
    pub fn unlock_section(&self, notebook: &Path, section: SectionId, secret: Secret<'_>) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        match sealed.protection(&dir) {
            Protection::None => return Err(ProtectError::NotProtected),
            Protection::Unlocked => return Ok(()),
            Protection::Locked => {}
        }
        let prepared = sealed.prepare_unlock(&dir, &section.to_string(), secret)?;
        let others = self.unlocked_in(notebook);
        self.closed(notebook, || {
            sealed.install(prepared);
            for other in others {
                sealed.install(other);
            }
            Ok(())
        })
    }

    /// Locks a section. Its open pages are saved and closed. Returns whether it was unlocked.
    pub fn lock_section(&self, notebook: &Path, section: SectionId) -> Result<bool, ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        if sealed.protection(&dir) != Protection::Unlocked {
            return Ok(false);
        }
        let others: Vec<_> = self
            .unlocked_in(notebook)
            .into_iter()
            .filter(|p| p.dir() != dir)
            .collect();
        let open = self
            .find_open(notebook)
            .ok_or_else(|| CoreError::NotFound(format!("open notebook {}", notebook.display())))?;
        open.close()?;
        for other in others {
            sealed.install(other);
        }
        self.open_notebook(notebook)?;
        Ok(true)
    }

    /// Locks every protected section of every open notebook, as when Windows locks or sleeps. Returns the
    /// notebooks that closed and opened again.
    pub fn lock_all_sections(&self) -> Result<Vec<PathBuf>, CoreError> {
        let Some(sealed) = self.ctx().fs.sealed() else {
            return Ok(Vec::new());
        };
        let dirs = sealed.unlocked();
        let mut reopened = Vec::new();
        for open in self.notebooks() {
            let root = open.path().to_path_buf();
            if !dirs.iter().any(|d| d.starts_with(&root)) {
                continue;
            }
            open.close()?;
            self.open_notebook(&root)?;
            reopened.push(root);
        }
        // Anything left, as of a notebook that closed some other way, goes too.
        sealed.lock_all();
        Ok(reopened)
    }

    /// Writes an unlocked section back as plain files and removes its protection.
    pub fn unprotect_section(&self, notebook: &Path, section: SectionId) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        if sealed.protection(&dir) != Protection::Unlocked {
            return Err(ProtectError::Locked);
        }
        let mut all = self.unlocked_in(notebook);
        let index = all.iter().position(|p| p.dir() == dir).ok_or(ProtectError::Locked)?;
        let this = all.remove(index);
        self.closed(notebook, || {
            sealed.install(this);
            let done = sealed.unprotect(&dir);
            for other in all {
                sealed.install(other);
            }
            done
        })
    }

    /// Changes an unlocked section's password.
    pub fn change_section_password(
        &self,
        notebook: &Path,
        section: SectionId,
        password: &str,
    ) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        sealed.set_slot(&dir, Secret::Password(password), None)
    }

    /// A fresh challenge for Windows Hello to sign when it is set up for a section.
    pub fn new_hello_challenge() -> Result<[u8; SALT], ProtectError> {
        Ok(crypto::random::<SALT>()?)
    }

    /// Lets Windows Hello unlock an unlocked section: `signature` is Hello's signature over `challenge`.
    pub fn set_section_hello(
        &self,
        notebook: &Path,
        section: SectionId,
        challenge: [u8; SALT],
        signature: &[u8],
    ) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        sealed.set_slot(&dir, Secret::Hello(signature), Some(challenge))
    }

    /// Stops Windows Hello unlocking an unlocked section.
    pub fn remove_section_hello(&self, notebook: &Path, section: SectionId) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        let sealed = fs.sealed().ok_or(ProtectError::NotProtected)?;
        sealed.remove_slot(&dir, "hello")
    }

    /// The challenge Windows Hello signs to unlock a section, if Hello is set up for it.
    pub fn section_hello_challenge(&self, notebook: &Path, section: SectionId) -> Result<Option<Vec<u8>>, CoreError> {
        let dir = self.section_dir(notebook, section)?;
        Ok(self.ctx().fs.sealed().and_then(|s| s.hello_challenge(&dir)))
    }

    /// The other versions of a protected section's sealed files that sync kept when two devices changed the
    /// section before syncing (ADR 0049): its `.sealed-conflict-<hash>` folders, by name.
    pub fn sealed_conflicts(&self, notebook: &Path, section: SectionId) -> Result<Vec<String>, CoreError> {
        let dir = self.section_dir(notebook, section)?;
        let fs = self.ctx().fs.clone();
        let disk = at_rest(fs.as_ref());
        let mut names: Vec<String> = match disk.read_dir(&dir) {
            Ok(entries) => entries
                .into_iter()
                .filter(|e| e.is_dir && is_conflict_name(&e.name))
                .map(|e| e.name)
                .collect(),
            Err(_) => Vec::new(),
        };
        names.sort();
        Ok(names)
    }

    /// Makes a kept version the section's own. The section locks first; its current sealed files become a kept
    /// version in turn, so both stay and the person can switch back.
    pub fn switch_sealed_conflict(&self, notebook: &Path, section: SectionId, name: &str) -> Result<(), ProtectError> {
        let fs = self.sealed_fs()?;
        let dir = self.section_dir(notebook, section)?;
        if !self.sealed_conflicts(notebook, section)?.iter().any(|n| n == name) {
            return Err(ProtectError::NotProtected);
        }
        self.lock_section(notebook, section)?;
        let suffix: String = crypto::random::<4>()?.iter().map(|b| format!("{b:02x}")).collect();
        let current = dir.join(SEALED_DIR);
        let kept = dir.join(format!("{SEALED_CONFLICT}{suffix}"));
        let disk = at_rest(fs.as_ref());
        self.closed(notebook, || {
            disk.rename_dir(&current, &kept)?;
            if let Err(error) = disk.rename_dir(&dir.join(name), &current) {
                let _ = disk.rename_dir(&kept, &current);
                return Err(error.into());
            }
            Ok(())
        })
    }

    /// Removes a kept version of a protected section's sealed files for good.
    pub fn discard_sealed_conflict(&self, notebook: &Path, section: SectionId, name: &str) -> Result<(), ProtectError> {
        let dir = self.section_dir(notebook, section)?;
        if !self.sealed_conflicts(notebook, section)?.iter().any(|n| n == name) {
            return Err(ProtectError::NotProtected);
        }
        let fs = self.ctx().fs.clone();
        at_rest(fs.as_ref()).remove_dir_all(&dir.join(name))?;
        Ok(())
    }
}

/// Whether a folder name is a kept version of sealed files: the prefix and then letters and digits only.
fn is_conflict_name(name: &str) -> bool {
    name.strip_prefix(SEALED_CONFLICT)
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric()))
}
