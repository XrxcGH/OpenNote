use std::path::Path;
use std::time::Duration;

use super::*;
use crate::model::ReadOnlyReason;
use crate::session::kit::{client, retitle, CoreKit};
use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};
use crate::session::notes::{ReceiptPart, Restored, SaveStatus, TrashReceipt, TrashTarget};
use crate::store::notebook_store::copy_tree;

fn top() -> NodePlacement {
    NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    }
}

fn titles(kit: &CoreKit) -> Vec<String> {
    kit.core.library().notebooks.into_iter().map(|n| n.title).collect()
}

#[test]
fn notebooks_join_the_library_in_order_and_leave_it_for_trash() {
    let kit = CoreKit::new();
    let biology = kit.notebook("Biology").unwrap();
    let chemistry = kit.notebook("Chemistry").unwrap();
    kit.core.set_library_folder(Path::new("/notes")).unwrap();
    assert_eq!(titles(&kit), ["Biology", "Chemistry"]);
    kit.core.move_notebook(chemistry.path(), Some(biology.path())).unwrap();
    assert_eq!(titles(&kit), ["Chemistry", "Biology"]);
    let path = biology.path().to_path_buf();
    kit.core.remove_notebook(&path).unwrap();
    assert!(kit.core.find_open(&path).is_none());
    assert_eq!(titles(&kit), ["Chemistry"]);
    assert_eq!(kit.core.library().removed.len(), 1);
    // The folder stays untouched.
    assert!(kit.fs.inner.exists(&path.join("notebook.json")));
    let back = kit.core.restore_notebook(&path).unwrap();
    assert_eq!(back.tree().title, "Biology");
    assert_eq!(titles(&kit), ["Chemistry", "Biology"]);
    let library = kit.core.library();
    assert_eq!(library.folder.as_deref(), Some(Path::new("/notes")));
    assert!(library.notebooks.iter().all(|n| n.open && n.available));
}

#[test]
fn a_forgotten_notebook_leaves_the_removed_list() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Old").unwrap();
    let path = notebook.path().to_path_buf();
    kit.core.remove_notebook(&path).unwrap();
    kit.core.forget_notebook(&path).unwrap();
    assert!(kit.core.library().removed.is_empty());
}

#[test]
fn opening_twice_shares_the_notebook_and_another_process_gets_it_read_only() {
    let kit = CoreKit::new();
    let first = kit.notebook("Biology").unwrap();
    let again = kit.core.open_notebook(first.path()).unwrap();
    assert!(std::sync::Arc::ptr_eq(&first.inner, &again.inner));
    let other = kit.beside();
    let locked = other.core.open_notebook(first.path()).unwrap();
    assert_eq!(
        locked.tree().access,
        crate::model::Access::ReadOnly(ReadOnlyReason::LockedElsewhere)
    );
    assert!(locked.create_section("No", top()).is_err());
    first.close().unwrap();
    locked.close().unwrap();
    let now_free = other
        .core
        .open_notebook(kit.core.library().notebooks[0].path.as_path())
        .unwrap();
    assert!(!now_free.tree().access.is_read_only());
}

#[test]
fn a_copied_notebook_opens_read_only_until_it_is_made_separate() {
    let kit = CoreKit::new();
    let original = kit.notebook("Biology").unwrap();
    original.create_section("Lab", top()).unwrap();
    copy_tree(&kit.fs, original.path(), Path::new("/notes/Biology copy")).unwrap();
    let copy = kit.core.open_notebook(Path::new("/notes/Biology copy")).unwrap();
    assert_eq!(copy.id(), original.id());
    assert!(copy.tree().access.is_read_only());
    assert!(copy.tree().notices.iter().any(|n| n.code == "notebook.sameId"));
    let id = copy.make_separate().unwrap();
    assert_ne!(id, original.id());
    assert!(!copy.tree().access.is_read_only());
    copy.create_section("Mine", top()).unwrap();
    assert_eq!(copy.tree().sections.len(), 2);
    assert_eq!(original.tree().sections.len(), 1);
}

