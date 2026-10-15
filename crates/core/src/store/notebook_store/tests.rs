#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::path::Path;

use super::kit::Kit;
use super::*;
use crate::error::EditError;
use crate::model::Color;
use crate::session::notebook::{NodePlacement, NodeProps, NodeRef, ParentRef};
use crate::store::fs::Fs;
use crate::store::layout::README_MD;

fn titles(store: &NotebookStore, parent: Option<GroupId>) -> Vec<String> {
    let tree = store.tree();
    tree.children(parent)
        .iter()
        .map(|c| match c {
            crate::model::TreeChild::Group(g) => format!("g:{}", g.title),
            crate::model::TreeChild::Section(s) => format!("s:{}", s.title),
        })
        .collect()
}

fn page_titles(store: &NotebookStore, section: SectionId) -> Vec<(String, u8)> {
    let tree = store.tree();
    tree.section(section)
        .unwrap()
        .pages
        .iter()
        .map(|p| (p.title.clone(), p.level))
        .collect()
}

fn is_invalid_move(e: &CoreError) -> bool {
    matches!(e, CoreError::Edit(EditError::Invalid(m)) if m.starts_with(INVALID_MOVE))
}

fn to_section(section: SectionId, before: Option<PageId>) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Section(section),
        before: before.map(NodeRef::Page),
    }
}

fn to_page(page: PageId, before: Option<PageId>) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Page(page),
        before: before.map(NodeRef::Page),
    }
}

/// A notebook with one section "Lab" holding pages A, B, and C.
fn with_pages() -> (Kit, NotebookStore, SectionId, [PageId; 3]) {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let section = store.create_section("Lab", None, None).unwrap();
    let a = store.create_page(section, None, None, "A").unwrap();
    let b = store.create_page(section, None, None, "B").unwrap();
    let c = store.create_page(section, None, None, "C").unwrap();
    (kit, store, section, [a, b, c])
}

#[test]
fn creating_a_notebook_names_its_folder_and_writes_its_files() {
    let kit = Kit::new();
    assert_eq!(kit.root, Path::new("/notes/Biology"));
    assert!(kit.fs.inner.exists(&kit.root.join(README_MD)));
    let second = create_notebook(&kit.env, Path::new("/notes"), "biology").unwrap();
    assert_eq!(second, Path::new("/notes/biology (2)"));
    let store = kit.open().unwrap();
    assert_eq!(store.tree().title, "Biology");
    assert!(store.tree().sections.is_empty());
}

#[test]
fn a_folder_without_notebook_json_is_not_a_notebook() {
    let kit = Kit::new();
    kit.fs.inner.mkdir_all(Path::new("/elsewhere"));
    let result = NotebookStore::open(
        kit.env.clone(),
        Path::new("/elsewhere"),
        PageCache::detached(),
        Box::new(kit.log.clone()),
    );
    assert!(matches!(result, Err(CoreError::NotFound(_))));
}

#[test]
fn groups_and_sections_share_one_order_and_survive_a_reopen() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let s1 = store.create_section("One", None, None).unwrap();
    let g = store.create_group("Semester", None, Some(s1.0)).unwrap();
    store.create_section("Two", None, None).unwrap();
    let inner = store.create_section("Inner", Some(g), None).unwrap();
    assert_eq!(titles(&store, None), ["g:Semester", "s:One", "s:Two"]);
    let again = kit.open().unwrap();
    assert_eq!(titles(&again, None), ["g:Semester", "s:One", "s:Two"]);
    assert_eq!(titles(&again, Some(g)), ["s:Inner"]);
    assert_eq!(again.tree().section(inner).unwrap().group, Some(g));
}

#[test]
fn groups_nest_at_most_four_levels() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let mut parent = None;
    for depth in 1..=4 {
        parent = Some(store.create_group(&format!("L{depth}"), parent, None).unwrap());
    }
    let fifth = store.create_group("L5", parent, None).unwrap_err();
    assert!(is_invalid_move(&fifth));
    let top = store.create_group("Top", None, None).unwrap();
    let nested = store.create_group("Nested", Some(top), None).unwrap();
    // Top holds two levels, so it can go under a group at depth 2 but not at depth 3.
    let depth2 = store.tree().groups.iter().find(|g| g.title == "L2").unwrap().id;
    let depth3 = store.tree().groups.iter().find(|g| g.title == "L3").unwrap().id;
    assert!(is_invalid_move(&store.move_group(top, Some(depth3), None).unwrap_err()));
    store.move_group(top, Some(depth2), None).unwrap();
    assert!(is_invalid_move(&store.move_group(top, Some(nested), None).unwrap_err()));
}

