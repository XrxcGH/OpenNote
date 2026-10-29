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
    d[0].write("Bio/todo.txt", b"a head carries the time it was written");
    settle(&d, 2);
    let now = opennote_sync::last_published(backend.as_ref(), d[0].engine.keys()).expect("lists")[&d[0].tag];
    // Made two days before the newest head; the joining device's clock is behind and says a minute later.
    let made = now - 2 * PAIRING_MS;
    let old = vault::create_pairing(backend.as_ref(), d[0].engine.keys(), made).expect("pairs");
    assert_eq!(
        vault::join_with_code(backend.as_ref(), old.text(), made + 60_000).unwrap_err(),
        SyncError::PairingExpired
    );
    let fresh = vault::create_pairing(backend.as_ref(), d[0].engine.keys(), now).expect("pairs");
    let keys = vault::join_with_code(backend.as_ref(), fresh.text(), now + 60_000).expect("joins");
    assert_eq!(keys.fingerprint(), d[0].engine.keys().fingerprint());
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
