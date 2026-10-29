//! Collecting the inline content of one line of ENML, and joining to-do lines into task lists.

use super::Piece;
use crate::doc::{push_text, Block, Inline, Item, Marks};

/// The marks that stand for an unchecked and a checked to-do box, until a line is finished.
pub(super) const TODO_OPEN: char = '\u{e000}';
pub(super) const TODO_DONE: char = '\u{e001}';

/// A line of inline content that is being collected.
#[derive(Default)]
pub(super) struct Line {
    pub inlines: Vec<Inline>,
    pub files: Vec<String>,
}

impl Line {
    /// Adds text with its whitespace collapsed, as a browser would show it.
    pub fn text(&mut self, text: &str, marks: &Marks) {
        let mut collapsed = String::with_capacity(text.len());
        for c in text.chars() {
            let c = if c.is_whitespace() { ' ' } else { c };
            if c == ' ' && collapsed.ends_with(' ') {
                continue;
            }
            collapsed.push(c);
        }
        let follows_space = matches!(self.inlines.last(), Some(Inline::Text { text, .. }) if text.ends_with(' '))
            || matches!(self.inlines.last(), Some(Inline::HardBreak) | None);
        if follows_space {
            collapsed = collapsed.trim_start_matches(' ').to_owned();
        }
        push_text(&mut self.inlines, &collapsed, marks);
    }

    /// Finishes the line: trims it, and sorts it into a paragraph or a to-do.
    pub fn flush(&mut self, pieces: &mut Vec<Piece>) {
        let mut inlines = std::mem::take(&mut self.inlines);
        trim_line(&mut inlines);
        let task = take_todo(&mut inlines);
        if !inlines.is_empty() || task.is_some() {
            pieces.push(match task {
                Some(done) => Piece::Task(done, inlines),
                None => Piece::Block(Block::Paragraph(inlines)),
            });
        }
        pieces.extend(self.files.drain(..).map(Piece::File));
    }
}

/// Removes spaces and breaks at both ends of a line.
pub(super) fn trim_line(inlines: &mut Vec<Inline>) {
    while matches!(inlines.last(), Some(Inline::HardBreak)) {
        inlines.pop();
    }
    while matches!(inlines.first(), Some(Inline::HardBreak)) {
        inlines.remove(0);
    }
    if let Some(Inline::Text { text, .. }) = inlines.last_mut() {
        *text = text.trim_end_matches(' ').to_owned();
    }
    if let Some(Inline::Text { text, .. }) = inlines.first_mut() {
        if !text.starts_with([TODO_OPEN, TODO_DONE]) {
            *text = text.trim_start_matches(' ').to_owned();
        }
    }
    inlines.retain(|inline| !matches!(inline, Inline::Text { text, .. } if text.is_empty()));
}

/// Removes the to-do mark at the start of a line, and says whether the box was checked.
fn take_todo(inlines: &mut Vec<Inline>) -> Option<bool> {
    let Some(Inline::Text { text, .. }) = inlines.first_mut() else {
        return None;
    };
    let done = match text.chars().next()? {
        TODO_OPEN => false,
        TODO_DONE => true,
        _ => return None,
    };
    let rest = text[TODO_OPEN.len_utf8()..].trim_start_matches(' ').to_owned();
    if rest.is_empty() {
        inlines.remove(0);
    } else {
        *text = rest;
    }
    Some(done)
}

/// Joins to-do lines that follow each other into one task list, and bullet lists that follow each other into one
/// list. Markdown has no way to keep two neighboring bullet lists apart, so they would merge when read again.
pub(super) fn merge_tasks(pieces: Vec<Piece>) -> Vec<Piece> {
    let mut out: Vec<Piece> = Vec::with_capacity(pieces.len());
    for piece in pieces {
        let new_items = match piece {
            Piece::Task(done, inlines) => {
                let item = Item {
                    task: Some(done),
                    blocks: vec![Block::Paragraph(inlines)],
                };
                vec![item]
            }
            Piece::Block(Block::List {
                ordered: false, items, ..
            }) => items,
            other => {
                out.push(other);
                continue;
            }
        };
        match out.last_mut() {
            Some(Piece::Block(Block::List {
                ordered: false, items, ..
            })) => items.extend(new_items),
            _ => out.push(Piece::Block(Block::List {
                ordered: false,
                start: 1,
                items: new_items,
            })),
        }
    }
    out
}
