//! `notebook.json` (spec 4.1 and 4.3), and the navigation tree the interface shows.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Access, Color, FormatInfo, JsonMap, Warning};
use crate::id::{GroupId, NotebookId, PageId, SectionId};
use crate::order::OrderKey;
use crate::time::Timestamp;

/// The names of the styles a version 1 reader knows, in the order `notebook.json` writes them (spec 4.1).
pub const STYLE_NAMES: [&str; 10] = ["normal", "h1", "h2", "h3", "h4", "h5", "h6", "title", "quote", "code"];

/// How a notebook shows one named style (spec 4.1 and 6.6). A missing value means the app's own.
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleSpec {
    /// The font family.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    /// The text size in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    /// The text color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// Space above the element in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_before: Option<f64>,
    /// Space below the element in page units.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_after: Option<f64>,
    /// The line height as a multiple of the size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    /// Unknown keys.
    #[serde(flatten)]
    pub extra: JsonMap,
}

impl StyleSpec {
    /// What is wrong with a style a person sets, or `None`. Readers show a value outside its range as if it were
    /// missing, so a file with one still opens (spec 4.1).
    pub fn problem(&self) -> Option<&'static str> {
        let within =
            |value: Option<f64>, low: f64, high: f64| value.is_none_or(|v| v.is_finite() && v >= low && v <= high);
        if self
            .font
            .as_ref()
            .is_some_and(|f| f.is_empty() || f.chars().count() > 200)
        {
            Some("a font name is 1 to 200 characters")
        } else if !within(self.size, 1.0, 1_000.0) {
            Some("a size is from 1 to 1000")
        } else if !within(self.space_before, 0.0, 1_000.0) || !within(self.space_after, 0.0, 1_000.0) {
            Some("a space is from 0 to 1000")
        } else if !within(self.line_height, 0.5, 10.0) {
            Some("a line height is from 0.5 to 10")
        } else {
            None
        }
    }
}

/// The most styles a notebook keeps, and the longest style name (spec 16).
pub const MAX_STYLES: usize = 64;
/// The longest style name in characters.
pub const MAX_STYLE_NAME_CHARS: usize = 64;

/// The named styles of a notebook, by style name. Names a reader doesn't know are kept (spec 2.9). An empty
/// map means the notebook has no `styles` and shows the app's own.
pub type NotebookStyles = BTreeMap<String, StyleSpec>;

/// The content of `notebook.json`.
#[derive(Clone, Debug, PartialEq)]
pub struct NotebookFile {
    /// The notebook's identity.
    pub id: NotebookId,
    /// The display name. It can differ from the folder name.
    pub title: String,
    /// The notebook's color chip.
    pub color: Option<Color>,
    /// When the notebook was made.
    pub created: Timestamp,
    /// When a field of this file last changed. Used only to merge sync copies.
    pub changed: Timestamp,
    /// Defaults for new pages. Only `view` is defined in version 1.
    pub defaults: Option<JsonMap>,
    /// How the notebook shows each named style.
    pub styles: NotebookStyles,
    /// Section groups, in any order. Each group names its parent and order.
    pub groups: Vec<Group>,
    /// Unknown keys.
    pub extra: JsonMap,
    /// What the reader found. Never written.
    pub format: FormatInfo,
}

impl NotebookFile {
    /// A new notebook with no groups.
    pub fn new(id: NotebookId, title: impl Into<String>, created: Timestamp) -> NotebookFile {
        NotebookFile {
            id,
            title: title.into(),
            color: None,
            created,
            changed: created,
            defaults: None,
            styles: NotebookStyles::new(),
            groups: Vec::new(),
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        }
    }
}

/// A section group (spec 4.3). Groups nest like folders, at most 4 levels deep.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    /// The group's identity.
    pub id: GroupId,
    /// The display name.
    pub title: String,
    /// The group's color chip.
    pub color: Option<Color>,
    /// The group that holds this one, or `None` at the top level.
    pub parent: Option<GroupId>,
    /// Position among the groups and sections with the same parent.
    pub order: OrderKey,
    /// When the group was made.
    pub created: Timestamp,
    /// When a field of the group last changed.
    pub changed: Timestamp,
    /// Unknown keys.
    #[serde(skip)]
    pub extra: JsonMap,
}

/// The navigation tree of one notebook, as the interface shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookTree {
    /// The notebook's identity.
    pub notebook: NotebookId,
    /// The display name.
    pub title: String,
    /// The notebook's color chip.
    pub color: Option<Color>,
    /// When the notebook was made.
    pub created: Timestamp,
    /// When `notebook.json` last changed.
    pub changed: Timestamp,
    /// How the notebook shows each named style.
    pub styles: NotebookStyles,
    /// Every section group.
    pub groups: Vec<Group>,
    /// Every section outside Trash.
    pub sections: Vec<SectionNode>,
    /// Whether the notebook's own settings may change.
    pub access: Access,
    /// Notices from the scan, such as duplicate folders.
    pub notices: Vec<Warning>,
    /// Archived: hidden from the library until "Show archived" (the unknown key `archived`).
    pub archived: bool,
}

