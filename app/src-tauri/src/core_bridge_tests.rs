//! Tests of the page commands' plumbing over pages the notes commands made.

use std::fs;

use opennote_core::ops::resolve::{Edit, TxnRequest};
use serde_json::{json, Value};

use super::*;

fn text_of(handle: &PageHandle) -> String {
    let envelope = handle.envelope(None).expect("an envelope");
    let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).expect("decodes");
    let page: Value = serde_json::from_slice(decoded.page_json).expect("page JSON");
    page["blocks"][0]["data"]["markdown"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

fn insert(handle: &PageHandle, seq: u64, markdown: &str) {
    insert_block(handle, seq, "01k6f00000000000000000b001", markdown);
}

/// Inserts a text block whose ID is made from `n`, so a page can take many.
fn insert_block(handle: &PageHandle, seq: u64, id: &str, markdown: &str) {
    let block: opennote_core::ops::resolve::NewBlock = serde_json::from_value(json!({
        "id": id, "type": "text", "data": { "markdown": markdown }
    }))
    .expect("a new block");
    let request = TxnRequest {
        page: handle.id(),
        client: handle.client().clone(),
        client_seq: seq,
        coalesce: None,
        ui: None,
        edits: vec![Edit::InsertBlock {
            block,
            after: None,
            before: None,
        }],
    };
    handle.apply(request).expect("applies");
}

/// The ID of the `n`th block a test inserts.
fn block_id(n: u64) -> String {
    format!("01k6f0000000000000000{n:05}")
}

/// A notebook with a section and a page in `notes`; returns the page's ID.
fn a_page(bridge: &CoreBridge, notes: &Path) -> String {
    pages(bridge, notes, 1).remove(0)
}

/// A notebook with a section and `count` pages in `notes`; returns the pages' IDs.
fn pages(bridge: &CoreBridge, notes: &Path, count: usize) -> Vec<String> {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>| {
                let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
            };
            let notebook = create(bridge, "notebook", None)?;
            let section = create(bridge, "section", Some(notebook))?;
            (0..count)
                .map(|_| create(bridge, "page", Some(section.clone())))
                .collect()
        })
        .expect("pages")
}

#[test]
fn typed_text_survives_a_restart_of_the_core() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Notes"));
    let bridge = CoreBridge::at(local.clone());
    let page = a_page(&bridge, &notes);
    bridge
        .notes(Some(notes.clone()), |bridge| {
            insert(&bridge.handle(&page, "main-1")?, 1, "Cells divide");
            Ok(())
        })
        .expect("the first run");
    bridge.shutdown();
    let again = CoreBridge::at(local);
    let text = again
        .notes(Some(notes), |bridge| Ok(text_of(&bridge.handle(&page, "main-1")?)))
        .expect("the second run");
    again.shutdown();
    assert_eq!(text, "Cells divide");
}

/// A command that holds the core for too long is reported, to the log and to the interface, with its name and
/// for how long; and the interface hears when the core answers again. Beta 4's T2-3 hung with "Saving" in the
/// title bar and nothing in the log, and nobody could tell what the core was doing.
#[test]
fn a_command_that_holds_the_core_too_long_is_reported_and_the_core_answers_again_after() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local")).warning_after(Duration::from_millis(100));
    let heard: Arc<Mutex<Vec<(&'static str, Value)>>> = Arc::default();
    let seen = heard.clone();
    bridge.listen(Box::new(move |name, payload| {
        seen.lock().expect("the events").push((name, payload));
    }));
    a_page(&bridge, &notes);
    // The first command started the core, which may itself have been reported: the events are looked for
    // after the ones heard so far, by what they say.
    let event = |name: &str, after: usize, what: Option<&str>| -> Option<(usize, Value)> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            let found = heard.lock().expect("the events").iter().enumerate().skip(after).find_map(|(i, (n, p))| {
                (*n == name && what.is_none_or(|what| p["what"] == what)).then(|| (i, p.clone()))
            });
            if found.is_some() {
                return found;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        None
    };
    let mut seen_until = 0;
    let (started, ready) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel::<()>();
    std::thread::scope(|scope| {
        let stuck = &bridge;
        scope.spawn(move || {
            let _ = stuck.with_named("a stuck command", |_| {
                let _ = started.send(());
                let _ = released.recv_timeout(Duration::from_secs(5));
                Ok(())
            });
        });
        ready.recv().expect("the command runs");
        let (at, stalled) =
            event(STALLED_EVENT, 0, Some("a stuck command")).expect("the interface hears that the core stalled");
        seen_until = at + 1;
        assert!(stalled["seconds"].is_u64(), "{stalled}");
        assert!(bridge.holder().starts_with("a stuck command has held it for"), "{}", bridge.holder());
        let _ = release.send(());
    });
    event(RESPONSIVE_EVENT, seen_until, None).expect("the interface hears that the core answers again");
    assert_eq!(bridge.holder(), "nothing holds it now");
    bridge.with_named("a command after it", |_| Ok(())).expect("the core is free");
    bridge.shutdown();
}