#[test]
fn a_receipt_covers_nodes_of_several_notebooks_and_whole_notebooks() {
    let kit = CoreKit::new();
    let a = kit.notebook("A").unwrap();
    let b = kit.notebook("B").unwrap();
    let c = kit.notebook("C").unwrap();
    let sa = a.create_section("SA", top()).unwrap();
    let sb = b.create_section("SB", top()).unwrap();
    let group = b.create_group("G", top()).unwrap();
    let targets = [
        TrashTarget::Node(a.clone(), NodeRef::Section(sa)),
        TrashTarget::Node(b.clone(), NodeRef::Section(sb)),
        TrashTarget::Node(b.clone(), NodeRef::Group(group)),
        TrashTarget::Notebook(c.path().to_path_buf()),
    ];
    let receipt = kit.core.trash_nodes(&targets).unwrap();
    assert_eq!(receipt.parts.len(), 3);
    assert!(receipt
        .parts
        .iter()
        .any(|p| matches!(p, ReceiptPart::Items { items, .. } if items.len() == 2)));
    let text = receipt.encode();
    let decoded = TrashReceipt::decode(&text).unwrap();
    assert_eq!(decoded, receipt);
    assert!(a.tree().sections.is_empty() && b.tree().sections.is_empty() && b.tree().groups.is_empty());
    assert_eq!(titles(&kit), ["A", "B"]);
    let restored = kit.core.restore_receipt(&decoded).unwrap();
    assert_eq!(restored.len(), 4);
    assert!(restored.iter().any(|r| matches!(r, Restored::Notebook(_))));
    assert_eq!(a.tree().sections.len(), 1);
    assert_eq!(b.tree().groups.len(), 1);
    assert_eq!(titles(&kit), ["A", "B", "C"]);
    assert!(TrashReceipt::decode("nonsense").is_err());
}

#[test]
fn nodes_are_found_by_their_id_alone() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let (page, _) = kit.inked_page(&notebook, section).unwrap();
    let group = notebook.create_group("G", top()).unwrap();
    let find = |id: crate::id::Id| kit.core.find_node(id).map(|(n, node)| (n.id(), node));
    assert_eq!(find(page.0), Some((notebook.id(), Some(NodeRef::Page(page)))));
    assert_eq!(find(section.0), Some((notebook.id(), Some(NodeRef::Section(section)))));
    assert_eq!(find(group.0), Some((notebook.id(), Some(NodeRef::Group(group)))));
    assert_eq!(find(notebook.id().0), Some((notebook.id(), None)));
    assert_eq!(find(crate::id::Id::ZERO), None);
    assert!(kit.core.notebook(notebook.id()).is_some());
}

#[test]
fn the_device_label_is_never_a_computer_name_and_can_change() {
    let kit = CoreKit::new();
    assert_eq!(kit.core.device().label, "Windows device GWGM");
    kit.core.set_device_label("Lab tablet").unwrap();
    assert_eq!(kit.core.device().label, "Lab tablet");
    kit.core.set_device_label("  ").unwrap();
    assert!(kit.core.device().label.ends_with(" device GWGM"));
    let label = device::default_label(crate::id::DeviceId::ZERO);
    assert!(label.ends_with("0000"));
}

#[test]
fn the_session_marker_tells_a_clean_exit_from_a_crash() {
    let kit = CoreKit::new();
    assert!(!kit.core.unclean_exit());
    let crashed = kit.beside();
    assert!(crashed.core.unclean_exit());
    crashed.core.flush_all(Duration::from_secs(5)).unwrap();
    assert!(!crashed.beside().core.unclean_exit());
}

#[test]
fn unsaved_state_and_memory_follow_the_open_pages() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let section = notebook.create_section("Lab", top()).unwrap();
    let (page, _) = kit.inked_page(&notebook, section).unwrap();
    assert_eq!(kit.core.save_status(), SaveStatus::Saved);
    let c = client("main-1");
    let handle = notebook.open_page(page, c.clone()).unwrap();
    assert!(kit.core.memory().open_pages > 0);
    handle
        .commit_for_tests(&retitle(kit.clock.as_ref(), &c, "Photosynthesis", "x"))
        .unwrap();
    assert_eq!(kit.core.save_status(), SaveStatus::Saving);
    assert!(kit.core.has_unsaved() && notebook.has_unsaved());
    kit.advance(Duration::from_secs(1));
    assert_eq!(kit.core.save_status(), SaveStatus::Saved);
    handle.close(&c).unwrap();
    assert_eq!(kit.core.memory().open_pages, 0);
}

#[test]
fn recovery_opens_the_first_notebook_and_reports() {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let path = notebook.path().to_path_buf();
    notebook.close().unwrap();
    let report = kit.core.recover_pending(Some(&path)).unwrap();
    assert!(report.pages.is_empty() && report.waiting.is_empty());
    assert!(kit.core.find_open(&path).is_some());
    let told = kit
        .events
        .events()
        .into_iter()
        .any(|e| matches!(e, CoreEvent::Recovered(_)));
    assert!(told);
}

#[test]
fn threads_save_on_their_own() {
    let kit = CoreKit::new();
    assert_eq!(kit.core.run_pending_work(), 0);
    let saver = std::sync::Arc::new(crate::session::autosave::Saver::default());
    saver.start(kit.clock.clone());
    saver.stop();
    kit.core.shutdown(Duration::from_secs(1));
    kit.core.shutdown(Duration::from_secs(1));
}
