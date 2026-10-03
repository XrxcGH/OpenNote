//! Bringing the text of an edited `page.md` back into the page (docs/FEATURES.md, Edits from other apps).
//!
//! When a person edits `page.md` in another program, OpenNote keeps that copy aside and never writes over it
//! silently (spec 11.2). This module turns the copy into a plan the person can accept. The plan holds new text
//! for the text blocks they changed, new text blocks, text blocks they deleted, and a new title or tags.
//!
//! It is a three-way merge. The base is the page as `page.md` was written from it. The edited file is one
//! side, and the page as it is now is the other. A text block that changed on both sides is a conflict, and
//! the page keeps its own version.
//!
//! The body is compared line by line, and lines nobody touched keep the block's own Markdown. Links that
//! `page.md` rewrote therefore stay in their `opennote:` and `asset:` forms. Changes to images, tables,
//! drawings, and the title heading can't come back this way, so they are counted as skipped.
//!
//! The file is untrusted, so nothing here indexes a slice or does unchecked arithmetic.

use std::ops::Range;

mod diff;

use crate::format::readable::{body_parts, BodyPart};
use crate::id::BlockId;
use crate::model::{BlockData, Page};
use crate::seams::LinkResolver;
use diff::diff;

/// One change to bring into the page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextChange {
    /// A text block with new Markdown.
    Replace {
        /// The block.
        block: BlockId,
        /// Its new Markdown.
        markdown: String,
    },
    /// A new text block, after the block `after` or before the block `before`.
    Insert {
        /// The block it goes after.
        after: Option<BlockId>,
        /// The block it goes before, when nothing comes before it.
        before: Option<BlockId>,
        /// Its Markdown.
        markdown: String,
    },
    /// A text block the person deleted.
    Remove {
        /// The block.
        block: BlockId,
    },
}

/// What an edited `page.md` would change.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarkdownImport {
    /// The new title, when the person changed it.
    pub title: Option<String>,
    /// The new tags, when the person changed them.
    pub tags: Option<Vec<String>>,
    /// Changes to text blocks, in page order.
    pub changes: Vec<TextChange>,
    /// Text blocks changed in the file and in the page since, which are left as the page has them.
    pub conflicts: Vec<BlockId>,
    /// Changes that can't come back: to images, tables, drawings, and the title heading.
    pub skipped: u32,
    /// The files were too different to compare, so nothing in the body was planned.
    pub too_different: bool,
}

impl MarkdownImport {
    /// Whether there is nothing to bring in.
    pub fn is_empty(&self) -> bool {
        self.title.is_none() && self.tags.is_none() && self.changes.is_empty()
    }

    fn skip(&mut self) {
        self.skipped = self.skipped.saturating_add(1);
    }
}

/// A part of the base body that is a text block: the block, and its own Markdown as lines.
struct TextPart {
    block: BlockId,
    lines: Vec<String>,
}

/// One part of the base body.
struct Part {
    /// The lines of the base body that the part fills.
    range: Range<usize>,
    block: Option<BlockId>,
    /// Set for a text block whose lines can be matched one to one with the lines in the file.
    text: Option<TextPart>,
}

/// Plans what an edited `page.md` brings into `current`. `base` is the page as the file was written from it,
/// and `edited` is the file.
pub fn plan_import(base: &Page, current: &Page, edited: &str, links: &dyn LinkResolver) -> MarkdownImport {
    let edited = edited.replace("\r\n", "\n");
    let (front, body) = split_front_matter(&edited);
    let mut plan = MarkdownImport {
        title: front_value(front, "title:")
            .and_then(|v| serde_json::from_str::<String>(v).ok())
            .filter(|title| *title != base.title && current.title == base.title),
        tags: front_value(front, "tags:")
            .and_then(|v| serde_json::from_str::<Vec<String>>(v).ok())
            .filter(|tags| *tags != base.tags && current.tags == base.tags),
        ..MarkdownImport::default()
    };
    let (parts, base_lines) = layout(base, links);
    let body = body.trim_matches('\n');
    let edited_lines: Vec<&str> = if body.is_empty() {
        Vec::new()
    } else {
        body.split('\n').collect()
    };
    let Some(hunks) = diff(&base_lines, &edited_lines) else {
        plan.too_different = true;
        return plan;
    };
    let mut work = Work::new(parts);
    for hunk in hunks.iter().rev() {
        let lines = edited_lines.get(hunk.edited.clone()).unwrap_or_default();
        let lines = lines.iter().map(|line| (*line).to_owned()).collect();
        work.apply(&hunk.base, lines, &mut plan);
    }
    work.finish(current, &mut plan);
    plan
}

