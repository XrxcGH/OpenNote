//! A notes folder that was moved or renamed while OpenNote was closed.

use std::path::Path;

use serde_json::{json, Value};

use crate::core_bridge::CoreBridge;

fn call(bridge: &CoreBridge, notes: &Path, command: &str, args: Value) -> Value {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| bridge.dispatch(command, &args))
        .unwrap_or_else(|error| panic!("{command}: {error}"))
}

#[test]
fn notebooks_whose_folder_went_away_are_counted_as_missing() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let local = dir.path().join("local");
    let notes = dir.path().join("Documents").join("OpenNote");
    let input = json!({ "kind": "notebook", "title": "Biology", "placement": { "parentId": null, "beforeId": null } });
    {
        let bridge = CoreBridge::at(local.clone());
        call(&bridge, &notes, "notes_create", json!({ "input": input }));
        let tree = call(&bridge, &notes, "notes_load_initial", json!({ "path": [] }));
        assert_eq!(tree["library"]["missing"], 0);
        bridge.shutdown();
    }
    std::fs::rename(&notes, dir.path().join("Documents").join("Moved")).expect("a rename");
    let bridge = CoreBridge::at(local);
    let tree = call(&bridge, &notes, "notes_load_initial", json!({ "path": [] }));
    assert_eq!(tree["notebooks"].as_array().map(Vec::len), Some(0));
    assert_eq!(
        tree["library"]["missing"], 1,
        "the tree can say the notebooks are missing"
    );
    bridge.shutdown();
}
