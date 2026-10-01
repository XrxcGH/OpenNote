use std::time::Duration;

use super::*;
use crate::error::FsErrorKind;
use crate::model::{ReadOnlyReason, VersionReason};
use crate::session::events::{CoreEvent, ExternalAction};
use crate::session::kit::{add_strokes, client, retitle, stroke, CoreKit};
use crate::session::notebook::{NodePlacement, NodeRef, NotebookHandle, ParentRef};
use crate::store::layout::NotebookLayout;
use crate::wire::envelope;

fn secs(s: u64) -> Duration {
    Duration::from_secs(s)
}

struct Setup {
    kit: CoreKit,
    notebook: NotebookHandle,
    section: SectionIdAlias,
    page: PageId,
}

type SectionIdAlias = crate::id::SectionId;

fn setup() -> Setup {
    let kit = CoreKit::new();
    let notebook = kit.notebook("Biology").unwrap();
    let at = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let section = notebook.create_section("Lab", at).unwrap();
    let (page, _) = kit.inked_page(&notebook, section).unwrap();
    Setup {
        kit,
        notebook,
        section,
        page,
    }
}

fn saved_revisions(kit: &CoreKit) -> usize {
    kit.events
        .events()
        .iter()
        .filter(|e| matches!(e, CoreEvent::Saved { .. }))
        .count()
}

fn on_disk(s: &Setup) -> Page {
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    read_page_dir(&s.kit.fs, &s.kit.codec, &dir, &Limits::default())
        .unwrap()
        .page
}

#[test]
fn the_envelope_holds_the_page_and_its_strokes() {
    let s = setup();
    let handle = s.notebook.open_page(s.page, client("main-1")).unwrap();
    let env = handle.envelope(None).unwrap();
    let decoded = envelope::decode(&env.bytes).unwrap();
    assert_eq!(decoded.strokes, 1);
    assert_eq!(decoded.flags, 0);
    let info: serde_json::Value = serde_json::from_slice(decoded.session).unwrap();
    assert_eq!(info["clientSeq"], 0);
    assert_eq!(info["saved"], true);
    assert_eq!(info["strokesTotal"], 1);
    assert!(!decoded.page_json.is_empty());
    let far = crate::model::Rect {
        x: 10_000.0,
        y: 10_000.0,
        w: 10.0,
        h: 10.0,
    };
    let env = handle.envelope(Some(far)).unwrap();
    assert!(!env.more_ink);
    assert_eq!(handle.remaining_ink(far).len(), 1);
}

#[test]
fn an_edit_is_journaled_and_saved_after_a_second_of_quiet() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let seq = handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Light"))
        .unwrap();
    assert_eq!(seq, 1);
    assert!(handle.has_unsaved());
    assert!(s.kit.core.has_unsaved());
    s.kit.advance(Duration::from_millis(900));
    assert!(handle.has_unsaved());
    s.kit.advance(Duration::from_millis(100));
    assert!(!handle.has_unsaved());
    assert_eq!(saved_revisions(&s.kit), 1);
    assert_eq!(on_disk(&s).title, "Light");
    let log = s.kit.backend.journal_log();
    assert_eq!(log.txns.len(), 1);
    assert_eq!(log.saves, vec![(s.page, 1)]);
    let hints = s.kit.index.hints();
    assert!(hints.last().is_some_and(|h| h.title_changed && h.page == s.page));
}

#[test]
fn continuous_editing_saves_after_ten_seconds() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let mut title = "Photosynthesis".to_owned();
    for n in 0..20 {
        let next = format!("T{n}");
        handle
            .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, &title, &next))
            .unwrap();
        title = next;
        s.kit.advance(Duration::from_millis(600));
    }
    // Twelve seconds of typing without a second of quiet saved at the ten-second cap.
    assert_eq!(saved_revisions(&s.kit), 1);
}

#[test]
fn a_degraded_journal_saves_a_second_after_every_change() {
    let s = setup();
    s.kit.backend.degrade_journal(true);
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let mut title = "Photosynthesis".to_owned();
    for n in 0..5 {
        let next = format!("T{n}");
        handle
            .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, &title, &next))
            .unwrap();
        title = next;
        s.kit.advance(Duration::from_millis(600));
    }
    assert!(saved_revisions(&s.kit) >= 2);
}

