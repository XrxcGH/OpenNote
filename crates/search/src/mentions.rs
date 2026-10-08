//! Unlinked mentions: where a page's title appears in other pages without a link.
//!
//! The backlinks pane of a page has a second list: pages that say this page's title but do not link to it.
//! "Link" turns one mention into a link, and "Link all" turns every mention into one, after a preview.
//!
//! The work has two layers. [`SearchIndex::unlinked_mentions`] asks the index which pages and blocks probably
//! hold a mention. It works on the plain text the index keeps, so it can say where to look but not exactly
//! where a mention sits in a block's Markdown.
//!
//! [`find_mentions`] reads the Markdown of one block and returns the exact mentions: byte ranges and a few
//! words of context for the preview. It skips what is not prose. That means code, existing links, web
//! addresses, HTML, math, and tags. [`link_mentions`] then rewrites the block so those mentions become links,
//! keeping the words as the writer typed them. The link is an ID link, `[words](opennote:page/<ID>)`. It
//! survives renames and moves.
//!
//! A mention is a run of whole words that match the title, ignoring case, accents, and the amount of white
//! space. The punctuation between the words must be the title's own. Titles shorter than
//! [`MIN_TITLE_LETTERS`] letters have no mentions, because a page called `Go` would match every sentence.
//! Pages in locked sections are not in the index, so they are skipped.

use std::ops::Range;

use opennote_core::{BlockId, PageId};
use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::doc::BlockKind;
use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::query::Term;
use crate::snippet::{self, Snippet, StoredBlock};
use crate::text::words;

use self::protect::protected_ranges;

/// The fewest letters a title needs before its mentions are listed.
pub const MIN_TITLE_LETTERS: usize = 3;
/// How many pages the index looks through for one list of mentions.
const MAX_CANDIDATES: i64 = 1_000;
/// Characters of context on each side of a mention.
const CONTEXT_CHARS: usize = 40;

/// The words of a title and the punctuation between them, ready to look for.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Shape {
    words: Vec<String>,
    separators: Vec<String>,
}

fn shape(title: &str) -> Option<Shape> {
    let found = words(title);
    let letters: usize = found.iter().map(|word| word.folded.chars().count()).sum();
    if found.is_empty() || letters < MIN_TITLE_LETTERS {
        return None;
    }
    let separators = found
        .windows(2)
        .map(|pair| squash(&title[pair[0].range.end..pair[1].range.start]))
        .collect();
    Some(Shape {
        words: found.into_iter().map(|word| word.folded).collect(),
        separators,
    })
}

/// Replaces every run of white space by one space.
fn squash(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = false;
    for c in text.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(if c == '\n' { '\n' } else { ' ' });
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

/// The byte ranges of `text` where the title's words appear in a row, on one line.
fn runs(text: &str, shape: &Shape) -> Vec<Range<usize>> {
    let found = words(text);
    let n = shape.words.len();
    let mut out = Vec::new();
    let mut at = 0;
    while at + n <= found.len() {
        let matches = (0..n).all(|k| found[at + k].folded == shape.words[k])
            && (0..n - 1)
                .all(|k| squash(&text[found[at + k].range.end..found[at + k + 1].range.start]) == shape.separators[k]);
        if matches {
            out.push(found[at].range.start..found[at + n - 1].range.end);
            at += n;
        } else {
            at += 1;
        }
    }
    out
}

/// One place in a block's Markdown where the title appears without a link.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    /// Where the words sit in the Markdown, in bytes.
    pub range: Range<usize>,
    /// The words as written, which become the link's text.
    pub text: String,
    /// The words before the mention on its line, for the preview.
    pub before: String,
    /// The words after the mention on its line, for the preview.
    pub after: String,
}

/// The exact mentions of a title in one block of Markdown, in order.
pub fn find_mentions(markdown: &str, title: &str) -> Vec<Mention> {
    let Some(shape) = shape(title) else {
        return Vec::new();
    };
    let protected = protected_ranges(markdown);
    runs(markdown, &shape)
        .into_iter()
        .filter(|range| !protected.iter().any(|p| p.start < range.end && range.start < p.end))
        .filter(|range| !markdown[..range.start].ends_with('#'))
        .filter(|range| !markdown[range.clone()].contains(['[', ']', '\\', '`', '<', '>', '\n']))
        .map(|range| Mention {
            text: markdown[range.clone()].to_string(),
            before: context_before(markdown, range.start),
            after: context_after(markdown, range.end),
            range,
        })
        .collect()
}

fn context_before(markdown: &str, at: usize) -> String {
    let line = markdown[..at].rsplit('\n').next().unwrap_or("");
    let skip = line.chars().count().saturating_sub(CONTEXT_CHARS);
    let cut: String = line.chars().skip(skip).collect();
    if skip > 0 {
        format!("\u{2026}{}", cut.trim_start())
    } else {
        cut
    }
}

fn context_after(markdown: &str, at: usize) -> String {
    let line = markdown[at..].split('\n').next().unwrap_or("");
    let cut: String = line.chars().take(CONTEXT_CHARS).collect();
    if line.chars().count() > CONTEXT_CHARS {
        format!("{}\u{2026}", cut.trim_end())
    } else {
        cut
    }
}

