//! The library through the core: the notebooks this device shows and their order, the notes folder, and
//! notebooks moved to Trash, which only leave the library (Phase 2 notes contract, section 12).

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::Core;
use crate::error::CoreError;
use crate::format::names::{fold_name, safe_folder_name};
use crate::id::NotebookId;
use crate::session::library::RemovedEntry;
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

    /// Names the folder of a notebook that has no sections yet after its title, as when the person names a new
    /// notebook right after making it. A notebook with content keeps its folder name (spec 3.4), as do one
    /// whose folder can't be renamed and one already named so. Returns the notebook, opened again from its new
    /// folder when it moved.
    pub fn name_new_notebook_folder(&self, notebook: &NotebookHandle) -> Result<NotebookHandle, CoreError> {
        let tree = notebook.tree();
        let path = notebook.path().to_path_buf();
        let (Some(parent), Some(current)) = (path.parent(), path.file_name().and_then(|n| n.to_str())) else {
            return Ok(notebook.clone());
        };
        if !tree.sections.is_empty() || !tree.groups.is_empty() {
            return Ok(notebook.clone());
        }
        let fs = self.ctx().fs.clone();
        let taken: Vec<String> = fs
            .read_dir(parent)?
            .into_iter()
            .map(|e| fold_name(&e.name))
            .filter(|name| *name != fold_name(current))
            .collect();
        let name = safe_folder_name(&tree.title, &|n| taken.contains(&fold_name(n)));
        if name == current {
            return Ok(notebook.clone());
        }
        let target = parent.join(&name);
        notebook.clone().close()?;
        let moved = fs.rename_dir(&path, &target).is_ok();
        let now = if moved { &target } else { &path };
        if moved {
            self.library_mut().repath(fs.as_ref(), &path, &target)?;
        }
        self.open_notebook(now)
    }

    /// Puts a removed notebook back where it was in the library, and opens it.
    pub fn restore_notebook(&self, path: &Path) -> Result<NotebookHandle, CoreError> {
        let fs = self.ctx().fs.clone();
        let removed = self.library_mut().restore(fs.as_ref(), path)?;
        self.open_notebook(path).inspect_err(|_| {
            // A notebook whose folder is gone or damaged stays in Trash rather than haunting the library.
            let _ = self.library_mut().unrestore(fs.as_ref(), removed);
        })
    }

    /// Forgets a removed notebook, after the app moved its folder to the operating system's recycle bin
    /// (spec 12.4).
    pub fn forget_notebook(&self, path: &Path) -> Result<(), CoreError> {
        let fs = self.ctx().fs.clone();
        self.library_mut().forget_removed(fs.as_ref(), path)
    }
}
