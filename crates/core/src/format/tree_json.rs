//! `section.json` and `notebook.json` (spec 4), and merging sync-tool copies of them (spec 14.3). Owned by WP1.

use crate::error::FormatError;
use crate::limits::Limits;
use crate::model::{NotebookFile, SectionFile};

/// Reads `section.json`.
pub fn read_section(_bytes: &[u8], _limits: &Limits) -> Result<SectionFile, FormatError> {
    unimplemented!("WP1: read_section")
}

/// Writes `section.json` in canonical form.
pub fn write_section(_file: &SectionFile) -> Vec<u8> {
    unimplemented!("WP1: write_section")
}

/// Reads `notebook.json`.
pub fn read_notebook(_bytes: &[u8], _limits: &Limits) -> Result<NotebookFile, FormatError> {
    unimplemented!("WP1: read_notebook")
}

/// Writes `notebook.json` in canonical form.
pub fn write_notebook(_file: &NotebookFile) -> Vec<u8> {
    unimplemented!("WP1: write_notebook")
}

/// Merges two copies of `section.json`: the union of entries by ID, each from the copy changed later.
pub fn merge_sections(_ours: &SectionFile, _theirs: &SectionFile) -> SectionFile {
    unimplemented!("WP1: merge_sections")
}

/// Merges two copies of `notebook.json` the same way.
pub fn merge_notebooks(_ours: &NotebookFile, _theirs: &NotebookFile) -> NotebookFile {
    unimplemented!("WP1: merge_notebooks")
}