#[test]
fn a_failed_save_backs_off_and_a_read_only_file_stops_saving() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    s.kit.backend.fail_saves(Some(FsErrorKind::Busy));
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "A"))
        .unwrap();
    s.kit.advance(secs(1));
    let failed: Vec<_> = s
        .kit
        .events
        .events()
        .into_iter()
        .filter_map(|e| match e {
            CoreEvent::SaveFailed { kind, retry_in, .. } => Some((kind, retry_in)),
            _ => None,
        })
        .collect();
    assert_eq!(failed, vec![(FsErrorKind::Busy, Some(secs(1)))]);
    assert_eq!(s.kit.core.save_status(), crate::session::notes::SaveStatus::Error);
    s.kit.backend.fail_saves(None);
    s.kit.advance(secs(1));
    assert!(!handle.has_unsaved());
    assert_eq!(s.kit.core.save_status(), crate::session::notes::SaveStatus::Saved);
    s.kit.backend.fail_saves(Some(FsErrorKind::ReadOnlyFile));
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "A", "B"))
        .unwrap();
    s.kit.advance(secs(1));
    assert_eq!(handle.read_only(), Some(ReadOnlyReason::ReadOnlyFile));
    assert!(handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "B", "C"))
        .is_err());
    s.kit.backend.fail_saves(None);
    handle.make_editable().unwrap();
    assert_eq!(handle.read_only(), None);
    s.kit.advance(secs(1));
    assert!(!handle.has_unsaved());
}

#[test]
fn strokes_become_a_segment_and_survive_a_reopen() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&add_strokes(s.kit.clock.as_ref(), &c, vec![stroke(1), stroke(2)]))
        .unwrap();
    handle.save_now().unwrap();
    handle.close(&c).unwrap();
    let log = s.kit.backend.journal_log();
    assert_eq!(log.closed.len(), 1);
    assert!(log.closed[0].1.is_some());
    assert_eq!(on_disk(&s).ink.len(), 3);
    let again = s.notebook.open_page(s.page, c.clone()).unwrap();
    assert_eq!(again.page_for_tests().ink.len(), 3);
}

#[test]
fn two_clients_share_a_session_and_hear_about_each_other() {
    let s = setup();
    let (a, b) = (client("main-1"), client("main-2"));
    let first = s.notebook.open_page(s.page, a.clone()).unwrap();
    let second = s.notebook.open_page(s.page, b.clone()).unwrap();
    first
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &a, "Photosynthesis", "Shared"))
        .unwrap();
    assert_eq!(second.page_for_tests().title, "Shared");
    let told = s
        .kit
        .events
        .events()
        .into_iter()
        .any(|e| matches!(e, CoreEvent::TxnApplied { page, source, .. } if page == s.page && source == a));
    assert!(told);
    first.close(&a).unwrap();
    assert!(second.has_unsaved());
    second.close(&b).unwrap();
    assert_eq!(on_disk(&s).title, "Shared");
}

#[test]
fn a_change_made_elsewhere_is_kept_as_a_conflict() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    let mut theirs = on_disk(&s);
    theirs.title = "Theirs".into();
    theirs.revision.device.label = "Mac device 7Q2M".into();
    write_page_dir(&s.kit.fs, &s.kit.codec, &dir, &theirs).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Mine"))
        .unwrap();
    handle.save_now().unwrap();
    assert_eq!(on_disk(&s).title, "Mine");
    let conflicts = handle.conflicts().unwrap();
    assert_eq!(conflicts.len(), 1);
    let told = s.kit.events.events().into_iter().any(|e| {
        matches!(e, CoreEvent::ExternalChange { action: ExternalAction::Conflict { other_device }, .. }
            if other_device == "Mac device 7Q2M")
    });
    assert!(told);
    assert!(handle.open_conflict(conflicts[0].revision).is_ok());
    handle
        .resolve_conflict(conflicts[0].revision, ConflictChoice::KeepMine)
        .unwrap();
    assert!(handle.conflicts().unwrap().is_empty());
    let history = handle.history().unwrap();
    assert!(history
        .iter()
        .any(|v| v.reason == crate::model::Named::Known(VersionReason::Conflict)));
}

