//! Regular expression search: the text of the query is a pattern. A page matches when the pattern matches its
//! title or the text of one of its blocks.
//!
//! A regular expression cannot use the full-text table, so a pattern search reads the text of every page that
//! the filters allow. It is slower than a word search but stays linear in the size of the text, because the
//! pattern engine has no backtracking. A pattern may not be large, may not repeat anything more than
//! [`MAX_REPEAT`] times, and the filters narrow the pages first.
//!
//! Linear time can still be long for a large notebook. So a search has a time budget, [`PATTERN_TIME_BUDGET`],
//! and its [`SearchLimits`] can set an earlier deadline or a cancel flag. Both are checked between blocks. A
//! search cut short returns what it found so far, marked as not complete.
//!
//! The scan keeps only a count and the first match of each page. It reads the matching block again for the
//! results it returns. The indexer's handle runs the scan in short slices and lets go of the index between them.
//! The indexer and other searches then never wait long.
//!
//! Matching ignores case, and a pattern can turn that off with `(?-i)`. The text searched is the plain text of
//! the index, so a pattern sees words, not Markdown marks. `^` and `$` match at the start and end of each line.
//! Results are ordered by how many places match, how new the page is, and the scope, as in [`crate::rank`].

use std::ops::Range;
use std::time::Duration;

use opennote_core::Timestamp;
use regex::{Regex, RegexBuilder};
use rusqlite::types::Value;
use rusqlite::{params_from_iter, OptionalExtension};

use crate::doc::BlockKind;
use crate::error::{Result, SearchError};
use crate::index::{parse_id, SearchIndex};
use crate::query::Query;
use crate::rank::{self, RankBreakdown, RankContext, Signals};
use crate::search::{add_filters, SearchHit, SearchLimits, SearchResults, MAX_LIMIT};
use crate::snippet::{self, StoredBlock};

/// The longest pattern, in characters.
pub const MAX_PATTERN_CHARS: usize = 500;
/// The largest count a repetition such as `a{3}` or `.{2,9}` may ask for. A large count multiplies the states the
/// engine tracks, which slows a search far more than the length of the pattern suggests.
pub const MAX_REPEAT: u32 = 100;
/// How long a pattern search may run when its limits set no earlier deadline.
pub const PATTERN_TIME_BUDGET: Duration = Duration::from_secs(3);
/// The most memory a compiled pattern may use.
const SIZE_LIMIT: usize = 1 << 20;
/// The most memory the engine's cache of states may use.
const DFA_SIZE_LIMIT: usize = 2 << 20;
/// The most places counted in one block or title. More only means the page ranks the same.
const MAX_PLACES: usize = 1000;

/// Checks a pattern, so the interface can show the problem while the person types. The message is in plain
/// words and says what is wrong.
pub fn check(pattern: &str) -> std::result::Result<(), String> {
    compile(pattern).map(|_| ())
}

fn compile(pattern: &str) -> std::result::Result<Regex, String> {
    if pattern.chars().count() > MAX_PATTERN_CHARS {
        return Err(format!("The pattern is longer than {MAX_PATTERN_CHARS} characters."));
    }
    if largest_count(pattern) > MAX_REPEAT {
        return Err(format!(
            "The pattern repeats something more than {MAX_REPEAT} times, which is too large to run."
        ));
    }
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .multi_line(true)
        .size_limit(SIZE_LIMIT)
        .dfa_size_limit(DFA_SIZE_LIMIT)
        .nest_limit(40)
        .build()
        .map_err(|error| match error {
            regex::Error::CompiledTooBig(_) => "The pattern is too large to run.".to_string(),
            other => short_message(&other.to_string()),
        })
}

