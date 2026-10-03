//! Resolving page links, and keeping them alive through renames.

mod common;

use std::fs;
use std::path::Path;

use common::{block_id, doc, notebook_id, page_id, section_id, DocExt};
use opennote_search::links::Link;
use opennote_search::{LinkStatus, PageDoc, Place, SearchIndex};

fn id_link(text: &str, page: u64) -> String {
    format!("[{text}](opennote:page/{})", page_id(page))
}

fn index_of(docs: &[PageDoc]) -> SearchIndex {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert_many(docs).unwrap();
    index
}

fn pages(resolution: &opennote_search::Resolution) -> Vec<u64> {
    resolution
        .targets
        .iter()
        .map(|target| target.page.id().time_ms() - 1_000)
        .collect()
}

#[test]
fn a_title_link_finds_its_page_ignoring_case_accents_and_spacing() {
    let index = index_of(&[doc(1, "\u{c9}cole  Normale")]);
    let found = index.resolve_title("ecole normale", None, None).unwrap();
    assert_eq!((found.status, pages(&found)), (LinkStatus::Resolved, vec![1]));
    assert_eq!(found.first().unwrap().title, "\u{c9}cole  Normale");
    let missing = index.resolve_title("nothing here", None, None).unwrap();
    assert_eq!(missing.status, LinkStatus::Broken);
    assert!(missing.targets.is_empty() && !missing.heading_missing);
    assert_eq!(
        index.resolve_title("  ", None, None).unwrap().status,
        LinkStatus::Broken
    );
}

#[test]
fn pages_that_share_a_title_come_closest_first() {
    let index = index_of(&[
        doc(1, "Meeting notes").notebook(2).section(5).modified(9_000),
        doc(2, "Meeting notes").notebook(1).section(2).modified(1_000),
        doc(3, "Meeting notes").notebook(1).section(1).modified(2_000),
        doc(4, "Source").notebook(1).section(1),
        doc(5, "Other source").notebook(1).section(2),
        doc(6, "Far source").notebook(3).section(9),
    ]);
    let from = |n| Some(page_id(n));
    let section = index.resolve_title("meeting notes", None, from(4)).unwrap();
    assert_eq!(section.status, LinkStatus::Ambiguous);
    assert_eq!(
        pages(&section),
        [3, 2, 1],
        "the section, then the notebook, then elsewhere"
    );
    let notebook = index.resolve_title("meeting notes", None, from(5)).unwrap();
    assert_eq!(
        pages(&notebook),
        [2, 3, 1],
        "the section, then the newer page of the notebook"
    );
    let far = index.resolve_title("meeting notes", None, from(6)).unwrap();
    assert_eq!(pages(&far), [1, 3, 2], "newest first when nothing is close");
    let nowhere = index.resolve_title("meeting notes", None, None).unwrap();
    assert_eq!(pages(&nowhere), [1, 3, 2]);
}

#[test]
fn a_heading_names_a_block_and_a_missing_heading_is_reported() {
    let index = index_of(&[doc(1, "Cells").text("# Organelles\n\nText").text("## Membrane")]);
    let found = index.resolve_title("cells", Some("membrane"), None).unwrap();
    assert_eq!(found.first().unwrap().block, Some(block_id(1, 1)));
    assert!(!found.heading_missing);
    let missing = index.resolve_title("cells", Some("Nucleus"), None).unwrap();
    assert_eq!(missing.status, LinkStatus::Resolved, "the link still opens the page");
    assert_eq!(missing.first().unwrap().block, None);
    assert!(missing.heading_missing);
}

#[test]
fn an_id_link_survives_a_rename_and_breaks_when_the_page_is_gone() {
    let mut index = index_of(&[doc(1, "First title"), doc(2, "Reader").text(&id_link("First title", 1))]);
    let link = &index.resolve_markdown(&id_link("x", 1), None).unwrap()[0];
    assert_eq!(link.resolution.status, LinkStatus::Resolved);
    index.upsert(&doc(1, "Second title")).unwrap();
    let after = index.resolve_markdown(&id_link("x", 1), None).unwrap();
    assert_eq!(after[0].resolution.first().unwrap().title, "Second title");
    index.delete_page(page_id(1)).unwrap();
    let gone = index.resolve_markdown(&id_link("x", 1), None).unwrap();
    assert_eq!(gone[0].resolution.status, LinkStatus::Broken);
    let heading = format!("[x](opennote:page/{}#{})", page_id(2), block_id(2, 0));
    let to_block = index.resolve_markdown(&heading, None).unwrap();
    assert_eq!(to_block[0].resolution.first().unwrap().block, Some(block_id(2, 0)));
}

