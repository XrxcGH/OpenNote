//! The quick switcher over a real index: it follows the index as pages come, go, and change.

mod common;

use common::{doc, page_id, DocExt};
use opennote_search::{SearchIndex, SwitchContext, Switcher};

fn titles(switcher: &Switcher, query: &str) -> Vec<String> {
    switcher
        .find(query, &SwitchContext::default())
        .hits
        .into_iter()
        .map(|hit| hit.title)
        .collect()
}

#[test]
fn the_switcher_reloads_only_when_the_index_changed() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    let mut switcher = Switcher::new();
    assert!(switcher.refresh(&index).unwrap(), "the first call loads");
    assert!(!switcher.refresh(&index).unwrap(), "nothing changed");
    index.upsert(&doc(1, "Physics lab")).unwrap();
    assert!(switcher.refresh(&index).unwrap());
    assert_eq!(titles(&switcher, "phys"), ["Physics lab"]);
    assert!(!switcher.refresh(&index).unwrap());

    index.upsert(&doc(1, "Chemistry lab")).unwrap();
    assert!(switcher.refresh(&index).unwrap(), "a rename is a change");
    assert_eq!(titles(&switcher, "phys"), Vec::<String>::new());
    assert_eq!(titles(&switcher, "chem"), ["Chemistry lab"]);

    assert!(index.delete_page(page_id(1)).unwrap());
    assert!(switcher.refresh(&index).unwrap());
    assert!(switcher.is_empty());
}

#[test]
fn moving_a_page_updates_the_switcher_without_a_new_title() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index.upsert(&doc(1, "Moved page").section(1)).unwrap();
    let mut switcher = Switcher::new();
    switcher.refresh(&index).unwrap();
    let before = switcher.find("moved", &SwitchContext::default()).hits[0].section;
    index
        .relocate(page_id(1), common::notebook_id(1), common::section_id(7))
        .unwrap();
    assert!(switcher.refresh(&index).unwrap());
    let after = switcher.find("moved", &SwitchContext::default()).hits[0].section;
    assert_ne!(before, after);
    assert_eq!(after, common::section_id(7));
}

#[test]
fn a_replaced_index_is_never_mistaken_for_the_old_one() {
    let mut first = SearchIndex::open_in_memory().unwrap();
    first.upsert(&doc(1, "From the first index")).unwrap();
    let mut switcher = Switcher::new();
    switcher.refresh(&first).unwrap();

    let mut second = SearchIndex::open_in_memory().unwrap();
    second.upsert(&doc(1, "From the second index")).unwrap();
    assert!(switcher.refresh(&second).unwrap());
    assert_eq!(titles(&switcher, "second"), ["From the second index"]);
}

#[test]
fn locked_pages_never_reach_the_switcher() {
    let mut index = SearchIndex::open_in_memory().unwrap();
    index
        .upsert_many(&[doc(1, "Open page"), doc(2, "Secret diary").locked()])
        .unwrap();
    let mut switcher = Switcher::new();
    switcher.refresh(&index).unwrap();
    assert_eq!(switcher.len(), 1);
    assert!(titles(&switcher, "secret").is_empty());
}
