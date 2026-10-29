//! Two or three devices syncing real note files through shared storage.

mod common;

use std::sync::Arc;

use common::*;
use opennote_core::format::tree_json::read_section;
use opennote_core::Limits;
use opennote_sync::{Backend, MemoryBackend, SyncError};

fn pair() -> (MemoryBackend, Vec<Device>) {
    let store = MemoryBackend::new();
    let devices = devices(Arc::new(store.clone()), 2);
    (store, devices)
}

#[test]
fn files_reach_the_other_device_and_deletes_follow() {
    let (_, d) = pair();
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "Mitosis", 1, &[], 1_000, &[]));
    d[0].write(&format!("{p}/assets/01-photo.png"), &vec![9u8; 3 * 1024 * 1024 + 5]);
    d[0].write("Bio/todo.txt", b"buy a microscope");
    let report = d[0].engine.sync().expect("syncs");
    assert_eq!(report.summary.upload.len(), 3);
    assert_eq!(report.generation, Some(1));
    let report = d[1].engine.sync().expect("syncs");
    assert_eq!(report.summary.download.len(), 3);
    assert_eq!(d[1].files(), d[0].files());

    // Nothing changed: no head is written and nothing moves.
    let quiet = d[0].engine.sync().expect("syncs");
    assert!(quiet.summary.is_empty() && quiet.generation.is_none(), "{quiet:?}");

    d[1].remove("Bio/todo.txt");
    settle(&d, 3);
    assert_eq!(d[0].read("Bio/todo.txt"), None);
    assert_eq!(d[1].files(), d[0].files());
}

#[test]
fn storage_sees_no_names_titles_or_text() {
    let (store, d) = pair();
    d[0].write("Biology/notes.txt", b"The mitochondria is the powerhouse of the cell");
    d[0].write(
        &format!("{}/page.json", page_dir(1)),
        &page(1, "Secret plans", 1, &[], 1_000, &[]),
    );
    d[0].engine.sync().expect("syncs");
    for (name, bytes) in store.snapshot() {
        for needle in ["Biology", "notes", "Bio", "page"] {
            assert!(!name.contains(&needle.to_lowercase()), "{name} names {needle}");
        }
        for needle in [&b"mitochondria"[..], b"Secret plans", b"Biology", b"page.json"] {
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "{name} holds {needle:?}"
            );
        }
        if name.starts_with("c/") || name.starts_with("h/") {
            assert!(
                bytes.len() >= 512 && (bytes.len() - 40).is_power_of_two(),
                "{name} is padded: {}",
                bytes.len()
            );
        }
    }
}

#[test]
fn equal_chunks_are_stored_once() {
    let (store, d) = pair();
    let big = vec![5u8; 2 * 1024 * 1024];
    d[0].write("a/one.bin", &big);
    d[0].write("b/two.bin", &big);
    d[0].engine.sync().expect("syncs");
    let chunks = store.snapshot().keys().filter(|n| n.starts_with("c/")).count();
    assert_eq!(chunks, 1, "two files of two equal chunks are one chunk");
}

#[test]
fn concurrent_page_edits_keep_both_versions_as_a_conflict() {
    let (_, d) = pair();
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "Base", 1, &[], 1_000, &[]));
    settle(&d, 2);
    d[0].write(
        &format!("{p}/page.json"),
        &page(1, "Edited on the laptop", 2, &[1], 2_000, &[]),
    );
    d[1].write(
        &format!("{p}/page.json"),
        &page(1, "Edited on the desktop", 3, &[1], 3_000, &[]),
    );
    d[0].engine.sync().expect("syncs");
    let report = d[1].engine.sync().expect("syncs");
    assert_eq!(report.summary.conflicts.len(), 1, "{:?}", report.summary);
    settle(&d, 3);
    assert_eq!(d[0].files(), d[1].files());
    let kept = String::from_utf8(d[0].read(&format!("{p}/page.json")).expect("page")).expect("utf8");
    assert!(
        kept.contains("Edited on the desktop"),
        "the later save stays as page.json"
    );
    let other = d[0]
        .read(&format!("{p}/.conflicts/{}.json", rev(2)))
        .expect("the other version is kept");
    assert!(String::from_utf8(other).expect("utf8").contains("Edited on the laptop"));
}

#[test]
fn a_later_save_of_the_same_page_is_not_a_conflict() {
    let (_, d) = pair();
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "One", 1, &[], 1_000, &[]));
    d[1].write(&format!("{p}/page.json"), &page(1, "Two", 2, &[1], 2_000, &[]));
    d[0].engine.sync().expect("syncs");
    let report = d[1].engine.sync().expect("syncs");
    assert!(
        report.summary.conflicts.is_empty(),
        "revision 2 lists 1 among its ancestors"
    );
    settle(&d, 3);
    assert!(String::from_utf8(d[0].read(&format!("{p}/page.json")).expect("page"))
        .expect("utf8")
        .contains("Two"));
    assert!(!d[0].files().keys().any(|k| k.contains(".conflicts")));
}

