//! Running a query: matching, filtering, ranking, and snippets.

use std::collections::HashMap;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opennote_core::{NotebookId, PageId, SectionId, Timestamp};
use rusqlite::params_from_iter;
use rusqlite::types::Value;
use serde::Serialize;

use crate::doc::BlockKind;
use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::query::{parse_query, DateField, ParsedText, Query, TextMode};
use crate::rank::{self, RankBreakdown, RankContext, SearchScope, Signals};
use crate::schema::RANK_WEIGHTS;
use crate::snippet::{self, Snippet, StoredBlock};
use crate::tags;

/// The most results one query returns, whatever its `limit` says.
pub const MAX_LIMIT: usize = 500;

/// How many of the best full-text matches a query ranks again with the title, heading, age, and scope. A fixed
/// size keeps paging stable: the same query gives the same order whichever page of results it asks for.
const RERANK_POOL: usize = 200;

/// One page that matched a query.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// The page.
    pub page: PageId,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// Its title.
    pub title: String,
    /// The byte ranges of the title's matched words.
    pub title_highlights: Vec<Range<usize>>,
    /// The last change to the page.
    pub modified: Timestamp,
    /// How well the page matches. Higher is better, and only the order means anything.
    pub score: f64,
    /// The parts of the score: body, title, heading, age, and scope.
    pub rank: RankBreakdown,
    /// The best matching words of the page, or the start of its text for a query without words.
    pub snippet: Option<Snippet>,
}

/// Limits on how long a search may read. Only a pattern search can take long, because it reads every page the
/// filters allow, and it also has a budget of its own (see [`crate::pattern`]).
#[derive(Clone, Debug, Default)]
pub struct SearchLimits {
    /// The search stops reading at this time and returns the best of what it read.
    pub deadline: Option<Instant>,
    /// The search stops reading once this is set, for example because the person typed another letter.
    pub cancel: Option<Arc<AtomicBool>>,
}

impl SearchLimits {
    /// Limits that end at `deadline`.
    pub fn until(deadline: Instant) -> SearchLimits {
        SearchLimits {
            deadline: Some(deadline),
            cancel: None,
        }
    }

    /// Whether the search should stop now.
    pub fn is_over(&self) -> bool {
        self.deadline.is_some_and(|deadline| Instant::now() >= deadline)
            || self
                .cancel
                .as_ref()
                .is_some_and(|cancel| cancel.load(Ordering::Relaxed))
    }

    /// These limits, with a deadline no later than `budget` from now.
    pub(crate) fn within(&self, budget: Duration) -> SearchLimits {
        let latest = Instant::now() + budget;
        SearchLimits {
            deadline: Some(self.deadline.map_or(latest, |deadline| deadline.min(latest))),
            cancel: self.cancel.clone(),
        }
    }
}

/// What a search found, and whether it read everything it should have.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    /// The pages, best first.
    pub hits: Vec<SearchHit>,
    /// `false` when a pattern search ran out of time or was canceled. `hits` then ranks only what it read.
    pub complete: bool,
}

struct RawHit {
    rid: i64,
    id: String,
    notebook: String,
    section: String,
    title: String,
    modified: i64,
    score: f64,
}

impl SearchIndex {
    /// Finds pages. Results come best first, and a query without words lists the newest pages first.
    ///
    /// The order follows [`crate::rank`] with its default weights and the current time. See
    /// [`SearchIndex::search_with`] to choose the weights or the time.
    pub fn search(&self, query: &Query) -> Result<Vec<SearchHit>> {
        self.search_with(query, &RankContext::current())
    }

    /// Finds pages, ranking them with `context`. A pattern search that runs out of its time budget returns what it
    /// found so far. See [`SearchIndex::search_within`] to tell, or to set a deadline or a cancel flag.
    pub fn search_with(&self, query: &Query, context: &RankContext) -> Result<Vec<SearchHit>> {
        Ok(self.search_within(query, context, &SearchLimits::default())?.hits)
    }

    /// Finds pages within some limits, and says whether the search read everything.
    pub fn search_within(&self, query: &Query, context: &RankContext, limits: &SearchLimits) -> Result<SearchResults> {
        if query.limit == 0 {
            return Ok(SearchResults {
                hits: Vec::new(),
                complete: true,
            });
        }
        if is_pattern(query) {
            return crate::pattern::search(self, query, context, limits);
        }
        let hits = self.search_words(query, context)?;
        Ok(SearchResults { hits, complete: true })
    }