/// The parts of the base body, and the lines of the body: every part with a blank line between parts.
fn layout(base: &Page, links: &dyn LinkResolver) -> (Vec<Part>, Vec<String>) {
    let mut parts = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    for BodyPart { block, text } in body_parts(base, links) {
        if !lines.is_empty() {
            lines.push(String::new());
        }
        let rendered: Vec<&str> = text.split('\n').collect();
        let start = lines.len();
        let range = start..start.saturating_add(rendered.len());
        let own = block.and_then(|id| match &base.blocks.get(id)?.data {
            BlockData::Text(data) => Some(TextPart {
                block: id,
                lines: data.markdown.split('\n').map(str::to_owned).collect(),
            }),
            _ => None,
        });
        // Rewriting links keeps the lines. If the counts differ, the lines can't be matched up.
        let text = own.filter(|own| own.lines.len() == rendered.len());
        lines.extend(rendered.into_iter().map(str::to_owned));
        parts.push(Part { range, block, text });
    }
    (parts, lines)
}

/// The parts of the base, with the changes made to their text so far.
struct Work {
    parts: Vec<Part>,
    /// The new lines of each text part, once a hunk changed them.
    changed: Vec<Option<Vec<String>>>,
    /// New blocks, as the index of the part they follow, or `None` for before the first part.
    inserts: Vec<(Option<usize>, String)>,
}

impl Work {
    fn new(parts: Vec<Part>) -> Work {
        let changed = parts.iter().map(|_| None).collect();
        Work {
            parts,
            changed,
            inserts: Vec::new(),
        }
    }

    /// The lines a text part holds now.
    fn lines(&mut self, index: usize) -> Option<&mut Vec<String>> {
        let own = self.parts.get(index)?.text.as_ref()?;
        let slot = self.changed.get_mut(index)?;
        Some(slot.get_or_insert_with(|| own.lines.clone()))
    }

    /// The part's lines in the base body.
    fn range(&self, index: usize) -> Range<usize> {
        self.parts.get(index).map_or(0..0, |part| part.range.clone())
    }

    /// Applies one hunk: the base lines `hit` are replaced by `lines`. Hunks come last to first, so the line
    /// numbers of the ones still to come hold.
    fn apply(&mut self, hit: &Range<usize>, lines: Vec<String>, plan: &mut MarkdownImport) {
        if hit.is_empty() {
            self.insert_at(hit.start, lines, plan);
            return;
        }
        let touched: Vec<usize> = (0..self.parts.len())
            .filter(|&i| {
                let range = self.range(i);
                range.start < hit.end && hit.start < range.end
            })
            .collect();
        let (Some(&first), Some(&last)) = (touched.first(), touched.last()) else {
            self.new_block_at(hit.start, lines);
            return;
        };
        if touched
            .iter()
            .any(|&i| self.parts.get(i).is_none_or(|part| part.text.is_none()))
        {
            plan.skip();
            return;
        }
        let (head, tail) = (self.range(first), self.range(last));
        let from = hit.start.max(head.start).saturating_sub(head.start);
        let to = hit.end.min(tail.end).saturating_sub(tail.start);
        if first == last {
            if let Some(own) = self.lines(first) {
                let to = to.min(own.len());
                own.splice(from.min(to)..to, lines);
            }
            return;
        }
        // The hunk runs through several blocks: the first takes the new lines and the rest of the last, and the
        // others go.
        let mut merged = lines;
        if let Some(own) = self.lines(last) {
            let rest = own.split_off(to.min(own.len()));
            merged.extend(rest);
        }
        if let Some(own) = self.lines(first) {
            own.truncate(from);
            own.extend(merged);
        }
        for &gone in touched.iter().skip(1) {
            if let Some(own) = self.lines(gone) {
                own.clear();
            }
        }
    }

