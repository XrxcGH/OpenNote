//! The shell's sync tests: setup, joining, devices, the passphrase, and cleanup, through the one command.

use super::*;
use crate::connectors::MemoryStore;

fn service(dir: &Path) -> SyncService {
    SyncService::with_store(dir.join("sync"), Arc::new(MemoryStore::default()))
}

fn ok(service: &SyncService, notes: Option<&Path>, name: &str, mut args: Value) -> Value {
    service.call(notes.map(Path::to_path_buf), name, &mut args).expect(name)
}

fn code(service: &SyncService, notes: Option<&Path>, name: &str, mut args: Value) -> String {
    service
        .call(notes.map(Path::to_path_buf), name, &mut args)
        .unwrap_err()
        .code
}

/// A laptop that set sync up in a folder and synced a file, and a desktop that joined with a pairing code.
struct Pair {
    dir: tempfile::TempDir,
    laptop: SyncService,
    desktop: SyncService,
    made: Value,
}

impl Pair {
    fn notes(&self, which: &str) -> PathBuf {
        self.dir.path().join(which)
    }
}

fn pair() -> Pair {
    let dir = tempfile::tempdir().expect("temp");
    let backend = json!({ "kind": "folder", "path": dir.path().join("storage").to_string_lossy() });
    let laptop = service(&dir.path().join("laptop"));
    fs::create_dir_all(dir.path().join("notes-a/Bio")).expect("dirs");
    fs::write(dir.path().join("notes-a/Bio/todo.txt"), b"from the laptop").expect("write");
    let off = ok(&laptop, None, "status", Value::Null);
    assert_eq!(
        (off["configured"].clone(), off["status"]["state"].clone()),
        (json!(false), json!("off"))
    );
    let weak = json!({ "backend": backend, "passphrase": "short" });
    assert_eq!(code(&laptop, None, "setUp", weak), "weakPassphrase");
    let setup = json!({ "backend": backend, "passphrase": "correct horse battery", "deviceName": "Laptop" });
    let mut made = ok(&laptop, None, "setUp", setup);
    assert!(made.get("recoveryKey").is_none(), "the key isn't in the view");
    let key = serde_json::to_value(Reply::Secret(laptop.take_recovery().expect("key"))).expect("serializes");
    assert_eq!(key.as_str().expect("text").split('-').count(), 13);
    assert_eq!(
        laptop.take_recovery().err().map(|e| e.code),
        Some(codes::INVALID.to_owned()),
        "the key is given once"
    );
    made["recoveryKey"] = key;
    assert_eq!(made["unfinished"], true);
    assert_eq!(
        code(&laptop, Some(&dir.path().join("notes-a")), "syncNow", Value::Null),
        "paused",
        "nothing syncs until the recovery key is checked"
    );
    assert_eq!(ok(&laptop, None, "finishSetUp", Value::Null)["unfinished"], false);
    let synced = ok(&laptop, Some(&dir.path().join("notes-a")), "syncNow", Value::Null);
    assert_eq!(synced["view"]["status"]["state"], "synced");
    let pairing = ok(&laptop, None, "pairingCode", Value::Null);
    assert!(!pairing["rows"].as_array().expect("rows").is_empty());
    let desktop = service(&dir.path().join("desktop"));
    let join = json!({ "backend": backend, "code": pairing["code"], "deviceName": "Desktop" });
    let joined = ok(&desktop, None, "join", join);
    assert_eq!(joined["fingerprint"], made["fingerprint"]);
    assert!(
        joined.get("recoveryKey").is_none(),
        "only a new sync shows a recovery key"
    );
    Pair {
        dir,
        laptop,
        desktop,
        made,
    }
}