/// The largest count of a counted repetition in a pattern, such as 9 in `.{2,9}`. Escaped braces and braces in a
/// character class are not repetitions. A count too large to read counts as the largest number.
fn largest_count(pattern: &str) -> u32 {
    let chars: Vec<char> = pattern.chars().collect();
    let mut largest = 0;
    let mut class = 0;
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '\\' => i += 1,
            '[' => class += 1,
            ']' if class > 0 => class -= 1,
            '{' if class == 0 => {
                let body: String = chars[i + 1..]
                    .iter()
                    .take_while(|c| c.is_ascii_digit() || matches!(c, ',' | ' '))
                    .collect();
                if chars.get(i + 1 + body.chars().count()) == Some(&'}') {
                    for part in body.split(',').map(str::trim).filter(|part| !part.is_empty()) {
                        largest = largest.max(part.parse().unwrap_or(u32::MAX));
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    largest
}

/// The last line of the engine's report, which names the problem without repeating the pattern.
fn short_message(report: &str) -> String {
    let last = report.lines().last().unwrap_or(report);
    let message = last.strip_prefix("error: ").unwrap_or(last).trim();
    let mut out = String::from(message);
    if let Some(first) = out.get_mut(..1) {
        first.make_ascii_uppercase();
    }
    out
}

/// The non-empty places where the pattern matches, at most [`MAX_PLACES`] of them.
fn ranges(regex: &Regex, text: &str) -> Vec<Range<usize>> {
    regex
        .find_iter(text)
        .filter(|found| !found.is_empty())
        .take(MAX_PLACES)
        .map(|found| found.range())
        .collect()
}

/// A page with at least one match. It keeps no block text: the block of the first match is read again for the
/// pages a search returns.
struct Found {
    rid: i64,
    id: String,
    notebook: String,
    section: String,
    title: String,
    modified: i64,
    title_ranges: Vec<Range<usize>>,
    /// How many places match in the whole page.
    count: usize,
    /// The position of the first block that matches.
    first: Option<i64>,
}

struct Row {
    rid: i64,
    id: String,
    notebook: String,
    section: String,
    title: String,
    modified: i64,
    /// The block's position on the page and its text.
    block: Option<(i64, String)>,
}

/// A pattern search that can pause between blocks and go on later, possibly with the index locked again.
pub(crate) struct PatternScan {
    regex: Regex,
    query: Query,
    title_searched: bool,
    current: Option<Found>,
    done: Vec<Found>,
    /// The last row read: the page's row ID and the block's position, so the next step starts after it.
    resume: (i64, i64),
    /// Every row has been read.
    finished: bool,
    /// The epoch of the index generation when the scan began. A rebuild between steps changes it, and the scan
    /// then stops, because row IDs no longer mean the same pages.
    epoch: Option<u64>,
}

impl PatternScan {
    /// Starts a search for the pattern of a query. Fails for a pattern that is not valid or too large.
    pub(crate) fn new(query: &Query) -> Result<PatternScan> {
        let regex = compile(&query.text).map_err(SearchError::Pattern)?;
        Ok(PatternScan {
            regex,
            title_searched: query.title_only || query.block_types.is_empty(),
            query: query.clone(),
            current: None,
            done: Vec::new(),
            resume: (i64::MIN, i64::MIN),
            finished: false,
            epoch: None,
        })
    }

    /// Reads rows until they run out or `pause` says to stop, which it is asked before each row after the first.
    /// Returns whether rows are left to read.
    pub(crate) fn step(&mut self, index: &SearchIndex, pause: &dyn Fn() -> bool) -> Result<bool> {
        let epoch = index.generation() >> 32;
        if *self.epoch.get_or_insert(epoch) != epoch {
            return Ok(false);
        }
        let (sql, params) = self.sql();
        let mut statement = index.conn.prepare_cached(&sql)?;
        let mut rows = statement.query(params_from_iter(params))?;
        let mut first = true;
        while let Some(row) = rows.next()? {
            if !first && pause() {
                return Ok(true);
            }
            first = false;
            let row = read_row(row)?;
            self.resume = (row.rid, row.block.as_ref().map_or(i64::MIN, |(ord, _)| *ord));
            self.push(row);
        }
        self.finished = true;
        Ok(false)
    }

    /// Ranks what the scan found and makes the hits. The results are complete only if every row was read.
    pub(crate) fn finish(mut self, index: &SearchIndex, context: &RankContext) -> Result<SearchResults> {
        self.flush();
        let query = &self.query;
        let mut ranked: Vec<(Found, RankBreakdown)> = std::mem::take(&mut self.done)
            .into_iter()
            .map(|found| {
                let breakdown = weigh(&found, query, context);
                (found, breakdown)
            })
            .collect();
        ranked.sort_by(|(a, x), (b, y)| {
            y.total
                .total_cmp(&x.total)
                .then(b.modified.cmp(&a.modified))
                .then(a.rid.cmp(&b.rid))
        });
        let from = query.offset.min(ranked.len());
        let to = from.saturating_add(query.limit.min(MAX_LIMIT)).min(ranked.len());
        let hits = ranked
            .into_iter()
            .skip(from)
            .take(to - from)
            .map(|(found, breakdown)| self.hit(index, found, breakdown))
            .collect::<Result<Vec<SearchHit>>>()?;
        Ok(SearchResults {
            hits,
            complete: self.finished,
        })
    }

    fn push(&mut self, row: Row) {
        if self.current.as_ref().map(|found| found.rid) != Some(row.rid) {
            self.flush();
            let title_ranges = if self.title_searched {
                ranges(&self.regex, &row.title)
            } else {
                Vec::new()
            };
            self.current = Some(Found {
                rid: row.rid,
                id: row.id,
                notebook: row.notebook,
                section: row.section,
                title: row.title,
                modified: row.modified,
                count: title_ranges.len(),
                title_ranges,
                first: None,
            });
        }
        let (Some(found), Some((ord, text))) = (self.current.as_mut(), row.block) else {
            return;
        };
        let places = self
            .regex
            .find_iter(&text)
            .filter(|found| !found.is_empty())
            .take(MAX_PLACES)
            .count();
        found.count += places;
        if found.first.is_none() && places > 0 {
            found.first = Some(ord);
        }
    }

    fn flush(&mut self) {
        if let Some(found) = self.current.take().filter(|found| found.count > 0) {
            self.done.push(found);
        }
    }

    /// The SQL that reads every page the filters allow, each with its blocks, from the row after the last one read.
    fn sql(&self) -> (String, Vec<Value>) {
        let query = &self.query;
        let (join, mut params) = block_join(query);
        let mut conditions: Vec<String> = Vec::new();
        add_filters(query, true, &mut conditions, &mut params);
        let (rid, ord) = self.resume;
        if query.title_only {
            conditions.push("p.rid > ?".to_string());
            params.push(Value::Integer(rid));
        } else {
            conditions.push("(p.rid > ? OR (p.rid = ? AND b.ord > ?))".to_string());
            params.extend([Value::Integer(rid), Value::Integer(rid), Value::Integer(ord)]);
        }
        let (block, order) = if query.title_only {
            ("NULL, NULL", "p.rid")
        } else {
            ("b.ord, b.text", "p.rid, b.ord")
        };
        let sql = format!(
            "SELECT p.rid, p.id, p.notebook, p.section, p.title, p.modified, {block} \
             FROM pages p {join} WHERE {} ORDER BY {order}",
            conditions.join(" AND ")
        );
        (sql, params)
    }

    fn hit(&self, index: &SearchIndex, found: Found, breakdown: RankBreakdown) -> Result<SearchHit> {
        let snippet = match self.first_block(index, &found)? {
            Some((block, places)) => Some(snippet::around(&block, &places)),
            None => snippet::best(&index.stored_blocks(found.rid)?, &[]),
        };
        Ok(SearchHit {
            page: parse_id(&found.id)?,
            notebook: parse_id(&found.notebook)?,
            section: parse_id(&found.section)?,
            title_highlights: found.title_ranges,
            title: found.title,
            modified: Timestamp::from_unix_ms(found.modified),
            score: breakdown.total,
            rank: breakdown,
            snippet,
        })
    }

    /// The first block that matched, read again, with its places. `None` if it no longer matches.
    fn first_block(&self, index: &SearchIndex, found: &Found) -> Result<Option<(StoredBlock, Vec<Range<usize>>)>> {
        let Some(ord) = found.first else {
            return Ok(None);
        };
        let mut statement = index
            .conn
            .prepare_cached("SELECT id, kind, text FROM blocks WHERE page = ?1 AND ord = ?2")?;
        let row = statement
            .query_row([found.rid, ord], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .optional()?;
        let Some((id, kind, text)) = row else {
            return Ok(None);
        };
        let places = ranges(&self.regex, &text);
        if places.is_empty() {
            return Ok(None);
        }
        let block = StoredBlock {
            id: parse_id(&id)?,
            kind: BlockKind::from_stored(&kind),
            text,
        };
        Ok(Some((block, places)))
    }
}

/// Finds the pages whose title or text matches the pattern of the query, within the limits and the time budget.
pub(crate) fn search(
    index: &SearchIndex,
    query: &Query,
    context: &RankContext,
    limits: &SearchLimits,
) -> Result<SearchResults> {
    let limits = limits.within(PATTERN_TIME_BUDGET);
    let mut scan = PatternScan::new(query)?;
    scan.step(index, &|| limits.is_over())?;
    scan.finish(index, context)
}

/// The `JOIN` that brings in the blocks to read, with the values it needs. A title-only search reads no blocks. A
/// join that can never match would still scan them for every page.
fn block_join(query: &Query) -> (String, Vec<Value>) {
    if query.title_only {
        return (String::new(), Vec::new());
    }
    if query.block_types.is_empty() {
        return ("LEFT JOIN blocks b ON b.page = p.rid".to_string(), Vec::new());
    }
    let marks = vec!["?"; query.block_types.len()].join(", ");
    let kinds = query
        .block_types
        .iter()
        .map(|kind| Value::Text(kind.as_str().to_string()))
        .collect();
    (
        format!("LEFT JOIN blocks b ON b.page = p.rid AND b.kind IN ({marks})"),
        kinds,
    )
}

fn read_row(row: &rusqlite::Row) -> Result<Row> {
    let block = match row.get::<_, Option<i64>>(6)? {
        Some(ord) => Some((ord, row.get::<_, String>(7)?)),
        None => None,
    };
    Ok(Row {
        rid: row.get(0)?,
        id: row.get(1)?,
        notebook: row.get(2)?,
        section: row.get(3)?,
        title: row.get(4)?,
        modified: row.get(5)?,
        block,
    })
}

fn weigh(found: &Found, query: &Query, context: &RankContext) -> RankBreakdown {
    let scope = query.scope.unwrap_or_default();
    let signals = Signals {
        bm25: found.count as f64,
        title: if found.title_ranges.is_empty() { 0.0 } else { 1.0 },
        heading: 0.0,
        age_ms: rank::age_ms(context.now, Timestamp::from_unix_ms(found.modified)),
        same_notebook: scope.notebook.map(|id| id.to_string()).as_deref() == Some(found.notebook.as_str()),
        same_section: scope.section.map(|id| id.to_string()).as_deref() == Some(found.section.as_str()),
    };
    rank::score(&signals, &context.weights)
}

#[cfg(test)]
mod tests;
