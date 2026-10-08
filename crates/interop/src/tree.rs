//! Building the section files that list imported pages.

use opennote_core::model::{Color, FormatInfo, JsonMap, Page, PageEntry, SectionFile};
use opennote_core::{OrderKey, PageId, SectionId, Timestamp};

use crate::error::{InteropError, Result};
use crate::sink::ImportEnv;

/// A page listed in a section.
struct Listed {
    id: PageId,
    title: String,
    parent: Option<PageId>,
    changed: Timestamp,
    color: Option<Color>,
}

/// Collects the page entries of one section.
pub struct SectionBuilder {
    id: SectionId,
    title: String,
    created: Timestamp,
    changed: Timestamp,
    entries: Vec<Listed>,
}

impl SectionBuilder {
    /// Starts a section. Its title is cut to a sensible length.
    pub fn new(env: &ImportEnv<'_>, title: &str, created: Timestamp) -> SectionBuilder {
        SectionBuilder {
            id: SectionId::generate(env.clock),
            title: title.chars().take(200).collect(),
            created,
            changed: created,
            entries: Vec::new(),
        }
    }

    /// The section's ID, for the pages it holds.
    pub fn id(&self) -> SectionId {
        self.id
    }

    /// Whether any page was added.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Lists a page. `parent` makes it a subpage of another page in this section.
    pub fn add_page(&mut self, page: &Page, parent: Option<PageId>) {
        self.add_colored_page(page, parent, None);
    }

    /// Lists a page with a color chip in the navigation tree.
    pub fn add_colored_page(&mut self, page: &Page, parent: Option<PageId>, color: Option<Color>) {
        self.changed = self.changed.max(page.modified);
        self.entries.push(Listed {
            id: page.id,
            title: page.title.clone(),
            parent,
            changed: page.modified,
            color,
        });
    }

    /// Finishes the section file. The pages keep the order in which they were added.
    pub fn finish(self, order: OrderKey) -> Result<SectionFile> {
        let keys = OrderKey::spread(None, None, self.entries.len())
            .map_err(|e| InteropError::format("page order", e.to_string()))?;
        let pages = self
            .entries
            .into_iter()
            .zip(keys)
            .map(|(listed, order)| PageEntry {
                id: listed.id,
                title: listed.title,
                parent: listed.parent,
                order,
                pinned: false,
                color: listed.color,
                changed: listed.changed,
                moving: None,
                extra: JsonMap::new(),
            })
            .collect();
        Ok(SectionFile {
            id: self.id,
            title: self.title,
            color: None,
            group: None,
            order,
            created: self.created,
            changed: self.changed,
            defaults: None,
            encryption: None,
            pages,
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        })
    }
}

/// Order keys for `count` sections, in order.
pub fn section_orders(count: usize) -> Result<Vec<OrderKey>> {
    OrderKey::spread(None, None, count).map_err(|e| InteropError::format("section order", e.to_string()))
}
