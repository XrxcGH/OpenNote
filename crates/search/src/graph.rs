//! The link graph: backlinks, outgoing links, title suggestions for `[[` autocomplete, and rename edits.
//!
//! The index stores each link as written. A title link finds its target through the target's current title,
//! and an ID link through the page ID, so moving a page never breaks either. Renaming a page breaks title links
//! until the blocks that hold them are rewritten, which [`SearchIndex::rename_edits`] lists.

use opennote_core::{BlockId, NotebookId, PageId, SectionId};
use rusqlite::params;
use serde::Serialize;

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::links::{self, LinkKind, Rename};
use crate::query::Term;
use crate::resolve::LinkStatus;
use crate::snippet::{self, Snippet, StoredBlock};
use crate::text::{fold, words};

/// A link to a page, seen from the page it points at.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    /// The page that holds the link.
    pub source: PageId,
    /// Its title.
    pub source_title: String,
    /// The block that holds the link.
    pub block: BlockId,
    /// The link as written in the block's Markdown.
    pub link: String,
    /// The heading or element the link points at, if it names one.
    pub fragment: Option<String>,
    /// The words around the link.
    pub context: Option<Snippet>,
    /// The link names an old title of the page. It still opens the page, and
    /// [`SearchIndex::repair_edits`] lists the edit that brings it up to date.
    pub stale: bool,
}

/// A page a link points at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    /// The page.
    pub page: PageId,
    /// Its title now.
    pub title: String,
    /// The block the link lands on: a heading that matched, or the block named in an ID link.
    pub block: Option<BlockId>,
}

/// A link of a page, with the pages it points at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLink {
    /// The block that holds the link.
    pub block: BlockId,
    /// The link as written.
    pub link: String,
    /// The text of the link.
    pub label: String,
    /// The heading or element after the `#`.
    pub fragment: Option<String>,
    /// The pages the link points at, closest first. None means a broken link, and several mean an ambiguous
    /// title.
    pub targets: Vec<LinkTarget>,
    /// How the link fares: resolved, ambiguous, found through an old title, or broken.
    pub status: LinkStatus,
    /// The link names a heading that no target page has.
    pub heading_missing: bool,
}

/// A page offered while a person types `[[`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSuggestion {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
}

/// A heading of a page, offered while a person types `[[Page#`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingRef {
    /// The block that holds the heading.
    pub block: BlockId,
    /// 1 to 6.
    pub level: u8,
    /// The heading's plain text.
    pub text: String,
}

/// One change a rename makes to the text of a block.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEdit {
    /// The page that holds the block.
    pub page: PageId,
    /// The block whose Markdown holds the link.
    pub block: BlockId,
    /// The link as it stands in the block.
    pub old: String,
    /// The link after the rename.
    pub new: String,
}

impl LinkEdit {
    /// Applies the edit to the Markdown of its block, or to one table cell of it. Only a link changes: the same
    /// text in a code span or a fenced block is an example, and stays.
    pub fn apply(&self, markdown: &str) -> String {
        let mut out = markdown.to_string();
        for link in links::parse(markdown).iter().rev() {
            if link.raw == self.old {
                out.replace_range(link.start..link.start + link.raw.len(), &self.new);
            }
        }
        out
    }
}

