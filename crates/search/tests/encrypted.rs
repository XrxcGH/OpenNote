//! Encrypted sections never enter the index, and leave nothing behind in its files (spec 5.7).

mod common;

use std::fs;
use std::path::Path;

use common::{doc, page_id, section_id, DocExt};
use opennote_search::{Query, SearchIndex};

fn hits(index: &SearchIndex, text: &str) -> usize {
    index.search(&Query::text(text)).unwrap().len()
}

fn secret(n: u64) -> opennote_search::PageDoc {
    doc(n, "Hidden title")
        .text("the butler did it, see [[Public page]]")
        .tags(&["private/diary"])
        .locked()
}

#[test]
fn a_locked_page_is_never_indexed() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert(&doc(1, "Public page").text("open words")).unwrap();
    index.upsert(&secret(2)).unwrap();
    assert_eq!(index.page_count().unwrap(), 1);
    for word in ["hidden", "butler", "diary", "private"] {
        assert_eq!(hits(&index, word), 0, "{word}");
    }
    assert!(index.indexed_page(page_id(2)).unwrap().is_none());
    assert!(
        index.backlinks(page_id(1)).unwrap().is_empty(),
        "links of a locked page are not indexed"
    );
    assert!(index.tag_tree().unwrap().is_empty());
    assert!(index.suggest_pages("hid", 10).unwrap().is_empty());
}

#[test]
fn a_page_that_becomes_locked_is_removed() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert(
            &doc(2, "Hidden title")
                .text("the butler did it, see [[Public page]]")
                .tags(&["private/diary"]),
        )
        .unwrap();
    assert_eq!(hits(&index, "butler"), 1);
    index.upsert(&secret(2)).unwrap();
    assert_eq!(index.page_count().unwrap(), 0);
    assert_eq!(hits(&index, "butler"), 0);
    assert!(index.tag_tree().unwrap().is_empty());
}

fn files_hold(dir: &Path, token: &str) -> bool {
    let needles = [token.to_string(), token.to_lowercase()];
    fs::read_dir(dir).unwrap().any(|entry| {
        let bytes = fs::read(entry.unwrap().path()).unwrap();
        needles
            .iter()
            .any(|needle| bytes.windows(needle.len()).any(|w| w == needle.as_bytes()))
    })
}

#[test]
fn nothing_of_a_page_that_becomes_locked_stays_in_the_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("search.db");
    let page = |n: u64, word: &str| {
        doc(n, &format!("Title {word}"))
            .text(&format!("Body {word}"))
            .tags(&[word])
            .section(n)
    };
    {
        let mut index = SearchIndex::open(&path).unwrap();
        let filler: Vec<_> = (10..60)
            .map(|n| doc(n, "Filler").text("unrelated filler words here"))
            .collect();
        index.upsert_many(&filler).unwrap();
        index.upsert(&page(1, "Zyxwvutsrq")).unwrap();
        index.upsert(&page(2, "Qponmlkjih")).unwrap();
    }
    assert!(
        files_hold(dir.path(), "Zyxwvutsrq"),
        "the check must be able to see text in the file"
    );
    {
        let mut index = SearchIndex::open(&path).unwrap();
        index.upsert(&page(1, "Zyxwvutsrq").locked()).unwrap();
        assert_eq!(index.purge_section(section_id(2)).unwrap(), 1);
        assert_eq!(index.page_count().unwrap(), 50);
        assert!(
            !files_hold(dir.path(), "Zyxwvutsrq"),
            "a locked page must leave nothing in the files"
        );
        assert!(
            !files_hold(dir.path(), "Qponmlkjih"),
            "a deleted section must leave nothing in the files"
        );
    }
    assert!(!files_hold(dir.path(), "Zyxwvutsrq") && !files_hold(dir.path(), "Qponmlkjih"));
}
