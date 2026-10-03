//! What collections, the graph filters, the daily notes calendar, and the Tags pane ask of the index: a row for each
//! page with its place, dates, and tags, and the pages in a scope that may hold tagged lines or open checkboxes.

use std::collections::{BTreeMap, HashSet};

use opennote_core::{NotebookId, PageId, SectionId};
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};

/// A page as the interface lists it. Dates are Unix milliseconds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageFact {
    /// The page.
    pub page: PageId,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// Its title.
    pub title: String,
    /// When it was made.
    pub created: i64,
    /// When its content last changed.
    pub modified: i64,
    /// Its tags, and the tags of its lines, in normal form.
    pub tags: Vec<String>,
    /// The page has properties, which only the page file holds in full.
    pub has_properties: bool,
}

/// Where the Tags pane looks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum Scope {
    /// One page.
    Page(PageId),
    /// One section.
    Section(SectionId),
    /// One notebook.
    Notebook(NotebookId),
    /// Every notebook.
    All,
}

/// A block whose text holds some words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextHit {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// The block.
    pub block: String,
    /// The kind of block: `text`, `tables`, `images`, `files`, `ink`, or `other`.
    pub kind: String,
}

impl SearchIndex {
    /// The blocks whose text holds `needle` anywhere, ignoring ASCII case, in page order. This is a literal
    /// search for replace, not the word search of [`SearchIndex::search`]: `cat` finds `concatenate`.
    pub fn blocks_containing(&self, needle: &str, limit: usize) -> Result<Vec<TextHit>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT p.id, p.title, b.id, b.kind FROM blocks b JOIN pages p ON p.rid = b.page
             WHERE instr(lower(b.text), lower(?1)) > 0 ORDER BY p.rid, b.ord LIMIT ?2",
        )?;
        let rows = statement.query_map(rusqlite::params![needle, i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut hits = Vec::new();
        for row in rows {
            let (page, title, block, kind) = row?;
            hits.push(TextHit {
                page: parse_id(&page)?,
                title,
                block,
                kind,
            });
        }
        Ok(hits)
    }

    /// Every page of a notebook, or of all notebooks with `None`, in the order the index holds them.
    pub fn page_facts(&self, notebook: Option<NotebookId>) -> Result<Vec<PageFact>> {
        self.facts_where(notebook.map(|id| ("notebook", id.to_string())), false)
    }

    /// The pages of a scope that may hold a tagged line or an open checkbox: pages with a tag of any kind, and
    /// pages whose text has an unchecked `[ ]` box. The caller reads those pages to find the lines.
    pub fn tag_candidates(&self, scope: Scope) -> Result<Vec<PageFact>> {
        let filter = match scope {
            Scope::Page(id) => Some(("id", id.to_string())),
            Scope::Section(id) => Some(("section", id.to_string())),
            Scope::Notebook(id) => Some(("notebook", id.to_string())),
            Scope::All => None,
        };
        self.facts_where(filter, true)
    }

    fn facts_where(&self, filter: Option<(&str, String)>, candidates_only: bool) -> Result<Vec<PageFact>> {
        let mut tags: BTreeMap<i64, Vec<String>> = BTreeMap::new();
        {
            let mut statement = self.conn.prepare_cached("SELECT page, tag FROM tags ORDER BY tag")?;
            let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            for row in rows {
                let (page, tag) = row?;
                tags.entry(page).or_default().push(tag);
            }
        }
        let boxes: HashSet<i64> = if candidates_only {
            let mut statement = self.conn.prepare_cached(
                "SELECT DISTINCT page FROM blocks WHERE kind = 'text' AND (text LIKE '%[ ] %' OR text LIKE '%[ ]' || char(10) || '%')",
            )?;
            let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        } else {
            HashSet::new()
        };
        let properties: HashSet<i64> = {
            let mut statement = self.conn.prepare_cached(
                "SELECT b.page FROM blocks b JOIN pages p ON p.rid = b.page WHERE b.id = p.id AND b.kind = 'other'",
            )?;
            let rows = statement.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        let sql = match &filter {
            Some((column, _)) => format!(
                "SELECT rid, id, notebook, section, title, created, modified FROM pages WHERE {column} = ?1 ORDER BY rid"
            ),
            None => "SELECT rid, id, notebook, section, title, created, modified FROM pages ORDER BY rid".to_owned(),
        };
        let mut statement = self.conn.prepare_cached(&sql)?;
        let read = |row: &rusqlite::Row<'_>| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        };
        let rows: Vec<_> = match &filter {
            Some((_, value)) => statement.query_map([value], read)?.collect::<rusqlite::Result<_>>()?,
            None => statement.query_map([], read)?.collect::<rusqlite::Result<_>>()?,
        };
        let mut facts = Vec::with_capacity(rows.len());
        for (rid, id, notebook, section, title, created, modified) in rows {
            let page_tags = tags.remove(&rid).unwrap_or_default();
            if candidates_only && page_tags.is_empty() && !boxes.contains(&rid) {
                continue;
            }
            facts.push(PageFact {
                page: parse_id(&id)?,
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
                title,
                created,
                modified,
                tags: page_tags,
                has_properties: properties.contains(&rid),
            });
        }
        Ok(facts)
    }
}