/// Every command through `with` is known to the watchdog by where it was called from, so the log names the
/// holder without each caller naming itself.
#[test]
fn the_watchdog_knows_a_command_by_where_it_was_called_from() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let holder = bridge.with(|_| Ok(bridge.holder())).expect("runs");
    assert!(holder.starts_with("the command at core_bridge_tests.rs:"), "{holder}");
    let holder = bridge
        .notes(None, |_| Ok(bridge.holder()))
        .expect("runs");
    assert!(holder.starts_with("the command at core_bridge_tests.rs:"), "{holder}");
    bridge.shutdown();
}

/// Closes a client's session of a page, as `page_close` does.
fn close_page(bridge: &CoreBridge, page: &str, client: &str) {
    bridge
        .with(|bridge| {
            let id = PageId::parse(page).expect("a page ID");
            let client = ClientId::parse(client).expect("a client ID");
            bridge.homes.remove(&(id, client.clone()));
            if let Some(handle) = bridge.open.remove(&(id, client.clone())) {
                handle.close(&client).map_err(internal)?;
            }
            Ok(())
        })
        .expect("closes");
}

/// The lock order of the core, under the load beta 4's T2-3 session had: typing, undo, saves, renames, pages
/// opening and closing, and a page going to Trash and back, all at once with the saver and maintenance threads.
/// A command that waits for another forever would hang this test, so a watchdog of its own ends the process
/// with the holder's name after a minute.
#[test]
fn concurrent_edits_saves_renames_and_closes_never_wait_for_each_other_forever() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let ids = pages(&bridge, &notes, 3);
    let (a, b, c) = (ids[0].clone(), ids[1].clone(), ids[2].clone());
    let open = |page: &str, client: &str| {
        bridge
            .notes(Some(notes.clone()), |bridge| bridge.handle(page, client))
            .expect("opens")
    };
    let typing = open(&a, "typing");
    let saving = open(&a, "saving");
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let (done, bridge) = (done.clone(), bridge.clone());
        std::thread::spawn(move || {
            for _ in 0..60 {
                std::thread::sleep(Duration::from_secs(1));
                if done.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
            }
            eprintln!("The core deadlocked: {}", bridge.holder());
            std::process::abort();
        });
    }
    let until = std::time::Instant::now() + Duration::from_millis(1500);
    let running = || std::time::Instant::now() < until;
    std::thread::scope(|scope| {
        scope.spawn(|| {
            let (mut seq, mut n) = (0, 0);
            while running() {
                seq += 1;
                n += 1;
                insert_block(&typing, seq, &block_id(n), "typed");
                if n % 3 == 0 {
                    typing.undo(typing.client()).expect("undoes");
                }
            }
        });
        scope.spawn(|| {
            while running() {
                saving.save_now().expect("saves");
            }
        });
        scope.spawn(|| {
            let mut n = 0;
            while running() {
                n += 1;
                let title = format!("Title {n}");
                bridge
                    .notes(Some(notes.clone()), |bridge| {
                        bridge.dispatch("notes_rename", &json!({ "id": a, "title": title }))
                    })
                    .expect("renames");
            }
        });
        scope.spawn(|| {
            let mut n = 1_000;
            while running() {
                n += 1;
                let handle = open(&b, "window");
                insert_block(&handle, 1, &block_id(n), "in a window");
                close_page(&bridge, &b, "window");
            }
        });
        scope.spawn(|| {
            while running() {
                let receipt = bridge
                    .notes(Some(notes.clone()), |bridge| {
                        bridge.dispatch("notes_trash", &json!({ "ids": [c] }))
                    })
                    .expect("trashes");
                let receipt = receipt["id"].as_str().unwrap_or_default().to_owned();
                bridge
                    .notes(Some(notes.clone()), |bridge| {
                        bridge.dispatch("notes_restore", &json!({ "receiptId": receipt }))
                    })
                    .expect("restores");
            }
        });
    });
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    close_page(&bridge, &a, "typing");
    close_page(&bridge, &a, "saving");
    bridge.shutdown();
}

