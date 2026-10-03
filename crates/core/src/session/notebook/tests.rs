use std::path::Path;
use std::time::Duration;

use super::*;
use crate::model::PageNodeState;
use crate::session::events::CoreEvent;
use crate::session::kit::{client, CoreKit};
use crate::session::tree_events::{diff, TreeEvent};

fn top() -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    }
}

fn in_section(section: SectionId) -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    }
}

fn page_titles(notebook: &NotebookHandle, section: SectionId) -> Vec<(String, u8)> {
    let tree = notebook.tree();
    tree.section(section)
        .map(|s| s.pages.iter().map(|p| (p.title.clone(), p.level)).collect())
        .unwrap_or_default()
}

fn tree_events(kit: &CoreKit) -> usize {
    kit.events
        .events()
        .iter()
        .filter(|e| matches!(e, CoreEvent::TreeChanged { .. }))
        .count()
}

#[test]
fn tree_changes_undo_and_redo() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let a = notebook.create_section("A", top()).unwrap();
    let b = notebook.create_section("B", top()).unwrap();
    notebook
        .move_node(
            NodeRef::Section(b),
            NodePlacement {
                parent: ParentRef::Notebook,
                before: Some(NodeRef::Section(a)),
            },
        )
        .unwrap();
    let order = |n: &NotebookHandle| {
        n.tree()
            .children(None)
            .iter()
            .map(|c| match c {
                crate::model::TreeChild::Section(s) => s.title.clone(),
                crate::model::TreeChild::Group(g) => g.title.clone(),
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(order(&notebook), ["B", "A"]);
    assert!(notebook.tree_undo().unwrap());
    assert_eq!(order(&notebook), ["A", "B"]);
    assert!(notebook.tree_redo().unwrap());
    assert_eq!(order(&notebook), ["B", "A"]);
    let color = NodeProps {
        color: Some(Some(Color::Palette("fern".into()))),
        pinned: None,
        styles: None,
    };
    notebook.set_props(NodeRef::Section(a), color).unwrap();
    notebook.delete(&[NodeRef::Section(a)]).unwrap();
    assert_eq!(order(&notebook), ["B"]);
    assert!(notebook.tree_undo().unwrap());
    assert_eq!(order(&notebook), ["B", "A"]);
    assert!(notebook.tree_undo().unwrap());
    assert_eq!(notebook.tree().section(a).unwrap().color, None);
    assert!(notebook.tree_undo().unwrap());
    assert!(notebook.tree_undo().unwrap());
    assert_eq!(order(&notebook), ["A"]);
    assert!(notebook.tree_undo().unwrap());
    assert!(!notebook.tree_undo().unwrap());
    assert!(order(&notebook).is_empty());
    assert!(tree_events(&kit) >= 8);
}

#[test]
fn contract_page_moves_and_levels_go_through_the_flat_list() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let a = notebook.create_page_titled(section, in_section(section), "A").unwrap();
    let b = notebook.create_page_titled(section, in_section(section), "B").unwrap();
    let c = notebook.create_page_titled(section, in_section(section), "C").unwrap();
    notebook.set_page_level(&[b, c], 1).unwrap();
    assert_eq!(
        page_titles(&notebook, section),
        [("A".into(), 0), ("B".into(), 1), ("C".into(), 1)]
    );
    let flat = notebook.flat_pages(section).unwrap();
    assert_eq!(flat.iter().map(|f| f.id).collect::<Vec<_>>(), [a, b, c]);
    notebook.set_page_level(&[c], 0).unwrap();
    // A moves with its subpage B, after C.
    notebook.move_pages(&[a], section, 1, 0).unwrap();
    assert_eq!(
        page_titles(&notebook, section),
        [("C".into(), 0), ("A".into(), 0), ("B".into(), 1)]
    );
    assert!(notebook.set_page_level(&[a], 2).is_err());
    assert!(notebook.set_page_level(&[c], 1).is_err());
}

#[test]
fn page_blocks_move_together_each_at_its_own_level() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let a = notebook.create_page_titled(section, in_section(section), "A").unwrap();
    let b = notebook.create_page_titled(section, in_section(section), "B").unwrap();
    let c = notebook.create_page_titled(section, in_section(section), "C").unwrap();
    let d = notebook.create_page_titled(section, in_section(section), "D").unwrap();
    notebook.set_page_level(&[b], 1).unwrap();
    // B goes first at level 0 and D after it at level 1, before C.
    notebook.move_page_blocks(&[(b, 0), (d, 1)], section, 1).unwrap();
    assert_eq!(
        page_titles(&notebook, section),
        [("A".into(), 0), ("B".into(), 0), ("D".into(), 1), ("C".into(), 0)]
    );
    // A move that leaves a page too deep changes nothing.
    assert!(notebook.move_page_blocks(&[(a, 2)], section, 3).is_err());
    assert_eq!(page_titles(&notebook, section).len(), 4);
    let _ = c;
}

