//! The vault's tests: unlocking, the header's checks and generation, devices, and pairing codes.

use super::*;
use crate::backend::MemoryBackend;
use crate::crypto::QUICK;

const PASS: &str = "correct horse battery";

#[test]
fn a_vault_opens_with_its_passphrase_or_recovery_key_and_nothing_else() {
    let store = MemoryBackend::new();
    let (keys, recovery) = create_with(&store, PASS, QUICK).expect("creates");
    assert_eq!(recovery.text().split('-').count(), 13);
    let again = unlock_passphrase(&store, PASS).expect("unlocks");
    assert_eq!(again.fingerprint(), keys.fingerprint());
    let typed = recovery.text().to_lowercase().replace('-', " ");
    assert_eq!(
        unlock_recovery(&store, &typed).expect("recovers").fingerprint(),
        keys.fingerprint()
    );
    assert_eq!(
        unlock_passphrase(&store, "correct horse battery!").unwrap_err(),
        SyncError::WrongSecret
    );
    assert_eq!(unlock_passphrase(&store, "").unwrap_err(), SyncError::WrongSecret);
    let mut wrong = recovery.text().to_owned();
    wrong.replace_range(0..1, if wrong.starts_with('0') { "1" } else { "0" });
    assert_eq!(unlock_recovery(&store, &wrong).unwrap_err(), SyncError::WrongSecret);
    assert_eq!(
        unlock_recovery(&store, "not a key").unwrap_err(),
        SyncError::WrongSecret
    );
    assert_eq!(create_with(&store, PASS, QUICK).unwrap_err(), SyncError::VaultExists);
    assert_eq!(
        create_with(&MemoryBackend::new(), "short", QUICK).unwrap_err(),
        SyncError::WeakPassphrase(10)
    );
    assert_eq!(
        unlock_passphrase(&MemoryBackend::new(), PASS).unwrap_err(),
        SyncError::NoVault
    );
}

#[test]
fn every_byte_of_the_vault_header_is_covered() {
    let store = MemoryBackend::new();
    create_with(&store, PASS, QUICK).expect("creates");
    let good = store.get("vault").expect("get").expect("vault");
    assert_eq!(good.len(), FIXED + SEAL_MAC, "a new vault lists no devices");
    for at in 0..good.len() {
        let mut bad = good.clone();
        bad[at] ^= 0x01;
        store.set_raw("vault", bad);
        let result = unlock_passphrase(&store, PASS);
        assert!(result.is_err(), "byte {at} was not covered");
    }
    store.set_raw("vault", good[..good.len() - 1].to_vec());
    assert_eq!(unlock_passphrase(&store, PASS).unwrap_err(), SyncError::WrongSecret);
    let mut newer = good.clone();
    newer[8..12].copy_from_slice(&2u32.to_be_bytes());
    store.set_raw("vault", newer);
    assert_eq!(unlock_passphrase(&store, PASS).unwrap_err(), SyncError::Newer);
}

#[test]
fn a_changed_slot_shows_on_a_device_or_pairing_unlock_too() {
    let store = MemoryBackend::new();
    let (keys, _) = create_with(&store, PASS, QUICK).expect("creates");
    let (tag, secret) = new_device().expect("device");
    add_device(&store, &keys, &tag, &secret, "Laptop", 1).expect("adds");
    let good = store.get("vault").expect("get").expect("vault");
    // Someone without the key swaps in their own recovery slot, or a cheaper cost.
    let mut slot = good.clone();
    slot[PREFIX + SLOT + 3] ^= 0x10;
    let mut cost = good.clone();
    cost[32..36].copy_from_slice(&2u32.to_be_bytes());
    for bad in [slot, cost] {
        let code = create_pairing(&store, &keys, 1).expect("pairs");
        store.set_raw("vault", bad);
        assert!(
            matches!(unlock_device(&store, &tag, &secret), Err(SyncError::Tampered(_))),
            "the background unlock notices"
        );
        assert!(matches!(
            join_with_code(&store, code.text(), 2),
            Err(SyncError::Tampered(_))
        ));
    }
    store.set_raw("vault", good);
    assert_eq!(
        unlock_device(&store, &tag, &secret).expect("unlocks").fingerprint(),
        keys.fingerprint()
    );
}

