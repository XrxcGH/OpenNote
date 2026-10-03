//! Writing a document as canonical OpenNote Markdown (spec 7.2 and 7.7).

use super::inline::{write_inlines, Breaks};
use super::{Block, Fold, Inline, Item};

/// Writes blocks as Markdown: one blank line between blocks, and no blank lines at either end.
pub fn to_markdown(blocks: &[Block]) -> String {
    render(blocks).join("\n")
}

/// Writes inlines as the text of one paragraph.
pub fn inlines_to_markdown(inlines: &[Inline]) -> String {
    write_inlines(inlines, Breaks::Backslash)
}

/// The lines of the blocks, with an empty line between blocks.
fn render(blocks: &[Block]) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for block in blocks {
        let block_lines = render_block(block);
        if block_lines.is_empty() {
            continue;
        }
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.extend(block_lines);
    }
    lines
}

fn render_block(block: &Block) -> Vec<String> {
    match block {
        Block::Paragraph(content) => split_lines(&write_inlines(content, Breaks::Backslash)),
        Block::Heading { level, content } => {
            let text = write_inlines(content, Breaks::Space);
            let marks = "#".repeat(usize::from((*level).clamp(1, 6)));
            vec![format!("{marks} {text}").trim_end().to_owned()]
        }
        Block::List { ordered, start, items } => render_list(*ordered, *start, items),
        Block::Quote(blocks) => prefix_quote(render(blocks)),
        Block::Callout {
            kind,
            fold,
            title,
            blocks,
        } => render_callout(kind, *fold, title, blocks),
        Block::Code { language, text } => render_code(language, text),
        Block::Break => vec!["---".to_owned()],
        Block::Table { header, rows } => render_table(*header, rows),
    }
}

fn split_lines(text: &str) -> Vec<String> {
    text.split('\n').map(str::to_owned).collect()
}

fn prefix_quote(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| {
            if line.is_empty() {
                ">".to_owned()
            } else {
                format!("> {line}")
            }
        })
        .collect()
}

fn render_callout(kind: &str, fold: Option<Fold>, title: &[Inline], blocks: &[Block]) -> Vec<String> {
    let kind: String = kind
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>()
        .to_lowercase();
    let fold = match fold {
        Some(Fold::Folded) => "-",
        Some(Fold::Open) => "+",
        None => "",
    };
    let title = write_inlines(title, Breaks::Space);
    let head = format!("> [!{kind}]{fold} {title}").trim_end().to_owned();
    let mut lines = vec![head];
    lines.extend(prefix_quote(render(blocks)));
    lines
}

fn render_code(language: &str, text: &str) -> Vec<String> {
    let longest = text
        .lines()
        .map(|line| line.trim_start_matches(' ').chars().take_while(|c| *c == '`').count())
        .max()
        .unwrap_or(0);
    let fence = "`".repeat((longest + 1).max(3));
    let language: String = language
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "_+#.-".contains(*c))
        .take(32)
        .collect();
    let mut lines = vec![format!("{fence}{language}")];
    if !text.is_empty() {
        lines.extend(text.split('\n').map(|line| line.trim_end_matches('\r').to_owned()));
    }
    lines.push(fence);
    lines
}

fn render_list(ordered: bool, start: u64, items: &[Item]) -> Vec<String> {
    let loose = items.iter().any(|item| item.blocks.len() > 1);
    let mut lines: Vec<String> = Vec::new();
    for (n, item) in items.iter().enumerate() {
        if loose && n > 0 {
            lines.push(String::new());
        }
        let marker = if ordered {
            format!("{}. ", start + n as u64)
        } else {
            "- ".to_owned()
        };
        let task = match item.task {
            Some(true) => "[x] ",
            Some(false) => "[ ] ",
            None => "",
        };
        let body = render(&item.blocks);
        let indent = " ".repeat(marker.len());
        for (i, line) in body.iter().enumerate() {
            let text = match (i, line.is_empty()) {
                (0, _) => format!("{marker}{task}{line}"),
                (_, true) => String::new(),
                (_, false) => format!("{indent}{line}"),
            };
            lines.push(text.trim_end().to_owned());
        }
        if body.is_empty() {
            lines.push(format!("{marker}{task}").trim_end().to_owned());
        }
    }
    lines
}

/// A pipe table, for the Markdown that other tools read. Pages keep tables in `table` blocks instead.
fn render_table(header: bool, rows: &[Vec<Vec<Inline>>]) -> Vec<String> {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let row_line = |cells: &[Vec<Inline>]| {
        let texts: Vec<String> = (0..width)
            .map(|i| {
                cells
                    .get(i)
                    .map(|cell| write_inlines(cell, Breaks::Html))
                    .unwrap_or_default()
            })
            .collect();
        format!("| {} |", texts.join(" | ")).replace("|  |", "| |")
    };
    let mut lines = Vec::new();
    let mut body = rows;
    if header && !rows.is_empty() {
        lines.push(row_line(&rows[0]));
        body = &rows[1..];
    } else {
        lines.push(row_line(&[]));
    }
    lines.push(format!("|{}", " --- |".repeat(width)));
    lines.extend(body.iter().map(|row| row_line(row)));
    lines
}