#[test]
fn closing_after_edits_keeps_a_version_and_restoring_as_a_copy_adds_a_page() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Edited"))
        .unwrap();
    handle.clone().close(&c).unwrap();
    let again = s.notebook.open_page(s.page, c.clone()).unwrap();
    let history = again.history().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].reason, crate::model::Named::Known(VersionReason::Closed));
    again
        .name_version(history[0].revision, Some("Final".into()), true)
        .unwrap();
    let named = again.history().unwrap();
    assert_eq!((named[0].name.as_deref(), named[0].keep), (Some("Final"), true));
    assert!(again.open_version(history[0].revision).is_ok());
    let copied = again.restore_version(history[0].revision, true).unwrap();
    let RestoreResult::Copied { page } = copied else {
        panic!("expected a copy")
    };
    let tree = s.notebook.tree();
    let pages = &tree.section(s.section).unwrap().pages;
    assert_eq!(pages.iter().map(|p| p.id).collect::<Vec<_>>(), vec![s.page, page]);
}

#[test]
fn restoring_a_version_in_place_saves_the_current_state_first() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let first = handle.save_now().unwrap().revision;
    handle.name_version(first, Some("Start".into()), false).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Later"))
        .unwrap();
    let result = handle.restore_version(first, false).unwrap();
    assert!(matches!(result, RestoreResult::Restored { .. }));
    assert_eq!(on_disk(&s).title, "Photosynthesis");
    let reasons: Vec<_> = handle.history().unwrap().into_iter().map(|v| v.reason).collect();
    assert!(reasons.contains(&crate::model::Named::Known(VersionReason::BeforeRestore)));
}

#[test]
fn assets_import_and_read_back_by_range() {
    let s = setup();
    let handle = s.notebook.open_page(s.page, client("main-1")).unwrap();
    let source = crate::store::assets::AssetSource::Bytes {
        name: "leaf.png".into(),
        mime: "image/png".into(),
        bytes: b"0123456789".to_vec(),
    };
    let asset = handle.import_asset(source.clone()).unwrap();
    assert_eq!(handle.import_asset(source).unwrap().id, asset.id);
    let part = handle.asset_bytes(asset.id, Some(2..5)).unwrap();
    assert_eq!((part.bytes.as_slice(), part.total), (&b"234"[..], 10));
    assert!(handle.asset_bytes(crate::id::AssetId::ZERO, None).is_err());
}

#[test]
fn a_closed_page_reopens_from_memory_unless_its_file_changed() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle.close(&c).unwrap();
    assert!(s.kit.core.memory().closed_pages > 0);
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    let mut theirs = on_disk(&s);
    theirs.title = "Changed elsewhere".into();
    write_page_dir(&s.kit.fs, &s.kit.codec, &dir, &theirs).unwrap();
    let again = s.notebook.open_page(s.page, c).unwrap();
    assert_eq!(again.page_for_tests().title, "Changed elsewhere");
    assert_eq!(s.kit.core.memory().closed_pages, 0);
}

#[test]
fn deleting_an_open_page_saves_and_closes_it() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Last words"))
        .unwrap();
    s.notebook.delete(&[NodeRef::Page(s.page)]).unwrap();
    assert!(handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Last words", "x"))
        .is_err());
    let item = s.notebook.trash().unwrap()[0].id;
    let dir = s
        .notebook
        .path()
        .join(".opennote/trash")
        .join(item.to_string())
        .join(s.page.to_string());
    let page = read_page_dir(&s.kit.fs, &s.kit.codec, &dir, &Limits::default())
        .unwrap()
        .page;
    assert_eq!(page.title, "Last words");
}

#[test]
fn an_open_page_follows_its_folder_to_another_section() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let at = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let other = s.notebook.create_section("Other", at).unwrap();
    let to = NodePlacement {
        parent: ParentRef::Section(other),
        before: None,
    };
    s.notebook.move_node(NodeRef::Page(s.page), to).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Moved"))
        .unwrap();
    handle.save_now().unwrap();
    let dir = s.notebook.path().join(other.to_string()).join(s.page.to_string());
    assert_eq!(handle.session.state().dir, dir);
    let page = read_page_dir(&s.kit.fs, &s.kit.codec, &dir, &Limits::default())
        .unwrap()
        .page;
    assert_eq!(page.title, "Moved");
}

#[test]
fn renaming_a_page_edits_its_page_json_and_its_title_copy() {
    let s = setup();
    s.notebook.rename(NodeRef::Page(s.page), "Renamed").unwrap();
    assert_eq!(on_disk(&s).title, "Renamed");
    assert_eq!(s.notebook.tree().find_page(s.page).unwrap().1.title, "Renamed");
    assert!(s.notebook.tree_undo().unwrap());
    assert_eq!(on_disk(&s).title, "Photosynthesis");
    assert!(s.notebook.tree_redo().unwrap());
    assert_eq!(s.notebook.tree().find_page(s.page).unwrap().1.title, "Renamed");
}