/// A command behind one that never returns fails as busy after its wait, naming the holder, instead of joining
/// the queue: the webview's IPC channel carries only a few commands at once, so a queue of them froze every
/// command, Close and the log included (beta 4's T2-3). The core serves the next command once the holder returns.
#[test]
fn a_command_gives_up_on_a_held_core_and_names_the_holder() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local")).waiting_at_most(Duration::from_millis(100));
    a_page(&bridge, &notes);
    let (started, ready) = std::sync::mpsc::channel();
    let (release, released) = std::sync::mpsc::channel::<()>();
    std::thread::scope(|scope| {
        let stuck = &bridge;
        scope.spawn(move || {
            let _ = stuck.with_named("a stuck command", |_| {
                let _ = started.send(());
                let _ = released.recv_timeout(Duration::from_secs(5));
                Ok(())
            });
        });
        ready.recv().expect("the command runs");
        let at = std::time::Instant::now();
        let error = bridge
            .with_named("the next command", |_| Ok(()))
            .expect_err("the next command gives up");
        assert!(at.elapsed() < Duration::from_secs(2), "it waited {:?}", at.elapsed());
        assert_eq!(error.code, BUSY);
        assert!(error.message.contains("a stuck command"), "the message names the holder: {}", error.message);
        release.send(()).expect("the holder is released");
    });
    bridge
        .with_named("after", |_| Ok(()))
        .expect("the core answers once the holder returns");
    bridge.shutdown();
}

#[test]
fn the_exit_gives_up_on_a_command_that_holds_the_core_too_long() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    a_page(&bridge, &notes);
    let (started, ready) = std::sync::mpsc::channel();
    let took = std::thread::scope(|scope| {
        scope.spawn(|| {
            let _ = bridge.with_named("a stuck command", |_| {
                let _ = started.send(());
                std::thread::sleep(Duration::from_millis(900));
                Ok(())
            });
        });
        ready.recv().expect("the command runs");
        let at = std::time::Instant::now();
        bridge.shutdown_within(Duration::from_millis(150));
        at.elapsed()
    });
    assert!(took < Duration::from_millis(800), "the exit waited {took:?} for the command");
    assert!(
        bridge.held.lock().expect("the holder").is_none(),
        "the holder is cleared once the command returns"
    );
    bridge.shutdown();
}

#[test]
fn only_pages_of_open_notebooks_open_and_page_ids_are_checked() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let (unknown, unopened, opened) = bridge
        .notes(Some(notes), |bridge| {
            let unknown = bridge
                .handle("01k6f00000000000000000p001", "main-1")
                .map(|_| ())
                .unwrap_err();
            let unopened = bridge.open_handle(&page, "main-1").map(|_| ()).unwrap_err();
            bridge.handle(&page, "main-1")?;
            Ok((unknown, unopened, bridge.open_handle(&page, "main-1").is_ok()))
        })
        .expect("the bridge");
    bridge.shutdown();
    assert_eq!(unknown.code, "notFound");
    assert_eq!(unopened.code, "notFound");
    assert!(opened);
    for bad in ["", "a/b", "..", "p 1", "..\\..\\x", &"p".repeat(MAX_PAGE_ID + 1)] {
        assert_eq!(check_page(bad).expect_err(bad).code, codes::INVALID);
    }
    assert!(check_page("01k6f00000000000000000p001").is_ok());
    assert_eq!(core_error(CoreError::NotFound("version".into())).code, "notFound");
}

