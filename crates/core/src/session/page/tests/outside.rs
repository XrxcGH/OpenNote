//! Another program edits `page.json` while the page is open.

use super::*;

#[test]
fn an_outside_edit_that_keeps_the_revision_is_kept_as_a_conflict() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Saved"))
        .unwrap();
    handle.save_now().unwrap();
    // Another program edits the text and keeps every revision field.
    let json = dir.join(crate::store::layout::PAGE_JSON);
    let mut theirs = on_disk(&s);
    theirs.title = "Changed outside".into();
    s.kit
        .fs
        .replace_durable(&json, &s.kit.codec.write_page(&theirs))
        .unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Saved", "Mine"))
        .unwrap();
    handle.save_now().unwrap();
    assert_eq!(on_disk(&s).title, "Mine");
    let conflicts = handle.conflicts().unwrap();
    assert_eq!(conflicts.len(), 1, "the outside edit is kept in .conflicts");
    assert!(handle.open_conflict(conflicts[0].revision).is_ok());
    let path = NotebookLayout::conflict_path(&dir, conflicts[0].revision);
    let bytes = s.kit.fs.inner.read(&path, u64::MAX).unwrap();
    let kept = s.kit.codec.read_page(&bytes, &Limits::default()).unwrap().page;
    assert_eq!(kept.title, "Changed outside");
    let told = s.kit.events.events().into_iter().any(|e| {
        matches!(
            e,
            CoreEvent::ExternalChange {
                action: ExternalAction::Conflict { .. },
                ..
            }
        )
    });
    assert!(told, "the app is told so it can offer the outside version");
}