    /// A search of the full-text table, for every query that is not a pattern.
    fn search_words(&self, query: &Query, context: &RankContext) -> Result<Vec<SearchHit>> {
        let parsed = parse_query(query);
        let exclude = parsed.as_ref().and_then(|parsed| parsed.exclude.clone());
        // A text that only leaves words out finds nothing to match, so it lists pages like a query without words.
        let parsed = parsed.filter(|parsed| !parsed.expression.is_empty());
        let (sql, params) = build_sql(query, parsed.as_ref(), exclude.as_deref());
        let mut statement = self.conn.prepare_cached(&sql)?;
        let rows = statement.query_map(params_from_iter(params), |row| {
            Ok(RawHit {
                rid: row.get(0)?,
                id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                notebook: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                section: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                title: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                modified: row.get(5)?,
                score: row.get(6)?,
            })
        })?;
        let mut raw = rows.collect::<rusqlite::Result<Vec<RawHit>>>()?;
        let Some(parsed) = parsed.as_ref() else {
            return raw.into_iter().map(|hit| self.finish(hit, None, None)).collect();
        };
        self.fill_details(&mut raw)?;
        let ranked = self.rank_hits(raw, query, parsed, context)?;
        let from = query.offset.min(ranked.len());
        let to = from.saturating_add(query.limit.min(MAX_LIMIT)).min(ranked.len());
        ranked
            .into_iter()
            .skip(from)
            .take(to - from)
            .map(|(hit, breakdown)| self.finish(hit, Some(parsed), Some(breakdown)))
            .collect()
    }

    /// Reads the ID, place, and title of the candidates. The first query leaves them out, because the rows it
    /// sorts by score stay small and so the sort is much faster.
    fn fill_details(&self, raw: &mut Vec<RawHit>) -> Result<()> {
        let rids: Vec<i64> = raw.iter().map(|hit| hit.rid).collect();
        let mut found: HashMap<i64, [String; 4]> = HashMap::with_capacity(rids.len());
        for chunk in rids.chunks(400) {
            let marks = vec!["?"; chunk.len()].join(", ");
            let mut statement = self.conn.prepare_cached(&format!(
                "SELECT rid, id, notebook, section, title FROM pages WHERE rid IN ({marks})"
            ))?;
            let rows = statement.query_map(params_from_iter(chunk.iter()), |row| {
                let text = |n: usize| row.get::<_, String>(n);
                Ok((row.get::<_, i64>(0)?, [text(1)?, text(2)?, text(3)?, text(4)?]))
            })?;
            for row in rows {
                let (rid, details) = row?;
                found.insert(rid, details);
            }
        }
        for hit in raw.iter_mut() {
            if let Some([id, notebook, section, title]) = found.remove(&hit.rid) {
                (hit.id, hit.notebook, hit.section, hit.title) = (id, notebook, section, title);
            }
        }
        raw.retain(|hit| !hit.id.is_empty());
        Ok(())
    }

    /// Weighs the signals of each candidate and puts them in order, best first.
    fn rank_hits(
        &self,
        raw: Vec<RawHit>,
        query: &Query,
        parsed: &ParsedText,
        context: &RankContext,
    ) -> Result<Vec<(RawHit, RankBreakdown)>> {
        let title_searched = query.block_types.is_empty() || query.title_only;
        let headings_searched = !query.title_only && (title_searched || query.block_types.contains(&BlockKind::Text));
        let headings = if headings_searched {
            self.headings_of(raw.iter().map(|hit| hit.rid))?
        } else {
            HashMap::new()
        };
        let scope = query.scope.unwrap_or_default();
        let scope_notebook = scope.notebook.map(|id| id.to_string());
        let scope_section = scope.section.map(|id| id.to_string());
        let mut ranked: Vec<(RawHit, RankBreakdown)> = raw
            .into_iter()
            .map(|hit| {
                let signals = Signals {
                    bm25: -hit.score,
                    title: if title_searched {
                        rank::title_score(&hit.title, &parsed.terms)
                    } else {
                        0.0
                    },
                    heading: headings.get(&hit.rid).map_or(0.0, |found| {
                        rank::heading_score(found.iter().map(String::as_str), &parsed.terms)
                    }),
                    age_ms: rank::age_ms(context.now, Timestamp::from_unix_ms(hit.modified)),
                    same_notebook: scope_notebook.as_deref() == Some(hit.notebook.as_str()),
                    same_section: scope_section.as_deref() == Some(hit.section.as_str()),
                };
                let breakdown = rank::score(&signals, &context.weights);
                (hit, breakdown)
            })
            .collect();
        ranked.sort_by(|(a, x), (b, y)| {
            y.total
                .total_cmp(&x.total)
                .then(b.modified.cmp(&a.modified))
                .then(a.rid.cmp(&b.rid))
        });
        Ok(ranked)
    }

