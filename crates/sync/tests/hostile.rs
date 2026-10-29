//! Storage that a person or another program changed by hand: names no device wrote and stale pairing codes. Sync
//! says so and stops, and never panics or counts from a number it can't trust.

mod common;

use std::fs;
use std::sync::Arc;

use common::*;
use opennote_sync::vault::{self, PAIRING_MS};
use opennote_sync::{Backend, FolderBackend, MemoryBackend, SyncError};

fn heads_of(backend: &dyn Backend, tag: &str) -> Vec<String> {
    let mut names = backend.list(&format!("h/{tag}/")).expect("lists");
    names.sort();
    names
}

/// The name of a device's newest head, by number.
fn newest_head(backend: &dyn Backend, tag: &str) -> String {
    heads_of(backend, tag)
        .into_iter()
        .max_by_key(|name| name.rsplit('/').next().and_then(|n| n.parse::<u64>().ok()))
        .expect("the device has heads")
}

fn is_impossible(result: Result<impl std::fmt::Debug, SyncError>) -> bool {
    matches!(result, Err(SyncError::Tampered(ref m)) if m.contains("impossible number"))
}

#[test]
fn a_head_name_with_an_impossible_number_stops_sync_without_writing_a_head() {
    let dir = tempfile::tempdir().expect("temp");
    let folder = Arc::new(FolderBackend::new(dir.path().join("storage")).expect("folder"));
    let backend: Arc<dyn Backend> = folder.clone();
    let d = devices(backend.clone(), 2);
    d[0].write("Bio/todo.txt", b"from the laptop");
    settle(&d, 3);
    let before = heads_of(backend.as_ref(), &d[0].tag);
    assert!(!before.is_empty(), "the laptop wrote a head");
    let now = i64::MAX / 2;
    // u64::MAX, one past the highest this app writes, and zero: no device wrote any of them.
    for (tag, number) in [
        (d[0].tag.as_str(), u64::MAX.to_string()),
        (d[0].tag.as_str(), ((1u64 << 53) + 1).to_string()),
        (d[1].tag.as_str(), "0".to_owned()),
    ] {
        let planted = dir.path().join("storage").join("h").join(tag).join(&number);
        fs::write(&planted, b"").expect("plants");
        for device in &d {
            assert!(is_impossible(device.engine.sync()), "sync stops at {number}");
            assert!(
                is_impossible(device.engine.trust_storage()),
                "trusting stops at {number}"
            );
            assert!(
                is_impossible(device.engine.collect_garbage(now)),
                "cleanup stops at {number}"
            );
            assert!(is_impossible(opennote_sync::last_published(
                backend.as_ref(),
                device.engine.keys()
            )));
        }
        fs::remove_file(&planted).expect("removes");
        assert_eq!(
            heads_of(backend.as_ref(), &d[0].tag),
            before,
            "no head was written or pruned"
        );
        assert!(backend.get(&format!("h/{}/0", d[0].tag)).expect("gets").is_none());
    }
    // The highest number this app writes is a name it can read, but counting on from it would pass the limit.
    let top = dir
        .path()
        .join("storage")
        .join("h")
        .join(&d[0].tag)
        .join((1u64 << 53).to_string());
    fs::write(&top, b"").expect("plants");
    assert!(is_impossible(d[0].engine.trust_storage()));
    assert!(matches!(d[0].engine.sync(), Err(SyncError::Tampered(_))));
    fs::remove_file(&top).expect("removes");
    assert_eq!(heads_of(backend.as_ref(), &d[0].tag), before);
    // Cleaned up by hand, sync carries on, and the desktop gets the laptop's next edit.
    d[0].write("Bio/todo.txt", b"after the cleanup");
    settle(&d, 3);
    assert_eq!(d[1].read("Bio/todo.txt").as_deref(), Some(&b"after the cleanup"[..]));
}

#[test]
fn a_pairing_code_past_its_day_by_the_storage_clock_is_refused_even_on_a_slow_clock() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 1);
    let real = now();
    // Made before any head, at the real time; then a head is written two days later.
    let old = vault::create_pairing(backend.as_ref(), d[0].engine.keys(), real).expect("pairs");
    d[0].engine.set_clock_offset(2 * PAIRING_MS);
    d[0].write("Bio/todo.txt", b"a head carries the time it was written");
    settle(&d, 2);
    // The joining device's clock is behind and says a minute after the code was made: refused, and the reason is
    // the clocks, not a typo.
    assert_eq!(
        vault::join_with_code(backend.as_ref(), old.text(), real + 60_000).unwrap_err(),
        SyncError::ClockAhead
    );
    // Right at the end of its day by both clocks, it's an ordinary expired code.
    let edge = vault::create_pairing(backend.as_ref(), d[0].engine.keys(), real).expect("pairs");
    let head_at = newest_head_at(backend.as_ref(), &d);
    assert_eq!(
        vault::join_with_code(backend.as_ref(), edge.text(), head_at + PAIRING_MS + 1).unwrap_err(),
        SyncError::PairingExpired
    );
}