#[test]
fn a_renamed_page_is_still_found_by_its_old_title() {
    let mut index = index_of(&[
        doc(1, "Leaf anatomy").text("# Veins"),
        doc(2, "Reader").text("See [[Leaf anatomy]] and [[Leaf anatomy#Veins]]."),
    ]);
    let report = index.write(&[doc(1, "Plant leaves").text("# Veins")]).unwrap();
    assert_eq!(report.renames.len(), 1);
    assert_eq!(
        (
            report.renames[0].old_title.as_str(),
            report.renames[0].new_title.as_str()
        ),
        ("Leaf anatomy", "Plant leaves")
    );
    assert_eq!(report.updated, [page_id(1)]);

    let old = index
        .resolve_title("Leaf anatomy", Some("Veins"), Some(page_id(2)))
        .unwrap();
    assert_eq!((old.status, pages(&old)), (LinkStatus::Renamed, vec![1]));
    assert_eq!(old.first().unwrap().title, "Plant leaves");
    assert_eq!(
        old.first().unwrap().block,
        Some(block_id(1, 0)),
        "headings resolve through the alias"
    );

    let links = index.outgoing_links(page_id(2)).unwrap();
    assert!(links.iter().all(|link| link.status == LinkStatus::Renamed));
    let back = index.backlinks(page_id(1)).unwrap();
    assert_eq!(back.len(), 2, "the stale links still count");
    assert!(back.iter().all(|link| link.stale));
}

#[test]
fn repair_edits_bring_stale_links_up_to_date_and_then_nothing_is_stale() {
    let mut docs = vec![
        doc(1, "Leaf anatomy"),
        doc(2, "Reader").text("See [[Leaf anatomy]] and [[leaf anatomy#Veins]]."),
        doc(3, "ID").text(&id_link("Leaf anatomy", 1)),
    ];
    let mut index = index_of(&docs);
    docs[0].title = "Plant leaves".into();
    index.upsert(&docs[0]).unwrap();
    let edits = index.repair_edits(page_id(1)).unwrap();
    let got: Vec<(u64, &str)> = edits
        .iter()
        .map(|edit| (edit.page.id().time_ms() - 1_000, edit.new.as_str()))
        .collect();
    assert_eq!(got, [(2, "[[Plant leaves]]"), (2, "[[Plant leaves#Veins]]")]);
    for edit in &edits {
        let page = docs.iter_mut().find(|d| d.page == edit.page).unwrap();
        let block = page.blocks.iter_mut().find(|b| b.id == edit.block).unwrap();
        block.text = edit.apply(&block.text);
    }
    index.upsert_many(&docs[1..]).unwrap();
    assert!(index.repair_edits(page_id(1)).unwrap().is_empty());
    assert!(index.backlinks(page_id(1)).unwrap().iter().all(|link| !link.stale));
    let now = index.resolve_title("Plant leaves", None, None).unwrap();
    assert_eq!(now.status, LinkStatus::Resolved);
}

#[test]
fn a_page_that_takes_an_old_title_wins_it() {
    let mut index = index_of(&[doc(1, "Old name"), doc(2, "Reader").text("[[Old name]]")]);
    index.upsert(&doc(1, "New name")).unwrap();
    assert_eq!(
        index.resolve_title("old name", None, None).unwrap().status,
        LinkStatus::Renamed
    );
    index.upsert(&doc(3, "Old name").text("a different page")).unwrap();
    let taken = index.resolve_title("old name", None, None).unwrap();
    assert_eq!((taken.status, pages(&taken)), (LinkStatus::Resolved, vec![3]));
    assert!(
        index.repair_edits(page_id(1)).unwrap().is_empty(),
        "the link now means page 3"
    );
    assert!(index.backlinks(page_id(1)).unwrap().is_empty());
    assert_eq!(index.backlinks(page_id(3)).unwrap().len(), 1);
}

#[test]
fn renaming_a_page_back_forgets_the_alias_and_chains_keep_every_old_title() {
    let mut index = index_of(&[doc(1, "A")]);
    index.upsert(&doc(1, "B")).unwrap();
    index.upsert(&doc(1, "C")).unwrap();
    for old in ["a", "b"] {
        assert_eq!(
            index.resolve_title(old, None, None).unwrap().status,
            LinkStatus::Renamed,
            "{old}"
        );
    }
    index.upsert(&doc(1, "A")).unwrap();
    assert_eq!(
        index.resolve_title("a", None, None).unwrap().status,
        LinkStatus::Resolved
    );
    assert_eq!(
        index.resolve_title("c", None, None).unwrap().status,
        LinkStatus::Renamed
    );
}

#[test]
fn only_the_latest_old_titles_are_kept() {
    let mut index = index_of(&[doc(1, "Title 0")]);
    for n in 1..=20 {
        index
            .upsert(&doc(1, &format!("Title {n}")).modified(1_000 * n as i64))
            .unwrap();
    }
    assert_eq!(
        index.resolve_title("title 19", None, None).unwrap().status,
        LinkStatus::Renamed
    );
    assert_eq!(
        index.resolve_title("title 0", None, None).unwrap().status,
        LinkStatus::Broken
    );
    assert_eq!(
        index.resolve_title("title 3", None, None).unwrap().status,
        LinkStatus::Broken
    );
    assert_eq!(
        index.resolve_title("title 4", None, None).unwrap().status,
        LinkStatus::Renamed
    );
}