#[test]
fn a_joined_device_previews_then_syncs_through_the_one_command() {
    let p = pair();
    let notes_b = p.notes("notes-b");
    let preview = ok(&p.desktop, Some(&notes_b), "preview", Value::Null);
    assert_eq!(preview["summary"]["download"][0], "Bio/todo.txt");
    assert!(!notes_b.join("Bio/todo.txt").exists(), "a preview changes nothing");
    ok(&p.desktop, Some(&notes_b), "syncNow", Value::Null);
    assert_eq!(
        fs::read(notes_b.join("Bio/todo.txt")).expect("read"),
        b"from the laptop"
    );
    assert!(p.made["fingerprint"].is_string());
    assert_eq!(code(&p.desktop, None, "nonsense", Value::Null), codes::INVALID);
}

#[test]
fn the_passphrase_changes_with_the_recovery_key_and_a_round_cleans_up_once_a_day() {
    let p = pair();
    let backend = json!({ "kind": "folder", "path": p.dir.path().join("storage").to_string_lossy() });
    let recovery = p.made["recoveryKey"].as_str().expect("key").to_owned();
    // A key of the right shape that isn't this vault's.
    let other_key = vec!["0000"; 13].join("-");
    let wrong = json!({ "recoveryKey": other_key, "passphrase": "a brand new passphrase" });
    assert_eq!(code(&p.laptop, None, "changePassphrase", wrong), "wrongSecret");
    let weak = json!({ "recoveryKey": recovery, "passphrase": "short" });
    assert_eq!(code(&p.laptop, None, "changePassphrase", weak), "weakPassphrase");
    let good = json!({ "recoveryKey": recovery, "passphrase": "a brand new passphrase" });
    ok(&p.laptop, None, "changePassphrase", good);
    let old = json!({ "backend": backend, "passphrase": "correct horse battery", "deviceName": "Tablet" });
    let tablet = service(&p.dir.path().join("tablet"));
    assert_eq!(code(&tablet, None, "join", old), "wrongSecret");
    let new = json!({ "backend": backend, "passphrase": "a brand new passphrase", "deviceName": "Tablet" });
    ok(&tablet, None, "join", new);
    // The devices that were already in keep syncing with their own keys.
    ok(&p.desktop, Some(&p.notes("notes-b")), "syncNow", Value::Null);

    let collected = || *p.desktop.inner.collected.lock().expect("lock");
    let first = collected();
    assert!(first > 0, "a finished round ran cleanup");
    ok(&p.desktop, Some(&p.notes("notes-b")), "syncNow", Value::Null);
    assert_eq!(collected(), first, "and not again the same day");
}

#[test]
fn cancelling_setup_before_the_key_is_checked_takes_the_new_vault_away() {
    let dir = tempfile::tempdir().expect("temp");
    let storage = dir.path().join("storage");
    let backend = json!({ "kind": "folder", "path": storage.to_string_lossy() });
    let laptop = service(&dir.path().join("laptop"));
    let setup = json!({ "backend": backend, "passphrase": "correct horse battery", "deviceName": "Laptop" });
    ok(&laptop, None, "setUp", setup.clone());
    assert!(storage.join("vault").exists());
    let off = ok(&laptop, None, "cancelSetUp", Value::Null);
    assert_eq!(off["configured"], false);
    assert!(!storage.join("vault").exists(), "the vault nothing used yet is gone");
    let again = ok(&laptop, None, "setUp", setup);
    assert_eq!(again["unfinished"], true, "setting up again in the same place works");
    ok(&laptop, None, "finishSetUp", Value::Null);
    assert_eq!(code(&laptop, None, "cancelSetUp", Value::Null), codes::INVALID);
}

