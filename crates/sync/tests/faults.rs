//! A crash at every write point, a changed byte in every blob, and a wrong passphrase: sync stops safely, says
//! so, and loses nothing.

mod common;

use std::collections::BTreeSet;
use std::sync::Arc;

use common::*;
use opennote_sync::backend::Faults;
use opennote_sync::{vault, Backend, MemoryBackend, SyncError};

/// Two devices with shared files, then concurrent changes on both. The second device has already synced its own.
fn scenario() -> (MemoryBackend, Vec<Device>) {
    let store = MemoryBackend::new();
    let d = devices(Arc::new(store.clone()), 2);
    let p = page_dir(1);
    d[0].write(&format!("{p}/page.json"), &page(1, "Base", 1, &[], 1_000, &[1]));
    d[0].write(&format!("{p}/{}", segment_name(1)), b"ink");
    d[0].write("Bio/todo.txt", b"base");
    d[0].write("Bio/old.txt", b"to be deleted");
    settle(&d, 2);
    d[0].write(&format!("{p}/page.json"), &page(1, "Laptop edit", 2, &[1], 2_000, &[1]));
    d[0].write("Bio/big.bin", &vec![3u8; 2 * 1024 * 1024 + 7]);
    d[0].remove("Bio/old.txt");
    d[1].write(
        &format!("{p}/page.json"),
        &page(1, "Desktop edit", 3, &[1], 3_000, &[1]),
    );
    d[1].write("Bio/todo.txt", b"desktop todo");
    d[1].engine.sync().expect("syncs");
    (store, d)
}

fn check_outcome(d: &[Device]) {
    let files = d[0].files();
    assert_eq!(files, d[1].files(), "the devices agree");
    let text: BTreeSet<String> = files
        .values()
        .map(|b| String::from_utf8_lossy(b).into_owned())
        .collect();
    for needle in ["Laptop edit", "Desktop edit", "desktop todo"] {
        assert!(text.iter().any(|t| t.contains(needle)), "{needle} survived");
    }
    assert_eq!(files.get("Bio/big.bin").map(Vec::len), Some(2 * 1024 * 1024 + 7));
    assert!(!files.contains_key("Bio/old.txt"));
    assert!(
        !files.keys().any(|k| k.contains(".osync-")),
        "no temporary file is left"
    );
}

#[test]
fn a_crash_at_any_local_write_point_loses_nothing() {
    let mut points = 0;
    loop {
        let (store, mut d) = scenario();
        d[0].engine.fail_after(Some(points));
        let crashed = d[0].engine.sync();
        d[0].restart(Arc::new(store.clone()));
        settle(&d, 4);
        check_outcome(&d);
        if crashed.is_ok() {
            break;
        }
        assert_eq!(crashed.unwrap_err(), SyncError::Interrupted);
        points += 1;
        assert!(points < 100, "the round ends");
    }
    assert!(
        points >= 5,
        "staging, moving, and saving were all interrupted: {points} points"
    );
}

#[test]
fn a_storage_failure_at_any_upload_or_delete_loses_nothing() {
    for deletes in [false, true] {
        let mut budget = 0;
        loop {
            let (store, mut d) = scenario();
            let faults = if deletes {
                Faults {
                    deletes_left: Some(budget),
                    ..Faults::default()
                }
            } else {
                Faults {
                    puts_left: Some(budget),
                    ..Faults::default()
                }
            };
            store.set_faults(faults);
            let crashed = d[0].engine.sync();
            store.set_faults(Faults::default());
            d[0].restart(Arc::new(store.clone()));
            settle(&d, 4);
            check_outcome(&d);
            if crashed.is_ok() {
                break;
            }
            budget += 1;
            assert!(budget < 100);
        }
        if !deletes {
            assert!(budget >= 3, "chunks and the head were each interrupted: {budget}");
        }
    }
}