/// A block of Markdown after its mentions became links.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LinkedMentions {
    /// The block's Markdown with the links in.
    pub markdown: String,
    /// The mentions that became links, in order.
    pub linked: Vec<Mention>,
}

/// Turns mentions of `title` into links to `target`. `which` picks mentions by their place in
/// [`find_mentions`]'s answer, and `None` links them all. Returns `None` when there is nothing to link.
pub fn link_mentions(markdown: &str, title: &str, target: PageId, which: Option<&[usize]>) -> Option<LinkedMentions> {
    let found = find_mentions(markdown, title);
    let chosen: Vec<Mention> = found
        .into_iter()
        .enumerate()
        .filter(|(at, _)| which.is_none_or(|picked| picked.contains(at)))
        .map(|(_, mention)| mention)
        .collect();
    if chosen.is_empty() {
        return None;
    }
    let mut out = markdown.to_string();
    for mention in chosen.iter().rev() {
        out.replace_range(mention.range.clone(), &id_link(&mention.text, target));
    }
    Some(LinkedMentions {
        markdown: out,
        linked: chosen,
    })
}

/// The link the editor stores for a page: the words, and the page's ID.
pub fn id_link(text: &str, target: PageId) -> String {
    format!("[{text}](opennote:page/{target})")
}

/// A block that may hold mentions.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionBlock {
    /// The block.
    pub block: BlockId,
    /// How many times the block says the title without linking it, by its plain text.
    pub count: usize,
    /// The words around the first mention.
    pub context: Option<Snippet>,
}

/// A page that mentions a title.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkedMention {
    /// The page that mentions the title.
    pub source: PageId,
    /// Its title.
    pub source_title: String,
    /// The blocks to look in, in reading order.
    pub blocks: Vec<MentionBlock>,
    /// The mentions in all blocks.
    pub count: usize,
}

impl SearchIndex {
    /// The pages that say the title of `page` without linking to it, newest change first, with the blocks to
    /// look in. Use [`find_mentions`] on the Markdown of each block for the exact places.
    pub fn unlinked_mentions(&self, page: PageId, limit: usize) -> Result<Vec<UnlinkedMention>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let Some((rid, title, norm)) = self.mention_target(page)? else {
            return Ok(Vec::new());
        };
        let Some(shape) = shape(&title) else {
            return Ok(Vec::new());
        };
        let candidates = self.mention_candidates(&shape, rid)?;
        let term = Term {
            words: shape.words.clone(),
            prefix: false,
        };
        let mut out = Vec::new();
        for (source_rid, source, source_title) in candidates {
            let blocks = self.mention_blocks(source_rid, &shape, &norm, page, &term)?;
            if blocks.is_empty() {
                continue;
            }
            out.push(UnlinkedMention {
                source,
                source_title,
                count: blocks.iter().map(|block| block.count).sum(),
                blocks,
            });
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }

    fn mention_target(&self, page: PageId) -> Result<Option<(i64, String, String)>> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT rid, title, title_norm FROM pages WHERE id = ?1")?;
        Ok(statement
            .query_row([page.to_string()], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .optional()?)
    }

    /// The pages whose text holds the title's words in a row, newest change first.
    fn mention_candidates(&self, shape: &Shape, rid: i64) -> Result<Vec<(i64, PageId, String)>> {
        let expression = format!("{{text tables}} : \"{}\"", shape.words.join(" "));
        let mut statement = self.conn.prepare_cached(
            "SELECT p.rid, p.id, p.title FROM page_fts JOIN pages p ON p.rid = page_fts.rowid
             WHERE page_fts MATCH ?1 AND p.rid != ?2 ORDER BY p.modified DESC, p.rid LIMIT ?3",
        )?;
        let rows = statement.query_map(rusqlite::params![expression, rid, MAX_CANDIDATES], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (rid, id, title) = row?;
            out.push((rid, parse_id(&id)?, title));
        }
        Ok(out)
    }

    /// The blocks of a page that say the title more often than they link it.
    fn mention_blocks(
        &self,
        rid: i64,
        shape: &Shape,
        norm: &str,
        target: PageId,
        term: &Term,
    ) -> Result<Vec<MentionBlock>> {
        let mut statement = self.conn.prepare_cached(
            "SELECT block, title FROM links WHERE page = ?1
               AND ((kind = 'title' AND title_norm = ?2) OR (kind = 'id' AND target = ?3))",
        )?;
        let rows = statement.query_map(rusqlite::params![rid, norm, target.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut linked: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for row in rows {
            let (block, label) = row?;
            *linked.entry(block).or_default() += runs(&label, shape).len();
        }
        let mut out = Vec::new();
        for block in self.stored_blocks(rid)? {
            if !matches!(block.kind, BlockKind::Text | BlockKind::Table) {
                continue;
            }
            let said = runs(&block.text, shape).len();
            let known = linked.get(&block.id.to_string()).copied().unwrap_or(0);
            let count = said.saturating_sub(known);
            if count == 0 {
                continue;
            }
            let stored = StoredBlock {
                id: block.id,
                kind: block.kind,
                text: block.text,
            };
            out.push(MentionBlock {
                block: stored.id,
                count,
                context: snippet::best(std::slice::from_ref(&stored), std::slice::from_ref(term)),
            });
        }
        Ok(out)
    }
}

mod protect;
#[cfg(test)]
mod tests;
