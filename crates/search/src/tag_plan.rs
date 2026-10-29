//! What renaming, merging, or deleting a tag would change, listed before anything changes.
//!
//! FEATURES.md asks for a preview of how many pages will change before a tag is renamed, merged, or deleted.
//! The plan reads the index, so it says which pages hold the tag and which tags move. The interface applies it
//! through the core, as one undo step. The index holds pages, not lines, so the line count of a tag on single
//! lines comes from reading those pages.

use std::collections::HashSet;

use opennote_core::PageId;
use serde::Serialize;

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::tags;

/// One tag that changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagChange {
    /// The tag now, in normal form.
    pub from: String,
    /// The tag after the change, or `None` when the tag is deleted.
    pub to: Option<String>,
    /// The pages that carry exactly this tag, in ID order.
    pub pages: Vec<PageId>,
}

/// Everything a tag change touches.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPlan {
    /// Each tag that changes, sorted by name. Tags nested in the tag go with it.
    pub changes: Vec<TagChange>,
    /// How many different pages change.
    pub page_count: usize,
    /// The new name already exists, so the tags merge with it.
    pub merges: bool,
}

impl TagPlan {
    fn empty() -> TagPlan {
        TagPlan {
            changes: Vec::new(),
            page_count: 0,
            merges: false,
        }
    }
}

impl SearchIndex {
    /// The plan to rename `from` to `to`, or to merge it into `to` when that tag exists. Tags nested in `from`
    /// move with it, so renaming `school` to `uni` also renames `school/biology` to `uni/biology`.
    ///
    /// The plan is empty when either name is empty after normalizing, or the names are the same.
    pub fn plan_tag_rename(&self, from: &str, to: &str) -> Result<TagPlan> {
        let (Some(from), Some(to)) = (tags::normalize(from), tags::normalize(to)) else {
            return Ok(TagPlan::empty());
        };
        if from == to {
            return Ok(TagPlan::empty());
        }
        let mut plan = self.plan(&from, Some(&to))?;
        let inside_itself = to.starts_with(&format!("{from}/"));
        plan.merges = !plan.changes.is_empty() && !inside_itself && self.tag_exists(&to)?;
        Ok(plan)
    }

    /// The plan to delete `tag` and the tags nested in it. It lists the pages that lose a tag.
    pub fn plan_tag_delete(&self, tag: &str) -> Result<TagPlan> {
        match tags::normalize(tag) {
            Some(tag) => self.plan(&tag, None),
            None => Ok(TagPlan::empty()),
        }
    }

    fn plan(&self, from: &str, to: Option<&str>) -> Result<TagPlan> {
        let (low, high) = tags::inside_bounds(from);
        let mut statement = self.conn.prepare_cached(
            "SELECT t.tag, p.id FROM tags t JOIN pages p ON p.rid = t.page
             WHERE t.tag = ?1 OR (t.tag >= ?2 AND t.tag < ?3) ORDER BY t.tag, p.id",
        )?;
        let rows = statement.query_map([from, low.as_str(), high.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut changes: Vec<TagChange> = Vec::new();
        let mut all_pages: HashSet<PageId> = HashSet::new();
        for row in rows {
            let (tag, page) = row?;
            let page: PageId = parse_id(&page)?;
            all_pages.insert(page);
            if changes.last().is_none_or(|last| last.from != tag) {
                let renamed = to.map(|to| format!("{to}{}", &tag[from.len()..]));
                changes.push(TagChange {
                    from: tag,
                    to: renamed,
                    pages: Vec::new(),
                });
            }
            if let Some(last) = changes.last_mut() {
                last.pages.push(page);
            }
        }
        Ok(TagPlan {
            changes,
            page_count: all_pages.len(),
            merges: false,
        })
    }

    fn tag_exists(&self, tag: &str) -> Result<bool> {
        let (low, high) = tags::inside_bounds(tag);
        let mut statement = self
            .conn
            .prepare_cached("SELECT EXISTS (SELECT 1 FROM tags WHERE tag = ?1 OR (tag >= ?2 AND tag < ?3))")?;
        Ok(statement.query_row([tag, low.as_str(), high.as_str()], |row| row.get(0))?)
    }
}
