//! What an import made, as the interface shows it.
//!
//! An import writes a whole notebook folder into the notes folder that setup chose, in the note format, and the
//! core opens it like any notebook there. Its node IDs are the core's, so the notes service, the tree, and the
//! page commands reach it with no map between the interface's IDs and the core's. This module answers with the
//! new notebook's tree so the dialog can offer to open it, and cleans up what a crashed import left behind.

use std::{fs, path::Path};

use opennote_core::session::notebook::NotebookHandle;
use serde::Serialize;

/// The hidden folder an import works in, inside the notes folder, until it finishes (`DiskSink`).
const STAGING_PREFIX: &str = ".importing-";

/// Deletes what a crashed import left in its hidden working folder in the notes folder.
pub fn clean_staging(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(STAGING_PREFIX) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// An imported notebook as the interface shows it. Every ID is a node ID of the notes tree.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTree {
    /// The notebook's node ID.
    pub notebook_id: String,
    /// The notebook folder.
    pub dir: String,
    pub title: String,
    pub color: Option<String>,
    pub sections: Vec<ImportedSection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSection {
    /// The section's node ID.
    pub id: String,
    pub title: String,
    pub color: Option<String>,
    pub pages: Vec<ImportedPageNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPageNode {
    /// The page's node ID, which is the core's page ID.
    pub core: String,
    pub title: String,
    /// 0 for a page, 1 and 2 for subpages.
    pub level: u8,
}

/// The navigation tree of an imported notebook, in display order.
pub fn tree_of(handle: &NotebookHandle) -> ImportedTree {
    let tree = handle.tree();
    ImportedTree {
        notebook_id: tree.notebook.to_string(),
        dir: handle.path().to_string_lossy().into_owned(),
        title: tree.title,
        color: tree.color.map(|color| color.to_text()),
        sections: tree
            .sections
            .into_iter()
            .map(|section| ImportedSection {
                id: section.id.to_string(),
                title: section.title,
                color: section.color.map(|color| color.to_text()),
                pages: section
                    .pages
                    .into_iter()
                    .map(|page| ImportedPageNode {
                        core: page.id.to_string(),
                        title: page.title,
                        level: page.level,
                    })
                    .collect(),
            })
            .collect(),
    }
}