    /// The heading texts of some pages, by page row.
    fn headings_of(&self, rids: impl Iterator<Item = i64>) -> Result<HashMap<i64, Vec<String>>> {
        let rids: Vec<i64> = rids.collect();
        let mut found: HashMap<i64, Vec<String>> = HashMap::new();
        for chunk in rids.chunks(400) {
            let marks = vec!["?"; chunk.len()].join(", ");
            let mut statement = self
                .conn
                .prepare_cached(&format!("SELECT page, text FROM headings WHERE page IN ({marks})"))?;
            let rows = statement.query_map(params_from_iter(chunk.iter()), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (page, text) = row?;
                found.entry(page).or_default().push(text);
            }
        }
        Ok(found)
    }

    fn finish(&self, hit: RawHit, parsed: Option<&ParsedText>, breakdown: Option<RankBreakdown>) -> Result<SearchHit> {
        let terms = parsed.map_or(&[][..], |parsed| &parsed.terms[..]);
        let blocks = self.stored_blocks(hit.rid)?;
        let rank = breakdown.unwrap_or_default();
        Ok(SearchHit {
            page: parse_id(&hit.id)?,
            notebook: parse_id(&hit.notebook)?,
            section: parse_id(&hit.section)?,
            title_highlights: snippet::highlights(&hit.title, terms),
            title: hit.title,
            modified: Timestamp::from_unix_ms(hit.modified),
            score: rank.total,
            rank,
            snippet: snippet::best(&blocks, terms),
        })
    }

    /// The plain text of a page's blocks, in reading order.
    pub(crate) fn stored_blocks(&self, rid: i64) -> Result<Vec<StoredBlock>> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT id, kind, text FROM blocks WHERE page = ?1 ORDER BY ord")?;
        let rows = statement.query_map([rid], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut blocks = Vec::new();
        for row in rows {
            let (id, kind, text) = row?;
            blocks.push(StoredBlock {
                id: parse_id(&id)?,
                kind: BlockKind::from_stored(&kind),
                text,
            });
        }
        Ok(blocks)
    }
}

/// Whether a query is a pattern search, which reads text instead of the full-text table.
pub(crate) fn is_pattern(query: &Query) -> bool {
    query.mode == TextMode::Regex && !query.text.trim().is_empty()
}

/// The SQL of a query and its parameters, in the order the placeholders appear.
fn build_sql(query: &Query, parsed: Option<&ParsedText>, exclude: Option<&str>) -> (String, Vec<Value>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    let mut order_params: Vec<Value> = Vec::new();
    let (columns, from, score, order) = match parsed {
        Some(parsed) => {
            conditions.push("page_fts MATCH ?".to_string());
            params.push(parsed.expression.clone().into());
            (
                // Narrow rows sort faster. The details of the best matches are read afterwards.
                "p.rid, NULL, NULL, NULL, NULL, p.modified",
                "page_fts JOIN pages p ON p.rid = page_fts.rowid",
                format!("bm25(page_fts, {RANK_WEIGHTS})"),
                "score, p.modified DESC, p.rid".to_string(),
            )
        }
        None => (
            "p.rid, p.id, p.notebook, p.section, p.title, p.modified",
            "pages p",
            "0.0".to_string(),
            scope_order(query.scope.as_ref(), &mut order_params),
        ),
    };
    if let Some(exclude) = exclude {
        conditions.push("p.rid NOT IN (SELECT rowid FROM page_fts WHERE page_fts MATCH ?)".to_string());
        params.push(exclude.to_string().into());
    }
    add_filters(query, parsed.is_some(), &mut conditions, &mut params);
    let filter = if conditions.is_empty() {
        "1".to_string()
    } else {
        conditions.join(" AND ")
    };
    let sql = format!(
        "SELECT {columns}, {score} AS score \
         FROM {from} WHERE {filter} ORDER BY {order} LIMIT ? OFFSET ?"
    );
    params.extend(order_params);
    add_paging(query, parsed.is_some(), &mut params);
    (sql, params)
}

