//! Resolving page links: which page does `[[Title]]`, `[[Title#Heading]]`, or `[Title](opennote:page/<ID>)` mean
//! today?
//!
//! An ID link names its page, so a move or a rename never breaks it. A title link names a title, and the
//! rules for finding its page come in three steps.
//!
//! First, the index looks for pages whose title is that title, ignoring case, accents, and spacing. One page is
//! a [`LinkStatus::Resolved`] link. Several are [`LinkStatus::Ambiguous`], listed with the closest first. The
//! closest is in the same section as the page that holds the link, then the same notebook, then the newest.
//!
//! Failing that, the index looks for a page that was called that, because it remembers the titles of renamed
//! pages ([`LinkStatus::Renamed`]). A link that no edit has reached yet still opens the right page. This
//! happens when the page that holds the link was read-only at the time of the rename.
//! [`SearchIndex::repair_edits`] lists the edits that bring such links up to date. Otherwise the link is
//! [`LinkStatus::Broken`].
//!
//! A title link may name a heading after `#`. The target then carries the block of that heading. A heading the
//! page does not have leaves the link on the page and sets `heading_missing`.
//!
//! [`SearchIndex::resolve_title`] and [`SearchIndex::resolve_link`] answer one link with a few lookups. A
//! [`Resolver`](crate::Resolver) holds every title in memory and answers many, such as the whole link graph.

use opennote_core::{NotebookId, PageId, SectionId};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::error::Result;
use crate::graph::{LinkEdit, LinkTarget};
use crate::index::{parse_id, SearchIndex};
use crate::links::{self, Link, LinkKind, Rename};
use crate::text::fold;

/// What a link points at now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkStatus {
    /// One page.
    Resolved,
    /// Several pages share the title.
    Ambiguous,
    /// No page has the title now, but one used to.
    Renamed,
    /// No page.
    Broken,
}

/// The pages a link points at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    /// How the link fares.
    pub status: LinkStatus,
    /// The pages, closest first. Empty for a broken link.
    pub targets: Vec<LinkTarget>,
    /// The link names a heading, and no target page has it.
    pub heading_missing: bool,
}

impl Resolution {
    /// A link to nothing.
    pub fn broken() -> Resolution {
        Resolution {
            status: LinkStatus::Broken,
            targets: Vec::new(),
            heading_missing: false,
        }
    }

    /// The page to open when the person follows the link: the closest target.
    pub fn first(&self) -> Option<&LinkTarget> {
        self.targets.first()
    }
}

/// A link found in Markdown, and what it points at.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedLink {
    /// The link.
    pub link: Link,
    /// Where it points.
    pub resolution: Resolution,
}

/// The notebook and section a link is written in, which decide the closest of several pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Place {
    /// The notebook.
    pub notebook: NotebookId,
    /// The section.
    pub section: SectionId,
}

/// A page that a title names.
struct Candidate {
    rid: i64,
    page: PageId,
    title: String,
    notebook: NotebookId,
    section: SectionId,
    modified: i64,
}

/// Puts the closest pages first: the same section, then the same notebook, then the newest.
pub(crate) fn by_closeness<T>(items: &mut [T], from: Option<Place>, place: impl Fn(&T) -> (Place, i64, i64)) {
    items.sort_by(|a, b| {
        let ((pa, ma, ra), (pb, mb, rb)) = (place(a), place(b));
        let rank = |p: Place| match from {
            Some(from) if from.section == p.section => 2,
            Some(from) if from.notebook == p.notebook => 1,
            _ => 0,
        };
        rank(pb).cmp(&rank(pa)).then(mb.cmp(&ma)).then(ra.cmp(&rb))
    });
}

impl SearchIndex {
    /// Resolves a title link. `from` is the page that holds the link, for choosing between pages that share
    /// the title.
    pub fn resolve_title(&self, title: &str, heading: Option<&str>, from: Option<PageId>) -> Result<Resolution> {
        let place = self.place_of(from)?;
        self.resolve_parts(Some(&fold(title)), None, heading, place)
    }

