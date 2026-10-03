//! The format functions tree code calls besides the codec, behind a seam so tree code can be tested with the
//! registry codec before the real formats land.

#[cfg(any(test, feature = "testing"))]
use std::collections::BTreeMap;

use crate::format::{readable, tree_json};
#[cfg(any(test, feature = "testing"))]
use crate::limits::Limits;
use crate::model::{NotebookFile, SectionFile};

/// Format functions outside [`crate::seams::Codec`] that tree code needs.
pub trait TreeFormats: Send + Sync + 'static {
    /// The notebook's `README.md` (spec 11.4).
    fn readme(&self, title: &str) -> Vec<u8>;
    /// Merges two copies of `section.json` (spec 14.3).
    fn merge_sections(&self, ours: &SectionFile, theirs: &SectionFile) -> SectionFile;
    /// Merges two copies of `notebook.json` (spec 14.3).
    fn merge_notebooks(&self, ours: &NotebookFile, theirs: &NotebookFile) -> NotebookFile;
    /// A page's title from the start of its `page.json`, without a full parse.
    fn page_title(&self, page_json: &[u8]) -> Option<String>;
}

/// The production formats: the functions of [`crate::format`].
#[derive(Clone, Copy, Debug, Default)]
pub struct CanonicalFormats;

impl TreeFormats for CanonicalFormats {
    fn readme(&self, title: &str) -> Vec<u8> {
        readable::render_readme(title)
    }

    fn merge_sections(&self, ours: &SectionFile, theirs: &SectionFile) -> SectionFile {
        tree_json::merge_sections(ours, theirs)
    }

    fn merge_notebooks(&self, ours: &NotebookFile, theirs: &NotebookFile) -> NotebookFile {
        tree_json::merge_notebooks(ours, theirs)
    }

    fn page_title(&self, page_json: &[u8]) -> Option<String> {
        crate::format::page_json::page_title_prefix(page_json)
    }
}

/// Simple formats for tests with the registry codec: a plain `README.md`, merges by ID with the later
/// `changed` time winning, and titles read through the codec.
#[cfg(any(test, feature = "testing"))]
pub struct SimpleFormats {
    codec: std::sync::Arc<dyn crate::seams::Codec>,
}

#[cfg(any(test, feature = "testing"))]
impl SimpleFormats {
    /// Formats that read titles through `codec`.
    pub fn new(codec: std::sync::Arc<dyn crate::seams::Codec>) -> SimpleFormats {
        SimpleFormats { codec }
    }
}

#[cfg(any(test, feature = "testing"))]
impl TreeFormats for SimpleFormats {
    fn readme(&self, title: &str) -> Vec<u8> {
        format!("# {title}\n\nThis folder is an OpenNote notebook.\n").into_bytes()
    }

    fn merge_sections(&self, ours: &SectionFile, theirs: &SectionFile) -> SectionFile {
        let mut merged = if theirs.changed > ours.changed {
            theirs.clone()
        } else {
            ours.clone()
        };
        let mut pages = BTreeMap::new();
        for entry in ours.pages.iter().chain(&theirs.pages) {
            let keep = pages
                .get(&entry.id)
                .is_none_or(|kept: &crate::model::PageEntry| entry.changed > kept.changed);
            if keep {
                pages.insert(entry.id, entry.clone());
            }
        }
        merged.pages = pages.into_values().collect();
        merged
    }

    fn merge_notebooks(&self, ours: &NotebookFile, theirs: &NotebookFile) -> NotebookFile {
        let mut merged = if theirs.changed > ours.changed {
            theirs.clone()
        } else {
            ours.clone()
        };
        let mut groups = BTreeMap::new();
        for group in ours.groups.iter().chain(&theirs.groups) {
            let keep = groups
                .get(&group.id)
                .is_none_or(|kept: &crate::model::Group| group.changed > kept.changed);
            if keep {
                groups.insert(group.id, group.clone());
            }
        }
        merged.groups = groups.into_values().collect();
        merged
    }

    fn page_title(&self, page_json: &[u8]) -> Option<String> {
        self.codec
            .read_page(page_json, &Limits::default())
            .ok()
            .map(|read| read.page.title)
    }
}
