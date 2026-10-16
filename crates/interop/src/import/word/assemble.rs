//! Turning the paragraphs of a Word page into blocks: lists, quotes, code, callouts, and tasks.

use super::body::{Item, Kind, Para};
use super::styles::StyleKind;
use crate::doc::{plain_text, Block, Inline, Item as ListItem};

const BOX_OPEN: char = '\u{2610}';
const BOX_DONE: [char; 2] = ['\u{2611}', '\u{2612}'];

/// The callout types that a title can name.
const CALLOUT_KINDS: &[&str] = &[
    "note",
    "tip",
    "warning",
    "important",
    "caution",
    "info",
    "question",
    "danger",
    "example",
    "success",
    "failure",
    "bug",
    "abstract",
    "todo",
];

/// Builds the blocks of one page.
pub(super) fn blocks(items: Vec<Item>) -> Vec<Block> {
    let mut out = Vec::new();
    let mut rest = items.into_iter().peekable();
    while let Some(item) = rest.next() {
        match item {
            Item::PageBreak => {}
            Item::Table(table) => out.push(table),
            Item::Para(para) => {
                let mut group = vec![para];
                while let Some(Item::Para(next)) = rest.peek() {
                    if !joins(&group[0], next) {
                        break;
                    }
                    if let Some(Item::Para(next)) = rest.next() {
                        group.push(next);
                    }
                }
                group_to_blocks(group, &mut out);
            }
        }
    }
    out
}

/// Whether a paragraph belongs to the same block as the first paragraph of a group.
fn joins(first: &Para, next: &Para) -> bool {
    if first.shaded || next.shaded {
        return first.shaded && next.shaded;
    }
    match (&first.kind, &next.kind) {
        (Kind::ListItem { .. }, Kind::ListItem { .. }) => true,
        (Kind::Styled(a), Kind::Styled(b)) if a == b && matches!(a, StyleKind::Quote | StyleKind::Code) => true,
        (Kind::Styled(StyleKind::Normal), Kind::Styled(StyleKind::Normal)) => {
            task_of(first).is_some() && task_of(next).is_some()
        }
        _ => false,
    }
}

fn group_to_blocks(group: Vec<Para>, out: &mut Vec<Block>) {
    let first = &group[0];
    if first.shaded && is_callout(&group) {
        out.push(callout(group));
        return;
    }
    match &first.kind {
        Kind::ListItem { .. } => out.extend(lists(&group)),
        Kind::Styled(StyleKind::Code) => {
            let text: Vec<String> = group.iter().map(|p| plain_text(&p.inlines)).collect();
            out.push(Block::Code {
                language: String::new(),
                text: text.join("\n"),
            });
        }
        Kind::Styled(StyleKind::Quote) => {
            let inner = group
                .into_iter()
                .filter(|p| !p.inlines.is_empty())
                .map(|p| Block::Paragraph(p.inlines))
                .collect::<Vec<_>>();
            if !inner.is_empty() {
                out.push(Block::Quote(inner));
            }
        }
        Kind::Styled(StyleKind::Normal) if task_of(first).is_some() => out.extend(lists(&group)),
        _ => {
            for para in group {
                single(para, out);
            }
        }
    }
}

fn single(para: Para, out: &mut Vec<Block>) {
    if para.inlines.is_empty() {
        return;
    }
    match para.kind {
        Kind::Styled(StyleKind::Title) => out.push(Block::Heading {
            level: 1,
            content: para.inlines,
        }),
        Kind::Styled(StyleKind::Subtitle) => out.push(Block::Heading {
            level: 2,
            content: para.inlines,
        }),
        Kind::Styled(StyleKind::Heading(level)) => out.push(Block::Heading {
            level,
            content: para.inlines,
        }),
        _ => out.push(Block::Paragraph(para.inlines)),
    }
}

/// A shaded group is a callout when its first paragraph is a bold title line.
fn is_callout(group: &[Para]) -> bool {
    let title = &group[0].inlines;
    !title.is_empty()
        && title
            .iter()
            .all(|i| matches!(i, Inline::Text { marks, .. } if marks.strong))
        && !matches!(group[0].kind, Kind::ListItem { .. })
}

fn callout(group: Vec<Para>) -> Block {
    let mut paragraphs = group.into_iter();
    let title = paragraphs.next().map(|p| p.inlines).unwrap_or_default();
    let named = plain_text(&title).trim().to_lowercase();
    let (kind, title) = if CALLOUT_KINDS.contains(&named.as_str()) {
        (named, Vec::new())
    } else {
        let plain = title
            .into_iter()
            .map(|inline| match inline {
                Inline::Text { text, mut marks } => {
                    marks.strong = false;
                    Inline::Text { text, marks }
                }
                other => other,
            })
            .collect();
        ("note".to_owned(), plain)
    };
    let mut blocks = Vec::new();
    for para in paragraphs {
        single(para, &mut blocks);
    }
    Block::Callout {
        kind,
        fold: None,
        title,
        blocks,
    }
}

/// Whether a paragraph starts with a checkbox, and if so whether it is checked.
fn task_of(para: &Para) -> Option<bool> {
    let Some(Inline::Text { text, .. }) = para.inlines.first() else {
        return None;
    };
    let first = text.chars().next()?;
    if first == BOX_OPEN {
        Some(false)
    } else {
        BOX_DONE.contains(&first).then_some(true)
    }
}

