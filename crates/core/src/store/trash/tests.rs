#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::time::Duration;

use super::*;
use crate::model::PageNodeState;
use crate::session::notebook::{NodePlacement, ParentRef};
use crate::store::notebook_store::kit::Kit;

fn pages(store: &NotebookStore, section: SectionId) -> Vec<(String, u8)> {
    store
        .tree()
        .section(section)
        .map(|s| s.pages.iter().map(|p| (p.title.clone(), p.level)).collect())
        .unwrap_or_default()
}

fn setup() -> (Kit, NotebookStore, SectionId, [PageId; 3]) {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let section = store.create_section("Lab", None, None).unwrap();
    let a = store.create_page(section, None, None, "A").unwrap();
    let b = store.create_page(section, None, None, "B").unwrap();
    let a1 = store.create_page(section, Some(a), None, "A1").unwrap();
    (kit, store, section, [a, b, a1])
}

#[test]
fn a_page_with_subpages_is_one_item_and_comes_back_in_place() {
    let (kit, mut store, section, [a, _b, a1]) = setup();
    let items = store
        .delete(&[NodeRef::Page(a), NodeRef::Page(a1)], TrashReason::Deleted)
        .unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(pages(&store, section), [("B".into(), 0)]);
    let item_dir = kit.root.join(".opennote/trash").join(items[0].to_string());
    assert!(kit.fs.inner.exists(&item_dir.join(a.to_string()).join("page.json")));
    assert!(kit.fs.inner.exists(&item_dir.join(a1.to_string())));
    let listed = store.trash_items();
    assert_eq!((listed[0].title.as_str(), listed[0].kind), ("A", TrashKind::Page));
    let restored = store.restore(items[0], None).unwrap();
    assert_eq!(restored, vec![NodeRef::Page(a)]);
    assert_eq!(
        pages(&store, section),
        [("A".into(), 0), ("A1".into(), 1), ("B".into(), 0)]
    );
    assert!(!kit.fs.inner.exists(&item_dir));
    assert!(store.trash_items().is_empty());
    let again = kit.open().unwrap();
    assert_eq!(
        pages(&again, section),
        [("A".into(), 0), ("A1".into(), 1), ("B".into(), 0)]
    );
}

#[test]
fn several_roots_make_several_items() {
    let (_kit, mut store, section, [a, b, _a1]) = setup();
    let items = store
        .delete(&[NodeRef::Page(a), NodeRef::Page(b)], TrashReason::Deleted)
        .unwrap();
    assert_eq!(items.len(), 2);
    assert!(pages(&store, section).is_empty());
    store.restore(items[1], None).unwrap();
    assert_eq!(pages(&store, section), [("B".into(), 0)]);
}

#[test]
fn pages_whose_section_is_gone_come_back_in_a_new_section() {
    let (_kit, mut store, section, [a, _b, _a1]) = setup();
    let page_item = store.delete(&[NodeRef::Page(a)], TrashReason::Deleted).unwrap()[0];
    store
        .delete(&[NodeRef::Section(section)], TrashReason::Deleted)
        .unwrap();
    assert!(store.tree().sections.is_empty());
    store.restore(page_item, None).unwrap();
    let tree = store.tree();
    assert_eq!(tree.sections.len(), 1);
    assert_eq!(tree.sections[0].title, "Lab");
    assert_ne!(tree.sections[0].id, section);
    assert_eq!(tree.sections[0].pages.len(), 2);
}

#[test]
fn a_section_goes_to_trash_and_back_to_the_top_level_if_its_group_is_gone() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let group = store.create_group("G", None, None).unwrap();
    let section = store.create_section("S", Some(group), None).unwrap();
    store.create_page(section, None, None, "P").unwrap();
    let item = store
        .delete(&[NodeRef::Section(section)], TrashReason::Deleted)
        .unwrap()[0];
    assert!(!kit.fs.inner.exists(&kit.root.join(section.to_string())));
    store.delete(&[NodeRef::Group(group)], TrashReason::Deleted).unwrap();
    store.restore(item, None).unwrap();
    let tree = kit.open().unwrap().tree();
    let node = tree.section(section).unwrap();
    assert_eq!(node.group, None);
    assert_eq!(node.pages.len(), 1);
}

#[test]
fn a_group_takes_its_groups_and_sections_and_brings_them_back() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let group = store.create_group("G", None, None).unwrap();
    let inner = store.create_group("Inner", Some(group), None).unwrap();
    let s1 = store.create_section("S1", Some(group), None).unwrap();
    let s2 = store.create_section("S2", Some(inner), None).unwrap();
    let items = store
        .delete(&[NodeRef::Group(group), NodeRef::Section(s2)], TrashReason::Deleted)
        .unwrap();
    assert_eq!(items.len(), 1);
    let tree = store.tree();
    assert!(tree.groups.is_empty() && tree.sections.is_empty());
    let item = &store.trash_items()[0];
    assert_eq!(item.kind, TrashKind::Group);
    assert_eq!(item.contents.len(), 2);
    store.restore(items[0], None).unwrap();
    let tree = kit.open().unwrap().tree();
    assert_eq!(tree.groups.len(), 2);
    assert_eq!(tree.section(s1).unwrap().group, Some(group));
    assert_eq!(tree.section(s2).unwrap().group, Some(inner));
}