impl SearchIndex {
    /// The links that point at a page, newest source page first. A title link counts for every page with
    /// that title, and a link from a page to itself does not count.
    pub fn backlinks(&self, page: PageId) -> Result<Vec<Backlink>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT DISTINCT src.rid, src.id, src.title, l.block, l.raw, l.fragment, l.title, src.modified,
                    (l.kind = 'title' AND l.title_norm != COALESCE((SELECT title_norm FROM pages WHERE id = ?1), ''))
             FROM links l JOIN pages src ON src.rid = l.page
             WHERE src.id != ?1
               AND (l.target = ?1
                    OR l.title_norm = (SELECT title_norm FROM pages WHERE id = ?1)
                    OR (l.title_norm IN (SELECT a.title_norm FROM aliases a WHERE a.page = ?1)
                        AND NOT EXISTS (SELECT 1 FROM pages q WHERE q.title_norm = l.title_norm)))
             ORDER BY src.modified DESC, src.rid, l.block, l.raw",
        )?;
        let rows = statement.query_map([page.to_string()], |row| {
            let text = |n: usize| row.get::<_, String>(n);
            Ok((
                row.get::<_, i64>(0)?,
                text(1)?,
                text(2)?,
                text(3)?,
                text(4)?,
                row.get(5)?,
                text(6)?,
                row.get::<_, bool>(8)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (rid, source, source_title, block, link, fragment, label, stale) = row?;
            let block: BlockId = parse_id(&block)?;
            out.push(Backlink {
                source: parse_id(&source)?,
                source_title,
                block,
                context: self.link_context(rid, block, &label)?,
                link,
                fragment,
                stale,
            });
        }
        Ok(out)
    }

    fn link_context(&self, rid: i64, block: BlockId, label: &str) -> Result<Option<Snippet>> {
        let blocks: Vec<StoredBlock> = self.stored_blocks(rid)?.into_iter().filter(|b| b.id == block).collect();
        let term = Term {
            words: words(label).into_iter().map(|w| w.folded).collect(),
            prefix: false,
        };
        Ok(snippet::best(&blocks, &[term]))
    }

    /// The links a page holds, each with the pages it points at now.
    pub fn outgoing_links(&self, page: PageId) -> Result<Vec<OutgoingLink>> {
        let place = self.place_of(Some(page))?;
        let mut statement = self.conn.prepare_cached(
            "SELECT l.block, l.kind, l.title, l.title_norm, l.target, l.fragment, l.raw
             FROM links l JOIN pages p ON p.rid = l.page WHERE p.id = ?1 ORDER BY l.rowid",
        )?;
        let rows = statement.query_map([page.to_string()], |row| {
            let text = |n: usize| row.get::<_, String>(n);
            Ok((
                text(0)?,
                text(1)?,
                text(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                text(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (block, kind, label, norm, target, fragment, link): RawLink = row?;
            let resolution = match kind.as_str() {
                "title" => self.resolve_parts(norm.as_deref(), None, fragment.as_deref(), place)?,
                _ => self.resolve_parts(None, target.as_deref(), fragment.as_deref(), place)?,
            };
            out.push(OutgoingLink {
                block: parse_id(&block)?,
                link,
                label,
                fragment,
                targets: resolution.targets,
                status: resolution.status,
                heading_missing: resolution.heading_missing,
            });
        }
        Ok(out)
    }

    /// The pages whose title starts with `prefix`, for `[[` autocomplete. An empty prefix lists the newest pages.
    pub fn suggest_pages(&self, prefix: &str, limit: usize) -> Result<Vec<PageSuggestion>> {
        let low = fold(prefix);
        let high = format!("{low}\u{10FFFF}");
        let mut statement = self.conn.prepare_cached(
            "SELECT id, title, notebook, section FROM pages
             WHERE title_norm != '' AND title_norm >= ?1 AND title_norm < ?2
             ORDER BY CASE WHEN ?1 = '' THEN -modified ELSE 0 END, title_norm, rid LIMIT ?3",
        )?;
        let rows = statement.query_map(params![low, high, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, title, notebook, section) = row?;
            out.push(PageSuggestion {
                page: parse_id(&id)?,
                title,
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
            });
        }
        Ok(out)
    }

    /// The headings of a page, in order, for `[[Page#` autocomplete.
    pub fn headings(&self, page: PageId) -> Result<Vec<HeadingRef>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT h.block, h.level, h.text FROM headings h JOIN pages p ON p.rid = h.page
             WHERE p.id = ?1 ORDER BY h.rowid",
        )?;
        let rows = statement.query_map([page.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u8>(1)?, row.get::<_, String>(2)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (block, level, text) = row?;
            out.push(HeadingRef {
                block: parse_id(&block)?,
                level,
                text,
            });
        }
        Ok(out)
    }

    /// The blocks whose link text must change after a rename: one edit for each distinct link in each block.
    ///
    /// Title links that name the old title change unless another page still has that title, because then the
    /// link is ambiguous and stays. ID links change when their text is still the old title. The index need
    /// not hold the new title yet. The edits do not touch the index, so the caller saves the changed blocks
    /// and indexes those pages again.
    pub fn rename_edits(&self, rename: &Rename) -> Result<Vec<LinkEdit>> {
        let old = fold(&rename.old_title);
        let still_used: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM pages WHERE title_norm = ?1 AND id != ?2",
            params![old, rename.page.to_string()],
            |row| row.get(0),
        )?;
        let mut statement = self.conn.prepare_cached(
            "SELECT DISTINCT src.id, l.block, l.raw FROM links l JOIN pages src ON src.rid = l.page
             WHERE l.target = ?1 OR (l.title_norm = ?2 AND ?2 != '')
             ORDER BY src.rid, l.block, l.raw",
        )?;
        let rows = statement.query_map(params![rename.page.to_string(), old], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut edits = Vec::new();
        for row in rows {
            let (page, block, raw) = row?;
            let Some(link) = links::parse(&raw).into_iter().next() else {
                continue;
            };
            if link.kind == LinkKind::Title && still_used > 0 {
                continue;
            }
            if let Some(new) = rename.rewrite_link(&link) {
                edits.push(LinkEdit {
                    page: parse_id(&page)?,
                    block: parse_id(&block)?,
                    old: raw,
                    new,
                });
            }
        }
        Ok(edits)
    }
}

type RawLink = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
);