    /// Resolves a link found in Markdown.
    pub fn resolve_link(&self, link: &Link, from: Option<PageId>) -> Result<Resolution> {
        let place = self.place_of(from)?;
        match link.kind {
            LinkKind::Title => self.resolve_parts(Some(&link.title_norm()), None, link.fragment.as_deref(), place),
            LinkKind::Id => {
                let target = link.target.map(|page| page.to_string());
                self.resolve_parts(None, target.as_deref(), link.fragment.as_deref(), place)
            }
        }
    }

    /// Every page link in a block of Markdown, each with what it points at.
    pub fn resolve_markdown(&self, markdown: &str, from: Option<PageId>) -> Result<Vec<ResolvedLink>> {
        let place = self.place_of(from)?;
        links::parse(markdown)
            .into_iter()
            .map(|link| {
                let resolution = match link.kind {
                    LinkKind::Title => {
                        self.resolve_parts(Some(&link.title_norm()), None, link.fragment.as_deref(), place)?
                    }
                    LinkKind::Id => {
                        let target = link.target.map(|page| page.to_string());
                        self.resolve_parts(None, target.as_deref(), link.fragment.as_deref(), place)?
                    }
                };
                Ok(ResolvedLink { link, resolution })
            })
            .collect()
    }

    /// The notebook and section of a page, if the index holds it.
    pub fn place_of(&self, page: Option<PageId>) -> Result<Option<Place>> {
        let Some(page) = page else { return Ok(None) };
        let mut statement = self
            .conn
            .prepare_cached("SELECT notebook, section FROM pages WHERE id = ?1")?;
        let row: Option<(String, String)> = statement
            .query_row([page.to_string()], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        row.map(|(notebook, section)| {
            Ok(Place {
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
            })
        })
        .transpose()
    }

    /// Resolves a link given as the index stores it: a folded title, or a page ID, and a fragment.
    pub(crate) fn resolve_parts(
        &self,
        title_norm: Option<&str>,
        target: Option<&str>,
        fragment: Option<&str>,
        from: Option<Place>,
    ) -> Result<Resolution> {
        if let Some(norm) = title_norm {
            if norm.is_empty() {
                return Ok(Resolution::broken());
            }
            return self.resolve_by_title(norm, fragment, from);
        }
        let Some(target) = target else {
            return Ok(Resolution::broken());
        };
        let mut statement = self.conn.prepare_cached("SELECT title FROM pages WHERE id = ?1")?;
        let title: Option<String> = statement.query_row([target], |row| row.get(0)).optional()?;
        let Some(title) = title else {
            return Ok(Resolution::broken());
        };
        let block = fragment.and_then(|text| text.parse().ok());
        Ok(Resolution {
            status: LinkStatus::Resolved,
            targets: vec![LinkTarget {
                page: parse_id(target)?,
                title,
                block,
            }],
            heading_missing: false,
        })
    }

    fn resolve_by_title(&self, norm: &str, heading: Option<&str>, from: Option<Place>) -> Result<Resolution> {
        let mut found = self.candidates(
            "SELECT rid, id, title, notebook, section, modified FROM pages WHERE title_norm = ?1",
            norm,
        )?;
        let mut status = match found.len() {
            0 => LinkStatus::Broken,
            1 => LinkStatus::Resolved,
            _ => LinkStatus::Ambiguous,
        };
        if found.is_empty() {
            found = self.candidates(
                "SELECT p.rid, p.id, p.title, p.notebook, p.section, p.modified
                 FROM aliases a JOIN pages p ON p.id = a.page WHERE a.title_norm = ?1",
                norm,
            )?;
            if !found.is_empty() {
                status = LinkStatus::Renamed;
            }
        }
        by_closeness(&mut found, from, |c| {
            (
                Place {
                    notebook: c.notebook,
                    section: c.section,
                },
                c.modified,
                c.rid,
            )
        });
        self.targets_with_heading(found, heading, status)
    }

    /// Turns candidate pages into targets, each with the block of the heading the link names, if it has one.
    fn targets_with_heading(
        &self,
        found: Vec<Candidate>,
        heading: Option<&str>,
        status: LinkStatus,
    ) -> Result<Resolution> {
        let mut heading_found = heading.is_none();
        let mut targets = Vec::with_capacity(found.len());
        let wanted = heading.map(fold);
        for candidate in found {
            let block = match &wanted {
                Some(norm) => self.heading_block(candidate.rid, norm)?,
                None => None,
            };
            heading_found |= block.is_some();
            targets.push(LinkTarget {
                page: candidate.page,
                title: candidate.title,
                block,
            });
        }
        Ok(Resolution {
            status,
            heading_missing: !targets.is_empty() && !heading_found,
            targets,
        })
    }

    fn candidates(&self, sql: &str, norm: &str) -> Result<Vec<Candidate>> {
        let mut statement = self.conn.prepare_cached(sql)?;
        let rows = statement.query_map([norm], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (rid, id, title, notebook, section, modified) = row?;
            out.push(Candidate {
                rid,
                page: parse_id(&id)?,
                title,
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
                modified,
            });
        }
        Ok(out)
    }

    pub(crate) fn heading_block(&self, rid: i64, norm: &str) -> Result<Option<opennote_core::BlockId>> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT block FROM headings WHERE page = ?1 AND norm = ?2 LIMIT 1")?;
        let found: Option<String> = statement.query_row(params![rid, norm], |row| row.get(0)).optional()?;
        found.as_deref().map(parse_id).transpose()
    }

