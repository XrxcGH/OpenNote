//! The tag tree: every tag with the number of pages under it.

use std::collections::{BTreeMap, HashSet};

use serde::Serialize;

use crate::error::Result;
use crate::index::SearchIndex;
use crate::tags;

/// A tag, such as `exam/unit-3`, and how many pages carry it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNode {
    /// The tag in normal form. The `/` separates its parents.
    pub tag: String,
    /// Pages with this tag, or with a tag nested in it.
    pub pages: usize,
    /// Pages with exactly this tag.
    pub own_pages: usize,
}

impl SearchIndex {
    /// Every tag, including the parents that exist only because a nested tag does, sorted by name. A parent
    /// always comes before the tags nested in it.
    pub fn tag_tree(&self) -> Result<Vec<TagNode>> {
        let mut statement = self.conn.prepare_cached("SELECT page, tag FROM tags")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        let mut pages: BTreeMap<String, HashSet<i64>> = BTreeMap::new();
        let mut own: BTreeMap<String, usize> = BTreeMap::new();
        for row in rows {
            let (page, tag) = row?;
            *own.entry(tag.clone()).or_default() += 1;
            for parent in tags::ancestors(&tag) {
                pages.entry(parent.to_string()).or_default().insert(page);
            }
            pages.entry(tag).or_default().insert(page);
        }
        let mut nodes: Vec<TagNode> = pages
            .into_iter()
            .map(|(tag, set)| TagNode {
                own_pages: own.get(&tag).copied().unwrap_or(0),
                pages: set.len(),
                tag,
            })
            .collect();
        nodes.sort_by(|a, b| a.tag.split('/').cmp(b.tag.split('/')));
        Ok(nodes)
    }
}
