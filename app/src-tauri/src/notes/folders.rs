//! Renaming a notebook renames its folder (A4-4), when the person keeps "Rename folders with notebooks" on. The core
//! closes the notebook, renames its folder to a safe, free name, and opens it again (library_api.rs). Pages of the
//! notebook that were open must open again, so the interface is told which.

use opennote_core::PageId;

use super::{from_core, tree::Found};
use crate::{core_bridge::Bridge, ipc::IpcResult};

/// The key in the shell's own choices (qol.json) for "Rename folders with notebooks". Absent means on.
pub const PREF_KEY: &str = "renameNotebookFolders";

/// Whether the choice, as read from qol.json, keeps folder renames on.
pub fn wanted(prefs: &serde_json::Map<String, serde_json::Value>) -> bool {
    prefs.get(PREF_KEY).and_then(serde_json::Value::as_bool).unwrap_or(true)
}

impl Bridge {
    /// Renames the folder of the notebook `id` after its title. Returns the pages that were open in it, which the
    /// interface opens again. Anything that isn't a notebook is left alone.
    pub(crate) fn rename_notebook_folder(&mut self, id: &str) -> IpcResult<Vec<PageId>> {
        let Found::Notebook(notebook) = self.find(id)? else {
            return Ok(Vec::new());
        };
        let path = notebook.path().to_path_buf();
        let book = notebook.id();
        drop(notebook);
        let moved = self.core.rename_notebook_folder(&path).map_err(from_core)?;
        if moved == path {
            return Ok(Vec::new());
        }
        Ok(self.forget_notebook_pages(book))
    }
}
