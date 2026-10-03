//! The quick switcher (Ctrl+O): find a page by name, with the pages the person opened lately first.
//!
//! A [`Switcher`] keeps the title of every page in memory, ready to match, and reloads them from the index only
//! when the index has changed. Typing a query lists matching pages best first (see [`crate::fuzzy`] for what
//! matches). An empty query lists the recent pages, then the newest. When nothing matches, the answer carries
//! the name a new page would get, so Enter can create it in the current section.
//!
//! The switcher never opens anything. It answers with page IDs, titles, and the ranges of each title to
//! highlight, and the interface opens the page, in a new tab for Ctrl+Enter.

use std::collections::HashMap;
use std::ops::Range;

use opennote_core::{NotebookId, PageId, SectionId, Timestamp};
use serde::Serialize;

use crate::error::Result;
use crate::fuzzy::{fuzzy_match_strict, fuzzy_match_typo, FuzzyMatch, Haystack, MatchKind, Needle};
use crate::index::{parse_id, SearchIndex};
use crate::rank::SearchScope;
use crate::text::fold;

/// How many results a switch returns when the context does not say.
pub const DEFAULT_LIMIT: usize = 20;
/// The most results a switch returns.
pub const MAX_LIMIT: usize = 100;
/// The longest title a new page gets from the query, in characters.
pub const MAX_NEW_TITLE_CHARS: usize = 200;
/// How many recent pages get a boost.
const RECENT_BOOSTED: usize = 10;

/// A page the switcher can open.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchEntry {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// The last change to the page.
    pub modified: Timestamp,
}

/// What the switcher knows about the person's place and history.
#[derive(Clone, Debug, Default)]
pub struct SwitchContext {
    /// The pages the person opened lately, the latest first. They lead an empty query and win ties.
    pub recent: Vec<PageId>,
    /// The page that is open now. An empty query leaves it out, because the person is already there.
    pub current: Option<PageId>,
    /// The notebook and section the person is in. Pages there rank a little higher.
    pub scope: Option<SearchScope>,
    /// The most results. Zero means [`DEFAULT_LIMIT`].
    pub limit: usize,
}

/// A page that matched.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchHit {
    /// The page.
    pub page: PageId,
    /// Its title.
    pub title: String,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// The last change to the page.
    pub modified: Timestamp,
    /// How the query matched, or `None` for the recent pages an empty query lists.
    pub kind: Option<MatchKind>,
    /// How well. Larger is better, and only the order means anything.
    pub score: u32,
    /// The byte ranges of the title to highlight.
    pub highlights: Vec<Range<usize>>,
    /// Where the page is in the recent list, 0 for the latest.
    pub recent: Option<usize>,
    /// The page is the open one.
    pub is_current: bool,
}

/// The answer to a query.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Switch {
    /// The pages, best first.
    pub hits: Vec<SwitchHit>,
    /// The title a new page would get, when nothing matched. Enter creates the page in the current section.
    pub create: Option<String>,
}

struct Prepared {
    entry: SwitchEntry,
    hay: Haystack,
    /// The folded title, for putting equal scores in a steady order.
    order: String,
}

/// The titles of the pages, ready to match.
#[derive(Default)]
pub struct Switcher {
    entries: Vec<Prepared>,
    by_page: HashMap<PageId, usize>,
    /// Entry numbers, newest change first.
    by_modified: Vec<usize>,
    seen: Option<u64>,
}

impl Switcher {
    /// An empty switcher. Call [`Switcher::refresh`] to fill it.
    pub fn new() -> Switcher {
        Switcher::default()
    }

    /// A switcher over some entries, for tools and tests that have no index.
    pub fn from_entries(entries: Vec<SwitchEntry>) -> Switcher {
        let mut switcher = Switcher::default();
        switcher.load(entries);
        switcher
    }

    /// Loads the titles again if the index has changed since the last call. Returns whether it did.
    pub fn refresh(&mut self, index: &SearchIndex) -> Result<bool> {
        if self.seen == Some(index.generation()) {
            return Ok(false);
        }
        let entries = index.switch_entries()?;
        self.load(entries);
        self.seen = Some(index.generation());
        Ok(true)
    }

    fn load(&mut self, entries: Vec<SwitchEntry>) {
        self.entries = entries
            .into_iter()
            .map(|entry| Prepared {
                hay: Haystack::new(&entry.title),
                order: fold(&entry.title),
                entry,
            })
            .collect();
        self.by_page = self
            .entries
            .iter()
            .enumerate()
            .map(|(at, found)| (found.entry.page, at))
            .collect();
        let mut order: Vec<usize> = (0..self.entries.len()).collect();
        order.sort_by(|a, b| {
            let (x, y) = (&self.entries[*a].entry, &self.entries[*b].entry);
            y.modified.cmp(&x.modified).then(x.page.cmp(&y.page))
        });
        self.by_modified = order;
    }