#[test]
fn section_lists_merge_by_the_cores_own_rule() {
    let (_, d) = pair();
    d[0].write(&section_path(), &section(&[(1, "Mitosis", 1_000)], 1_000));
    settle(&d, 2);
    d[0].write(
        &section_path(),
        &section(&[(1, "Mitosis", 1_000), (2, "Meiosis", 2_000)], 2_000),
    );
    d[1].write(
        &section_path(),
        &section(&[(1, "Mitosis and the cell cycle", 3_000)], 3_000),
    );
    settle(&d, 3);
    assert_eq!(d[0].files(), d[1].files());
    let merged = read_section(&d[0].read(&section_path()).expect("section"), &Limits::default()).expect("reads");
    let titles: Vec<_> = merged.pages.iter().map(|p| p.title.as_str()).collect();
    assert_eq!(titles.len(), 2, "both pages are listed: {titles:?}");
    assert!(titles.contains(&"Meiosis"));
    assert!(
        titles.contains(&"Mitosis and the cell cycle"),
        "the later change to an entry wins"
    );
    assert!(!d[0].files().keys().any(|k| k.contains("conflicted copy")));
}

#[test]
fn ordinary_files_changed_on_both_devices_keep_a_conflicted_copy() {
    let (_, d) = pair();
    d[0].write("Bio/todo.txt", b"base");
    settle(&d, 2);
    d[0].write("Bio/todo.txt", b"laptop");
    d[1].write("Bio/todo.txt", b"desktop");
    settle(&d, 3);
    let files = d[0].files();
    assert_eq!(files, d[1].files());
    let mut texts: Vec<_> = files
        .iter()
        .filter(|(k, _)| k.starts_with("Bio/todo"))
        .map(|(_, v)| v.clone())
        .collect();
    texts.sort();
    assert_eq!(texts, [b"desktop".to_vec(), b"laptop".to_vec()]);
    assert!(files
        .keys()
        .any(|k| k.starts_with("Bio/todo (conflicted copy ") && k.ends_with(").txt")));
}

#[test]
fn an_edit_beats_a_delete_made_without_seeing_it() {
    let (_, d) = pair();
    d[0].write("Bio/todo.txt", b"base");
    settle(&d, 2);
    d[0].remove("Bio/todo.txt");
    d[1].write("Bio/todo.txt", b"still needed");
    settle(&d, 3);
    assert_eq!(d[0].read("Bio/todo.txt").as_deref(), Some(&b"still needed"[..]));
    assert_eq!(d[0].files(), d[1].files());
}

#[test]
fn ink_a_page_still_points_at_comes_back_after_a_concurrent_delete() {
    let (_, d) = pair();
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "Sketch", 1, &[], 1_000, &[1]));
    d[0].write(&format!("{p}/{}", segment_name(1)), b"strokes one");
    settle(&d, 2);
    // The laptop rewrites the page into a new segment and drops the old one; the desktop adds ink meanwhile.
    d[0].write(&format!("{p}/page.json"), &page(1, "Sketch", 2, &[1], 2_000, &[2]));
    d[0].write(&format!("{p}/{}", segment_name(2)), b"strokes compacted");
    d[0].remove(&format!("{p}/{}", segment_name(1)));
    d[1].write(&format!("{p}/page.json"), &page(1, "Sketch", 3, &[1], 3_000, &[1, 3]));
    d[1].write(&format!("{p}/{}", segment_name(3)), b"strokes three");
    settle(&d, 4);
    assert_eq!(d[0].files(), d[1].files());
    for s in [1, 2, 3] {
        assert!(
            d[0].read(&format!("{p}/{}", segment_name(s))).is_some(),
            "segment {s} is there"
        );
    }
    assert!(d[0].read(&format!("{p}/.conflicts/{}.json", rev(2))).is_some());
}

#[test]
fn the_preview_changes_nothing() {
    let (store, d) = pair();
    d[0].write("Bio/todo.txt", b"x");
    let before = store.snapshot();
    let plan = d[0].engine.plan().expect("plans");
    assert_eq!(plan.summary.upload, ["Bio/todo.txt"]);
    assert_eq!(plan.summary.bytes_up, 1);
    assert_eq!(store.snapshot(), before, "a plan writes nothing to storage");
    assert!(
        !d[0].dir.path().join("state.json").exists(),
        "nor to the device's state"
    );
}

#[test]
fn a_file_changed_during_a_round_waits_and_nothing_is_lost() {
    let (_, d) = pair();
    d[0].write("Bio/todo.txt", b"base");
    settle(&d, 2);
    d[0].write("Bio/todo.txt", b"from the laptop");
    d[0].engine.sync().expect("syncs");
    let plan = d[1].engine.plan().expect("plans");
    assert_eq!(plan.summary.download, ["Bio/todo.txt"]);
    // The person types on the desktop between the plan and the write.
    d[1].write("Bio/todo.txt", b"typed meanwhile");
    let report = d[1].engine.apply(plan).expect("applies");
    assert_eq!(report.deferred, ["Bio/todo.txt"]);
    assert_eq!(d[1].read("Bio/todo.txt").as_deref(), Some(&b"typed meanwhile"[..]));
    settle(&d, 4);
    let mut texts: Vec<_> = d[0].files().into_values().collect();
    texts.sort();
    assert_eq!(texts, [b"from the laptop".to_vec(), b"typed meanwhile".to_vec()]);
    assert_eq!(d[0].files(), d[1].files());
}

