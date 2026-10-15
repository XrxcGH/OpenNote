//! The library through the core: the notebooks this device shows and their order, the notes folder, and
//! notebooks moved to Trash, which only leave the library (Phase 2 notes contract, section 12).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::Core;
use crate::error::CoreError;
use crate::format::names::{fold_name, safe_folder_name};
use crate::id::NotebookId;
use crate::session::library::{same_path, RemovedEntry};
use crate::session::notebook::NotebookHandle;

/// A notebook of the library, as the interface lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryNotebook {
    /// The notebook folder.
    pub path: PathBuf,
    /// The notebook's ID.
    pub notebook: NotebookId,
    /// Its title, from the open notebook or as last seen.
    pub title: String,
    /// Whether it is open in this core.
    pub open: bool,
    /// Whether its folder can be reached. A notebook on an unplugged drive shows but can't open.
    pub available: bool,
}

/// The library as the interface shows it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    /// The notes folder, where new notebooks go.
    pub folder: Option<PathBuf>,
    /// The notebooks, in display order.
    pub notebooks: Vec<LibraryNotebook>,
    /// Notebooks removed from the library, which can be restored.
    pub removed: Vec<RemovedEntry>,
}

impl Core {
    /// The library: the notes folder, the notebooks in order, and the removed ones.
    pub fn library(&self) -> LibraryInfo {
        let library = self.library_mut().clone();
        let fs = self.ctx().fs.clone();
        let notebooks = library
            .entries()
            .iter()
            .map(|entry| {
                let open = self.find_open(&entry.path);
                LibraryNotebook {
                    path: entry.path.clone(),
                    notebook: open.as_ref().map_or(entry.notebook, NotebookHandle::id),
                    title: open.as_ref().map_or_else(|| entry.title.clone(), |n| n.tree().title),
                    open: open.is_some(),
                    available: fs.metadata(&entry.path).is_ok_and(|m| m.is_dir),
                }
            })
            .collect();
        LibraryInfo {
            folder: library.folder().map(Path::to_path_buf),
            notebooks,
            removed: library.removed().to_vec(),
        }
    }

    /// Sets the notes folder, where new notebooks go.
    pub fn set_library_folder(&self, folder: &Path) -> Result<(), CoreError> {
        let fs = self.ctx().fs.clone();
        self.library_mut().set_folder(fs.as_ref(), folder)
    }

    /// Moves a notebook before another in the library, or to the end.
    pub fn move_notebook(&self, path: &Path, before: Option<&Path>) -> Result<(), CoreError> {
        let fs = self.ctx().fs.clone();
        self.library_mut().move_to(fs.as_ref(), path, before)
    }

    /// The notes contract's "move a notebook to Trash": saves and closes the notebook if it is open, and
    /// removes it from the library. Its folder stays untouched until the app deletes it and calls
    /// [`Core::forget_notebook`].
    pub fn remove_notebook(&self, path: &Path) -> Result<RemovedEntry, CoreError> {
        if let Some(open) = self.find_open(path) {
            open.close()?;
        }
        let fs = self.ctx().fs.clone();
        let now = self.ctx().clock.now();
        self.library_mut().remove(fs.as_ref(), path, now)
    }

    /// Puts a removed notebook back where it was in the library, and opens it.
    pub fn restore_notebook(&self, path: &Path) -> Result<NotebookHandle, CoreError> {
        let fs = self.ctx().fs.clone();
        self.library_mut().restore(fs.as_ref(), path)?;
        self.open_notebook(path)
    }

    /// Forgets a removed notebook, after the app moved its folder to the operating system's recycle bin
    /// (spec 12.4).
    pub fn forget_notebook(&self, path: &Path) -> Result<(), CoreError> {
        let fs = self.ctx().fs.clone();
        self.library_mut().forget_removed(fs.as_ref(), path)
    }

