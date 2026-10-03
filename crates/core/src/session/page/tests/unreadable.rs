//! A save that finds `page.json` changed on disk and can't read the new file: it is never replaced unread.

use super::*;

fn dirty_page_with_changed_file(s: &Setup, theirs: &[u8]) -> (PageHandle, std::path::PathBuf) {
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Mine"))
        .unwrap();
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    s.kit.fs.inner.put(&NotebookLayout::page_json(&dir), theirs);
    (handle, dir)
}

#[test]
fn a_damaged_file_is_moved_aside_before_the_save_replaces_it() {
    let s = setup();
    let (handle, dir) = dirty_page_with_changed_file(&s, b"not a page");
    handle.save_now().unwrap();
    assert_eq!(on_disk(&s).title, "Mine");
    let damaged = s
        .kit
        .fs
        .inner
        .read_dir(&dir.join(crate::store::layout::DAMAGED_DIR))
        .unwrap();
    let kept = damaged
        .iter()
        .map(|e| s.kit.fs.inner.get(&dir.join(".damaged").join(&e.name)).unwrap());
    assert_eq!(kept.collect::<Vec<_>>(), [b"not a page".to_vec()]);
}

#[test]
fn a_file_that_cant_be_read_now_is_not_replaced() {
    let s = setup();
    let (handle, dir) = dirty_page_with_changed_file(&s, b"saved elsewhere");
    let path = NotebookLayout::page_json(&dir);
    s.kit.fs.inner.set_placeholder(&path, true);
    assert!(handle.save_now().is_err());
    assert!(handle.has_unsaved(), "the edit stays in memory and in the journal");
    s.kit.fs.inner.set_placeholder(&path, false);
    assert_eq!(s.kit.fs.inner.get(&path).unwrap(), b"saved elsewhere");
}
