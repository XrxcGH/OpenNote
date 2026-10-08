//! Every title of the index in memory, to resolve many links without touching the database.

use std::collections::HashMap;

use opennote_core::{NotebookId, PageId, SectionId, Timestamp};

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::resolve::{by_closeness, LinkStatus, Place};

impl SearchIndex {
    /// Loads every title into memory, to resolve many links without touching the database.
    pub fn resolver(&self) -> Result<Resolver> {
        let mut pages = Vec::new();
        let mut statement = self
            .conn
            .prepare_cached("SELECT rid, id, title, title_norm, notebook, section, modified FROM pages ORDER BY rid")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        let mut by_rid = HashMap::new();
        for row in rows {
            let (rid, id, title, norm, notebook, section, modified) = row?;
            by_rid.insert(rid, pages.len());
            pages.push(ResolverPage {
                rid,
                page: parse_id(&id)?,
                title,
                title_norm: norm,
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
                modified: Timestamp::from_unix_ms(modified),
            });
        }
        let mut aliases: HashMap<String, Vec<usize>> = HashMap::new();
        let mut statement = self.conn.prepare_cached(
            "SELECT p.rid, a.title_norm FROM aliases a JOIN pages p ON p.id = a.page ORDER BY a.at DESC, p.rid",
        )?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (rid, norm) = row?;
            if let Some(at) = by_rid.get(&rid) {
                aliases.entry(norm).or_default().push(*at);
            }
        }
        Ok(Resolver::new(pages, aliases))
    }
}

/// A page in a [`Resolver`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolverPage {
    pub(crate) rid: i64,
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    pub(crate) title_norm: String,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// The last change to the page.
    pub modified: Timestamp,
}

impl ResolverPage {
    fn place(&self) -> Place {
        Place {
            notebook: self.notebook,
            section: self.section,
        }
    }
}

/// Every title of the index in memory.
pub struct Resolver {
    pages: Vec<ResolverPage>,
    by_id: HashMap<PageId, usize>,
    by_title: HashMap<String, Vec<usize>>,
    by_alias: HashMap<String, Vec<usize>>,
}

impl Resolver {
    fn new(pages: Vec<ResolverPage>, by_alias: HashMap<String, Vec<usize>>) -> Resolver {
        let mut by_title: HashMap<String, Vec<usize>> = HashMap::new();
        for (at, page) in pages.iter().enumerate() {
            if !page.title_norm.is_empty() {
                by_title.entry(page.title_norm.clone()).or_default().push(at);
            }
        }
        let by_id = pages.iter().enumerate().map(|(at, page)| (page.page, at)).collect();
        Resolver {
            pages,
            by_id,
            by_title,
            by_alias,
        }
    }

    /// The pages, in the order the index holds them.
    pub fn pages(&self) -> &[ResolverPage] {
        &self.pages
    }

    /// The position of a page in [`Resolver::pages`].
    pub fn position(&self, page: PageId) -> Option<usize> {
        self.by_id.get(&page).copied()
    }

    /// The pages a folded title names, closest to `from` first, and how the link fares.
    pub fn resolve_title(&self, title_norm: &str, from: Option<Place>) -> (LinkStatus, Vec<usize>) {
        let (status, mut found) = match self.by_title.get(title_norm) {
            Some(found) => (
                if found.len() == 1 {
                    LinkStatus::Resolved
                } else {
                    LinkStatus::Ambiguous
                },
                found.clone(),
            ),
            None => match self.by_alias.get(title_norm) {
                Some(found) => (LinkStatus::Renamed, found.clone()),
                None => return (LinkStatus::Broken, Vec::new()),
            },
        };
        by_closeness(&mut found, from, |at| {
            let page = &self.pages[*at];
            (page.place(), page.modified.unix_ms(), page.rid)
        });
        (status, found)
    }

    /// The page an ID link names, if the index holds it.
    pub fn resolve_id(&self, page: PageId) -> Option<usize> {
        self.position(page)
    }
}