#[test]
fn a_group_can_not_go_inside_itself() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let a = store.create_group("A", None, None).unwrap();
    let b = store.create_group("B", Some(a), None).unwrap();
    assert!(is_invalid_move(&store.move_group(a, Some(b), None).unwrap_err()));
    assert!(is_invalid_move(&store.move_group(a, Some(a), None).unwrap_err()));
}

#[test]
fn moving_to_the_same_place_writes_nothing() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let a = store.create_section("A", None, None).unwrap();
    let b = store.create_section("B", None, None).unwrap();
    let before = kit.fs.inner.get(&kit.root.join(a.to_string()).join("section.json"));
    store.move_section(a, None, Some(b.0)).unwrap();
    store.move_section(a, None, Some(a.0)).unwrap();
    assert_eq!(
        kit.fs.inner.get(&kit.root.join(a.to_string()).join("section.json")),
        before
    );
    store.move_section(a, None, None).unwrap();
    assert_eq!(titles(&store, None), ["s:B", "s:A"]);
}

#[test]
fn pages_and_subpages_keep_their_order_and_levels() {
    let (kit, mut store, section, [a, b, _c]) = with_pages();
    let a1 = store.create_page(section, Some(a), None, "A1").unwrap();
    store.create_page(section, Some(a1), None, "A1x").unwrap();
    store.create_page(section, None, Some(b), "A2").unwrap();
    let deep = store.create_page(
        section,
        Some(store.tree().section(section).unwrap().pages[2].id),
        None,
        "X",
    );
    assert!(is_invalid_move(&deep.unwrap_err()));
    let expected = [("A", 0), ("A1", 1), ("A1x", 2), ("A2", 0), ("B", 0), ("C", 0)];
    let got = page_titles(&kit.open().unwrap(), section);
    let want: Vec<(String, u8)> = expected.iter().map(|(t, l)| ((*t).to_owned(), *l)).collect();
    assert_eq!(got, want);
}

#[test]
fn moving_a_page_takes_its_subpages() {
    let (_kit, mut store, section, [a, b, c]) = with_pages();
    store.create_page(section, Some(a), None, "A1").unwrap();
    store.move_node(NodeRef::Page(a), &to_section(section, None)).unwrap();
    assert_eq!(
        page_titles(&store, section),
        [("B".into(), 0), ("C".into(), 0), ("A".into(), 0), ("A1".into(), 1)]
    );
    store.move_node(NodeRef::Page(a), &to_page(b, None)).unwrap();
    assert_eq!(
        page_titles(&store, section),
        [("B".into(), 0), ("A".into(), 1), ("A1".into(), 2), ("C".into(), 0)]
    );
    // A1 would become a third level under C's child.
    let c1 = store.create_page(section, Some(c), None, "C1").unwrap();
    assert!(is_invalid_move(
        &store.move_node(NodeRef::Page(a), &to_page(c1, None)).unwrap_err()
    ));
    assert!(is_invalid_move(
        &store.move_node(NodeRef::Page(a), &to_page(a, None)).unwrap_err()
    ));
}

#[test]
fn page_levels_change_in_place_with_their_subpages() {
    let (_kit, mut store, section, [a, b, c]) = with_pages();
    store.set_page_level(&[b], 1).unwrap();
    assert_eq!(store.tree().find_page(b).unwrap().1.parent, Some(a));
    store.set_page_level(&[c], 2).unwrap();
    assert_eq!(store.tree().find_page(c).unwrap().1.parent, Some(b));
    assert!(is_invalid_move(&store.set_page_level(&[a], 1).unwrap_err()));
    // Promoting B takes C with it: C stays B's subpage, one level up.
    store.set_page_level(&[b], 0).unwrap();
    assert_eq!(
        page_titles(&store, section),
        [("A".into(), 0), ("B".into(), 0), ("C".into(), 1)]
    );
}

