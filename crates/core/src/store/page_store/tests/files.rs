use super::*;
use crate::model::{Ink, VersionReason};
use crate::store::history::list_versions;
use crate::store::layout::{CONFLICTS_DIR, DAMAGED_DIR};
use crate::store::PageFiles;

fn saved(h: &Harness) -> (Page, SaveOutcome) {
    let page = sample_page();
    h.put_assets(&page);
    h.save(&page, None, CompactionPlan::None)
}

#[test]
fn readable_copies_follow_spec_11_2() {
    let h = Harness::new();
    let (page, _) = saved(&h);
    let md = h.dir.join("page.md");
    assert_eq!(
        h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap(),
        ReadableOutcome::Written
    );
    assert_eq!(
        h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap(),
        ReadableOutcome::Unchanged
    );
    let mut renamed = page.clone();
    renamed.revision.id = "01m3sa8yf8bryf28a7sjgb7mmz".parse().unwrap();
    assert_eq!(
        h.store.write_page_md(&h.dir, &renamed, &NoLinks).unwrap(),
        ReadableOutcome::Written,
        "stale"
    );
    h.fs.put(&md, b"\0\0\0");
    assert_eq!(
        h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap(),
        ReadableOutcome::Written,
        "damaged"
    );
    h.fs.put(&md, b"# My own notes\n");
    let kept = match h.store.write_page_md(&h.dir, &page, &NoLinks).unwrap() {
        ReadableOutcome::EditedCopyKept(path) => path,
        other => panic!("{other:?}"),
    };
    assert_eq!(h.fs.get(&kept).unwrap(), b"# My own notes\n");
    let name = kept.file_name().unwrap().to_string_lossy().into_owned();
    assert!(
        name.starts_with("page.md.20260930T140000Z") && name.ends_with(".edited"),
        "{name}"
    );
    assert_eq!(kept.parent().unwrap(), h.dir.join(CONFLICTS_DIR));
    assert_eq!(
        h.codec.classify_readable(&h.fs.get(&md).unwrap()),
        ReadableState::Ours {
            revision: page.revision.id
        }
    );
}

#[test]
fn ink_pictures_and_encrypted_pages() {
    let h = Harness::new();
    let (page, _) = saved(&h);
    assert_eq!(h.store.write_ink_svg(&h.dir, &page).unwrap(), ReadableOutcome::Written);
    let mut blank = page.clone();
    blank.ink = Ink::default();
    let empty = Harness::new();
    assert_eq!(
        empty.store.write_ink_svg(&empty.dir, &blank).unwrap(),
        ReadableOutcome::Unchanged
    );
    assert!(!empty.fs.exists(&empty.dir.join("ink.svg")));
    let mut locked = page;
    locked.encryption = Some(serde_json::json!({}));
    assert_eq!(
        empty.store.write_page_md(&empty.dir, &locked, &NoLinks).unwrap(),
        ReadableOutcome::Unchanged
    );
    assert!(!empty.fs.exists(&empty.dir.join("page.md")));
}

#[test]
fn conflict_copies_are_found_by_name_and_absorbed() {
    let h = Harness::new();
    let (page, _) = saved(&h);
    let mut theirs = page.clone();
    theirs.revision.id = "01m3sa8yf8bryf28a7sjgb7mmz".parse().unwrap();
    theirs.title = "Changed elsewhere".into();
    let dropbox = h.dir.join("page (Sam's conflicted copy 2026-09-30).json");
    let onedrive = h.dir.join("page-LAPTOP.json");
    h.fs.put(&dropbox, &h.codec.write_page(&theirs));
    let mut older = page.clone();
    older.revision = sample_page().revision;
    h.fs.put(&onedrive, &h.codec.write_page(&older));
    h.fs.put(&h.dir.join("~page.json.0badf00d.tmp"), b"x");
    let copies = h.store.conflict_copies(&h.dir).unwrap();
    assert_eq!(copies, [dropbox.clone(), onedrive.clone()]);
    assert_eq!(
        h.store.absorb_conflict_copy(&h.dir, &dropbox).unwrap(),
        Some(theirs.revision.id)
    );
    assert!(h.fs.exists(&NotebookLayout::conflict_path(&h.dir, theirs.revision.id)));
    assert!(!h.fs.exists(&dropbox));
    assert_eq!(
        h.store.absorb_conflict_copy(&h.dir, &onedrive).unwrap(),
        None,
        "an ancestor"
    );
    assert!(!h.fs.exists(&onedrive));
    let files = PageFiles {
        fs: &h.fs,
        codec: &h.codec,
        dir: &h.dir,
    };
    let history = list_versions(&files, &Limits::default()).unwrap();
    assert_eq!(history.versions.len(), 1);
    assert_eq!(history.versions[0].reason.known(), Some(VersionReason::Conflict));
    let mut stranger = page;
    stranger.id = PageId(Id::from_parts(5, 5));
    let foreign = h.dir.join("page 2.json");
    h.fs.put(&foreign, &h.codec.write_page(&stranger));
    assert_eq!(h.store.absorb_conflict_copy(&h.dir, &foreign).unwrap(), None);
    assert!(h.fs.exists(&foreign), "another page's file is left alone");
}

