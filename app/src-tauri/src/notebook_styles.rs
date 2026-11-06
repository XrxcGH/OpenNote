//! A notebook's named styles, kept in its `notebook.json` (ADR 0082). `notebook_styles_get` reads them and
//! `notebook_styles_set` writes them over the core's `set_notebook_styles`. The core merges them per style when
//! two devices change one notebook.

use opennote_core::{model::NotebookStyles, session::notebook::NodeProps};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    ipc::{IpcError, IpcResult},
    notes::{from_core, tree::Found},
};

/// The notebook's styles as the JSON object the interface keeps: style name to style.
pub(crate) fn get(bridge: &Bridge, notebook: &str) -> IpcResult<Value> {
    let found = bridge.find(notebook)?;
    let Found::Notebook(handle) = found else {
        return Err(IpcError::invalid("notebook", "isn't a notebook"));
    };
    serde_json::to_value(handle.tree().styles).map_err(|e| IpcError::invalid("styles", &e.to_string()))
}

/// Replaces the notebook's styles. An empty object removes them, so the notebook shows the app's own.
pub(crate) fn set(bridge: &Bridge, notebook: &str, styles: Value) -> IpcResult<()> {
    let styles: NotebookStyles =
        serde_json::from_value(styles).map_err(|e| IpcError::invalid("styles", &e.to_string()))?;
    let Found::Notebook(handle) = bridge.find(notebook)? else {
        return Err(IpcError::invalid("notebook", "isn't a notebook"));
    };
    let props = NodeProps {
        styles: Some(styles),
        ..NodeProps::default()
    };
    handle.set_notebook_props(props).map_err(from_core)
}

/// The notebook's named styles.
#[tauri::command]
pub async fn notebook_styles_get(app: AppHandle, bridge: State<'_, CoreBridge>, notebook: String) -> IpcResult<Value> {
    bridge
        .run(move |bridge| run_notes(&app, bridge, |b| get(b, &notebook)))
        .await
}

/// Saves the notebook's named styles.
#[tauri::command]
pub async fn notebook_styles_set(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    notebook: String,
    styles: Value,
) -> IpcResult<()> {
    bridge
        .run(move |bridge| run_notes(&app, bridge, |b| set(b, &notebook, styles)))
        .await
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn library() -> (tempfile::TempDir, CoreBridge, std::path::PathBuf, String) {
        let dir = tempfile::tempdir().expect("a temp folder");
        let notes = dir.path().join("Notes");
        let bridge = CoreBridge::at(dir.path().join("local"));
        let input =
            json!({ "kind": "notebook", "placement": { "parentId": null, "beforeId": null }, "title": "Biology" });
        let made = bridge
            .notes(Some(notes.clone()), |b| {
                b.dispatch("notes_create", &json!({ "input": input }))
            })
            .expect("a notebook");
        let id = made["id"].as_str().expect("an id").to_owned();
        (dir, bridge, notes, id)
    }

    fn sample() -> Value {
        json!({
            "Normal": { "font": "Serif Test", "size": 11.5, "lineHeight": 1.15 },
            "Heading 1": { "font": "Sans Test", "size": 20.5, "spaceBefore": 12.5, "color": "#112233" }
        })
    }

    #[test]
    fn set_then_get_returns_the_same_object_and_the_file_holds_it() {
        let (_dir, bridge, notes, id) = library();
        let run = |work: &dyn Fn(&Bridge) -> IpcResult<Value>| bridge.notes(Some(notes.clone()), |b| work(b));
        assert_eq!(run(&|b| get(b, &id)).expect("empty styles"), json!({}));
        run(&|b| set(b, &id, sample()).map(|()| Value::Null)).expect("saved");
        assert_eq!(run(&|b| get(b, &id)).expect("styles"), sample());
        let file = std::fs::read_to_string(notes.join("Biology").join("notebook.json")).expect("notebook.json");
        let disk: Value = serde_json::from_str(&file).expect("json");
        assert_eq!(disk["styles"], sample());
        run(&|b| set(b, &id, json!({})).map(|()| Value::Null)).expect("cleared");
        assert_eq!(run(&|b| get(b, &id)).expect("cleared styles"), json!({}));
        bridge.shutdown();
    }

    #[test]
    fn a_wrong_id_or_a_bad_object_is_refused() {
        let (_dir, bridge, notes, id) = library();
        let bad_id = bridge.notes(Some(notes.clone()), |b| get(b, "nope"));
        assert!(bad_id.is_err());
        let bad = bridge.notes(Some(notes), |b| set(b, &id, json!({ "Normal": { "size": "big" } })));
        assert_eq!(bad.expect_err("a bad size").code, crate::ipc::codes::INVALID);
        bridge.shutdown();
    }
}
