//! Cutting a block whose Markdown is too long for one text block into smaller blocks of the same kind.

use crate::doc::write::to_markdown;
use crate::doc::{Block, Inline, Item};

/// The Markdown of `block`, in pieces of at most `max` bytes each.
///
/// A block that is too long is cut in two, and each half is tried again. Code is cut between its lines, and a
/// list between its items. A quote or callout is cut between its blocks, and a paragraph between its runs or
/// inside its text. Each piece is still whole Markdown of the same kind. Other blocks are cut between lines.
pub(super) fn markdown_pieces(block: Block, max: usize) -> Vec<String> {
    let markdown = to_markdown(std::slice::from_ref(&block));
    if markdown.len() <= max {
        return vec![markdown];
    }
    match halves(block) {
        Some((first, second)) => {
            let mut pieces = markdown_pieces(first, max);
            pieces.extend(markdown_pieces(second, max));
            pieces
        }
        None => cut_lines(&markdown, max),
    }
}

/// A block cut in two blocks of the same kind, or `None` when it cannot be.
fn halves(block: Block) -> Option<(Block, Block)> {
    match block {
        Block::Code { language, text } => {
            let (first, second) = split_text(&text, false)?;
            let code = |text| Block::Code {
                language: language.clone(),
                text,
            };
            Some((code(first), code(second)))
        }
        Block::List { ordered, start, items } => {
            let (first, second) = split_items(items)?;
            let next = start.saturating_add(first.len() as u64);
            let list = |start, items| Block::List { ordered, start, items };
            Some((list(start, first), list(next, second)))
        }
        Block::Quote(blocks) => {
            let (first, second) = split_blocks(blocks)?;
            Some((Block::Quote(first), Block::Quote(second)))
        }
        Block::Callout {
            kind,
            fold,
            title,
            blocks,
        } => {
            let (first, second) = split_blocks(blocks)?;
            let callout = |blocks| Block::Callout {
                kind: kind.clone(),
                fold,
                title: title.clone(),
                blocks,
            };
            Some((callout(first), callout(second)))
        }
        Block::Paragraph(inlines) => {
            let (first, second) = split_inlines(inlines)?;
            Some((Block::Paragraph(first), Block::Paragraph(second)))
        }
        _ => None,
    }
}

/// The items of a list in two halves. A single item is cut in two items.
fn split_items(mut items: Vec<Item>) -> Option<(Vec<Item>, Vec<Item>)> {
    if items.len() > 1 {
        let rest = items.split_off(items.len() / 2);
        return Some((items, rest));
    }
    let item = items.pop()?;
    let (first, second) = split_blocks(item.blocks)?;
    let half = |blocks| Item {
        task: item.task,
        blocks,
    };
    Some((vec![half(first)], vec![half(second)]))
}

fn split_blocks(mut blocks: Vec<Block>) -> Option<(Vec<Block>, Vec<Block>)> {
    if blocks.len() > 1 {
        let rest = blocks.split_off(blocks.len() / 2);
        return Some((blocks, rest));
    }
    let (first, second) = halves(blocks.pop()?)?;
    Some((vec![first], vec![second]))
}

fn split_inlines(mut inlines: Vec<Inline>) -> Option<(Vec<Inline>, Vec<Inline>)> {
    if inlines.len() > 1 {
        let rest = inlines.split_off(inlines.len() / 2);
        return Some((inlines, rest));
    }
    match inlines.pop()? {
        Inline::Text { text, marks } => {
            let (first, second) = split_text(&text, true)?;
            let first = Inline::Text {
                text: first,
                marks: marks.clone(),
            };
            Some((vec![first], vec![Inline::Text { text: second, marks }]))
        }
        _ => None,
    }
}

/// Text cut near its middle: at the last line break before it, else (for prose) at the last space, else at the
/// middle itself. The break or space it is cut at is dropped. Both parts hold something.
fn split_text(text: &str, prose: bool) -> Option<(String, String)> {
    let mut middle = text.len() / 2;
    while !text.is_char_boundary(middle) {
        middle += 1;
    }
    let before = text.get(..middle)?;
    let space = || before.rfind(' ').filter(|_| prose);
    let (first, second) = match before.rfind('\n').or_else(space).filter(|at| *at > 0) {
        Some(at) => (text.get(..at)?, text.get(at + 1..)?),
        None => (before, text.get(middle..)?),
    };
    (!first.is_empty() && !second.is_empty()).then(|| (first.to_owned(), second.to_owned()))
}

/// Markdown cut between lines into pieces of at most `max` bytes. A longer line is cut where it must be.
fn cut_lines(markdown: &str, max: usize) -> Vec<String> {
    let max = max.max(4);
    let mut pieces = Vec::new();
    let mut piece = String::new();
    for line in markdown.split_inclusive('\n') {
        let mut line = line;
        while !line.is_empty() {
            if !piece.is_empty() && piece.len() + line.len() > max {
                pieces.push(std::mem::take(&mut piece));
            }
            let mut take = line.len().min(max);
            while !line.is_char_boundary(take) {
                take -= 1;
            }
            piece.push_str(&line[..take]);
            line = &line[take..];
        }
    }
    pieces.push(piece);
    pieces
        .into_iter()
        .map(|piece| piece.trim_end_matches('\n').to_owned())
        .filter(|piece| !piece.trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::parse::{parse, SoftBreaks};

    const MAX: usize = 1_000;

    fn pieces_of(markdown: &str) -> Vec<String> {
        let blocks = parse(markdown, SoftBreaks::Space).blocks;
        blocks.into_iter().flat_map(|b| markdown_pieces(b, MAX)).collect()
    }

    #[test]
    fn a_long_code_block_becomes_whole_code_blocks() {
        let code: Vec<String> = (0..300).map(|n| format!("line {n} of the log")).collect();
        let pieces = pieces_of(&format!("```text\n{}\n```", code.join("\n")));
        assert!(pieces.len() > 1);
        for piece in &pieces {
            assert!(piece.len() <= MAX, "{}", piece.len());
            assert!(piece.starts_with("```text\n") && piece.ends_with("```"), "{piece}");
        }
        let lines: usize = pieces.iter().map(|p| p.lines().count() - 2).sum();
        assert_eq!(lines, 300);
    }

    #[test]
    fn a_long_list_becomes_lists_that_keep_counting() {
        let items: Vec<String> = (1..=200).map(|n| format!("{n}. item number {n}")).collect();
        let pieces = pieces_of(&items.join("\n"));
        assert!(pieces.len() > 1);
        assert!(pieces.iter().all(|p| p.len() <= MAX));
        assert!(
            pieces[1].starts_with(&format!("{}. ", pieces[0].lines().count() + 1)),
            "{}",
            pieces[1]
        );
    }

    #[test]
    fn a_long_paragraph_and_a_long_line_are_cut_to_fit() {
        let words = "word ".repeat(1_000);
        let pieces = pieces_of(&words);
        assert!(pieces.len() > 1 && pieces.iter().all(|p| p.len() <= MAX));
        let heading = format!("# {}", "x".repeat(3_000));
        let pieces = pieces_of(&heading);
        assert!(pieces.len() > 1 && pieces.iter().all(|p| p.len() <= MAX));
    }
}
