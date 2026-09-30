//! The parts of OpenNote Markdown the core needs (spec 7): escaping and links. Owned by WP1.
//!
//! The core otherwise treats Markdown as an opaque string.

use crate::id::{AssetId, Id, NotebookId, PageId, SectionId};
use crate::seams::LinkResolver;

/// A link found in Markdown (spec 7.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkTarget {
    /// `opennote:page/<page ID>`, optionally with `#<block or element ID>`.
    Page {
        /// The page.
        page: PageId,
        /// A block or text element on it.
        anchor: Option<Id>,
    },
    /// `opennote:section/<section ID>`.
    Section(SectionId),
    /// `opennote:notebook/<notebook ID>`.
    Notebook(NotebookId),
    /// `asset:<asset ID>`.
    Asset(AssetId),
    /// A web or email link.
    External(String),
    /// A link with an unknown scheme, kept but never opened.
    Other(String),
}

/// Escapes text as spec 7.6 requires. `at_line_start` says whether the text begins a paragraph line.
pub fn escape_text(_text: &str, _at_line_start: bool) -> String {
    unimplemented!("WP1: escape_text")
}

/// Rewrites page and asset links into relative paths for `page.md` (spec 11.1).
pub fn rewrite_links(_markdown: &str, _from: PageId, _links: &dyn LinkResolver) -> String {
    unimplemented!("WP1: rewrite_links")
}

/// Every link in a text block's Markdown.
pub fn outgoing_links(_markdown: &str) -> Vec<LinkTarget> {
    unimplemented!("WP1: outgoing_links")
}