#[test]
fn an_interrupted_upload_resumes_without_sending_chunks_again() {
    let store = MemoryBackend::new();
    let d = devices(Arc::new(store.clone()), 1);
    for i in 0..6 {
        d[0].write(&format!("Bio/f{i}.bin"), &vec![i as u8; 1024 * 1024]);
    }
    store.set_faults(Faults {
        puts_left: Some(3),
        ..Faults::default()
    });
    assert!(d[0].engine.sync().is_err());
    store.set_faults(Faults::default());
    let before = store.puts();
    let report = d[0].engine.sync().expect("resumes");
    assert_eq!(report.chunks_sent, 3, "only the missing chunks go");
    assert_eq!(store.puts() - before, 4, "three chunks and the head");
}

#[test]
fn a_changed_byte_in_any_blob_stops_sync_and_writes_nothing() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 1);
    d[0].write(
        &format!("{}/page.json", page_dir(1)),
        &page(1, "Notes", 1, &[], 1_000, &[]),
    );
    d[0].write("Bio/big.bin", &vec![4u8; 1024 * 1024 + 3]);
    d[0].engine.sync().expect("syncs");
    let good = store.snapshot();
    let mut checked = 0;
    for (name, bytes) in &good {
        if !(name.starts_with("c/") || name.starts_with("h/")) {
            continue;
        }
        for at in [0, 24, bytes.len() / 2, bytes.len() - 1] {
            let mut bad = bytes.clone();
            bad[at] ^= 0x40;
            store.set_raw(name, bad);
            let fresh = join(backend.clone(), &format!("t{checked}"));
            let error = fresh.engine.sync().expect_err("a changed blob is refused");
            // A damaged chunk is one to ask for again; a damaged head stops sync.
            if name.starts_with("c/") {
                assert_eq!(error, SyncError::Incomplete, "{name} byte {at}");
            } else {
                assert!(matches!(error, SyncError::Tampered(_)), "{name} byte {at}: {error:?}");
            }
            assert!(fresh.files().is_empty(), "nothing was written from {name}");
            store.set_raw(name, bytes.clone());
            for request in store.snapshot().into_keys().filter(|n| n.starts_with("m/")) {
                store.remove_raw(&request);
            }
            vault::remove_device(backend.as_ref(), d[0].engine.keys(), &fresh.tag, 0).expect("tidies");
            store.remove_raw(&format!("x/{}", fresh.tag));
            checked += 1;
        }
    }
    assert!(checked >= 12, "two chunks, a page chunk, and a head: {checked}");

    // A blob moved to another name, and a head under another device's name, fail too.
    let chunks: Vec<_> = good.keys().filter(|n| n.starts_with("c/")).cloned().collect();
    store.set_raw(&chunks[0], good[&chunks[1]].clone());
    let fresh = join(backend.clone(), "swap");
    assert_eq!(fresh.engine.sync().unwrap_err(), SyncError::Incomplete);
    assert!(fresh.files().is_empty(), "the moved chunk's bytes were not used");
    store.set_raw(&chunks[0], good[&chunks[0]].clone());
    let head = good.keys().find(|n| n.starts_with("h/")).expect("head").clone();
    store.set_raw("h/ffffffffffffffff/1", good[&head].clone());
    let fresh = join(backend.clone(), "imposter");
    assert!(matches!(fresh.engine.sync().unwrap_err(), SyncError::Tampered(_)));
}

#[test]
fn a_blob_from_another_vault_does_not_open_here() {
    let ours = MemoryBackend::new();
    let theirs = MemoryBackend::new();
    let a = devices(Arc::new(ours.clone()), 2);
    let b = devices(Arc::new(theirs.clone()), 1);
    a[0].write("x.txt", b"ours");
    b[0].write("x.txt", b"theirs");
    a[0].engine.sync().expect("syncs");
    b[0].engine.sync().expect("syncs");
    let foreign = theirs
        .snapshot()
        .into_iter()
        .find(|(n, _)| n.starts_with("h/"))
        .expect("head");
    // Both vaults have a device named d0, so the other vault's head lands on our device's own head.
    ours.set_raw(&foreign.0, foreign.1);
    assert!(matches!(a[1].engine.sync().unwrap_err(), SyncError::Tampered(_)));
    assert_eq!(a[1].read("x.txt"), None, "nothing from the other vault is written");
}

