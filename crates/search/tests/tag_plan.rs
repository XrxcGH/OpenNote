//! Previews of tag renames, merges, and deletes.

mod common;

use common::{doc, page_id, DocExt};
use opennote_search::{PageDoc, SearchIndex, TagChange};

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn sample() -> SearchIndex {
    index_of(&[
        doc(1, "A").tags(&["school", "school/biology"]),
        doc(2, "B").tags(&["school/biology/cells"]),
        doc(3, "C").tags(&["schoolwork", "uni"]),
        doc(4, "D").tags(&["school/biology"]),
        doc(5, "E").tags(&["School/Chemistry"]).locked(),
    ])
}

fn change(from: &str, to: Option<&str>, pages: &[u64]) -> TagChange {
    TagChange {
        from: from.into(),
        to: to.map(String::from),
        pages: pages.iter().map(|n| page_id(*n)).collect(),
    }
}

#[test]
fn a_rename_moves_the_tag_and_the_tags_nested_in_it() {
    let plan = sample().plan_tag_rename("School", "#college").unwrap();
    assert_eq!(
        plan.changes,
        [
            change("school", Some("college"), &[1]),
            change("school/biology", Some("college/biology"), &[1, 4]),
            change("school/biology/cells", Some("college/biology/cells"), &[2]),
        ]
    );
    assert_eq!(plan.page_count, 3);
    assert!(!plan.merges);
}

#[test]
fn a_lookalike_tag_does_not_move() {
    let plan = sample().plan_tag_rename("school", "x").unwrap();
    assert!(plan.changes.iter().all(|change| change.from != "schoolwork"));
}

#[test]
fn renaming_to_a_tag_that_exists_is_a_merge() {
    assert!(sample().plan_tag_rename("school", "uni").unwrap().merges);
    assert!(sample().plan_tag_rename("school", "schoolwork").unwrap().merges);
    assert!(!sample().plan_tag_rename("school", "school/new").unwrap().merges);
    assert!(!sample().plan_tag_rename("nothing", "uni").unwrap().merges);
}

#[test]
fn a_delete_lists_the_pages_that_lose_a_tag() {
    let plan = sample().plan_tag_delete("school/biology").unwrap();
    assert_eq!(
        plan.changes,
        [
            change("school/biology", None, &[1, 4]),
            change("school/biology/cells", None, &[2]),
        ]
    );
    assert_eq!(plan.page_count, 3);
}

#[test]
fn nothing_changes_for_empty_unknown_or_equal_names() {
    let index = sample();
    for plan in [
        index.plan_tag_rename("#", "x").unwrap(),
        index.plan_tag_rename("school", " / ").unwrap(),
        index.plan_tag_rename("School", "school").unwrap(),
        index.plan_tag_rename("nothing", "x").unwrap(),
        index.plan_tag_delete("").unwrap(),
        index.plan_tag_delete("nothing").unwrap(),
    ] {
        assert!(plan.changes.is_empty() && plan.page_count == 0 && !plan.merges);
    }
}