    /// How many pages the switcher holds.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the switcher holds no pages.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Answers a query.
    pub fn find(&self, query: &str, context: &SwitchContext) -> Switch {
        let limit = match context.limit {
            0 => DEFAULT_LIMIT,
            limit => limit.min(MAX_LIMIT),
        };
        if query.trim().is_empty() {
            return Switch {
                hits: self.recent_pages(context, limit),
                create: None,
            };
        }
        let hits = match Needle::new(query) {
            Some(needle) => self.matches(&needle, context, limit),
            None => Vec::new(),
        };
        let create = hits.is_empty().then(|| new_page_title(query)).flatten();
        Switch { hits, create }
    }

    /// The recent pages in order, then the newest pages, without the open one.
    fn recent_pages(&self, context: &SwitchContext, limit: usize) -> Vec<SwitchHit> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        let recent = context
            .recent
            .iter()
            .enumerate()
            .filter_map(|(rank, page)| self.by_page.get(page).map(|at| (*at, Some(rank))));
        let newest = self.by_modified.iter().map(|at| (*at, None));
        for (at, rank) in recent.chain(newest) {
            let entry = &self.entries[at].entry;
            if Some(entry.page) == context.current || !seen.insert(entry.page) {
                continue;
            }
            out.push(hit(entry, None, 0, Vec::new(), rank, context));
            if out.len() >= limit {
                break;
            }
        }
        out
    }

    fn matches(&self, needle: &Needle, context: &SwitchContext, limit: usize) -> Vec<SwitchHit> {
        let ranks: HashMap<PageId, usize> = context
            .recent
            .iter()
            .enumerate()
            .take(RECENT_BOOSTED)
            .map(|(rank, page)| (*page, rank))
            .collect();
        let scope = context.scope.unwrap_or_default();
        let mut found: Vec<(u32, usize, FuzzyMatch)> = Vec::new();
        let mut missed: Vec<usize> = Vec::new();
        for (at, prepared) in self.entries.iter().enumerate() {
            match fuzzy_match_strict(needle, &prepared.hay) {
                Some(matched) => found.push((boosted(&prepared.entry, &matched, &ranks, scope), at, matched)),
                None => missed.push(at),
            }
        }
        // A typo is the last resort. Looking for one in every title is the slow part of a match, so it waits
        // until nothing better than scattered letters has matched.
        if found
            .iter()
            .all(|(_, _, matched)| matched.kind == MatchKind::Subsequence)
        {
            for at in missed {
                let prepared = &self.entries[at];
                if let Some(matched) = fuzzy_match_typo(needle, &prepared.hay) {
                    found.push((boosted(&prepared.entry, &matched, &ranks, scope), at, matched));
                }
            }
        }
        found.sort_by(|(a, x, _), (b, y, _)| {
            let (p, q) = (&self.entries[*x], &self.entries[*y]);
            b.cmp(a)
                .then(q.entry.modified.cmp(&p.entry.modified))
                .then_with(|| p.order.cmp(&q.order))
                .then(p.entry.page.cmp(&q.entry.page))
        });
        found.truncate(limit);
        found
            .into_iter()
            .map(|(score, at, matched)| {
                let entry = &self.entries[at].entry;
                let recent = context.recent.iter().position(|page| *page == entry.page);
                hit(entry, Some(matched.kind), score, matched.ranges, recent, context)
            })
            .collect()
    }
}

/// A match's score with the boosts for a recent page and for the section or notebook the person is in.
fn boosted(entry: &SwitchEntry, matched: &FuzzyMatch, ranks: &HashMap<PageId, usize>, scope: SearchScope) -> u32 {
    let mut score = matched.score;
    if let Some(rank) = ranks.get(&entry.page) {
        score += 40 - 4 * *rank as u32;
    }
    if scope.section == Some(entry.section) {
        score += 8;
    } else if scope.notebook == Some(entry.notebook) {
        score += 4;
    }
    score
}

fn hit(
    entry: &SwitchEntry,
    kind: Option<MatchKind>,
    score: u32,
    highlights: Vec<Range<usize>>,
    recent: Option<usize>,
    context: &SwitchContext,
) -> SwitchHit {
    SwitchHit {
        page: entry.page,
        title: entry.title.clone(),
        notebook: entry.notebook,
        section: entry.section,
        modified: entry.modified,
        kind,
        score,
        highlights,
        recent,
        is_current: context.current == Some(entry.page),
    }
}

/// The title of a page made from what was typed: white space collapsed, and not too long. `None` for text
/// without a visible character.
pub fn new_page_title(query: &str) -> Option<String> {
    let collapsed = query.split_whitespace().collect::<Vec<_>>().join(" ");
    let title: String = collapsed.chars().take(MAX_NEW_TITLE_CHARS).collect();
    let title = title.trim_end().to_string();
    (!title.is_empty()).then_some(title)
}

impl SearchIndex {
    /// Every page's title and place, for the quick switcher.
    pub fn switch_entries(&self) -> Result<Vec<SwitchEntry>> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT id, title, notebook, section, modified FROM pages ORDER BY rid")?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (page, title, notebook, section, modified) = row?;
            out.push(SwitchEntry {
                page: parse_id(&page)?,
                title,
                notebook: parse_id(&notebook)?,
                section: parse_id(&section)?,
                modified: Timestamp::from_unix_ms(modified),
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests;