#[test]
fn deleting_a_page_forgets_its_old_titles() {
    let mut index = index_of(&[doc(1, "Before")]);
    index.upsert(&doc(1, "After")).unwrap();
    index.delete_page(page_id(1)).unwrap();
    assert_eq!(
        index.resolve_title("before", None, None).unwrap().status,
        LinkStatus::Broken
    );
    index.upsert(&doc(1, "Again")).unwrap();
    assert_eq!(
        index.resolve_title("before", None, None).unwrap().status,
        LinkStatus::Broken
    );
}

#[test]
fn a_case_only_rename_is_reported_but_needs_no_alias() {
    let mut index = index_of(&[doc(1, "leaf anatomy")]);
    let report = index.write(&[doc(1, "Leaf Anatomy")]).unwrap();
    assert_eq!(report.renames.len(), 1);
    assert_eq!(
        index.resolve_title("LEAF ANATOMY", None, None).unwrap().status,
        LinkStatus::Resolved
    );
    assert!(index.repair_edits(page_id(1)).unwrap().is_empty());
}

#[test]
fn a_report_says_what_was_added_updated_and_removed() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let report = index.write(&[doc(1, "One"), doc(2, "Two")]).unwrap();
    assert_eq!(report.added, [page_id(1), page_id(2)]);
    assert!(report.updated.is_empty() && report.renames.is_empty());
    let report = index
        .write(&[
            doc(1, "One").text("more"),
            doc(2, "Two").locked(),
            doc(3, "Three").locked(),
        ])
        .unwrap();
    assert_eq!(report.updated, [page_id(1)]);
    assert_eq!(
        report.removed,
        [page_id(2)],
        "a locked page that was never held is not removed"
    );
    assert!(report.added.is_empty());
}

#[test]
fn a_resolver_agrees_with_the_index_for_every_link_of_a_web() {
    let mut docs = vec![
        doc(1, "Alpha").notebook(1).section(1),
        doc(2, "Beta").notebook(1).section(2),
        doc(3, "Beta").notebook(2).section(3),
        doc(4, "Gamma"),
        doc(5, "Links").text(&format!(
            "[[Alpha]] [[beta]] [[Gamma#Nope]] [[Lost]] [[Old gamma]] {} {}",
            id_link("a", 1),
            id_link("gone", 77)
        )),
    ];
    docs.push(doc(6, "Delta").text("[[Alpha]]"));
    let mut index = index_of(&docs);
    index.upsert(&doc(4, "Gamma two")).unwrap();
    index.upsert(&doc(4, "Gamma three")).unwrap();
    index.upsert(&doc(7, "Old gamma")).unwrap();
    index
        .upsert(&doc(8, "Gamma").text("new owner of the old title"))
        .unwrap();
    let resolver = index.resolver().unwrap();
    let origin = index.place_of(Some(page_id(5))).unwrap().unwrap();
    assert_eq!(
        origin,
        Place {
            notebook: notebook_id(1),
            section: section_id(1)
        }
    );
    for title in ["alpha", "beta", "gamma", "gamma two", "lost", "old gamma", ""] {
        let (status, found) = resolver.resolve_title(title, Some(origin));
        let single = index.resolve_title(title, None, Some(page_id(5))).unwrap();
        assert_eq!(status, single.status, "{title}");
        let from_resolver: Vec<opennote_core::PageId> = found.iter().map(|at| resolver.pages()[*at].page).collect();
        let from_index: Vec<opennote_core::PageId> = single.targets.iter().map(|t| t.page).collect();
        assert_eq!(from_resolver, from_index, "{title}");
    }
}

fn files_hold(dir: &Path, token: &str) -> bool {
    let needles = [token.to_string(), token.to_lowercase()];
    fs::read_dir(dir).unwrap().any(|entry| {
        let bytes = fs::read(entry.unwrap().path()).unwrap();
        needles
            .iter()
            .any(|needle| bytes.windows(needle.len()).any(|window| window == needle.as_bytes()))
    })
}

#[test]
fn a_page_that_locks_after_a_rename_leaves_no_old_title_in_the_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut index = SearchIndex::open(&dir.path().join("search.db")).unwrap();
    index.upsert(&doc(1, "Zephyrine original").text("plain")).unwrap();
    index.upsert(&doc(1, "Quillon renamed").text("plain")).unwrap();
    index.upsert(&doc(1, "Quillon renamed").text("plain").locked()).unwrap();
    assert_eq!(index.page_count().unwrap(), 0);
    assert_eq!(
        index.resolve_title("zephyrine original", None, None).unwrap().status,
        LinkStatus::Broken
    );
    drop(index);
    assert!(!files_hold(dir.path(), "Zephyrine"));
    assert!(!files_hold(dir.path(), "Quillon"));
}

#[test]
fn links_found_in_markdown_carry_their_resolution() {
    let index = index_of(&[doc(1, "Target"), doc(2, "Reader")]);
    let found = index
        .resolve_markdown("see [[Target]], `[[Target]]` and [[Nowhere]]", Some(page_id(2)))
        .unwrap();
    assert_eq!(found.len(), 2, "code holds no links");
    assert_eq!(found[0].resolution.status, LinkStatus::Resolved);
    assert_eq!(found[1].resolution.status, LinkStatus::Broken);
    let link: &Link = &found[1].link;
    assert_eq!(link.title, "Nowhere");
}