#[test]
fn a_page_moves_to_another_notebook_after_its_final_save() {
    let kit = CoreKit::new();
    let source = kit.notebook("Biology").unwrap();
    let target = kit.notebook("Archive").unwrap();
    let section = source.create_section("Lab", top()).unwrap();
    let inbox = target.create_section("Inbox", top()).unwrap();
    let (page, _) = kit.inked_page(&source, section).unwrap();
    let c = client("main-1");
    let handle = source.open_page(page, c.clone()).unwrap();
    handle
        .commit_for_tests(&crate::session::kit::retitle(
            kit.clock.as_ref(),
            &c,
            "Photosynthesis",
            "Moving",
        ))
        .unwrap();
    source.move_to_notebook(page, &target, in_section(inbox)).unwrap();
    assert!(handle.has_unsaved() || handle.page_for_tests().title == "Moving");
    assert_eq!(page_titles(&target, inbox), [("Moving".into(), 0)]);
    let moved = target.open_page(page, c.clone()).unwrap();
    assert_eq!(moved.page_for_tests().title, "Moving");
    assert_eq!(source.trash().unwrap().len(), 1);
    assert!(source.move_to_notebook(page, &source, in_section(section)).is_err());
}

#[test]
fn a_section_moves_to_another_notebook() {
    let kit = CoreKit::new();
    let source = kit.notebook("Biology").unwrap();
    let target = kit.notebook("Archive").unwrap();
    let section = source.create_section("Lab", top()).unwrap();
    kit.inked_page(&source, section).unwrap();
    let transfer = source
        .move_section_to_notebook(NodeRef::Section(section), &target, top())
        .unwrap();
    assert_eq!(transfer.moved, vec![NodeRef::Section(section)]);
    assert_eq!(page_titles(&target, section).len(), 1);
    assert!(source.tree().sections.is_empty());
}

#[test]
fn a_duplicate_folder_is_kept_or_trashed_as_the_person_chooses() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let (page, _) = kit.inked_page(&notebook, section).unwrap();
    let dir = notebook.path().join(section.to_string());
    let copy = dir.join("Photosynthesis copy");
    crate::store::notebook_store::copy_tree(&kit.fs, &dir.join(page.to_string()), &copy).unwrap();
    let report = notebook.scan().unwrap();
    assert_eq!(report.duplicates.len(), 1);
    assert_eq!(
        notebook.tree().find_page(page).unwrap().1.state,
        PageNodeState::Duplicate
    );
    notebook
        .resolve_duplicate(page, &copy, DuplicateChoice::KeepBoth)
        .unwrap();
    assert_eq!(page_titles(&notebook, section).len(), 2);
    assert!(!kit.fs.inner.exists(&copy));
    let again = dir.join("second copy");
    crate::store::notebook_store::copy_tree(&kit.fs, &dir.join(page.to_string()), &again).unwrap();
    notebook.scan().unwrap();
    notebook
        .resolve_duplicate(page, &again, DuplicateChoice::TrashCopy)
        .unwrap();
    assert_eq!(notebook.trash().unwrap().len(), 1);
    assert!(notebook.tree().find_page(page).is_some());
    assert!(notebook
        .resolve_duplicate(page, &dir.join(page.to_string()), DuplicateChoice::TrashCopy)
        .is_err());
}