    /// The edits that bring title links up to date with a page that was renamed.
    ///
    /// Renaming a page rewrites the links that name it, but a link can be missed. The page that holds it may
    /// have been read-only, or in a notebook that was closed. Such a link still works through the page's old
    /// title ([`LinkStatus::Renamed`]), and these edits change it to the title the page has now. A link whose
    /// old title another page has taken since is a link to that page, and it stays.
    pub fn repair_edits(&self, page: PageId) -> Result<Vec<LinkEdit>> {
        let mut edits = Vec::new();
        for (old_title, norm, current) in self.stale_titles(page)? {
            let rename = Rename {
                page,
                old_title,
                new_title: current,
            };
            for (source, block, raw) in self.title_link_rows(&norm)? {
                let Some(link) = links::parse(&raw).into_iter().next() else {
                    continue;
                };
                if let Some(new) = rename.rewrite_link(&link) {
                    edits.push(LinkEdit {
                        page: parse_id(&source)?,
                        block: parse_id(&block)?,
                        old: raw,
                        new,
                    });
                }
            }
        }
        Ok(edits)
    }

    /// The earlier titles of a page that no page has now, with the title the page has now.
    fn stale_titles(&self, page: PageId) -> Result<Vec<(String, String, String)>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT a.title, a.title_norm, t.title FROM aliases a JOIN pages t ON t.id = a.page
             WHERE t.id = ?1 AND t.title_norm != ''
               AND NOT EXISTS (SELECT 1 FROM pages q WHERE q.title_norm = a.title_norm)
             ORDER BY a.at DESC, a.title_norm",
        )?;
        let rows = statement.query_map([page.to_string()], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The pages, blocks, and text of the title links that name a folded title.
    fn title_link_rows(&self, norm: &str) -> Result<Vec<(String, String, String)>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT DISTINCT src.id, l.block, l.raw, src.rid FROM links l JOIN pages src ON src.rid = l.page
             WHERE l.kind = 'title' AND l.title_norm = ?1 ORDER BY src.rid, l.block, l.raw",
        )?;
        let rows = statement.query_map([norm], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