    /// Renames an open notebook's folder after its title (A4-4), with a name that is safe and free beside it
    /// (spec 3.4). Windows can't rename a folder with files open inside, so the notebook is saved and closed first,
    /// which closes its journals and releases its lock, and opens again afterwards. The library records the rename
    /// before the folder is renamed, so a crash at any step is settled at the next start. If the folder can't be
    /// renamed, as when another app holds a file inside, the notebook opens again where it was and the error is
    /// returned. Returns the notebook's folder afterwards, the same one when its name already fits the title.
    pub fn rename_notebook_folder(&self, path: &Path) -> Result<PathBuf, CoreError> {
        let open = self.writable_open(path)?;
        let (Some(parent), Some(current)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) else {
            return Err(CoreError::NotFound(format!("notebook folder {}", path.display())));
        };
        let name = self.free_name(parent, &open.tree().title, Some(current))?;
        if name == current {
            return Ok(path.to_path_buf());
        }
        let to = parent.join(&name);
        drop(open);
        let fs = self.ctx().fs.clone();
        self.relocate(path, &to, &mut |from, to| Ok(fs.rename_dir(from, to).map(|_| ())?))?;
        Ok(to)
    }

    /// Moves an open notebook into the folder `parent` (A4-5), under its folder's name, or a free one like it.
    /// `copy` copies the notebook's files to the new folder and checks every byte of the copy, writing
    /// `notebook.json` last. On an error or a cancel it removes what it copied.
    ///
    /// The library names the new folder only once the copy is checked, and the old folder stays for the caller to
    /// remove. As with a rename, a crash at any step leaves the library naming a whole notebook. Returns the new
    /// folder.
    pub fn move_notebook_folder(
        &self,
        path: &Path,
        parent: &Path,
        copy: &mut dyn FnMut(&Path, &Path) -> Result<(), CoreError>,
    ) -> Result<PathBuf, CoreError> {
        let open = self.writable_open(path)?;
        let current = path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or_else(|| open.tree().title, str::to_owned);
        if path.parent().is_some_and(|above| same_path(above, parent)) {
            return Ok(path.to_path_buf());
        }
        let to = parent.join(self.free_name(parent, &current, None)?);
        drop(open);
        self.relocate(path, &to, copy)?;
        Ok(to)
    }

    /// The open, writable notebook at `path`.
    pub(super) fn writable_open(&self, path: &Path) -> Result<NotebookHandle, CoreError> {
        let open = self
            .find_open(path)
            .ok_or_else(|| CoreError::NotFound(format!("open notebook {}", path.display())))?;
        if open.is_backup() {
            return Err(CoreError::ReadOnly(crate::model::page::ReadOnlyReason::Backup));
        }
        open.check_writable()?;
        Ok(open)
    }

    /// A safe folder name for `title` that is free in `parent`, where `own` is the folder's current name there.
    fn free_name(&self, parent: &Path, title: &str, own: Option<&str>) -> Result<String, CoreError> {
        let fs = self.ctx().fs.clone();
        let own = own.map(fold_name);
        let taken: HashSet<String> = match fs.read_dir(parent) {
            Ok(entries) => entries.into_iter().map(|entry| fold_name(&entry.name)).collect(),
            Err(error) if error.kind == crate::error::FsErrorKind::NotFound => HashSet::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(safe_folder_name(title, &|n| {
            let folded = fold_name(n);
            Some(&folded) != own.as_ref() && taken.contains(&folded)
        }))
    }

    /// Closes the notebook at `from`, records the move in the library, runs `op` to put the folder at `to`, then
    /// names `to` in the library and opens the notebook there. On an error the notebook opens again at `from`.
    fn relocate(
        &self,
        from: &Path,
        to: &Path,
        op: &mut dyn FnMut(&Path, &Path) -> Result<(), CoreError>,
    ) -> Result<(), CoreError> {
        let open = self.writable_open(from)?;
        open.close()?;
        crate::fail_point!("notebook.folder.closed");
        let fs = self.ctx().fs.clone();
        if let Err(error) = self.library_mut().begin_rename(fs.as_ref(), from, to) {
            self.open_notebook(from)?;
            return Err(error);
        }
        crate::fail_point!("notebook.folder.recorded");
        if let Err(error) = op(from, to) {
            self.library_mut().abandon_rename(fs.as_ref())?;
            self.open_notebook(from)?;
            return Err(error);
        }
        crate::fail_point!("notebook.folder.renamed");
        self.library_mut().finish_rename(fs.as_ref())?;
        self.open_notebook(to)?;
        Ok(())
    }
}