#[test]
fn a_held_folder_moves_later_on_the_maintenance_queue() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let a = notebook.create_section("A", top()).unwrap();
    let b = notebook.create_section("B", top()).unwrap();
    let page = notebook.create_page_titled(a, in_section(a), "P").unwrap();
    let old = notebook.path().join(a.to_string()).join(page.to_string());
    kit.fs.hold(&old);
    notebook.move_node(NodeRef::Page(page), in_section(b)).unwrap();
    assert_eq!(notebook.tree().find_page(page).unwrap().1.state, PageNodeState::Moving);
    kit.fs.release();
    kit.advance(Duration::from_secs(3));
    assert_eq!(notebook.tree().find_page(page).unwrap().1.state, PageNodeState::Normal);
    assert!(kit
        .fs
        .inner
        .exists(&notebook.path().join(b.to_string()).join(page.to_string())));
}

#[test]
fn diffs_of_handle_trees_give_contract_events() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let before = notebook.tree();
    let section = notebook.create_section("Lab", top()).unwrap();
    let events = diff(&before, &notebook.tree());
    assert!(events
        .iter()
        .any(|e| matches!(e, TreeEvent::Upserted { nodes } if nodes.iter().any(|n| n.id == section.to_string()))));
    assert!(events.contains(&TreeEvent::ChildrenChanged {
        parent_id: Some(notebook.id().to_string())
    }));
}

#[test]
fn a_closed_notebook_refuses_work_and_can_open_again() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let path = notebook.path().to_path_buf();
    let copy = notebook.clone();
    notebook.close().unwrap();
    assert!(copy.create_section("X", top()).is_err());
    assert!(kit.core.find_open(&path).is_none());
    let again = kit.core.open_notebook(Path::new(&path)).unwrap();
    assert!(again.create_section("X", top()).is_ok());
    assert!(again.verify().unwrap().is_clean());
}

#[test]
fn trash_expires_when_the_notebook_opens() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    notebook.delete(&[NodeRef::Section(section)]).unwrap();
    let path = notebook.path().to_path_buf();
    notebook.close().unwrap();
    kit.clock.advance(Duration::from_secs(31 * 86_400));
    let again = kit.core.open_notebook(&path).unwrap();
    assert_eq!(again.trash().unwrap().len(), 1);
    kit.core.run_pending_work();
    assert!(again.trash().unwrap().is_empty());
}

#[test]
fn the_notebook_takes_its_color_and_styles_as_props() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let mut styles = crate::model::NotebookStyles::new();
    styles.insert(
        "quote".to_owned(),
        crate::model::StyleSpec {
            size: Some(15.0),
            ..Default::default()
        },
    );
    let props = NodeProps {
        color: Some(Some(Color::Palette("fern".into()))),
        styles: Some(styles.clone()),
        ..NodeProps::default()
    };
    notebook.set_notebook_props(props).unwrap();
    let tree = notebook.tree();
    assert_eq!(tree.styles, styles);
    assert_eq!(tree.color, Some(Color::Palette("fern".into())));
    let pin = NodeProps {
        pinned: Some(true),
        ..NodeProps::default()
    };
    assert!(notebook.set_notebook_props(pin).is_err());
    let none = NodeProps {
        styles: Some(Default::default()),
        ..NodeProps::default()
    };
    notebook.set_notebook_props(none).unwrap();
    assert!(notebook.tree().styles.is_empty());
}

#[test]
fn a_page_that_cant_be_saved_doesnt_stop_the_backup() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let (page, _) = kit.inked_page(&notebook, section).unwrap();
    let c = client("main-1");
    let handle = notebook.open_page(page, c.clone()).unwrap();
    kit.backend.fail_saves(Some(crate::error::FsErrorKind::ReadOnlyFile));
    let txn = crate::session::kit::retitle(kit.clock.as_ref(), &c, "Photosynthesis", "A");
    handle.commit_for_tests(&txn).unwrap();
    kit.advance(Duration::from_secs(1));
    assert!(handle.read_only().is_some() && handle.has_unsaved());
    let policy = crate::store::backup::BackupPolicy::default();
    let report = notebook.backup_to(Path::new("/backups"), &policy, 0).unwrap();
    assert_eq!(
        report.unsaved_pages,
        [page],
        "the shell can say which page is missing its edits"
    );
    assert!(report.copied_files > 0 && report.finished.is_some());
}