    /// A hunk that only inserts lines, at base line `at`.
    fn insert_at(&mut self, at: usize, lines: Vec<String>, plan: &mut MarkdownImport) {
        let blank = |line: Option<&String>| line.is_none_or(|l| l.trim().is_empty());
        let found = (0..self.parts.len()).find(|&i| {
            let range = self.range(i);
            range.start <= at && at <= range.end
        });
        let Some(index) = found else {
            self.new_block_at(at, lines);
            return;
        };
        let range = self.range(index);
        // Lines that touch a block's first or last line belong to it. With a blank line between, they are new.
        let abutting = if at == range.end {
            !blank(lines.first())
        } else if at == range.start {
            !blank(lines.last())
        } else {
            true
        };
        if !abutting {
            self.new_block_at(at, lines);
            return;
        }
        match self.lines(index) {
            Some(own) => {
                let place = at.saturating_sub(range.start).min(own.len());
                own.splice(place..place, lines);
            }
            None if lines.iter().all(|l| l.trim().is_empty()) => {}
            None => plan.skip(),
        }
    }

    /// New lines between parts become a new text block.
    fn new_block_at(&mut self, at: usize, mut lines: Vec<String>) {
        trim_blank_edges(&mut lines);
        if lines.is_empty() {
            return;
        }
        let after = (0..self.parts.len()).rev().find(|&i| self.range(i).end <= at);
        self.inserts.push((after, lines.join("\n")));
    }

    /// Turns the work into changes, leaving out text blocks that changed in the page since.
    fn finish(self, current: &Page, plan: &mut MarkdownImport) {
        let Work {
            parts,
            changed,
            mut inserts,
        } = self;
        for (part, lines) in parts.iter().zip(changed) {
            let (Some(own), Some(mut lines)) = (&part.text, lines) else {
                continue;
            };
            trim_blank_edges(&mut lines);
            if lines == own.lines {
                continue;
            }
            let unchanged_in_page = matches!(
                current.blocks.get(own.block).map(|b| &b.data),
                Some(BlockData::Text(data)) if data.markdown.split('\n').eq(own.lines.iter().map(String::as_str))
            );
            if !unchanged_in_page {
                plan.conflicts.push(own.block);
            } else if lines.is_empty() {
                plan.changes.push(TextChange::Remove { block: own.block });
            } else {
                plan.changes.push(TextChange::Replace {
                    block: own.block,
                    markdown: lines.join("\n"),
                });
            }
        }
        // Hunks were applied last to first, so the inserts are too.
        inserts.reverse();
        for (after, markdown) in inserts {
            let live = |i: usize| parts.get(i)?.block.filter(|id| current.blocks.contains(*id));
            let after_block = after.and_then(|i| (0..=i).rev().find_map(live));
            let before_block = match after_block {
                Some(_) => None,
                None => (after.map_or(0, |i| i.saturating_add(1))..parts.len()).find_map(live),
            };
            plan.changes.push(TextChange::Insert {
                after: after_block,
                before: before_block,
                markdown,
            });
        }
    }
}

/// Removes blank lines from both ends.
fn trim_blank_edges(lines: &mut Vec<String>) {
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    let blanks = lines.iter().take_while(|l| l.trim().is_empty()).count();
    lines.drain(..blanks);
}

/// Splits a file at its YAML front matter: the lines between the first two `---` lines, and what follows.
fn split_front_matter(text: &str) -> (&str, &str) {
    let Some(rest) = text.strip_prefix("---\n") else {
        return ("", text);
    };
    match rest.split_once("\n---\n") {
        Some((front, body)) => (front, body),
        None => ("", text),
    }
}

/// The value after `key` on a front matter line.
fn front_value<'a>(front: &'a str, key: &str) -> Option<&'a str> {
    front.lines().find_map(|line| line.strip_prefix(key)).map(str::trim)
}

#[cfg(test)]
mod tests;
