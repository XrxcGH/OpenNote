//! Trash items (spec 12.1): `item.json` in `.opennote/trash/<item ID>/`.

use serde::Serialize;

use super::{named_enum, DeviceRef, FormatInfo, Group, JsonMap, Named, PageEntry};
use crate::id::{GroupId, Id, SectionId, TrashItemId};
use crate::order::OrderKey;
use crate::time::Timestamp;

named_enum! {
    /// What a Trash item holds.
    TrashKind {
        /// A page with its subpages.
        Page = "page",
        /// A section.
        Section = "section",
        /// A section group with everything in it.
        Group = "group",
    }
}

named_enum! {
    /// Why an item is in Trash.
    #[derive(Default)]
    TrashReason {
        /// The person deleted it.
        #[default]
        Deleted = "deleted",
        /// It moved to another notebook, and this is the original (spec 18.2).
        Moved = "moved",
    }
}

/// The content of `item.json`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItemFile {
    /// The item's ID, which also names its folder.
    pub id: TrashItemId,
    /// What it holds.
    #[serde(rename = "itemKind")]
    pub kind: TrashKind,
    /// The deleted item's title, for the Trash list.
    pub title: String,
    /// When it was deleted.
    pub deleted_at: Timestamp,
    /// When it is purged.
    pub expires_at: Timestamp,
    /// The device that deleted it.
    pub deleted_by: DeviceRef,
    /// Why it is in Trash.
    pub reason: Named<TrashReason>,
    /// Where it came from, so it can go back.
    pub origin: TrashOrigin,
    /// The folders in the item, by name: page IDs for pages, section IDs for a section or group.
    pub contents: Vec<Id>,
    /// Unknown keys.
    #[serde(skip)]
    pub extra: JsonMap,
    /// What the reader found. Never written.
    #[serde(skip)]
    pub format: FormatInfo,
}

/// Where a Trash item came from (spec 12.1).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TrashOrigin {
    /// Pages: their section and their page entries, with order keys and parents.
    Pages {
        /// The section they came from.
        section: SectionId,
        /// That section's title, for the Trash list and for a new section if it is gone.
        section_title: String,
        /// The removed page entries.
        entries: Vec<PageEntry>,
    },
    /// A section: its group and position.
    Section {
        /// The group that held it, or `None` at the top level.
        group: Option<GroupId>,
        /// Its position among its siblings.
        order: OrderKey,
        /// The title of that group, or `None` at the top level.
        parent_title: Option<String>,
    },
    /// A section group: its definition and the groups nested in it.
    Group {
        /// The removed group definitions, the deleted group first.
        groups: Vec<Group>,
        /// The title of the group that held it, or `None` at the top level.
        parent_title: Option<String>,
    },
}