#[test]
fn a_vault_that_asks_for_a_cheaper_passphrase_check_is_refused() {
    assert!(COST.checkable(false) && COST.checkable(true));
    assert!(!QUICK.checkable(false) && QUICK.checkable(true));
    assert!(!Cost { passes: 1, ..COST }.checkable(false));
    assert!(!Cost { lanes: 4, ..COST }.checkable(false));
    let store = MemoryBackend::new();
    create_with(&store, PASS, QUICK).expect("creates");
    assert!(matches!(
        unlock_passphrase_at(&store, PASS, false),
        Err(SyncError::Tampered(_))
    ));
    assert!(unlock_passphrase_at(&store, PASS, true).is_ok());
}

#[test]
fn a_vault_that_asks_for_a_dearer_passphrase_check_is_refused_before_deriving() {
    let store = MemoryBackend::new();
    create_with(&store, PASS, QUICK).expect("creates");
    let mut bytes = store.get("vault").expect("get").expect("vault");
    // The cost sits after the magic, version, and ID: memory, passes, lanes, big-endian. The most allowed() takes.
    for (at, value) in [(28, 256 * 1024u32), (32, 10), (36, 4)] {
        bytes[at..at + 4].copy_from_slice(&value.to_be_bytes());
    }
    store.set_raw("vault", bytes);
    for quick in [false, true] {
        let started = std::time::Instant::now();
        assert!(matches!(
            unlock_passphrase_at(&store, PASS, quick),
            Err(SyncError::Tampered(_))
        ));
        // 256 MiB over 10 passes takes seconds; a refusal before deriving takes none.
        assert!(
            started.elapsed() < std::time::Duration::from_millis(500),
            "refused at once"
        );
    }
}

#[test]
fn devices_join_with_their_own_slot_and_can_be_removed() {
    let store = MemoryBackend::new();
    let (keys, _) = create_with(&store, PASS, QUICK).expect("creates");
    let (tag, secret) = new_device().expect("device");
    add_device(&store, &keys, &tag, &secret, "Surface Laptop", 1_000).expect("adds");
    let (other, other_secret) = new_device().expect("device");
    add_device(&store, &keys, &other, &other_secret, "Desktop", 2_000).expect("adds");
    assert_eq!(
        unlock_device(&store, &tag, &secret).expect("unlocks").fingerprint(),
        keys.fingerprint()
    );
    assert_eq!(
        unlock_device(&store, &tag, &other_secret).unwrap_err(),
        SyncError::WrongSecret
    );
    let names: Vec<_> = list_devices(&store, &keys)
        .expect("lists")
        .into_iter()
        .map(|d| d.name)
        .collect();
    assert_eq!(names, ["Surface Laptop", "Desktop"]);
    // A slot copied to another device's name doesn't open there.
    let slot = store.get(&format!("k/{tag}")).expect("get").expect("slot");
    store.set_raw(&format!("k/{other}"), slot);
    assert_eq!(
        unlock_device(&store, &other, &secret).unwrap_err(),
        SyncError::WrongSecret
    );
    remove_device(&store, &keys, &tag, 3_000).expect("removes");
    assert!(is_removed(&store, &keys, &tag).expect("checks"));
    assert_eq!(unlock_device(&store, &tag, &secret).unwrap_err(), SyncError::Removed);
    assert_eq!(
        list_devices(&store, &keys).expect("lists").len(),
        0,
        "the copied slot doesn't open as a device"
    );
}