#[test]
fn readable_copies_follow_saves_on_the_maintenance_queue() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Readable"))
        .unwrap();
    s.kit.advance(secs(1));
    let dir = s.notebook.inner.tree().store.page_dir(s.page).unwrap();
    let md = s.kit.fs.inner.get(&dir.join(crate::store::layout::PAGE_MD)).unwrap();
    assert!(String::from_utf8_lossy(&md).contains("Readable"));
    assert_eq!(s.notebook.tree().find_page(s.page).unwrap().1.title, "Readable");
}

#[test]
fn flush_all_saves_every_dirty_page_and_closes_journals() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Exit"))
        .unwrap();
    let report = s.kit.core.flush_all(secs(5)).unwrap();
    assert_eq!((report.saved, report.failed.len(), report.timed_out), (1, 0, false));
    assert_eq!(s.kit.backend.journal_log().closed.len(), 1);
    assert!(!s.kit.core.has_unsaved());
    let history = handle.history().unwrap();
    assert_eq!(history[0].reason, crate::model::Named::Known(VersionReason::Exit));
    // Editing after a flush opens a new journal.
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Exit", "Again"))
        .unwrap();
    assert_eq!(s.kit.backend.journal_log().txns.len(), 2);
}

#[test]
fn pages_without_a_journal_still_save() {
    let s = setup();
    s.kit.backend.refuse_journals(true);
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    handle
        .commit_for_tests(&retitle(s.kit.clock.as_ref(), &c, "Photosynthesis", "Unjournaled"))
        .unwrap();
    let degraded = s
        .kit
        .events
        .events()
        .into_iter()
        .any(|e| matches!(e, CoreEvent::JournalDegraded { .. }));
    assert!(degraded);
    s.kit.advance(secs(1));
    assert_eq!(on_disk(&s).title, "Unjournaled");
}

#[test]
fn write_and_read_page_dir_round_trip() {
    let kit = CoreKit::new();
    let dir = std::path::Path::new("/export/page");
    kit.fs.inner.mkdir_all(dir);
    let mut page = crate::testing::sample::sample_page();
    page.assets.clear();
    let revision = write_page_dir(&kit.fs, &kit.codec, dir, &page).unwrap();
    assert_eq!(revision.parents, vec![page.revision.id]);
    let loaded = read_page_dir(&kit.fs, &kit.codec, dir, &Limits::default()).unwrap();
    assert_eq!(loaded.page.revision.id, revision.id);
    assert_eq!(loaded.page.ink.len(), 1);
    assert!(kit.fs.inner.exists(&NotebookLayout::page_json(dir)));
}

#[test]
fn out_of_order_edits_are_refused() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let req = TxnRequest {
        page: s.page,
        client: c,
        client_seq: 5,
        coalesce: None,
        ui: None,
        edits: Vec::new(),
    };
    assert_eq!(handle.apply(req).unwrap_err(), EditError::OutOfOrder { expected: 1 });
}

#[test]
fn requests_resolve_apply_and_undo() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let req = TxnRequest {
        page: s.page,
        client: c.clone(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: vec![crate::ops::resolve::Edit::SetPage {
            title: Some("Resolved".into()),
            tags: None,
            view: None,
        }],
    };
    let ack = handle.apply(req).unwrap();
    assert!(ack.can_undo && !ack.can_redo);
    let frame = handle.undo(&c).unwrap().unwrap();
    let (json, _) = crate::wire::frames::decode(&frame.bytes).unwrap();
    assert_eq!(json["title"], "Photosynthesis");
    assert!(handle.redo(&c).unwrap().is_some());
    assert_eq!(handle.page_for_tests().title, "Resolved");
}

#[test]
fn binary_strokes_resolve_into_one_transaction() {
    let s = setup();
    let c = client("main-1");
    let handle = s.notebook.open_page(s.page, c.clone()).unwrap();
    let records = s
        .kit
        .codec
        .encode_records(&[crate::model::InkRecord::Stroke(stroke(9))]);
    let meta = StrokeTxnMeta {
        page: s.page,
        client: c,
        client_seq: 1,
        coalesce: None,
    };
    let ack = handle.add_strokes(meta, &records).unwrap();
    assert_eq!(ack.seq, 1);
    assert_eq!(handle.page_for_tests().ink.len(), 2);
}