#[test]
fn a_third_device_joins_by_pairing_code_and_catches_up() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 1);
    d[0].write("Bio/todo.txt", b"x");
    d[0].engine.sync().expect("syncs");
    let code = opennote_sync::vault::create_pairing(backend.as_ref(), d[0].engine.keys(), 0).expect("pairs");
    let keys = opennote_sync::vault::join_with_code(backend.as_ref(), code.text(), 1).expect("joins");
    assert_eq!(keys.fingerprint(), d[0].engine.keys().fingerprint());
    let late = join(backend.clone(), "d9");
    late.engine.sync().expect("syncs");
    assert_eq!(late.files(), d[0].files());
}

#[test]
fn a_removed_device_stops_syncing_and_keeps_its_notes() {
    let (store, d) = pair();
    d[1].write("Bio/todo.txt", b"mine");
    d[1].engine.sync().expect("syncs");
    opennote_sync::vault::remove_device(&store, d[0].engine.keys(), "d1", 5).expect("removes");
    assert_eq!(d[1].engine.sync().unwrap_err(), SyncError::Removed);
    assert_eq!(d[1].read("Bio/todo.txt").as_deref(), Some(&b"mine"[..]));
    d[0].engine.sync().expect("the other device still syncs");
    assert_eq!(d[0].read("Bio/todo.txt").as_deref(), Some(&b"mine"[..]));
}

#[test]
fn a_rolled_back_head_is_noticed_and_can_be_trusted_on_purpose() {
    let (store, d) = pair();
    d[0].write("Bio/todo.txt", b"one");
    d[0].engine.sync().expect("syncs");
    let old = store.snapshot();
    d[0].write("Bio/todo.txt", b"two");
    d[0].engine.sync().expect("syncs");
    d[1].engine.sync().expect("syncs");
    // The storage goes back to an older copy, as a restore from a backup or a hostile server would.
    for name in store.snapshot().keys() {
        store.remove_raw(name);
    }
    for (name, bytes) in old {
        store.set_raw(&name, bytes);
    }
    assert_eq!(d[1].engine.sync().unwrap_err(), SyncError::Rollback);
    assert_eq!(
        d[1].read("Bio/todo.txt").as_deref(),
        Some(&b"two"[..]),
        "nothing changed here"
    );
    d[1].engine.trust_storage().expect("trusts");
    d[1].engine.sync().expect("syncs after trusting");
    assert_eq!(
        d[1].read("Bio/todo.txt").as_deref(),
        Some(&b"two"[..]),
        "and keeps its newer file"
    );
}

#[test]
fn unused_chunks_go_only_after_the_grace_period_and_every_device_moved_on() {
    let (store, d) = pair();
    d[0].write("Bio/big.bin", &[1u8; 10]);
    settle(&d, 2);
    d[0].write("Bio/big.bin", &[2u8; 10]);
    settle(&d, 2);
    let chunks = || store.snapshot().keys().filter(|n| n.starts_with("c/")).count();
    assert_eq!(chunks(), 2);
    let day = 24 * 60 * 60 * 1000;
    // The path is live with new bytes, so the old chunk is unused.
    assert_eq!(d[0].engine.collect_garbage(0).expect("marks"), 0, "first only marked");
    assert_eq!(
        d[0].engine.collect_garbage(8 * day).expect("waits"),
        0,
        "no device wrote a newer head yet"
    );
    d[1].write("Bio/other.txt", b"x");
    settle(&d, 2);
    assert_eq!(d[0].engine.collect_garbage(8 * day).expect("collects"), 1);
    assert_eq!(chunks(), 2, "the old chunk went, the new file's chunk came");
    settle(&d, 2);
    assert_eq!(d[1].read("Bio/big.bin"), Some(vec![2u8; 10]));
}

#[test]
fn deleted_files_keep_their_chunks_for_a_concurrent_edit() {
    let (store, d) = pair();
    d[0].write("Bio/a.txt", b"keep me");
    settle(&d, 2);
    d[0].remove("Bio/a.txt");
    settle(&d, 2);
    let day = 24 * 60 * 60 * 1000;
    d[0].engine.collect_garbage(0).expect("marks");
    d[0].write("Bio/x.txt", b"x");
    d[1].write("Bio/y.txt", b"y");
    settle(&d, 2);
    assert_eq!(
        d[0].engine.collect_garbage(8 * day).expect("collects"),
        0,
        "a tombstone still refers to it"
    );
    assert!(store.snapshot().keys().filter(|n| n.starts_with("c/")).count() >= 3);
}
