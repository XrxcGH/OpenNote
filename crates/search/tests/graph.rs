//! Links between pages, backlinks, rename propagation, autocomplete, and the tag tree.

mod common;

use common::{block_id, doc, page_id, DocExt};
use opennote_search::{LinkEdit, PageDoc, Query, Rename, SearchIndex};

const TITLE: &str = "Leaf anatomy";

fn id_link(text: &str, page: u64) -> String {
    format!("[{text}](opennote:page/{})", page_id(page))
}

/// Page 1 is the target. Pages 2 to 4 link to it in different ways.
fn web() -> Vec<PageDoc> {
    vec![
        doc(1, TITLE).text("# Veins\n\nThe veins carry water.\n\nSelf link: [[Leaf anatomy]]"),
        doc(2, "Biology notes").text("See [[Leaf anatomy]] for more, and [[Missing page]]."),
        doc(3, "Plant tour").text(&format!("Start at {}, then stop.", id_link(TITLE, 1))),
        doc(4, "Exam review").text("[[Leaf anatomy#Veins]] and [[leaf  ANATOMY]] and [[Other page]]"),
        doc(5, "Custom text").text(&format!("Read {} too.", id_link("my own words", 1))),
    ]
}

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

#[test]
fn backlinks_follow_title_links_and_id_links_newest_first() {
    let index = index_of(&web());
    let links = index.backlinks(page_id(1)).unwrap();
    let sources: Vec<u64> = links.iter().map(|l| l.source.id().time_ms() - 1_000).collect();
    assert_eq!(sources, [5, 4, 4, 3, 2], "the page's own link is left out");
    assert_eq!(links[1].fragment.as_deref(), Some("Veins"));
    assert_eq!(links[3].link, id_link(TITLE, 1));
    assert_eq!(links[4].source_title, "Biology notes");
    assert_eq!(links[4].block, block_id(2, 0));
    let context = links[4].context.as_ref().unwrap();
    assert!(context.text.contains("for more"));
    assert!(index.backlinks(page_id(99)).unwrap().is_empty());
    assert!(index.backlinks(page_id(2)).unwrap().is_empty());
}

#[test]
fn outgoing_links_show_their_targets_and_headings() {
    let mut docs = web();
    docs.push(doc(6, "Twin"));
    docs.push(doc(7, "TWIN"));
    docs.push(doc(8, "Hub").text(&format!(
        "[[Leaf anatomy#veins]] [[Missing]] [[Twin]] {}",
        id_link("x", 2)
    )));
    let index = index_of(&docs);
    let links = index.outgoing_links(page_id(8)).unwrap();
    assert_eq!(links.len(), 4);
    assert_eq!(links[0].targets.len(), 1);
    assert_eq!(links[0].targets[0].page, page_id(1));
    assert_eq!(links[0].targets[0].block, Some(block_id(1, 0)), "the heading's block");
    assert!(links[1].targets.is_empty(), "a broken link");
    assert_eq!(links[2].targets.len(), 2, "an ambiguous title");
    assert_eq!(links[3].targets[0].title, "Biology notes");
    let headings = index.headings(page_id(1)).unwrap();
    assert_eq!((headings[0].level, headings[0].text.as_str()), (1, "Veins"));
}

#[test]
fn a_rename_lists_the_blocks_whose_link_text_must_change() {
    let index = index_of(&web());
    let rename = Rename {
        page: page_id(1),
        old_title: TITLE.into(),
        new_title: "Plant leaves".into(),
    };
    let edits = index.rename_edits(&rename).unwrap();
    let got: Vec<(u64, String)> = edits
        .iter()
        .map(|e| (e.page.id().time_ms() - 1_000, e.new.clone()))
        .collect();
    let expect = [
        (1, "[[Plant leaves]]".to_string()),
        (2, "[[Plant leaves]]".to_string()),
        (3, id_link("Plant leaves", 1)),
        (4, "[[Plant leaves#Veins]]".to_string()),
        (4, "[[Plant leaves]]".to_string()),
    ];
    assert_eq!(got, expect);
    assert!(
        edits.iter().all(|e| e.page != page_id(5)),
        "text the person wrote by hand stays"
    );
    assert_eq!(edits[0].block, block_id(1, 0));
}