#[test]
fn a_pairing_code_works_once_and_only_for_a_day() {
    let store = MemoryBackend::new();
    let (keys, _) = create_with(&store, PASS, QUICK).expect("creates");
    let code = create_pairing(&store, &keys, 0).expect("pairs");
    assert_eq!(code.text().len(), 24 + 5);
    assert!(!code.qr_rows().is_empty());
    let joined = join_with_code(&store, &format!("opennote-sync:{}", code.text().to_lowercase()), 1).expect("joins");
    assert_eq!(joined.fingerprint(), keys.fingerprint());
    assert_eq!(
        join_with_code(&store, code.text(), 2).unwrap_err(),
        SyncError::PairingExpired,
        "used up"
    );
    let unused = create_pairing(&store, &keys, 0).expect("pairs");
    cancel_pairing(&store, &unused).expect("cancels");
    assert_eq!(
        join_with_code(&store, unused.text(), 1).unwrap_err(),
        SyncError::PairingExpired,
        "withdrawn"
    );
    let late = create_pairing(&store, &keys, 0).expect("pairs");
    assert_eq!(
        join_with_code(&store, late.text(), PAIRING_MS + 1).unwrap_err(),
        SyncError::PairingExpired
    );
    assert_eq!(
        join_with_code(&store, "AAAA-BBBB", 0).unwrap_err(),
        SyncError::WrongSecret
    );
    let mut fresh = create_pairing(&store, &keys, 0).expect("pairs").text().to_owned();
    fresh.replace_range(0..1, if fresh.starts_with('0') { "1" } else { "0" });
    assert_eq!(
        join_with_code(&store, &fresh, 0).unwrap_err(),
        SyncError::PairingExpired,
        "a wrong code finds no slot"
    );
}

#[test]
fn every_change_counts_the_generation_up_and_the_list_decides_who_unlocks() {
    let store = MemoryBackend::new();
    let (keys, recovery) = create_with(&store, PASS, QUICK).expect("creates");
    let gen = |s: &MemoryBackend| status(s, &keys).expect("status").generation;
    assert_eq!(gen(&store), 1);
    let (a, a_secret) = new_device().expect("device");
    let (b, b_secret) = new_device().expect("device");
    add_device(&store, &keys, &a, &a_secret, "A", 1).expect("adds");
    add_device(&store, &keys, &b, &b_secret, "B", 2).expect("adds");
    assert_eq!(gen(&store), 3);
    assert_eq!(unlock_device(&store, &a, &a_secret).expect("unlocks").generation(), 3);
    let before_removal = store.snapshot();
    remove_device(&store, &keys, &b, 3).expect("removes");
    assert_eq!(gen(&store), 4);
    // Storage puts the removed device's slot back and takes the note away: the list still leaves it out.
    let slot = format!("k/{b}");
    store.set_raw(&slot, before_removal[&slot].clone());
    store.remove_raw(&format!("x/{b}"));
    assert_eq!(unlock_device(&store, &b, &b_secret).unwrap_err(), SyncError::Removed);
    assert_eq!(list_devices(&store, &keys).expect("lists").len(), 1);
    change_passphrase(&store, &keys, recovery.text(), "a new passphrase").expect("changes");
    assert_eq!(gen(&store), 5);
    // An old header opens with the old passphrase, but shows its lower generation.
    store.set_raw("vault", before_removal["vault"].clone());
    assert_eq!(unlock_passphrase(&store, PASS).expect("opens").generation(), 3);
    assert_eq!(gen(&store), 3);
    // A device tag storage can't name is refused.
    assert!(matches!(
        add_device(&store, &keys, "Laptop", &a_secret, "x", 4),
        Err(SyncError::Local(_))
    ));
}