#[test]
fn moving_a_page_between_sections_moves_its_folders() {
    let (kit, mut store, section, [a, _b, _c]) = with_pages();
    let a1 = store.create_page(section, Some(a), None, "A1").unwrap();
    let other = store.create_section("Other", None, None).unwrap();
    store.move_node(NodeRef::Page(a), &to_section(other, None)).unwrap();
    let other_dir = kit.root.join(other.to_string());
    assert!(kit.fs.inner.exists(&other_dir.join(a.to_string()).join("page.json")));
    assert!(kit.fs.inner.exists(&other_dir.join(a1.to_string())));
    assert!(!kit
        .fs
        .inner
        .exists(&kit.root.join(section.to_string()).join(a.to_string())));
    let again = kit.open().unwrap();
    assert_eq!(page_titles(&again, other), [("A".into(), 0), ("A1".into(), 1)]);
    assert_eq!(page_titles(&again, section), [("B".into(), 0), ("C".into(), 0)]);
    assert!(again.sections[&other].file.pages.iter().all(|e| e.moving.is_none()));
}

#[test]
fn a_held_folder_leaves_the_move_pending_until_a_retry() {
    let (kit, mut store, section, [a, _b, _c]) = with_pages();
    let other = store.create_section("Other", None, None).unwrap();
    let old = kit.root.join(section.to_string()).join(a.to_string());
    kit.fs.hold(&old);
    store.move_node(NodeRef::Page(a), &to_section(other, None)).unwrap();
    assert_eq!(store.page_dir(a), Some(old.clone()));
    assert_eq!(store.tree().find_page(a).unwrap().1.state, PageNodeState::Moving);
    assert_eq!(store.pending.len(), 1);
    kit.fs.release();
    store.finish_pending().unwrap();
    assert!(store.pending.is_empty());
    assert_eq!(
        store.page_dir(a),
        Some(kit.root.join(other.to_string()).join(a.to_string()))
    );
    assert_eq!(store.tree().find_page(a).unwrap().1.state, PageNodeState::Normal);
}

#[test]
fn renaming_and_recoloring_change_one_file() {
    let (kit, mut store, section, [a, _b, _c]) = with_pages();
    let group = store.create_group("G", None, None).unwrap();
    store.rename(NodeRef::Group(group), "Semester").unwrap();
    store.rename(NodeRef::Section(section), "Labs").unwrap();
    store.rename(NodeRef::Page(a), "Alpha").unwrap();
    let fern = Some(Color::Palette("fern".into()));
    let props = NodeProps {
        color: Some(fern.clone()),
        pinned: None,
        styles: None,
    };
    store.set_props(NodeRef::Section(section), &props).unwrap();
    store.set_props(NodeRef::Group(group), &props).unwrap();
    let pin = NodeProps {
        color: None,
        pinned: Some(true),
        styles: None,
    };
    store.set_props(NodeRef::Page(a), &pin).unwrap();
    // Only pages and sections can be pinned.
    assert!(is_invalid_move(
        &store.set_props(NodeRef::Group(group), &pin).unwrap_err()
    ));
    store.rename_notebook("Bio").unwrap();
    let tree = kit.open().unwrap().tree();
    assert_eq!(tree.title, "Bio");
    assert_eq!(tree.groups[0].title, "Semester");
    assert_eq!(tree.groups[0].color, fern);
    let node = tree.section(section).unwrap();
    assert_eq!((node.title.as_str(), node.color.clone()), ("Labs", fern));
    assert!(node.pages[0].pinned);
    assert_eq!(node.pages[0].title, "Alpha");
}

#[test]
fn a_pinned_section_and_a_colored_page_survive_a_reopen() {
    let (kit, mut store, section, [a, b, _c]) = with_pages();
    let pin = NodeProps {
        color: None,
        pinned: Some(true),
        styles: None,
    };
    store.set_props(NodeRef::Section(section), &pin).unwrap();
    let plum = Some(Color::Palette("plum".into()));
    let color = NodeProps {
        color: Some(plum.clone()),
        pinned: None,
        styles: None,
    };
    store.set_props(NodeRef::Page(a), &color).unwrap();
    let tree = kit.open().unwrap().tree();
    let node = tree.section(section).unwrap();
    assert!(node.pinned);
    assert_eq!(node.pages.iter().find(|page| page.id == a).unwrap().color, plum);
    assert_eq!(node.pages.iter().find(|page| page.id == b).unwrap().color, None);
    // Unpinning removes the key, so the file is as it was.
    let unpin = NodeProps {
        color: None,
        pinned: Some(false),
        styles: None,
    };
    store.set_props(NodeRef::Section(section), &unpin).unwrap();
    assert!(!kit.open().unwrap().tree().section(section).unwrap().pinned);
}