/// A group or a section: a child of the notebook or of a group.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TreeChild<'a> {
    /// A section group.
    Group(&'a Group),
    /// A section.
    Section(&'a SectionNode),
}

impl TreeChild<'_> {
    fn sort_key(&self) -> (&OrderKey, crate::id::Id) {
        match self {
            TreeChild::Group(group) => (&group.order, group.id.0),
            TreeChild::Section(section) => (&section.order, section.id.0),
        }
    }
}

impl NotebookTree {
    /// The groups and sections directly under `parent`, or under the notebook for `None`, in display order:
    /// by order key, then ID.
    pub fn children(&self, parent: Option<GroupId>) -> Vec<TreeChild<'_>> {
        let groups = self.groups.iter().filter(|g| g.parent == parent).map(TreeChild::Group);
        let sections = self
            .sections
            .iter()
            .filter(|s| s.group == parent)
            .map(TreeChild::Section);
        let mut children: Vec<TreeChild<'_>> = groups.chain(sections).collect();
        children.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        children
    }

    /// How deep a group sits: 1 for a group at the top level. `None` for a missing group or a loop.
    pub fn group_depth(&self, group: GroupId) -> Option<u32> {
        let mut depth = 0;
        let mut current = Some(group);
        while let Some(id) = current {
            depth += 1;
            if depth > self.groups.len() {
                return None;
            }
            current = self.groups.iter().find(|g| g.id == id)?.parent;
        }
        u32::try_from(depth).ok()
    }

    /// The section with this ID.
    pub fn section(&self, id: SectionId) -> Option<&SectionNode> {
        self.sections.iter().find(|s| s.id == id)
    }

    /// The section and node of a page.
    pub fn find_page(&self, id: PageId) -> Option<(&SectionNode, &PageNode)> {
        self.sections
            .iter()
            .find_map(|s| s.pages.iter().find(|p| p.id == id).map(|p| (s, p)))
    }
}

/// The unknown key in a tree file's entries that marks a node archived. Older versions keep it as it is.
pub const ARCHIVED_KEY: &str = "archived";

/// Whether an entry's unknown keys mark it archived.
pub fn is_archived(extra: &JsonMap) -> bool {
    extra.get(ARCHIVED_KEY).and_then(serde_json::Value::as_bool).unwrap_or(false)
}

/// Marks an entry archived or not. True when the entry changed.
pub fn set_archived(extra: &mut JsonMap, archived: bool) -> bool {
    if is_archived(extra) == archived {
        return false;
    }
    if archived {
        extra.insert(ARCHIVED_KEY.to_owned(), serde_json::Value::Bool(true));
    } else {
        extra.remove(ARCHIVED_KEY);
    }
    true
}

/// A section in the navigation tree.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionNode {
    /// The section's identity.
    pub id: SectionId,
    /// The display name.
    pub title: String,
    /// The section's color chip.
    pub color: Option<Color>,
    /// The group that holds it, or `None` at the top level.
    pub group: Option<GroupId>,
    /// Position among its siblings.
    pub order: OrderKey,
    /// When the section was made.
    pub created: Timestamp,
    /// When `section.json` last changed.
    pub changed: Timestamp,
    /// Its pages in display order: each page followed by its subpages.
    pub pages: Vec<PageNode>,
    /// Whether the section's settings and page list may change.
    pub access: Access,
    /// The section is encrypted (spec 5.7). Its pages are locked, and nothing about them is indexed.
    pub encrypted: bool,
    /// Archived: hidden from the tree until "Show archived" (the unknown key `archived`).
    pub archived: bool,
}

/// A page in the navigation tree.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageNode {
    /// The page's identity.
    pub id: PageId,
    /// The title copy from `section.json`, repaired from `page.json` when they differ.
    pub title: String,
    /// The parent page, for a subpage.
    pub parent: Option<PageId>,
    /// Position among pages with the same parent.
    pub order: OrderKey,
    /// 0 for a page, 1 for a subpage, and 2 for a sub-subpage (spec 4.4).
    pub level: u8,
    /// Pinned in the navigation tree.
    pub pinned: bool,
    /// Archived: hidden from the tree until "Show archived" (the unknown key `archived`).
    pub archived: bool,
    /// The page's color chip.
    pub color: Option<Color>,
    /// When the page was made: from the device-local cache, or the page ID's time until the cache knows.
    pub created: Timestamp,
    /// The last content change, from the device-local cache (spec 20.1).
    pub modified: Option<Timestamp>,
    /// Whether the page can be opened.
    pub state: PageNodeState,
}

/// The state of a page in the navigation tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PageNodeState {
    /// An ordinary page.
    Normal,
    /// A move or restore whose folder is still on its way (spec 18.2).
    Moving,
    /// A deletion whose folder is still on its way to Trash (spec 12.2).
    PendingDelete,
    /// The page's folder is missing (spec 18.3).
    Unavailable {
        /// A sync tool manages the notebook, so the folder may still arrive.
        maybe_syncing: bool,
    },
    /// Another folder holds the same page ID (spec 14.4).
    Duplicate,
}

#[cfg(test)]
mod tests;
