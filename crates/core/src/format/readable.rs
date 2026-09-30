//! Readable copies (spec 11): `page.md`, `ink.svg`, `index.md`, and `README.md`. Owned by WP1.
//!
//! Nothing here is written for pages in encrypted sections (spec 5.7). The callers enforce that.

use crate::format::ReadableState;
use crate::model::{NotebookTree, Page};
use crate::seams::LinkResolver;

/// Renders `page.md` with its checksum (spec 11.1).
pub fn render_page_md(_page: &Page, _links: &dyn LinkResolver) -> Vec<u8> {
    unimplemented!("WP1: render_page_md")
}

/// Renders `ink.svg` (spec 11.3).
pub fn render_ink_svg(_page: &Page) -> Vec<u8> {
    unimplemented!("WP1: render_ink_svg")
}

/// Renders `index.md` (spec 11.4).
pub fn render_index_md(_tree: &NotebookTree) -> Vec<u8> {
    unimplemented!("WP1: render_index_md")
}

/// Renders the notebook's `README.md` (spec 11.4).
pub fn render_readme(_title: &str) -> Vec<u8> {
    unimplemented!("WP1: render_readme")
}

/// Tells a readable copy on disk apart: missing, damaged by a power cut, ours, or edited (spec 11.2).
pub fn classify_readable(_bytes: &[u8]) -> ReadableState {
    unimplemented!("WP1: classify_readable")
}