#[test]
fn applying_the_edits_keeps_every_link_alive() {
    let mut docs = web();
    let mut index = index_of(&docs);
    let rename = Rename {
        page: page_id(1),
        old_title: TITLE.into(),
        new_title: "Plant leaves".into(),
    };
    for edit in index.rename_edits(&rename).unwrap() {
        let page = docs.iter_mut().find(|d| d.page == edit.page).unwrap();
        let block = page.blocks.iter_mut().find(|b| b.id == edit.block).unwrap();
        block.text = edit.apply(&block.text);
    }
    docs[0].title = "Plant leaves".into();
    index.upsert_many(&docs).unwrap();
    assert_eq!(index.backlinks(page_id(1)).unwrap().len(), 5, "no link was lost");
    assert!(
        index.rename_edits(&rename).unwrap().is_empty(),
        "nothing is left to rewrite"
    );
    assert!(
        index.search(&Query::text("\"leaf anatomy\"")).unwrap().is_empty(),
        "no text says the old title"
    );
}

#[test]
fn a_title_another_page_still_uses_is_ambiguous_so_title_links_stay() {
    let mut docs = web();
    docs.push(doc(9, TITLE).text("A different page with the same title"));
    let index = index_of(&docs);
    let rename = Rename {
        page: page_id(1),
        old_title: TITLE.into(),
        new_title: "Plant leaves".into(),
    };
    let edits = index.rename_edits(&rename).unwrap();
    assert_eq!(edits.len(), 1, "only the ID link is certain");
    assert_eq!(edits[0].page, page_id(3));
}

#[test]
fn suggests_pages_by_title_prefix() {
    let index = index_of(&[
        doc(1, "Leaf anatomy"),
        doc(2, "Leaves in autumn"),
        doc(3, "\u{c9}cole"),
        doc(4, ""),
        doc(5, "Root"),
    ]);
    let titles = |prefix: &str, limit| {
        index
            .suggest_pages(prefix, limit)
            .unwrap()
            .into_iter()
            .map(|s| s.title)
            .collect::<Vec<_>>()
    };
    assert_eq!(titles("LEA", 10), ["Leaf anatomy", "Leaves in autumn"]);
    assert_eq!(titles("leaf a", 10), ["Leaf anatomy"]);
    assert_eq!(titles("ecole", 10), ["\u{c9}cole"]);
    assert_eq!(
        titles("", 2),
        ["Root", "\u{c9}cole"],
        "without a prefix, the newest pages"
    );
    assert!(titles("zzz", 10).is_empty());
}

#[test]
fn the_tag_tree_counts_pages_under_each_tag() {
    let index = index_of(&[
        doc(1, "One").tags(&["a/b/c", "x"]),
        doc(2, "Two").tags(&["a/b", "a/c"]),
        doc(3, "Three").tags(&["A"]),
        doc(4, "Four").text("Plan #a/b/d soon"),
    ]);
    let nodes: Vec<(String, usize, usize)> = index
        .tag_tree()
        .unwrap()
        .into_iter()
        .map(|n| (n.tag, n.pages, n.own_pages))
        .collect();
    let expect = [
        ("a", 4, 1),
        ("a/b", 3, 1),
        ("a/b/c", 1, 1),
        ("a/b/d", 1, 1),
        ("a/c", 1, 1),
        ("x", 1, 1),
    ];
    assert_eq!(nodes, expect.map(|(t, p, o)| (t.to_string(), p, o)));
}

#[test]
fn an_edit_changes_links_but_not_the_same_text_in_code() {
    let edit = LinkEdit {
        page: page_id(2),
        block: block_id(2, 1),
        old: "[[Leaf]]".into(),
        new: "[[Foliage]]".into(),
    };
    let block = "Write `[[Leaf]]` to link, as in [[Leaf]].\n\n```\n[[Leaf]]\n```\n\nAgain [[Leaf]] and [[Leaf#Veins]].";
    assert_eq!(
        edit.apply(block),
        "Write `[[Leaf]]` to link, as in [[Foliage]].\n\n```\n[[Leaf]]\n```\n\nAgain [[Foliage]] and [[Leaf#Veins]]."
    );
    assert_eq!(edit.apply("nothing here"), "nothing here");
}