#[test]
fn archiving_marks_an_unknown_key_that_the_next_open_still_sees() {
    let (kit, mut store, section, [a, b, _c]) = with_pages();
    let group = store.create_group("G", None, None).unwrap();
    store.set_archived(NodeRef::Page(a), true).unwrap();
    store.set_archived(NodeRef::Section(section), true).unwrap();
    store.set_archived(NodeRef::Group(group), true).unwrap();
    store.set_notebook_archived(true).unwrap();
    let tree = kit.open().unwrap().tree();
    assert!(tree.archived && tree.groups[0].extra.contains_key(crate::model::ARCHIVED_KEY));
    let node = tree.section(section).unwrap();
    assert!(node.archived);
    assert!(node.pages.iter().find(|page| page.id == a).unwrap().archived);
    assert!(!node.pages.iter().find(|page| page.id == b).unwrap().archived);
    // Putting an item back removes the key, so the file is as it was.
    store.set_archived(NodeRef::Page(a), false).unwrap();
    store.set_notebook_archived(false).unwrap();
    let tree = kit.open().unwrap().tree();
    assert!(!tree.archived);
    assert!(!tree.section(section).unwrap().pages.iter().any(|page| page.archived));
}

#[test]
fn a_notebook_keeps_its_named_styles() {
    let (kit, mut store, section, _) = with_pages();
    let styles = |size: f64| {
        let mut styles = crate::model::NotebookStyles::new();
        let h1 = crate::model::StyleSpec {
            size: Some(size),
            color: Some(Color::Palette("fern".into())),
            ..Default::default()
        };
        styles.insert("h1".to_owned(), h1);
        styles
    };
    let before = store.tree().changed;
    store.set_notebook_styles(styles(28.0)).unwrap();
    assert_eq!(store.tree().styles, styles(28.0));
    assert!(store.tree().changed >= before);
    assert_eq!(
        kit.open().unwrap().tree().styles,
        styles(28.0),
        "the styles reach notebook.json"
    );
    // Nothing changes when the styles do not, and an empty map removes them.
    let at = store.tree().changed;
    store.set_notebook_styles(styles(28.0)).unwrap();
    assert_eq!(store.tree().changed, at);
    store.set_notebook_styles(crate::model::NotebookStyles::new()).unwrap();
    assert!(kit.open().unwrap().tree().styles.is_empty());
    // Values out of range and styles on other nodes are refused.
    for bad in [0.5, f64::NAN, 5_000.0] {
        assert!(
            is_invalid_move(&store.set_notebook_styles(styles(bad)).unwrap_err()),
            "{bad}"
        );
    }
    let props = NodeProps {
        styles: Some(styles(20.0)),
        ..NodeProps::default()
    };
    assert!(is_invalid_move(
        &store.set_props(NodeRef::Section(section), &props).unwrap_err()
    ));
}

#[test]
fn duplicating_a_page_adds_a_copy_right_after_it() {
    let (kit, mut store, section, [a, _b, _c]) = with_pages();
    let copy = store.duplicate(a).unwrap();
    assert_ne!(copy, a);
    assert_eq!(page_titles(&store, section)[..2], [("A".into(), 0), ("A".into(), 0)]);
    assert_eq!(store.tree().section(section).unwrap().pages[1].id, copy);
    let dir = kit.root.join(section.to_string()).join(copy.to_string());
    let loaded = read_page_files(kit.env.fs.as_ref(), &kit.codec, &dir, &Limits::default()).unwrap();
    assert_eq!(loaded.page.id, copy);
    assert!(loaded.page.revision.parents.is_empty());
}

#[test]
fn a_page_moves_to_another_notebook_and_the_original_goes_to_trash() {
    let (kit, mut store, section, [a, _b, _c]) = with_pages();
    let a1 = store.create_page(section, Some(a), None, "A1").unwrap();
    let target_root = create_notebook(&kit.env, Path::new("/notes"), "Chemistry").unwrap();
    let mut target = NotebookStore::open(
        kit.env.clone(),
        &target_root,
        PageCache::detached(),
        Box::new(crate::store::tree_log::MemIntentLog::new()),
    )
    .unwrap();
    let t_section = target.create_section("Inbox", None, None).unwrap();
    let transfer = store
        .move_page_to(a, &mut target, &to_section(t_section, None))
        .unwrap();
    assert_eq!(transfer.originals.len(), 1);
    assert_eq!(page_titles(&target, t_section), [("A".into(), 0), ("A1".into(), 1)]);
    assert!(kit.fs.inner.exists(
        &target_root
            .join(t_section.to_string())
            .join(a1.to_string())
            .join("page.json")
    ));
    assert!(store.tree().find_page(a).is_none());
    let item = &store.trash_items()[0];
    assert_eq!(
        item.reason,
        crate::model::Named::Known(crate::model::TrashReason::Moved)
    );
    assert_eq!(item.contents, vec![a.0, a1.0]);
}