#[test]
fn a_wrong_passphrase_or_device_secret_never_unlocks() {
    let store = MemoryBackend::new();
    let d = devices(Arc::new(store.clone()), 1);
    assert_eq!(
        vault::unlock_passphrase(&store, "correct horse batterY").unwrap_err(),
        SyncError::WrongSecret
    );
    assert_eq!(
        vault::unlock_passphrase(&store, "").unwrap_err(),
        SyncError::WrongSecret
    );
    let (_, stranger) = vault::new_device().expect("device");
    assert_eq!(
        vault::unlock_device(&store, &d[0].tag, &stranger).unwrap_err(),
        SyncError::WrongSecret
    );
    assert_eq!(
        vault::unlock_device(&store, "0000000000000000", &stranger).unwrap_err(),
        SyncError::Removed
    );
}

#[test]
fn hostile_listings_and_paths_never_escape_the_notes_folder() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 2);
    // A device writes files whose names are fine on its system but must not be written here.
    d[0].write("Bio/ok.txt", b"fine");
    d[0].engine.sync().expect("syncs");
    store.set_raw("h/../../escape", b"x".to_vec());
    store.set_raw("c/zz/not-hex", b"x".to_vec());
    d[1].engine.sync().expect("odd names in storage are skipped");
    assert_eq!(d[1].read("Bio/ok.txt").as_deref(), Some(&b"fine"[..]));
    assert!(!d[1].dir.path().join("escape").exists());
}

#[test]
fn crash_then_edit_across_many_vaults_never_drops_text() {
    // A round publishes its head and stops before saving its state. The person then edits the file again before
    // the next round, while the other device edits the published version. Which edit wins a tie depends on the
    // vault's keys, so several vaults are tried.
    for vault in 0..8 {
        let store = MemoryBackend::new();
        let mut d = devices(Arc::new(store.clone()), 2);
        d[0].write("Bio/todo.txt", b"first");
        settle(&d, 2);
        d[0].write("Bio/todo.txt", b"second");
        d[0].write("Bio/new.txt", b"new one");
        d[0].engine.fail_after(Some(0));
        assert_eq!(d[0].engine.sync().unwrap_err(), SyncError::Interrupted, "vault {vault}");
        d[0].restart(Arc::new(store.clone()));
        d[1].engine.sync().expect("syncs");
        assert_eq!(
            d[1].read("Bio/todo.txt").as_deref(),
            Some(&b"second"[..]),
            "the head was published"
        );
        d[1].write("Bio/todo.txt", b"desktop");
        d[1].write("Bio/new.txt", b"desktop new");
        d[1].engine.sync().expect("syncs");
        d[0].write("Bio/todo.txt", b"third");
        d[0].write("Bio/new.txt", b"laptop new");
        settle(&d, 4);
        let files = d[0].files();
        assert_eq!(files, d[1].files(), "vault {vault}: the devices agree");
        let text: BTreeSet<&[u8]> = files.values().map(Vec::as_slice).collect();
        for needle in [&b"third"[..], b"desktop", b"laptop new", b"desktop new"] {
            assert!(
                text.contains(needle),
                "vault {vault}: {} survived in {:?}",
                String::from_utf8_lossy(needle),
                files.keys().collect::<Vec<_>>()
            );
        }
    }
}

