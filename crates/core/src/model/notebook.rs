//! `notebook.json` (spec 4.1 and 4.3), and the navigation tree the interface shows.

use serde::Serialize;

use super::{Access, Color, FormatInfo, JsonMap, Warning};
use crate::id::{GroupId, NotebookId, PageId, SectionId};
use crate::order::OrderKey;
use crate::time::Timestamp;

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
    /// Every section group.
    pub groups: Vec<Group>,
    /// Every section outside Trash.
    pub sections: Vec<SectionNode>,
    /// Whether the notebook's own settings may change.
    pub access: Access,
    /// Notices from the scan, such as duplicate folders.
    pub notices: Vec<Warning>,
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