#[test]
fn a_group_moves_to_another_notebook_with_its_sections() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let group = store.create_group("Semester", None, None).unwrap();
    let inner = store.create_group("Labs", Some(group), None).unwrap();
    let s1 = store.create_section("Week 1", Some(inner), None).unwrap();
    let p = store.create_page(s1, None, None, "Notes").unwrap();
    let target_root = create_notebook(&kit.env, Path::new("/notes"), "Archive").unwrap();
    let mut target = NotebookStore::open(
        kit.env.clone(),
        &target_root,
        PageCache::detached(),
        Box::new(crate::store::tree_log::MemIntentLog::new()),
    )
    .unwrap();
    let to = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    store.move_section_to(NodeRef::Group(group), &mut target, &to).unwrap();
    let again = NotebookStore::open(
        kit.env.clone(),
        &target_root,
        PageCache::detached(),
        Box::new(crate::store::tree_log::MemIntentLog::new()),
    )
    .unwrap();
    assert_eq!(titles(&again, None), ["g:Semester"]);
    assert_eq!(titles(&again, Some(inner)), ["s:Week 1"]);
    assert_eq!(page_titles(&again, s1), [("Notes".into(), 0)]);
    assert!(kit
        .fs
        .inner
        .exists(&target_root.join(s1.to_string()).join(p.to_string())));
    assert!(store.tree().groups.is_empty());
    assert!(store.tree().sections.is_empty());
}

#[test]
fn equal_order_keys_get_new_keys_when_a_node_goes_between_them() {
    let a = (OrderKey::parse("a0").unwrap(), Id::from_parts(1, 1));
    let b = (OrderKey::parse("a0").unwrap(), Id::from_parts(2, 2));
    let (key, rekeys) = place_key(&[a.clone(), b.clone()], 1).unwrap();
    assert!(!rekeys.is_empty());
    let new_key = |s: &(OrderKey, Id)| rekeys.iter().find(|r| r.0 == s.1).map_or(s.0.clone(), |r| r.1.clone());
    assert!(new_key(&a) < key && key < new_key(&b));
    let (key, rekeys) = place_key(&[a], 1).unwrap();
    assert!(rekeys.is_empty() && key.as_str() > "a0");
}

#[test]
fn sibling_keys_keep_what_they_can() {
    use super::flat::sibling_keys;
    let k = |s: &str, n: u64| (OrderKey::parse(s).unwrap(), Id::from_parts(n, 0));
    assert_eq!(sibling_keys(&[k("a0", 1), k("a1", 2)]).unwrap(), [None, None]);
    let keys = sibling_keys(&[k("a0", 1), k("a5", 2), k("a1", 3), k("a2", 4)]).unwrap();
    assert_eq!(keys[0], None);
    assert_eq!(keys[1], None);
    let fixed: Vec<OrderKey> = keys
        .iter()
        .zip(["a0", "a5", "a1", "a2"])
        .map(|(k, old)| k.clone().unwrap_or_else(|| OrderKey::parse(old).unwrap()))
        .collect();
    assert!(fixed.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn an_interrupted_page_create_rolls_forward() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    let section = store.create_section("Lab", None, None).unwrap();
    let page = PageId::generate(kit.clock.as_ref());
    let intent = store.begin(TreeOp::CreatePage { section, page });
    store.log.step_done(intent, 1);
    kit.fs
        .create_dir_durable(&kit.root.join(section.to_string()).join(page.to_string()))
        .unwrap();
    let mut again = kit.open().unwrap();
    assert_eq!(again.roll_forward().unwrap(), 1);
    assert!(again.tree().find_page(page).is_some());
    assert!(kit.fs.inner.exists(&again.page_dir(page).unwrap().join("page.json")));
    assert_eq!(kit.open().unwrap().roll_forward().unwrap(), 0);
}

#[test]
fn a_read_only_notebook_refuses_changes() {
    let kit = Kit::new();
    let mut store = kit.open().unwrap();
    store.read_only = Some(crate::model::ReadOnlyReason::LockedElsewhere);
    assert!(matches!(
        store.create_section("X", None, None),
        Err(CoreError::ReadOnly(crate::model::ReadOnlyReason::LockedElsewhere))
    ));
    assert!(store.tree().access.is_read_only());
}