#[test]
fn keeps_conflicts_and_moves_damaged_files_aside() {
    let h = Harness::new();
    let (page, _) = saved(&h);
    let bytes = h.codec.write_page(&page);
    assert_eq!(h.store.keep_conflict(&h.dir, &bytes).unwrap(), page.revision.id);
    assert_eq!(
        h.store.keep_conflict(&h.dir, &bytes).unwrap(),
        page.revision.id,
        "again"
    );
    assert!(h.store.keep_conflict(&h.dir, b"nonsense").is_err());
    let moved = h.store.move_damaged(&h.dir, "page.json").unwrap();
    assert_eq!(moved, h.dir.join(DAMAGED_DIR).join("20260930T140000Z-page.json"));
    assert_eq!(h.store.fingerprint(&h.dir).unwrap(), None);
    h.fs.put(&h.dir.join("page.json"), b"second");
    let again = h.store.move_damaged(&h.dir, "page.json").unwrap();
    assert_eq!(again, h.dir.join(DAMAGED_DIR).join("20260930T140000Z-page-2.json"));
    assert!(
        h.store.move_damaged(&h.dir, "page.json").is_err(),
        "nothing left to move"
    );
}

#[test]
fn repairs_damaged_strokes_from_other_segments_and_the_journal() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    draw(&mut page, stroke_n(1));
    draw(&mut page, stroke_n(2));
    let (page, first) = h.save(&page, None, CompactionPlan::None);
    // An older copy of stroke 1 sits in a segment that history keeps but the page no longer lists.
    let (mut later, second) = h.save(&page, Some(first.stamp), CompactionPlan::Major);
    later.title = "Later".into();
    let (later, _) = h.save(&later, Some(second.stamp), CompactionPlan::None);
    let base = Some(second.segments[0].id);
    *h.codec.damage.lock().unwrap() = vec![
        (base, stroke_n(1).id),
        (None, stroke_n(2).id),
        (None, sample_stroke().id),
    ];
    let loaded = h.store.load(&h.dir).unwrap();
    assert_eq!(loaded.damaged.len(), 3);
    let repaired = h.store.repair_ink(&h.dir, &loaded.page, &[stroke_n(2)]).unwrap();
    h.codec.damage.lock().unwrap().clear();
    assert_eq!(repaired.format.access, Access::ReadWrite);
    assert!(repaired.ink.stroke(stroke_n(1).id).is_some(), "from the older segment");
    assert!(repaired.ink.stroke(stroke_n(2).id).is_some(), "from the journal");
    assert!(repaired.ink.stroke(sample_stroke().id).is_none(), "no intact copy");
    let files = PageFiles {
        fs: &h.fs,
        codec: &h.codec,
        dir: &h.dir,
    };
    let history = list_versions(&files, &Limits::default()).unwrap();
    assert_eq!(history.versions[0].revision, later.revision.id);
    assert_eq!(history.versions[0].reason.known(), Some(VersionReason::BeforeRepair));
    let (fixed, _) = h.save(&repaired, h.store.fingerprint(&h.dir).unwrap(), CompactionPlan::Major);
    assert_eq!(h.store.load(&h.dir).unwrap().page, fixed);
}