/// A chunk storage lost after the head that names it was written: other devices ask for it, and the device that
/// has the file sends it again, so everyone converges instead of waiting forever.
#[test]
fn a_chunk_lost_after_its_head_was_written_is_sent_again() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 2);
    let big: Vec<u8> = (0..(3 * 1024 * 1024 + 7)).map(|i| (i % 251) as u8).collect();
    d[0].write("Bio/scan.bin", &big);
    d[0].engine.sync().expect("syncs");
    let chunks = || -> Vec<String> { store.snapshot().into_keys().filter(|n| n.starts_with("c/")).collect() };
    assert_eq!(chunks().len(), 4, "three whole chunks and the rest");
    let lost = chunks()[1].clone();
    store.remove_raw(&lost);

    // The other device can't finish, and asks.
    assert_eq!(d[1].engine.sync().unwrap_err(), SyncError::Incomplete);
    let requests: Vec<_> = store.snapshot().into_keys().filter(|n| n.starts_with("m/")).collect();
    assert_eq!(requests.len(), 1, "{requests:?}");
    // The device with the file sends it on its next round, and the request goes.
    d[0].engine.sync().expect("syncs");
    assert!(store.snapshot().contains_key(&lost));
    assert!(!store.snapshot().keys().any(|n| n.starts_with("m/")));
    d[1].engine.sync().expect("syncs");
    assert_eq!(d[1].read("Bio/scan.bin").as_deref(), Some(&big[..]));

    // With no one asking, the daily check finds a lost chunk too.
    store.remove_raw(&lost);
    let later = 2 * opennote_sync::engine::CHECK_MS + 1_800_000_000_000;
    assert_eq!(d[0].engine.repair(later).expect("repairs"), 1);
    assert!(store.snapshot().contains_key(&lost));
    assert_eq!(d[0].engine.repair(later + 1).expect("repairs"), 0, "checked once a day");
}

/// A chunk that is there but damaged (a flipped byte from a bad disk, a half-copied file, one too long to be
/// OpenNote's): the other device asks for it, the device that has the file replaces it on its next round, and the
/// other device then gets the file. The expected bytes are the ones written, not anything read back from storage.
#[test]
fn a_damaged_chunk_is_sent_again_by_the_device_that_has_the_file() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 1);
    let big: Vec<u8> = (0..(2 * 1024 * 1024 + 11)).map(|i| (i % 241) as u8).collect();
    d[0].write("Bio/scan.bin", &big);
    d[0].engine.sync().expect("syncs");
    let chunks: Vec<String> = store.snapshot().into_keys().filter(|n| n.starts_with("c/")).collect();
    assert_eq!(chunks.len(), 3, "two whole chunks and the rest");
    let good = store.snapshot()[&chunks[0]].clone();
    let flipped = |b: &[u8]| {
        let mut bad = b.to_vec();
        bad[b.len() / 3] ^= 0x01;
        bad
    };
    let too_long = |b: &[u8]| [b, &vec![0u8; 8 * 1024 * 1024][..]].concat();
    for (round, (what, bad)) in [
        ("a flipped byte", flipped(&good)),
        ("half a file", good[..good.len() / 2].to_vec()),
        ("too long", too_long(&good)),
    ]
    .into_iter()
    .enumerate()
    {
        let other = join(backend.clone(), &format!("o{round}"));
        store.set_raw(&chunks[0], bad.clone());
        assert_eq!(other.engine.sync().unwrap_err(), SyncError::Incomplete, "{what}");
        assert_eq!(
            other.read("Bio/scan.bin"),
            None,
            "{what}: no damaged bytes reach the file"
        );
        let requests: Vec<_> = store.snapshot().into_keys().filter(|n| n.starts_with("m/")).collect();
        assert_eq!(requests.len(), 1, "{what}: {requests:?}");
        d[0].engine.sync().expect("the holder's round syncs");
        assert_ne!(store.snapshot()[&chunks[0]], bad, "{what}: the holder replaced it");
        assert!(
            !store.snapshot().keys().any(|n| n.starts_with("m/")),
            "{what}: the request went"
        );
        other.engine.sync().expect("the other device recovers");
        assert_eq!(other.read("Bio/scan.bin").as_deref(), Some(&big[..]), "{what}");
    }

    // With no one asking, the holder's daily check finds a chunk of the wrong size and replaces it.
    store.set_raw(&chunks[1], store.snapshot()[&chunks[1]][..100].to_vec());
    let later = 2 * opennote_sync::engine::CHECK_MS + 1_900_000_000_000;
    assert_eq!(d[0].engine.repair(later).expect("repairs"), 1);
    let fresh = join(backend.clone(), "late");
    fresh.engine.sync().expect("a new device gets every piece");
    assert_eq!(fresh.read("Bio/scan.bin").as_deref(), Some(&big[..]));
}
