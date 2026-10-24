//! Small helpers that tidy what the parser builds.

use super::SoftBreaks;
use crate::doc::{push_text, Block, Fold, Inline, Marks};

/// Resolves soft breaks and joins neighboring runs with the same marks.
pub(super) fn tidy(inlines: &mut Vec<Inline>, soft: SoftBreaks) {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    for inline in inlines.drain(..) {
        match inline {
            Inline::Text { text, marks } => push_text(&mut out, &text, &marks),
            Inline::SoftBreak if soft == SoftBreaks::Hard => out.push(Inline::HardBreak),
            Inline::SoftBreak => push_text(&mut out, " ", &Marks::none()),
            other => out.push(other),
        }
    }
    *inlines = out;
}

/// Reads `[!type]`, an optional fold mark, and a title from the first line of a quote, and makes a callout of it
/// and the blocks that follow the first line.
pub(super) fn split_callout(blocks: &[Block]) -> Option<Block> {
    let Some(Block::Paragraph(first)) = blocks.first() else {
        return None;
    };
    let line_end = first
        .iter()
        .position(|i| matches!(i, Inline::SoftBreak | Inline::HardBreak));
    let (head, tail) = match line_end {
        Some(at) => (&first[..at], &first[at + 1..]),
        None => (&first[..], &first[..0]),
    };
    let Some(Inline::Text { text, marks }) = head.first() else {
        return None;
    };
    let inner = text.strip_prefix("[!")?;
    let close = inner.find(']')?;
    let kind = &inner[..close];
    if kind.is_empty() || !kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let after = &inner[close + 1..];
    let (fold, after) = match after.chars().next() {
        Some('-') => (Some(Fold::Folded), &after[1..]),
        Some('+') => (Some(Fold::Open), &after[1..]),
        _ => (None, after),
    };
    let mut title = Vec::new();
    push_text(&mut title, after.trim_start(), marks);
    title.extend(head[1..].iter().cloned());
    let mut body: Vec<Block> = Vec::new();
    if !tail.is_empty() {
        body.push(Block::Paragraph(tail.to_vec()));
    }
    body.extend(blocks[1..].iter().cloned());
    Some(Block::Callout {
        kind: kind.to_lowercase(),
        fold,
        title,
        blocks: body,
    })
}

pub(super) fn clean_language(info: &str) -> String {
    info.chars()
        .filter(|c| c.is_ascii_alphanumeric() || "_+#.-".contains(*c))
        .take(32)
        .collect()
}

/// An Obsidian size hint such as `300` or `300x200` in an image's label is not a description.
pub(super) fn clean_alt(alt: &str) -> String {
    let sized = !alt.is_empty() && alt.chars().all(|c| c.is_ascii_digit() || c == 'x');
    if sized {
        String::new()
    } else {
        alt.to_owned()
    }
}