#[test]
fn devices_are_listed_and_removed_and_pause_and_turn_off_keep_the_notes() {
    let p = pair();
    let notes_b = p.notes("notes-b");
    ok(&p.desktop, Some(&notes_b), "syncNow", Value::Null);
    let devices = ok(&p.desktop, None, "devices", Value::Null);
    let list = devices.as_array().expect("list");
    let mut names: Vec<_> = list
        .iter()
        .map(|d| d["name"].as_str().unwrap_or("").to_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["Desktop", "Laptop"]);
    let row = list.iter().find(|d| d["name"] == "Laptop").expect("laptop");
    assert_eq!(row["thisDevice"], false);
    ok(&p.desktop, None, "removeDevice", json!({ "tag": row["tag"] }));
    assert_eq!(
        code(&p.laptop, Some(&p.notes("notes-a")), "syncNow", Value::Null),
        "removed"
    );
    assert_eq!(ok(&p.laptop, None, "status", Value::Null)["status"]["state"], "error");

    ok(&p.desktop, None, "setPaused", json!({ "paused": true }));
    assert_eq!(code(&p.desktop, Some(&notes_b), "syncNow", Value::Null), "paused");
    assert_eq!(ok(&p.desktop, None, "status", Value::Null)["status"]["state"], "paused");
    ok(&p.desktop, None, "setPaused", json!({ "paused": false }));
    let rows = ok(&p.desktop, None, "devices", Value::Null);
    let me = rows
        .as_array()
        .expect("list")
        .iter()
        .find(|d| d["thisDevice"] == true)
        .expect("this device")
        .clone();
    assert!(me["lastSync"].as_i64().is_some_and(|at| at > 0), "{me}");
    let tag = me["tag"].as_str().expect("tag").to_owned();
    let backend = p
        .desktop
        .open_backend(&p.desktop.config().expect("config").backend, None)
        .expect("backend");
    let keys = vault::unlock_device(backend.as_ref(), &tag, &p.desktop.device_secret().expect("secret")).expect("keys");
    ok(&p.desktop, None, "turnOff", Value::Null);
    assert_eq!(ok(&p.desktop, None, "status", Value::Null)["configured"], false);
    assert!(
        vault::is_removed(backend.as_ref(), &keys, &tag).expect("reads"),
        "turning off takes this device out of the vault, so cleanup elsewhere doesn't wait for it"
    );
    assert!(vault::list_devices(backend.as_ref(), &keys)
        .expect("lists")
        .iter()
        .all(|d| d.tag != tag));
    assert!(
        fs::read(notes_b.join("Bio/todo.txt")).is_ok(),
        "turning off keeps the notes"
    );
}

#[test]
fn secrets_leave_the_call_arguments_before_anything_else_runs() {
    let dir = tempfile::tempdir().expect("temp");
    let service = service(dir.path());
    let mut args = json!({
        "backend": { "kind": "nowhere" },
        "passphrase": "correct horse battery",
        "recoveryKey": "AAAA-BBBB",
        "code": "CCCC-DDDD",
        "password": "server password",
    });
    // Refused for the backend, after the secrets were already moved out.
    let refused = service.call(None, "join", &mut args).unwrap_err();
    assert_eq!(refused.code, codes::INVALID);
    for key in ["passphrase", "recoveryKey", "code", "password"] {
        assert_eq!(args[key], Value::Null, "{key} is no longer in the arguments");
    }
    assert_eq!(args["backend"]["kind"], "nowhere", "the rest stays");
    assert!(service.take_recovery().is_err(), "joining shows no recovery key");
}

#[test]
fn errors_reach_the_interface_as_a_code_and_a_detail_never_as_english() {
    let every = [
        SyncError::WrongSecret,
        SyncError::NoVault,
        SyncError::VaultExists,
        SyncError::Tampered("a head doesn't open".into()),
        SyncError::Rollback,
        SyncError::Incomplete,
        SyncError::Removed,
        SyncError::PairingExpired,
        SyncError::ClockAhead,
        SyncError::Storage("timed out".into()),
        SyncError::Local("permission denied".into()),
        SyncError::WeakPassphrase(10),
        SyncError::Newer,
        SyncError::Interrupted,
    ];
    for error in every {
        let sent = fail(error.clone());
        assert_eq!(
            known_code(&sent.code),
            Some(error.code()),
            "the status knows {}",
            sent.code
        );
        assert!(!error.to_string().is_empty() && !sent.message.contains(&error.to_string()));
    }
    assert_eq!(fail(SyncError::Rollback).message, "");
    assert_eq!(fail(SyncError::Storage("timed out".into())).message, "timed out");
    assert_eq!(fail(SyncError::WeakPassphrase(10)).message, "10");
}