/// Removes the checkbox glyph and the space after it.
fn strip_box(mut inlines: Vec<Inline>) -> Vec<Inline> {
    if let Some(Inline::Text { text, .. }) = inlines.first_mut() {
        let rest: String = text.chars().skip(1).collect();
        *text = rest.trim_start_matches(' ').to_owned();
    }
    inlines.retain(|i| !matches!(i, Inline::Text { text, .. } if text.is_empty()));
    inlines
}

/// One entry of a list being built.
struct Entry {
    level: u32,
    ordered: bool,
    start: u64,
    task: Option<bool>,
    inlines: Vec<Inline>,
}

/// Builds lists from paragraphs: nested by level, and a new list when the numbering style changes.
fn lists(group: &[Para]) -> Vec<Block> {
    let entries: Vec<Entry> = group
        .iter()
        .map(|p| {
            let task = task_of(p);
            let inlines = if task.is_some() {
                strip_box(p.inlines.clone())
            } else {
                p.inlines.clone()
            };
            match p.kind {
                Kind::ListItem {
                    level, ordered, start, ..
                } => Entry {
                    level,
                    ordered,
                    start,
                    task,
                    inlines,
                },
                Kind::Styled(_) => Entry {
                    level: 0,
                    ordered: false,
                    start: 1,
                    task,
                    inlines,
                },
            }
        })
        .collect();
    let mut blocks = Vec::new();
    let mut at = 0;
    while at < entries.len() {
        let (block, next) = build(&entries, at, entries[at].level);
        blocks.push(block);
        at = next.max(at + 1);
    }
    blocks
}

/// Builds the list whose first entry is `from`, at `level`, and returns it with the index after its last entry.
fn build(entries: &[Entry], from: usize, level: u32) -> (Block, usize) {
    let (ordered, start) = (entries[from].ordered, entries[from].start);
    let mut items = Vec::new();
    let mut at = from;
    while at < entries.len() {
        let entry = &entries[at];
        if entry.level < level || (entry.level == level && entry.ordered != ordered && at > from) {
            break;
        }
        if entry.level > level {
            // A deeper entry with no parent above it starts its own list inside the previous item.
            let (nested, next) = build(entries, at, entry.level);
            match items.last_mut() {
                Some(ListItem { blocks, .. }) => blocks.push(nested),
                None => items.push(ListItem {
                    task: None,
                    blocks: vec![nested],
                }),
            }
            at = next;
            continue;
        }
        let paragraph = Block::Paragraph(entry.inlines.clone());
        items.push(ListItem {
            task: entry.task,
            blocks: vec![paragraph],
        });
        at += 1;
    }
    (Block::List { ordered, start, items }, at)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn para(kind: Kind, text: &str) -> Item {
        Item::Para(Para {
            kind,
            inlines: if text.is_empty() {
                Vec::new()
            } else {
                vec![Inline::text(text)]
            },
            bookmarks: Vec::new(),
            shaded: false,
        })
    }

    fn bullet(level: u32, text: &str) -> Item {
        para(
            Kind::ListItem {
                level,
                num_id: 1,
                ordered: false,
                start: 1,
            },
            text,
        )
    }

    #[test]
    fn nested_bullets_become_nested_lists() {
        let blocks = blocks(vec![bullet(0, "a"), bullet(1, "a1"), bullet(1, "a2"), bullet(0, "b")]);
        assert_eq!(blocks.len(), 1);
        let Block::List { items, .. } = &blocks[0] else {
            panic!("a list");
        };
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0].blocks.len(),
            2,
            "the first item holds its paragraph and a nested list"
        );
        assert!(matches!(&items[0].blocks[1], Block::List { items, .. } if items.len() == 2));
    }

    #[test]
    fn checkbox_glyphs_make_task_lists_and_blank_paragraphs_vanish() {
        let normal = Kind::Styled(StyleKind::Normal);
        let blocks = blocks(vec![
            para(normal.clone(), "\u{2611} done"),
            para(normal.clone(), "\u{2610} todo"),
            para(normal.clone(), ""),
            para(normal, "Plain."),
        ]);
        assert_eq!(blocks.len(), 2, "{blocks:?}");
        let Block::List { items, .. } = &blocks[0] else {
            panic!("a task list");
        };
        assert_eq!((items[0].task, items[1].task), (Some(true), Some(false)));
        assert_eq!(
            plain_text(&match &items[0].blocks[0] {
                Block::Paragraph(p) => p.clone(),
                _ => Vec::new(),
            }),
            "done"
        );
    }

    #[test]
    fn code_and_quote_paragraphs_group() {
        let blocks = blocks(vec![
            para(Kind::Styled(StyleKind::Code), "let a = 1;"),
            para(Kind::Styled(StyleKind::Code), "let b = 2;"),
            para(Kind::Styled(StyleKind::Quote), "Wise words."),
            para(Kind::Styled(StyleKind::Heading(2)), "Part"),
        ]);
        assert!(matches!(&blocks[0], Block::Code { text, .. } if text == "let a = 1;\nlet b = 2;"));
        assert!(matches!(&blocks[1], Block::Quote(inner) if inner.len() == 1));
        assert!(matches!(&blocks[2], Block::Heading { level: 2, .. }));
    }
}
