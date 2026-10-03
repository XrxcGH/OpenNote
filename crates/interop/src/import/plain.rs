//! Importing plain text: one `.txt` file, or a folder of them.
//!
//! Each file becomes a page named after the file. Paragraphs stay paragraphs, single line breaks stay line
//! breaks, and lines that start with a bullet or a number become lists.

use std::path::Path;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::scan::NoteFile;
use crate::doc::{Block, Inline, Item};
use crate::error::Result;
use crate::report::Report;
use crate::sink::{ImportEnv, ImportSink};

/// Imports a folder of text files into a new notebook.
pub fn import_text_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &TextReader, env, sink)
}

/// Reads text files.
pub(super) struct TextReader;

impl NoteReader for TextReader {
    fn label(&self, _root: &Path) -> String {
        "Text folder".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["txt", "text"]
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        NoteContent {
            title: note.stem.clone(),
            blocks: text_blocks(text),
            ..NoteContent::default()
        }
    }
}

/// A line of a list: whether the list is numbered, the number, and the text.
type ListLine<'a> = (bool, usize, &'a str);

/// Turns the lines of a text file into blocks.
pub(super) fn text_blocks(text: &str) -> Vec<Block> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut blocks = Vec::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let mut list: Vec<ListLine<'_>> = Vec::new();
    for line in normalized.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            flush(&mut blocks, &mut paragraph, &mut list);
        } else if let Some(item) = list_item(trimmed) {
            flush_paragraph(&mut blocks, &mut paragraph);
            if list.last().is_some_and(|(ordered, ..)| *ordered != item.0) {
                flush_list(&mut blocks, &mut list);
            }
            list.push(item);
        } else {
            flush_list(&mut blocks, &mut list);
            paragraph.push(trimmed);
        }
    }
    flush(&mut blocks, &mut paragraph, &mut list);
    blocks
}

fn list_item(line: &str) -> Option<ListLine<'_>> {
    for bullet in ["- ", "* ", "+ ", "\u{2022} ", "\u{2013} "] {
        if let Some(rest) = line.strip_prefix(bullet) {
            return Some((false, 1, rest.trim()));
        }
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if (1..=3).contains(&digits) {
        let (number, rest) = line.split_at(digits);
        let rest = rest.strip_prefix(['.', ')'])?.strip_prefix(' ')?;
        return Some((true, number.parse().ok()?, rest.trim()));
    }
    None
}

fn flush(blocks: &mut Vec<Block>, paragraph: &mut Vec<&str>, list: &mut Vec<ListLine<'_>>) {
    flush_paragraph(blocks, paragraph);
    flush_list(blocks, list);
}

fn flush_paragraph(blocks: &mut Vec<Block>, paragraph: &mut Vec<&str>) {
    if paragraph.is_empty() {
        return;
    }
    let mut inlines = Vec::new();
    for (n, line) in paragraph.drain(..).enumerate() {
        if n > 0 {
            inlines.push(Inline::HardBreak);
        }
        inlines.push(Inline::text(line));
    }
    blocks.push(Block::Paragraph(inlines));
}

fn flush_list(blocks: &mut Vec<Block>, list: &mut Vec<ListLine<'_>>) {
    let Some(&(ordered, start, _)) = list.first() else {
        return;
    };
    let items = list
        .drain(..)
        .map(|(_, _, text)| Item {
            task: None,
            blocks: vec![Block::Paragraph(vec![Inline::text(text)])],
        })
        .collect();
    blocks.push(Block::List {
        ordered,
        start: start as u64,
        items,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::plain_text;

    fn text_of(block: &Block) -> String {
        match block {
            Block::Paragraph(inlines) => plain_text(inlines),
            Block::List { items, .. } => items
                .iter()
                .map(|i| match &i.blocks[0] {
                    Block::Paragraph(p) => plain_text(p),
                    _ => String::new(),
                })
                .collect::<Vec<_>>()
                .join("|"),
            _ => String::new(),
        }
    }

    #[test]
    fn blank_lines_split_paragraphs_and_single_breaks_stay() {
        let blocks = text_blocks("One\nstill one\n\nTwo\r\n\r\n\r\nThree");
        assert_eq!(blocks.len(), 3);
        assert_eq!(text_of(&blocks[0]), "One still one");
        let Block::Paragraph(first) = &blocks[0] else {
            panic!("a paragraph");
        };
        assert!(first.contains(&Inline::HardBreak));
    }

    #[test]
    fn bullets_and_numbers_become_lists() {
        let blocks = text_blocks("Shopping:\n- milk\n- eggs\n\n3. third\n4. fourth\nback to text");
        assert_eq!(blocks.len(), 4, "{blocks:?}");
        assert_eq!(text_of(&blocks[1]), "milk|eggs");
        match &blocks[2] {
            Block::List { ordered, start, .. } => assert!(*ordered && *start == 3),
            other => panic!("a numbered list, got {other:?}"),
        }
        assert_eq!(text_of(&blocks[3]), "back to text");
    }

    #[test]
    fn a_number_inside_a_sentence_is_not_a_list() {
        let blocks = text_blocks("2024 was a good year\n1.5 liters");
        assert_eq!(blocks.len(), 1);
    }
}
