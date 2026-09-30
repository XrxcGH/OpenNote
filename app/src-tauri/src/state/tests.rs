use std::path::Path;

use serde_json::json;

use super::*;

#[test]
fn defaults_match_the_documented_shape() {
    let mut expected = json!({
        "stateVersion": 1,
        "window": { "placement": null, "maximized": false },
        "panes": {
            "notebooks": { "width": 272.0, "collapsed": false },
            "pages": { "width": 300.0, "collapsed": false }
        },
        "location": { "view": "workspace", "notebookId": null, "sectionId": null, "pageId": null },
        "expanded": [],
        "lastPageBySection": {},
        "recentCommands": [],
        "recentPages": [],
        "setup": { "status": "notStarted", "step": null, "completedSteps": [], "draft": null },
        "pageViews": {}
    });
    expected["ink"] = serde_json::to_value(InkDeviceState::default()).expect("serializes");
    assert_eq!(
        serde_json::to_value(DeviceState::default()).expect("serializes"),
        expected
    );
}

#[test]
fn reads_the_documented_example() {
    let example = json!({
        "stateVersion": 1,
        "window": { "placement": { "showCmd": 1, "normal": [120, 80, 1560, 980] }, "maximized": true },
        "location": { "view": "settings", "section": "appearance" },
        "setup": { "status": "done", "step": null, "completedSteps": ["storage"], "draft": null }
    });
    let state: DeviceState = serde_json::from_value(example).expect("parses");
    assert_eq!(
        state.location,
        StoredLocation::Settings {
            section: "appearance".into()
        }
    );
    assert_eq!(state.window.placement.map(|p| p.normal), Some([120, 80, 1560, 980]));
    assert_eq!(state.setup.status, SetupStatus::Done);
}

#[test]
fn patches_merge_but_never_touch_the_window() {
    let store = DeviceStateStore::in_memory();
    store.set_window(&WindowState {
        placement: None,
        maximized: true,
    });
    let patch = json!({
        "window": { "maximized": false },
        "location": { "view": "trash" },
        "panes": { "pages": { "collapsed": true } }
    });
    store.update(patch).expect("valid");
    let state = store.get();
    assert!(state.window.maximized);
    assert_eq!(state.location, StoredLocation::Trash);
    assert!(state.panes.pages.collapsed && state.panes.pages.width == 300.0);
    assert!(store.update(json!([1])).is_err());
}

#[test]
fn keeps_the_500_most_recently_used_page_views() {
    let store = DeviceStateStore::in_memory();
    let views: serde_json::Map<String, Value> = (0..520)
        .map(|n| {
            (
                format!("p{n}"),
                json!({ "scrollY": 0, "zoom": 1, "folds": [], "at": n }),
            )
        })
        .collect();
    store.update(json!({ "pageViews": views })).expect("valid");
    let state = store.get();
    assert_eq!(state.page_views.len(), MAX_PAGE_VIEWS);
    assert!(!state.page_views.contains_key("p19") && state.page_views.contains_key("p20"));
}

#[test]
fn a_bad_field_falls_back_without_losing_the_rest() {
    let store = DeviceStateStore::in_memory();
    store
        .update(json!({ "expanded": ["n1"], "location": { "view": "nowhere" }, "ink": { "lastTool": "pen" } }))
        .expect("merges");
    let state = store.get();
    assert_eq!(state.expanded, ["n1"]);
    assert_eq!(state.location, StoredLocation::default());
}

fn load(folder: &Path) -> (DeviceStateStore, Option<Notice>, Paths) {
    let paths = Paths::under_profile(folder);
    let (store, notice) = DeviceStateStore::load(&paths);
    (store, notice, paths)
}

#[test]
fn saves_and_reloads() {
    let folder = tempfile::tempdir().expect("a folder");
    let (store, notice, paths) = load(folder.path());
    assert_eq!(notice, None);
    store.update(json!({ "expanded": ["n1", "g2"] })).expect("valid");
    store.flush().expect("saves");
    drop(store);
    let (store, _, _) = load(folder.path());
    assert_eq!(store.get().expanded, ["n1", "g2"]);
    assert!(paths.state_file.exists());
}

#[test]
fn a_corrupt_file_starts_over() {
    let folder = tempfile::tempdir().expect("a folder");
    let paths = Paths::under_profile(folder.path());
    fs::create_dir_all(&paths.local).expect("a folder");
    fs::write(&paths.state_file, "{ nope").expect("writes");
    let (store, notice, _) = load(folder.path());
    assert_eq!(notice, Some(Notice::StateReset));
    assert_eq!(store.get(), DeviceState::default());
}

/// Writes `DeviceState::default()` next to the generated types, where a Vitest test compares it with the
/// interface's defaults.
#[test]
fn exports_the_defaults_for_the_interface() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/platform/bindings/device-state-default.json");
    let mut text = serde_json::to_string_pretty(&DeviceState::default()).expect("serializes");
    text.push('\n');
    if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
        fs::write(&path, text).expect("writes");
    }
}