/// The `LIMIT` and `OFFSET` of a query.
fn add_paging(query: &Query, has_text: bool, params: &mut Vec<Value>) {
    if has_text {
        // A query with words ranks a pool of the best matches again, and the caller pages through the result.
        let wanted = query.offset.saturating_add(query.limit.min(MAX_LIMIT));
        params.push(Value::Integer(wanted.max(RERANK_POOL) as i64));
        params.push(Value::Integer(0));
    } else {
        params.push(Value::Integer(query.limit.min(MAX_LIMIT) as i64));
        params.push(Value::Integer(query.offset as i64));
    }
}

/// The order of a query without words: the pages of the section, then of the notebook, then the rest, each
/// newest first. Without a scope, only the newest first.
fn scope_order(scope: Option<&SearchScope>, params: &mut Vec<Value>) -> String {
    let Some(scope) = scope.filter(|scope| !scope.is_empty()) else {
        return "p.modified DESC, p.rid".to_string();
    };
    params.push(scope.section.map_or(Value::Null, |id| Value::Text(id.to_string())));
    params.push(scope.notebook.map_or(Value::Null, |id| Value::Text(id.to_string())));
    "CASE WHEN p.section = ? THEN 2 WHEN p.notebook = ? THEN 1 ELSE 0 END DESC, p.modified DESC, p.rid".to_string()
}

pub(crate) fn add_filters(query: &Query, has_text: bool, conditions: &mut Vec<String>, params: &mut Vec<Value>) {
    in_list(
        "p.notebook",
        query.notebooks.iter().map(ToString::to_string),
        conditions,
        params,
    );
    in_list(
        "p.section",
        query.sections.iter().map(ToString::to_string),
        conditions,
        params,
    );
    for tag in query.tags.iter().filter_map(|tag| tags::normalize(tag)) {
        let (low, high) = tags::inside_bounds(&tag);
        conditions.push(
            "EXISTS (SELECT 1 FROM tags t WHERE t.page = p.rid AND (t.tag = ? OR (t.tag >= ? AND t.tag < ?)))"
                .to_string(),
        );
        params.extend([tag.into(), low.into(), high.into()]);
    }
    if let Some(range) = &query.date {
        let column = match range.field {
            DateField::Modified => "p.modified",
            DateField::Created => "p.created",
        };
        if let Some(from) = range.from {
            conditions.push(format!("{column} >= ?"));
            params.push(Value::Integer(from.unix_ms()));
        }
        if let Some(to) = range.to {
            conditions.push(format!("{column} < ?"));
            params.push(Value::Integer(to.unix_ms()));
        }
    }
    if !has_text {
        in_list_of_blocks(query, conditions, params);
    }
}

/// Without words to match, a block type filter asks for pages that have such a block.
fn in_list_of_blocks(query: &Query, conditions: &mut Vec<String>, params: &mut Vec<Value>) {
    if query.block_types.is_empty() {
        return;
    }
    let marks = vec!["?"; query.block_types.len()].join(", ");
    conditions.push(format!(
        "EXISTS (SELECT 1 FROM blocks b WHERE b.page = p.rid AND b.kind IN ({marks}))"
    ));
    params.extend(
        query
            .block_types
            .iter()
            .map(|kind| Value::Text(kind.as_str().to_string())),
    );
}

fn in_list(column: &str, values: impl Iterator<Item = String>, conditions: &mut Vec<String>, params: &mut Vec<Value>) {
    let values: Vec<String> = values.collect();
    if values.is_empty() {
        return;
    }
    conditions.push(format!("{column} IN ({})", vec!["?"; values.len()].join(", ")));
    params.extend(values.into_iter().map(Value::Text));
}