/// A device whose clock is two days ahead wrote the newest head. A code made on a device with the right clock still
/// works for a day from when it was made, on a joining device with the right clock.
#[test]
fn a_device_clock_days_ahead_does_not_expire_new_pairing_codes() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 2);
    d[0].engine.set_clock_offset(2 * PAIRING_MS);
    d[0].write("Bio/todo.txt", b"written on the fast clock");
    settle(&d, 2);
    let real = now();
    assert!(newest_head_at(backend.as_ref(), &d) >= real + 2 * PAIRING_MS - 60_000);
    let code = vault::create_pairing(backend.as_ref(), d[1].engine.keys(), real).expect("pairs");
    let keys = vault::join_with_code(backend.as_ref(), code.text(), real + 60_000).expect("joins");
    assert_eq!(keys.fingerprint(), d[1].engine.keys().fingerprint());
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn newest_head_at(backend: &dyn Backend, d: &[Device]) -> i64 {
    opennote_sync::last_published(backend, d[0].engine.keys())
        .expect("lists")
        .into_values()
        .max()
        .expect("a head")
}

#[test]
fn stale_pairing_slots_are_cleared_by_the_next_round() {
    let store = MemoryBackend::new();
    let backend: Arc<dyn Backend> = Arc::new(store.clone());
    let d = devices(backend.clone(), 1);
    let keys = d[0].engine.keys();
    let _stale = vault::create_pairing(backend.as_ref(), keys, 1_000).expect("pairs");
    let live = vault::create_pairing(backend.as_ref(), keys, i64::MAX / 4).expect("pairs");
    // A slot some other program left: not this app's, so it stays.
    store.set_raw("j/0123456789abcdef", vec![1, 2, 3]);
    assert_eq!(backend.list("j/").expect("lists").len(), 3);
    d[0].write("Bio/todo.txt", b"a round");
    d[0].engine.sync().expect("syncs");
    let mut left = backend.list("j/").expect("lists");
    left.sort();
    assert_eq!(left.len(), 2, "only the stale slot went: {left:?}");
    assert!(left.contains(&"j/0123456789abcdef".to_owned()));
    let joined = vault::join_with_code(backend.as_ref(), live.text(), i64::MAX / 4).expect("joins");
    assert_eq!(joined.fingerprint(), keys.fingerprint());
}

#[test]
fn a_head_withheld_from_one_device_is_a_rollback_once_another_device_merged_it_a_day_ago() {
    let store = Arc::new(MemoryBackend::new());
    let backend: Arc<dyn Backend> = store.clone();
    let d = devices(backend.clone(), 3);
    let (a, b, c) = (&d[0], &d[1], &d[2]);
    b.write("Bio/todo.txt", b"one");
    settle(&d, 3);
    b.write("Bio/todo.txt", b"two");
    b.engine.sync().expect("b publishes");
    c.engine.sync().expect("c merges b's newest head");
    let newest = newest_head(backend.as_ref(), &b.tag);
    assert!(
        heads_of(backend.as_ref(), &c.tag).len() >= 2,
        "c published a head that names b's newest"
    );
    // The storage hides b's newest head from a, but c's head still says it merged it.
    store.remove_raw(&newest);
    // A sync tool may copy c's head before b's, so a carries on for now, with b's last head it can see.
    a.engine.sync().expect("a waits for the head a little while");
    assert_eq!(
        a.read("Bio/todo.txt").as_deref(),
        Some(&b"two"[..]),
        "c's merge brings it"
    );
    a.engine.set_clock_offset(23 * 60 * 60 * 1000);
    a.engine.sync().expect("still within a day");
    a.engine.set_clock_offset(25 * 60 * 60 * 1000);
    assert_eq!(a.engine.sync().unwrap_err(), SyncError::Rollback);
    // Trusting the storage on purpose, as after a restore, clears it.
    a.engine.trust_storage().expect("trusts");
    a.engine.sync().expect("syncs again");
}

#[test]
fn a_device_that_is_only_slow_to_arrive_is_never_a_rollback() {
    let store = Arc::new(MemoryBackend::new());
    let backend: Arc<dyn Backend> = store.clone();
    let d = devices(backend.clone(), 3);
    let (a, b, c) = (&d[0], &d[1], &d[2]);
    b.write("Bio/todo.txt", b"one");
    settle(&d, 3);
    b.write("Bio/todo.txt", b"two");
    b.engine.sync().expect("b publishes");
    c.engine.sync().expect("c merges b's newest head");
    let newest = newest_head(backend.as_ref(), &b.tag);
    let held = store.snapshot()[&newest].clone();
    store.remove_raw(&newest);
    a.engine.sync().expect("a waits for it");
    // It arrives within the day, and a day later nothing is owed.
    store.set_raw(&newest, held);
    a.engine.sync().expect("a reads it");
    a.engine.set_clock_offset(25 * 60 * 60 * 1000);
    a.engine.sync().expect("nothing is withheld");
}
