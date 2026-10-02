#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::sync::Arc;

use super::diff::Hunk;
use super::*;
use crate::format::readable::render_page_md;
use crate::id::Id;
use crate::model::{Block, ImageData, JsonMap, TextData};
use crate::order::OrderKey;
use crate::testing::sample::{sample_asset_id, sample_page};
use crate::testing::NoLinks;
use crate::time::Timestamp;

fn id(n: u128) -> BlockId {
    BlockId(Id::from_parts(1_800_000_000_000, n))
}

fn block(n: u128, key: &OrderKey, data: BlockData) -> Arc<Block> {
    Arc::new(Block {
        id: id(n),
        order: key.clone(),
        frame: None,
        lock: None,
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        data,
        fallback: None,
        extra: JsonMap::new(),
    })
}

fn text(markdown: &str) -> BlockData {
    BlockData::Text(TextData {
        markdown: markdown.into(),
        ..TextData::default()
    })
}

/// A page titled "Cells" with three text blocks (1 to 3) and a picture (4), in that order.
fn page() -> Page {
    let mut page = sample_page();
    let ids: Vec<BlockId> = page.blocks.iter().map(|b| b.id).collect();
    for old in ids {
        page.blocks.remove(old);
    }
    page.title = "Cells".to_owned();
    page.tags = vec!["biology".to_owned()];
    let keys = OrderKey::spread(None, None, 4).unwrap();
    let image = BlockData::Image(ImageData {
        asset: sample_asset_id(),
        alt: "A cell".to_owned(),
        decorative: false,
        crop: None,
        extra: JsonMap::new(),
    });
    let blocks = [
        block(1, &keys[0], text("The cell has a membrane.\n\nIt also has a nucleus.")),
        block(2, &keys[1], text("## Organelles\n\n- Mitochondria\n- Ribosomes")),
        block(3, &keys[2], text("Cells divide by mitosis.")),
        block(4, &keys[3], image),
    ];
    for b in blocks {
        page.blocks.insert(b).unwrap();
    }
    page
}

fn file(page: &Page) -> String {
    String::from_utf8(render_page_md(page, &NoLinks)).unwrap()
}

fn plan_for(base: &Page, edited: &str) -> MarkdownImport {
    plan_import(base, base, edited, &NoLinks)
}

#[test]
fn a_file_nobody_edited_brings_nothing() {
    let base = page();
    assert!(plan_for(&base, &file(&base)).is_empty());
    assert!(plan_for(&base, &file(&base).replace('\n', "\r\n")).is_empty());
}

#[test]
fn a_changed_word_replaces_one_block() {
    let base = page();
    let edited = file(&base).replace("Ribosomes", "Ribosomes and vacuoles");
    let plan = plan_for(&base, &edited);
    assert_eq!(
        plan.changes,
        [TextChange::Replace {
            block: id(2),
            markdown: "## Organelles\n\n- Mitochondria\n- Ribosomes and vacuoles".to_owned()
        }]
    );
    assert!(plan.conflicts.is_empty() && plan.skipped == 0);
}

#[test]
fn a_new_paragraph_between_blocks_is_a_new_block() {
    let base = page();
    let edited = file(&base).replace("Cells divide by mitosis.", "A new thought.\n\nCells divide by mitosis.");
    let plan = plan_for(&base, &edited);
    assert_eq!(
        plan.changes,
        [TextChange::Insert {
            after: Some(id(2)),
            before: None,
            markdown: "A new thought.".to_owned()
        }]
    );
}

#[test]
fn a_paragraph_after_the_title_comes_before_the_first_block() {
    let base = page();
    let edited = file(&base).replace("# Cells\n\n", "# Cells\n\nIntro.\n\n");
    let plan = plan_for(&base, &edited);
    assert_eq!(
        plan.changes,
        [TextChange::Insert {
            after: None,
            before: Some(id(1)),
            markdown: "Intro.".to_owned()
        }]
    );
}

#[test]
fn lines_added_below_a_block_join_it() {
    let base = page();
    let edited = file(&base).replace("- Ribosomes", "- Ribosomes\n- Lysosomes");
    let plan = plan_for(&base, &edited);
    assert_eq!(
        plan.changes,
        [TextChange::Replace {
            block: id(2),
            markdown: "## Organelles\n\n- Mitochondria\n- Ribosomes\n- Lysosomes".to_owned()
        }]
    );
}