#[test]
fn a_header_change_lost_to_another_writer_is_made_again() {
    // Storage that, once, puts back the header it held before a write, as a racing device's write would.
    struct Racing {
        inner: MemoryBackend,
        lose: std::sync::atomic::AtomicBool,
    }
    impl Backend for Racing {
        fn get(&self, name: &str) -> Result<Option<Vec<u8>>> {
            self.inner.get(name)
        }
        fn put(&self, name: &str, bytes: &[u8]) -> Result<()> {
            let old = self.inner.get(name)?;
            self.inner.put(name, bytes)?;
            if name == "vault" && self.lose.swap(false, std::sync::atomic::Ordering::SeqCst) {
                self.inner.put(name, &old.expect("a header"))?;
            }
            Ok(())
        }
        fn exists(&self, name: &str) -> Result<bool> {
            self.inner.exists(name)
        }
        fn list(&self, prefix: &str) -> Result<Vec<String>> {
            self.inner.list(prefix)
        }
        fn delete(&self, name: &str) -> Result<()> {
            self.inner.delete(name)
        }
    }
    let store = Racing {
        inner: MemoryBackend::new(),
        lose: false.into(),
    };
    let (keys, _) = create_with(&store, PASS, QUICK).expect("creates");
    let (tag, secret) = new_device().expect("device");
    store.lose.store(true, std::sync::atomic::Ordering::SeqCst);
    add_device(&store, &keys, &tag, &secret, "A", 1).expect("adds");
    assert!(
        !store.lose.load(std::sync::atomic::Ordering::SeqCst),
        "the race happened"
    );
    assert!(unlock_device(&store, &tag, &secret).is_ok());
}

#[test]
fn changing_the_passphrase_needs_the_recovery_key_and_keeps_it() {
    let store = MemoryBackend::new();
    let (keys, recovery) = create_with(&store, PASS, QUICK).expect("creates");
    assert_eq!(
        change_passphrase(&store, &keys, recovery.text(), "short").unwrap_err(),
        SyncError::WeakPassphrase(10)
    );
    let (_, other) = create_with(&MemoryBackend::new(), PASS, QUICK).expect("creates");
    assert_eq!(
        change_passphrase(&store, &keys, other.text(), "a new passphrase").unwrap_err(),
        SyncError::WrongSecret
    );
    change_passphrase(&store, &keys, recovery.text(), "a new passphrase").expect("changes");
    assert_eq!(unlock_passphrase(&store, PASS).unwrap_err(), SyncError::WrongSecret);
    assert!(unlock_passphrase(&store, "a new passphrase").is_ok());
    assert!(unlock_recovery(&store, recovery.text()).is_ok());
}

#[test]
fn the_pairing_time_and_the_fingerprint_are_keyed_by_their_own_subkeys_not_the_root() {
    let store = MemoryBackend::new();
    let (keys, _) = create_with(&store, PASS, QUICK).expect("creates");
    let root = keys.root.as_ref();

    let subkey = derive(root, "fingerprint", &keys.id);
    let expected = base32(&mac(subkey.as_ref(), &[&keys.id])[..5], 4).to_string();
    let rooted = base32(&mac(root, &[b"fingerprint", &keys.id])[..5], 4).to_string();
    assert_eq!(keys.fingerprint(), expected);
    assert_ne!(keys.fingerprint(), rooted);

    let made = 1_700_000_000_000i64;
    let code = create_pairing(&store, &keys, made).expect("pairs");
    let slot = store.get(&code.1).expect("reads").expect("slot");
    assert_eq!(&slot[..8], &made.to_le_bytes());
    let subkey = derive(root, "pairing-made", &keys.id);
    let at = made.to_le_bytes();
    assert_eq!(&slot[8..MADE], &mac(subkey.as_ref(), &[code.1.as_bytes(), &at]));
    assert_ne!(&slot[8..MADE], &mac(root, &[b"pairing-made", code.1.as_bytes(), &at]));
    assert_eq!(slot_made(&keys, &code.1, &slot), Some(made));
    join_with_code(&store, code.text(), made + 1).expect("a code made under the subkey still joins");
}
