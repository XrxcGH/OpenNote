//! Unlinked mentions through the index, and linking them.

mod common;

use common::{block_id, doc, page_id, DocExt};
use opennote_search::mentions::{find_mentions, link_mentions};
use opennote_search::{PageDoc, SearchIndex};

const TITLE: &str = "Leaf anatomy";

fn id_link(text: &str, page: u64) -> String {
    format!("[{text}](opennote:page/{})", page_id(page))
}

fn web() -> Vec<PageDoc> {
    vec![
        doc(1, TITLE).text("# Veins"),
        doc(2, "Field notes")
            .text("Today I studied leaf anatomy in the garden.")
            .modified(2_000),
        doc(3, "Linked only")
            .text("See [[Leaf anatomy]] for more.")
            .modified(3_000),
        doc(4, "Both")
            .text("Linked here: [[Leaf anatomy]].")
            .text("Unlinked here: Leaf anatomy again.")
            .modified(4_000),
        doc(5, "Own words")
            .text(&format!("{} and also leaf anatomy.", id_link("my own words", 1)))
            .modified(5_000),
        doc(6, "Secret").text("leaf anatomy").locked(),
        doc(7, "Table")
            .block(opennote_search::BlockKind::Table, "| a |\n| --- |\n| leaf anatomy |")
            .modified(1_000),
    ]
}

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn sources(index: &SearchIndex, limit: usize) -> Vec<u64> {
    index
        .unlinked_mentions(page_id(1), limit)
        .unwrap()
        .iter()
        .map(|found| found.source.id().time_ms() - 1_000)
        .collect()
}

#[test]
fn pages_that_say_the_title_without_linking_it_are_listed_newest_first() {
    let index = index_of(&web());
    assert_eq!(sources(&index, 50), [5, 4, 2, 7]);
}

#[test]
fn a_page_with_a_link_and_a_mention_lists_only_the_block_with_the_mention() {
    let index = index_of(&web());
    let found = index.unlinked_mentions(page_id(1), 50).unwrap();
    let both = found.iter().find(|found| found.source == page_id(4)).unwrap();
    assert_eq!(both.count, 1);
    assert_eq!(both.blocks.len(), 1);
    assert_eq!(both.blocks[0].block, block_id(4, 1));
    let context = both.blocks[0].context.as_ref().unwrap();
    assert!(context.text.contains("Unlinked here"));
    assert!(!context.highlights.is_empty());
    assert_eq!(both.source_title, "Both");
}

#[test]
fn a_link_with_other_words_does_not_hide_a_mention_in_the_same_block() {
    let index = index_of(&web());
    let found = index.unlinked_mentions(page_id(1), 50).unwrap();
    let own = found.iter().find(|found| found.source == page_id(5)).unwrap();
    assert_eq!(
        own.count, 1,
        "the link says `my own words`, and the mention is separate"
    );
}

#[test]
fn tables_count_and_locked_pages_and_the_page_itself_do_not() {
    let mut docs = web();
    docs[0] = doc(1, TITLE).text("Leaf anatomy is this page's own title");
    let index = index_of(&docs);
    let found = sources(&index, 50);
    assert!(found.contains(&7));
    assert!(!found.contains(&6));
    assert!(!found.contains(&1));
}

#[test]
fn the_limit_counts_pages() {
    let index = index_of(&web());
    assert_eq!(sources(&index, 2), [5, 4]);
    assert!(sources(&index, 0).is_empty());
}

#[test]
fn short_titles_and_unknown_pages_have_no_mentions() {
    let index = index_of(&[doc(1, "Go"), doc(2, "Other").text("go go go")]);
    assert!(index.unlinked_mentions(page_id(1), 10).unwrap().is_empty());
    assert!(index.unlinked_mentions(page_id(99), 10).unwrap().is_empty());
}

#[test]
fn a_rename_changes_which_title_is_mentioned() {
    let mut docs = web();
    let mut index = index_of(&docs);
    docs[0].title = "Plant leaves".into();
    index.upsert(&docs[0]).unwrap();
    assert!(sources(&index, 50).is_empty(), "nothing says the new title yet");
    index
        .upsert(&doc(8, "Journal").text("Wrote about plant leaves.").modified(8_000))
        .unwrap();
    assert_eq!(sources(&index, 50), [8]);
}

#[test]
fn counts_add_up_across_blocks() {
    let index = index_of(&[
        doc(1, TITLE),
        doc(2, "Busy")
            .text("leaf anatomy and Leaf Anatomy")
            .text("nothing")
            .text("one more leaf anatomy"),
    ]);
    let found = index.unlinked_mentions(page_id(1), 10).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].count, 3);
    assert_eq!(
        found[0].blocks.iter().map(|block| block.block).collect::<Vec<_>>(),
        [block_id(2, 0), block_id(2, 2)]
    );
}

#[test]
fn link_all_turns_every_mention_into_a_link_and_the_list_empties() {
    let mut docs = web();
    let mut index = index_of(&docs);
    for found in index.unlinked_mentions(page_id(1), 50).unwrap() {
        let page = docs.iter_mut().find(|d| d.page == found.source).unwrap();
        for entry in &found.blocks {
            let block = page.blocks.iter_mut().find(|b| b.id == entry.block).unwrap();
            let linked = link_mentions(&block.text, TITLE, page_id(1), None).unwrap();
            block.text = linked.markdown;
        }
    }
    index.upsert_many(&docs).unwrap();
    assert!(sources(&index, 50).is_empty());
    let from: Vec<u64> = index
        .backlinks(page_id(1))
        .unwrap()
        .iter()
        .map(|link| link.source.id().time_ms() - 1_000)
        .collect();
    for page in [2, 3, 4, 5, 7] {
        assert!(from.contains(&page), "page {page} links now");
    }
}

#[test]
fn the_index_may_list_a_block_whose_mention_is_only_code_and_the_markdown_says_so() {
    let index = index_of(&[doc(1, TITLE), doc(2, "Snippet").text("Run `leaf anatomy` first")]);
    let found = index.unlinked_mentions(page_id(1), 10).unwrap();
    assert_eq!(found.len(), 1, "the index sees plain text only");
    assert!(
        find_mentions("Run `leaf anatomy` first", TITLE).is_empty(),
        "the Markdown knows it is code"
    );
}