#[test]
fn a_page_moved_to_trash_loses_its_open_session() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    bridge
        .notes(Some(notes.clone()), |bridge| {
            bridge.handle(&page, "main-1")?;
            bridge.dispatch("notes_trash", &json!({ "ids": [page] }))
        })
        .expect("the bridge");
    let still_open = bridge
        .notes(Some(notes), |bridge| Ok(bridge.open_handle(&page, "main-1").is_ok()))
        .expect("the bridge");
    bridge.shutdown();
    assert!(!still_open);
}

#[test]
fn a_beta_one_profile_keeps_its_core_data_under_core() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let old = dir.path().join("phase4").join("core");
    fs::create_dir_all(&old).expect("the old data folder");
    fs::write(old.join("marker"), "kept").expect("a file");
    assert_eq!(data_dir(dir.path()), dir.path().join("core"));
    assert_eq!(
        fs::read_to_string(dir.path().join("core").join("marker")).expect("moved"),
        "kept"
    );
    assert!(!old.exists());
}

/// Phase 9 keeps a recording's entry in the page's view, because the core can't edit a block of a type it doesn't
/// know, and the time stamps of typed text in the data of a text block. Both must come back after a restart.
#[test]
fn a_recording_entry_and_text_marks_survive_a_restart() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Notes"));
    let edits = |value: Value| -> Vec<Edit> { serde_json::from_value(value).expect("edits") };
    let apply = |handle: &PageHandle, seq: u64, edits: Vec<Edit>| {
        let request = TxnRequest {
            page: handle.id(),
            client: handle.client().clone(),
            client_seq: seq,
            coalesce: None,
            ui: None,
            edits,
        };
        handle.apply(request).expect("applies");
    };
    let bridge = CoreBridge::at(local.clone());
    let page = a_page(&bridge, &notes);
    bridge
        .notes(Some(notes.clone()), |bridge| {
            let handle = bridge.handle(&page, "main-1")?;
            insert(&handle, 1, "Osmosis");
            let entry = json!({ "id": "r1", "state": "recording", "flags": [{ "id": "f" }], "tracks": [] });
            apply(
                &handle,
                2,
                edits(json!([
                    { "edit": "insertBlock", "after": "01k6f00000000000000000b001", "block": {
                        "id": "01k6f00000000000000000b002", "type": "ext:org.opennote/recording",
                        "data": { "recording": "r1" }, "fallback": { "markdown": "Audio recording" } } },
                    { "edit": "setPage", "view": { "recordings": { "r1": entry } } }
                ])),
            );
            let done = json!({ "id": "r1", "state": "complete", "flags": null, "tracks": [] });
            let marks = json!({ "recordings": ["r1"], "marks": [{
                "from": 1, "to": 8, "recording": 0, "startNs": 5, "endNs": 9
            }] });
            apply(
                &handle,
                3,
                edits(json!([
                    { "edit": "setPage", "view": { "recordings": { "r1": done } } },
                    { "edit": "patchBlock", "block": "01k6f00000000000000000b001", "data": { "marks": marks } }
                ])),
            );
            Ok(())
        })
        .expect("the first run");
    bridge.shutdown();
    let again = CoreBridge::at(local);
    let page_json = again
        .notes(Some(notes), |bridge| {
            let envelope = bridge.handle(&page, "main-1")?.envelope(None).map_err(internal)?;
            let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).map_err(internal)?;
            serde_json::from_slice::<Value>(decoded.page_json).map_err(internal)
        })
        .expect("the second run");
    again.shutdown();
    let blocks = &page_json["blocks"];
    assert_eq!(blocks[0]["data"]["markdown"], "Osmosis");
    assert_eq!(blocks[0]["data"]["marks"]["marks"][0]["startNs"], 5);
    assert_eq!(blocks[1]["type"], "ext:org.opennote/recording");
    assert_eq!(blocks[1]["data"]["recording"], "r1");
    assert_eq!(page_json["view"]["recordings"]["r1"]["state"], "complete");
    assert!(
        page_json["view"]["recordings"]["r1"].get("flags").is_none(),
        "null removes a member"
    );
}
