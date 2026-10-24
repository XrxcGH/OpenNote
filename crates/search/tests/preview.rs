//! Link previews: the first lines of a page, or the lines under a heading.

mod common;

use common::{block_id, doc, page_id, DocExt};
use opennote_search::{BlockKind, SearchIndex};

fn sample() -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert_many(&[
            doc(1, "Photosynthesis")
                .text("Plants turn light into sugar.\n\nIt happens in the chloroplast.")
                .text(concat!(
                    "# Light reactions\n\nWater splits.\n\n## Detail\n\nOxygen is released.\n\n",
                    "# Calvin cycle\n\nCarbon is fixed."
                )),
            doc(2, "Only a picture").block(BlockKind::Image, "A leaf under a microscope"),
            doc(3, "Long").text(&"word ".repeat(300)),
            doc(4, "Secret").text("Hidden notes.").locked(),
            doc(5, "Many lines").text(&(1..=20).map(|n| format!("line {n}")).collect::<Vec<_>>().join("\n\n")),
        ])
        .unwrap();
    index
}

#[test]
fn a_page_previews_its_first_lines() {
    let index = sample();
    let preview = index.link_preview(page_id(1), None).unwrap().unwrap();
    assert_eq!(preview.title, "Photosynthesis");
    assert_eq!(preview.heading, None);
    assert_eq!(preview.block, Some(block_id(1, 0)));
    assert!(preview
        .text
        .starts_with("Plants turn light into sugar.\nIt happens in the chloroplast.\nLight reactions\n"));
    assert!(!preview.heading_missing);
}

#[test]
fn a_heading_previews_the_lines_under_it_up_to_the_next_heading_of_its_level() {
    let index = sample();
    let preview = index
        .link_preview(page_id(1), Some("light  REACTIONS"))
        .unwrap()
        .unwrap();
    assert_eq!(preview.heading.as_deref(), Some("Light reactions"));
    assert_eq!(preview.block, Some(block_id(1, 1)));
    assert_eq!(preview.text, "Water splits.\nDetail\nOxygen is released.");
    let preview = index.link_preview(page_id(1), Some("Detail")).unwrap().unwrap();
    assert_eq!(preview.text, "Oxygen is released.");
    let preview = index.link_preview(page_id(1), Some("Calvin cycle")).unwrap().unwrap();
    assert_eq!(preview.text, "Carbon is fixed.");
}

#[test]
fn a_missing_heading_falls_back_to_the_start_and_says_so() {
    let index = sample();
    let preview = index.link_preview(page_id(1), Some("Nope")).unwrap().unwrap();
    assert!(preview.heading_missing);
    assert_eq!(preview.heading, None);
    assert!(preview.text.starts_with("Plants turn light"));
    let blank = index.link_preview(page_id(1), Some("  ")).unwrap().unwrap();
    assert!(!blank.heading_missing, "an empty fragment names nothing");
}

#[test]
fn text_blocks_come_first_and_other_blocks_stand_in_for_a_page_without_text() {
    let index = sample();
    let preview = index.link_preview(page_id(2), None).unwrap().unwrap();
    assert_eq!(preview.text, "A leaf under a microscope");
}

#[test]
fn a_preview_is_cut_at_the_character_and_line_limits() {
    let index = sample();
    let long = index.link_preview(page_id(3), None).unwrap().unwrap();
    assert_eq!(long.text.chars().count(), 401);
    assert!(long.text.ends_with('\u{2026}'));
    let many = index.link_preview(page_id(5), None).unwrap().unwrap();
    assert_eq!(many.text.lines().count(), 8);
    assert!(many.text.ends_with('\u{2026}'));
    assert!(many.text.starts_with("line 1\nline 2"));
}

#[test]
fn locked_and_unknown_pages_have_no_preview() {
    let index = sample();
    assert!(index.link_preview(page_id(4), None).unwrap().is_none());
    assert!(index.link_preview(page_id(99), None).unwrap().is_none());
}
