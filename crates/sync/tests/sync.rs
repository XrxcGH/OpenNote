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
fn two_saves_that_name_each_other_as_ancestors_are_both_kept() {
    // Only a damaged or hostile page.json can do this. It used to mark both older and stop the round.
    let (_, d) = pair();
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "Laptop text", 2, &[3], 2_000, &[]));
    d[1].write(&format!("{p}/page.json"), &page(1, "Desktop text", 3, &[2], 3_000, &[]));
    d[0].engine.sync().expect("syncs");
    let report = d[1].engine.sync().expect("syncs");
    assert_eq!(report.summary.conflicts.len(), 1, "{:?}", report.summary);
    settle(&d, 3);
    assert_eq!(d[0].files(), d[1].files());
    let text: String = d[0]
        .files()
        .iter()
        .filter(|(k, _)| k.starts_with(&p))
        .map(|(_, v)| String::from_utf8_lossy(v).into_owned())
        .collect();
    assert!(text.contains("Laptop text") && text.contains("Desktop text"));
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
    // The code is made at the time on the newest head: older than a day by it, a code no longer works.
    let now = opennote_sync::last_published(backend.as_ref(), d[0].engine.keys()).expect("lists")[&d[0].tag];
    let code = opennote_sync::vault::create_pairing(backend.as_ref(), d[0].engine.keys(), now).expect("pairs");
    let keys = opennote_sync::vault::join_with_code(backend.as_ref(), code.text(), now + 1).expect("joins");
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
fn an_older_vault_header_put_back_is_a_rollback_on_every_device_that_saw_the_newer() {
    let (store, d) = pair();
    d[0].write("Bio/todo.txt", b"one");
    settle(&d, 2);
    let old_header = store.get("vault").expect("get").expect("vault");
    assert_eq!(
        d[0].engine.state().expect("state").vault,
        3,
        "made, then d0 and d1 added"
    );
    // A third device joins and is removed again: two more header changes that everyone sees.
    let late = join(Arc::new(store.clone()), "d2");
    opennote_sync::vault::remove_device(&store, late.engine.keys(), "d2", 1).expect("removes");
    settle(&d, 2);
    assert_eq!(d[1].engine.state().expect("state").vault, 5);
    // Storage puts the old header back, as an old copy of the folder or a hostile server would.
    store.set_raw("vault", old_header);
    for device in &d {
        assert_eq!(device.engine.sync().unwrap_err(), SyncError::Rollback, "{}", device.tag);
    }
    d[0].engine.trust_storage().expect("trusts on purpose");
    d[0].engine.sync().expect("syncs after trusting");
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
    assert_eq!(
        d[0].engine.collect_garbage(8 * day).expect("waits"),
        0,
        "one newer head isn't enough: a round may have been under way at the mark"
    );
    d[1].write("Bio/third.txt", b"y");
    settle(&d, 2);
    assert_eq!(d[0].engine.collect_garbage(8 * day).expect("collects"), 1);
    assert_eq!(chunks(), 3, "the old chunk went, and the two new files' chunks came");
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

const SEALED: &str = "Bio/s1/.sealed";

/// The sealed folders of the section on a device: each folder's manifest bytes and the blob names beside it.
fn sealed_sets(d: &Device) -> Vec<(Vec<u8>, std::collections::BTreeSet<String>)> {
    let mut sets: std::collections::BTreeMap<String, (Vec<u8>, std::collections::BTreeSet<String>)> =
        Default::default();
    for (path, bytes) in d.files() {
        let Some(rest) = path.strip_prefix("Bio/s1/") else {
            continue;
        };
        let Some((folder, name)) = rest.split_once('/') else {
            continue;
        };
        if !folder.starts_with(".sealed") {
            continue;
        }
        let set = sets.entry(folder.to_owned()).or_default();
        if name == "manifest" {
            set.0 = bytes;
        } else {
            set.1.insert(name.to_owned());
        }
    }
    sets.into_values().collect()
}

fn names(list: &[&str]) -> std::collections::BTreeSet<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn sealed_blobs_deleted_by_a_second_reseal_do_not_come_back() {
    let (_, d) = pair();
    d[0].write(&format!("{SEALED}/manifest"), b"sealed manifest one");
    d[0].write(&format!("{SEALED}/aaaa"), b"blob a");
    settle(&d, 2);
    // Each re-seal writes a new blob, a new manifest, and deletes the old blob, as the core does.
    for (round, (manifest, new, old)) in [
        (&b"sealed manifest two"[..], "bbbb", "aaaa"),
        (b"sealed manifest three", "cccc", "bbbb"),
        (b"sealed manifest four", "dddd", "cccc"),
    ]
    .into_iter()
    .enumerate()
    {
        d[0].write(&format!("{SEALED}/{new}"), format!("blob {round}").as_bytes());
        d[0].write(&format!("{SEALED}/manifest"), manifest);
        d[0].remove(&format!("{SEALED}/{old}"));
        settle(&d, 3);
    }
    for device in &d {
        assert_eq!(
            sealed_sets(device),
            vec![(b"sealed manifest four".to_vec(), names(&["dddd"]))],
            "{}: only the newest blob stays",
            device.tag
        );
    }
}

#[test]
fn a_protected_section_changed_on_two_devices_keeps_both_whole() {
    let (_, d) = pair();
    d[0].write(&format!("{SEALED}/manifest"), b"base manifest");
    d[0].write(&format!("{SEALED}/aaaa"), b"blob a");
    settle(&d, 2);
    // The laptop re-seals the one file: a new blob, and the old one goes. The desktop adds a file and keeps it.
    d[0].write(&format!("{SEALED}/bbbb"), b"blob b");
    d[0].write(&format!("{SEALED}/manifest"), b"laptop manifest: bbbb");
    d[0].remove(&format!("{SEALED}/aaaa"));
    d[1].write(&format!("{SEALED}/cccc"), b"blob c");
    d[1].write(&format!("{SEALED}/manifest"), b"desktop manifest: aaaa cccc");
    d[0].engine.sync().expect("syncs");
    let report = d[1].engine.sync().expect("syncs");
    assert_eq!(report.summary.conflicts.len(), 1, "{:?}", report.summary);
    let conflict = &report.summary.conflicts[0];
    assert_eq!(conflict.path, format!("{SEALED}/manifest"));
    assert!(
        conflict.kept_as.starts_with("Bio/s1/.sealed-conflict-") && conflict.kept_as.ends_with("/manifest"),
        "{conflict:?}"
    );
    settle(&d, 4);
    assert_eq!(d[0].files(), d[1].files(), "the devices agree");
    let needs = [
        (b"laptop manifest: bbbb".to_vec(), names(&["bbbb"])),
        (b"desktop manifest: aaaa cccc".to_vec(), names(&["aaaa", "cccc"])),
    ];
    let sets = sealed_sets(&d[0]);
    assert_eq!(
        sets.len(),
        2,
        "the section's sealed files and the other version: {sets:?}"
    );
    for (manifest, blobs) in &needs {
        let (_, has) = sets
            .iter()
            .find(|(m, _)| m == manifest)
            .expect("both versions are kept");
        assert!(has.is_superset(blobs), "{}: {has:?}", String::from_utf8_lossy(manifest));
    }
    assert!(!d[0].files().keys().any(|k| k.contains(".opennote/conflicts")));
    let quiet = d[0].engine.sync().expect("syncs");
    assert!(
        quiet.summary.is_empty() && quiet.generation.is_none(),
        "{:?}",
        quiet.summary
    );
}

/// Storage where another device's garbage collection removes `victim` just before this device writes its head.
struct CollectedMeanwhile {
    inner: MemoryBackend,
    victim: std::sync::Mutex<Option<String>>,
}

impl Backend for CollectedMeanwhile {
    fn get(&self, name: &str) -> opennote_sync::Result<Option<Vec<u8>>> {
        self.inner.get(name)
    }
    fn put(&self, name: &str, bytes: &[u8]) -> opennote_sync::Result<()> {
        if name.starts_with("h/") {
            if let Some(victim) = self.victim.lock().expect("lock").take() {
                self.inner.delete(&victim)?;
            }
        }
        self.inner.put(name, bytes)
    }
    fn exists(&self, name: &str) -> opennote_sync::Result<bool> {
        self.inner.exists(name)
    }
    fn list(&self, prefix: &str) -> opennote_sync::Result<Vec<String>> {
        self.inner.list(prefix)
    }
    fn delete(&self, name: &str) -> opennote_sync::Result<()> {
        self.inner.delete(name)
    }
}

#[test]
fn a_chunk_collected_while_a_round_reused_it_is_sent_again() {
    let store = MemoryBackend::new();
    let shared = Arc::new(CollectedMeanwhile {
        inner: store.clone(),
        victim: std::sync::Mutex::new(None),
    });
    let mut d = devices(shared.clone(), 2);
    d[0].write("Bio/old.txt", b"bytes that come back");
    settle(&d, 2);
    let chunk = store
        .snapshot()
        .keys()
        .find(|n| n.starts_with("c/"))
        .expect("the old file's chunk")
        .clone();
    // Changed, so no head refers to the first bytes any more, and garbage collection may take their chunk.
    d[0].write("Bio/old.txt", b"something else");
    settle(&d, 2);
    // The same bytes come back under a new name: storage still has the chunk, so the round reuses it, and then
    // another device collects it just before this round writes its head.
    d[0].write("Bio/new.txt", b"bytes that come back");
    *shared.victim.lock().expect("lock") = Some(chunk.clone());
    d[0].engine.sync().expect("syncs");
    assert!(store.exists(&chunk).expect("exists"), "the round sent the chunk again");
    d[1].restart(Arc::new(store.clone()));
    d[1].engine.sync().expect("the other device finds everything");
    assert_eq!(d[1].read("Bio/new.txt").as_deref(), Some(&b"bytes that come back"[..]));
}

#[test]
fn a_moved_file_is_copied_from_its_old_place_without_storage() {
    let (store, mut d) = pair();
    let big = vec![9u8; 3 * 1024 * 1024 + 11];
    d[0].write("Bio/assets/recording.webm", &big);
    settle(&d, 2);
    d[0].write("Bio/moved/recording.webm", &big);
    d[0].remove("Bio/assets/recording.webm");
    d[0].engine.sync().expect("syncs");
    // Without the chunks in storage, the only way to the moved file is the copy already on this device.
    for name in store.snapshot().keys().filter(|n| n.starts_with("c/")) {
        store.remove_raw(name);
    }
    d[1].restart(Arc::new(store.clone()));
    d[1].engine.sync().expect("syncs from the local copy");
    assert_eq!(d[1].read("Bio/moved/recording.webm"), Some(big));
    assert_eq!(d[1].read("Bio/assets/recording.webm"), None);
}

#[test]
fn paths_that_differ_only_in_case_end_up_the_same_on_every_device() {
    let (_, d) = pair();
    d[0].write("Bio/Todo.txt", b"upper");
    d[1].write("Bio/todo.txt", b"lower");
    d[0].engine.sync().expect("syncs");
    let report = d[1].engine.sync().expect("syncs");
    assert_eq!(report.summary.conflicts.len(), 1, "{:?}", report.summary);
    assert_eq!(report.summary.conflicts[0].path, "Bio/Todo.txt");
    settle(&d, 4);
    let files = d[0].files();
    assert_eq!(files, d[1].files(), "both devices hold the same files");
    let mut kept: Vec<_> = files.values().map(|b| b.as_slice()).collect();
    kept.sort();
    assert_eq!(kept, [&b"lower"[..], &b"upper"[..]], "neither text was lost");
    assert_eq!(files.get("Bio/Todo.txt").map(Vec::as_slice), Some(&b"upper"[..]));
    assert!(files
        .keys()
        .any(|p| p.starts_with("Bio/todo (conflicted copy ") && p.ends_with(").txt")));
}

#[test]
fn a_tombstone_every_device_took_in_leaves_the_heads_after_the_grace_period() {
    let (store, d) = pair();
    d[0].write("Bio/a.txt", b"gone soon");
    settle(&d, 2);
    d[0].remove("Bio/a.txt");
    settle(&d, 2);
    let has = |dev: &Device| dev.engine.state().expect("state").files.contains_key("Bio/a.txt");
    assert!(has(&d[0]) && has(&d[1]), "both keep the delete");
    let day = 24 * 60 * 60 * 1000;
    for dev in &d {
        dev.engine.collect_garbage(0).expect("marks");
    }
    for n in 0..2 {
        d[0].write(&format!("Bio/x{n}.txt"), b"x");
        d[1].write(&format!("Bio/y{n}.txt"), b"y");
        settle(&d, 2);
    }
    for dev in &d {
        dev.engine.collect_garbage(8 * day).expect("collects");
    }
    settle(&d, 3);
    assert!(!has(&d[0]) && !has(&d[1]), "the delete left both devices");
    // No head names the path any more: a device joining now never hears of it.
    let late = join(Arc::new(store.clone()), "d2");
    late.engine.sync().expect("syncs");
    assert!(!has(&late));
    assert_eq!(late.files().len(), 4);
}

#[test]
fn a_tombstone_stays_while_a_device_has_not_taken_it_in() {
    let (_, d) = pair();
    d[0].write("Bio/a.txt", b"x");
    settle(&d, 2);
    d[0].remove("Bio/a.txt");
    d[0].engine.sync().expect("syncs");
    let day = 24 * 60 * 60 * 1000;
    d[0].engine.collect_garbage(0).expect("marks");
    // The other device is away: it still has the file and hasn't seen the delete.
    for n in 0..3 {
        d[0].write(&format!("Bio/x{n}.txt"), b"x");
        d[0].engine.sync().expect("syncs");
    }
    d[0].engine.collect_garbage(8 * day).expect("collects");
    assert!(d[0].engine.state().expect("state").files.contains_key("Bio/a.txt"));
    settle(&d, 3);
    assert_eq!(d[1].read("Bio/a.txt"), None, "the delete still reaches it");
    assert_eq!(d[0].read("Bio/a.txt"), None, "and the file doesn't come back");
}