#[test]
fn a_deleted_block_is_removed() {
    let base = page();
    let edited = file(&base).replace("Cells divide by mitosis.\n\n", "");
    let plan = plan_for(&base, &edited);
    assert_eq!(plan.changes, [TextChange::Remove { block: id(3) }]);
}

#[test]
fn an_edit_through_two_blocks_merges_them() {
    let base = page();
    let edited = file(&base).replace("nucleus.\n\n## Organelles\n\n- Mito", "nucleus and - Mito");
    let plan = plan_for(&base, &edited);
    assert_eq!(plan.changes.len(), 2, "{plan:?}");
    assert!(plan.changes.contains(&TextChange::Replace {
        block: id(1),
        markdown: "The cell has a membrane.\n\nIt also has a nucleus and - Mitochondria\n- Ribosomes".to_owned()
    }));
    assert!(plan.changes.contains(&TextChange::Remove { block: id(2) }));
}

#[test]
fn the_title_and_tags_come_from_the_front_matter() {
    let base = page();
    let edited = file(&base)
        .replace("title: \"Cells\"", "title: \"Cell biology\"")
        .replace("tags: [\"biology\"]", "tags: [\"biology\", \"exam\"]");
    let plan = plan_for(&base, &edited);
    assert_eq!(plan.title.as_deref(), Some("Cell biology"));
    assert_eq!(plan.tags, Some(vec!["biology".to_owned(), "exam".to_owned()]));
    assert!(plan.changes.is_empty());
    // A page whose title changed since is left alone.
    let mut current = base.clone();
    current.title = "Renamed here".to_owned();
    assert_eq!(plan_import(&base, &current, &edited, &NoLinks).title, None);
}

#[test]
fn a_block_that_changed_in_the_page_since_is_a_conflict() {
    let base = page();
    let mut current = base.clone();
    let edited_in_app = block(3, &OrderKey::spread(None, None, 4).unwrap()[2], text("Cells divide."));
    current.blocks.replace(edited_in_app).unwrap();
    let edited = file(&base).replace("mitosis", "meiosis");
    let plan = plan_import(&base, &current, &edited, &NoLinks);
    assert_eq!(plan.conflicts, [id(3)]);
    assert!(plan.changes.is_empty());
}

#[test]
fn changes_to_pictures_and_the_heading_are_counted_not_merged() {
    let base = page();
    let edited = file(&base).replace("![A cell]", "![A fine cell]");
    let plan = plan_for(&base, &edited);
    assert_eq!((plan.skipped, plan.changes.len()), (1, 0));
    let edited = file(&base).replace("# Cells", "# Cell biology");
    let plan = plan_for(&base, &edited);
    assert_eq!((plan.skipped, plan.changes.len()), (1, 0));
}

#[test]
fn files_too_long_to_compare_are_left_alone() {
    let mut base = page();
    let long: String = (0..2_500).map(|n| format!("line {n}\n")).collect();
    let keys = OrderKey::spread(None, None, 5).unwrap();
    base.blocks.insert(block(5, &keys[4], text(long.trim_end()))).unwrap();
    let different: String = (0..2_500).map(|n| format!("other {n}\n")).collect();
    let edited = file(&base).replace(&long, &different);
    assert!(plan_for(&base, &edited).too_different);
}

#[test]
fn the_diff_finds_runs_of_changed_lines() {
    let base: Vec<String> = ["a", "b", "c", "d", "e"].iter().map(|s| (*s).to_owned()).collect();
    let hunks = diff(&base, &["a", "x", "c", "d", "y", "z"]).unwrap();
    assert_eq!(
        hunks,
        [
            Hunk {
                base: 1..2,
                edited: 1..2
            },
            Hunk {
                base: 4..5,
                edited: 4..6
            }
        ]
    );
    assert!(diff(&base, &["a", "b", "c", "d", "e"]).unwrap().is_empty());
    let all = diff(&base, &[]).unwrap();
    assert_eq!(
        all,
        [Hunk {
            base: 0..5,
            edited: 0..0
        }]
    );
}
