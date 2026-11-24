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

#[test]
fn notebooks_a_sync_round_brought_open_without_a_restart() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let first = dir.path().join("first-notes");
    let input = json!({ "kind": "notebook", "title": "Physics", "placement": { "parentId": null, "beforeId": null } });
    {
        let bridge = CoreBridge::at(dir.path().join("first"));
        call(&bridge, &first, "notes_create", json!({ "input": input }));
        bridge.shutdown();
    }
    let notes = dir.path().join("second-notes");
    let bridge = CoreBridge::at(dir.path().join("second"));
    let tree = call(&bridge, &notes, "notes_load_initial", json!({ "path": [] }));
    let before = tree["notebooks"].as_array().map_or(0, Vec::len);
    // A sync round moves the other device's notebook folder into this notes folder.
    crate::notes::migrate::copy_dir(&first, &notes).expect("a copy");
    bridge
        .notes(Some(notes.clone()), |bridge| {
            bridge.open_arrived_notebooks();
            Ok(())
        })
        .expect("a rescan");
    let tree = call(&bridge, &notes, "notes_load_initial", json!({ "path": [] }));
    let titles: Vec<&str> = tree["notebooks"]
        .as_array()
        .map(|all| all.iter().filter_map(|n| n["title"].as_str()).collect())
        .unwrap_or_default();
    assert_eq!(titles.len(), before + 1, "{titles:?}");
    assert!(titles.contains(&"Physics"), "{titles:?}");
    bridge.shutdown();
}
