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
    let block: opennote_core::ops::resolve::NewBlock = serde_json::from_value(json!({
        "id": "01k6f00000000000000000b001", "type": "text", "data": { "markdown": markdown }
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

/// A notebook with a section and a page in `notes`; returns the page's ID.
fn a_page(bridge: &CoreBridge, notes: &Path) -> String {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>| {
                let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
            };
            let notebook = create(bridge, "notebook", None)?;
            let section = create(bridge, "section", Some(notebook))?;
            create(bridge, "page", Some(section))
        })
        .expect("a page")
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

/// F3-3: a page window that closed went without closing its pages, so its client stayed in the session for good.
#[test]
fn a_window_that_goes_closes_the_page_sessions_it_left_open_and_no_others() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let main = bridge.windows().current("main");
    let first = bridge.windows().current("page-x");
    bridge
        .notes(Some(notes.clone()), |inner| {
            inner.handle_in(&page, "main-1", &main, bridge.windows())?;
            inner.handle_in(&page, "wabc12345-1", &first, bridge.windows())?;
            Ok(())
        })
        .expect("the bridge");
    let gone = bridge.window_went("page-x");
    assert_eq!(gone, first);
    // The same page opens in its own window again before the old window's sessions are closed.
    let second = bridge.windows().current("page-x");
    assert_ne!(second, first, "a window opened again with the same label is a new one");
    let late = bridge.notes(Some(notes.clone()), |inner| {
        inner.handle_in(&page, "wabc12345-2", &first, bridge.windows())
    });
    assert_eq!(
        late.map(|_| ()).unwrap_err().code,
        "notFound",
        "an open from the window that went is refused"
    );
    bridge
        .notes(Some(notes.clone()), |inner| {
            inner.handle_in(&page, "wdef67890-1", &second, bridge.windows())?;
            Ok(())
        })
        .expect("the new window opens the page");
    assert_eq!(bridge.close_window(&gone), 1);
    assert_eq!(bridge.close_window(&gone), 0, "it closes each session once");
    let open = bridge
        .notes(Some(notes), |inner| {
            Ok((
                inner.open_handle(&page, "main-1").is_ok(),
                inner.open_handle(&page, "wabc12345-1").is_ok(),
                inner.open_handle(&page, "wabc12345-2").is_ok(),
                inner.open_handle(&page, "wdef67890-1").is_ok(),
            ))
        })
        .expect("the bridge");
    bridge.shutdown();
    assert_eq!(
        open,
        (true, false, false, true),
        "the new window's session outlives the old window's close"
    );
}

/// F3-1: a second window that named a client another window holds was handed that window's session.
#[test]
fn a_client_belongs_to_one_window() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let bridge = CoreBridge::at(dir.path().join("local"));
    let page = a_page(&bridge, &notes);
    let main = bridge.windows().current("main");
    let other = bridge.windows().current("page-x");
    let (again, taken) = bridge
        .notes(Some(notes), |inner| {
            inner.handle_in(&page, "main-1", &main, bridge.windows())?;
            let again = inner.handle_in(&page, "main-1", &main, bridge.windows()).is_ok();
            let taken = inner
                .handle_in(&page, "main-1", &other, bridge.windows())
                .map(|_| ())
                .unwrap_err();
            Ok((again, taken))
        })
        .expect("the bridge");
    assert!(again, "the window that holds the client opens it again");
    assert_eq!(taken.code, "invalid", "{}", taken.message);
    assert_eq!(bridge.close_window(&other), 0, "the session stays with its window");
    assert_eq!(bridge.close_window(&main), 1);
    bridge.shutdown();
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