#[test]
fn purging_deletes_the_item_for_good() {
    let (kit, mut store, _section, [a, b, _a1]) = setup();
    let items = store
        .delete(&[NodeRef::Page(a), NodeRef::Page(b)], TrashReason::Deleted)
        .unwrap();
    store.purge(items[0]).unwrap();
    assert!(!kit
        .fs
        .inner
        .exists(&kit.root.join(".opennote/trash").join(items[0].to_string())));
    assert_eq!(store.trash_items().len(), 1);
    assert!(store.purge(items[0]).is_err());
    store.empty_trash().unwrap();
    assert!(store.trash_items().is_empty());
}

#[test]
fn expired_items_are_purged() {
    let (kit, mut store, _section, [a, _b, _a1]) = setup();
    store.delete(&[NodeRef::Page(a)], TrashReason::Deleted).unwrap();
    assert!(store.purge_expired().unwrap().is_empty());
    kit.clock.advance(Duration::from_secs(31 * 86_400));
    assert_eq!(store.purge_expired().unwrap().len(), 1);
    assert!(store.trash_items().is_empty());
}

#[test]
fn a_held_folder_leaves_the_deletion_pending_and_hidden() {
    let (kit, mut store, section, [a, _b, _a1]) = setup();
    let folder = kit.root.join(section.to_string()).join(a.to_string());
    kit.fs.hold(&folder);
    let item = store.delete(&[NodeRef::Page(a)], TrashReason::Deleted).unwrap()[0];
    assert!(kit.fs.inner.exists(&folder));
    assert_eq!(pages(&store, section), [("B".into(), 0)]);
    // A reopen still hides the pending deletion, and the scan finishes it once the folder is free.
    let mut again = kit.open().unwrap();
    assert_eq!(pages(&again, section), [("B".into(), 0)]);
    kit.fs.release();
    again.scan().unwrap();
    let item_dir = kit.root.join(".opennote/trash").join(item.to_string());
    assert!(kit.fs.inner.exists(&item_dir.join(a.to_string())));
    assert!(!kit.fs.inner.exists(&folder));
}

#[test]
fn a_deletion_cut_off_after_item_json_finishes_on_the_next_open() {
    let (kit, mut store, section, [a, _b, a1]) = setup();
    let item = store.trash_item_for(NodeRef::Page(a), TrashReason::Deleted).unwrap();
    let intent = store.begin(TreeOp::DeleteToTrash {
        item: item.id,
        contents: item.contents.clone(),
    });
    store.write_trash_item(&item).unwrap();
    store.log.step_done(intent, 1);
    // The crash: entries still listed, folders still in the section.
    let mut again = kit.open().unwrap();
    assert_eq!(pages(&again, section), [("B".into(), 0)]);
    assert_eq!(again.roll_forward().unwrap(), 1);
    let listed: Vec<PageId> = again.sections[&section].file.pages.iter().map(|e| e.id).collect();
    assert!(!listed.contains(&a) && !listed.contains(&a1));
    let item_dir = kit.root.join(".opennote/trash").join(item.id.to_string());
    assert!(kit.fs.inner.exists(&item_dir.join(a1.to_string())));
}

#[test]
fn a_restore_cut_off_after_the_marks_finishes_on_the_next_open() {
    let (kit, mut store, section, [a, _b, _a1]) = setup();
    let item = store.delete(&[NodeRef::Page(a)], TrashReason::Deleted).unwrap()[0];
    let folder = kit
        .root
        .join(".opennote/trash")
        .join(item.to_string())
        .join(a.to_string());
    kit.fs.hold(&folder);
    store.restore(item, None).unwrap();
    assert_eq!(store.tree().find_page(a).unwrap().1.state, PageNodeState::Moving);
    assert_eq!(store.page_dir(a), Some(folder.clone()));
    kit.fs.release();
    let mut again = kit.open().unwrap();
    again.scan().unwrap();
    assert_eq!(again.tree().find_page(a).unwrap().1.state, PageNodeState::Normal);
    assert!(again.trash_items().is_empty());
    assert!(kit
        .fs
        .inner
        .exists(&kit.root.join(section.to_string()).join(a.to_string())));
}

#[test]
fn restoring_to_a_placement_puts_the_page_there() {
    let (_kit, mut store, section, [a, b, _a1]) = setup();
    let item = store.delete(&[NodeRef::Page(a)], TrashReason::Deleted).unwrap()[0];
    let to = NodePlacement {
        parent: ParentRef::Page(b),
        before: None,
    };
    store.restore(item, Some(&to)).unwrap();
    assert_eq!(
        pages(&store, section),
        [("B".into(), 0), ("A".into(), 1), ("A1".into(), 2)]
    );
}

#[test]
fn deleting_a_missing_node_fails_without_changes() {
    let (kit, mut store, _section, _pages) = setup();
    let before = kit.fs.inner.files();
    assert!(store
        .delete(&[NodeRef::Page(PageId::ZERO)], TrashReason::Deleted)
        .is_err());
    assert_eq!(kit.fs.inner.files(), before);
    assert!(kit.env.fs.read_dir(&kit.root.join(".opennote/trash")).is_err());
}
