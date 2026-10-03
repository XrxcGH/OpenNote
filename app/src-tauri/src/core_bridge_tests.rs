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
