//! Tests of the notes commands against a real core in a temporary folder. The contract suite also runs against
//! these commands through the notes harness (app/src/services/notes/core/contract.test.ts).

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use opennote_core::{
    ops::resolve::{Edit, TxnRequest},
    session::page::PageHandle,
};
use serde_json::{json, Value};

use crate::{core_bridge::CoreBridge, ipc::IpcResult};

/// A profile and a notes folder in a temporary folder, with the bridge over them.
struct Lib {
    notes: PathBuf,
    bridge: CoreBridge,
    events: Arc<Mutex<Vec<Value>>>,
    _dir: Option<tempfile::TempDir>,
}

impl Lib {
    fn new() -> Lib {
        let dir = tempfile::tempdir().expect("a temp folder");
        let mut lib = Lib::at(
            &dir.path().join("local"),
            &dir.path().join("Documents").join("OpenNote"),
        );
        lib._dir = Some(dir);
        lib
    }

    fn at(local: &Path, notes: &Path) -> Lib {
        let bridge = CoreBridge::at(local.to_path_buf());
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        bridge.listen(Box::new(move |name, payload| {
            if name == super::NOTES_EVENT {
                sink.lock().expect("the events").push(payload);
            }
        }));
        Lib {
            notes: notes.to_path_buf(),
            bridge,
            events,
            _dir: None,
        }
    }

    fn call(&self, command: &str, args: Value) -> IpcResult<Value> {
        self.bridge
            .notes(Some(self.notes.clone()), |bridge| bridge.dispatch(command, &args))
    }

    fn ok(&self, command: &str, args: Value) -> Value {
        self.call(command, args)
            .unwrap_or_else(|error| panic!("{command}: {error}"))
    }

    fn add(&self, parent: Option<&str>, kind: &str, title: &str) -> String {
        let input = json!({ "kind": kind, "title": title, "placement": { "parentId": parent, "beforeId": null } });
        let node = self.ok("notes_create", json!({ "input": input }));
        node["id"].as_str().expect("an id").to_owned()
    }

    fn add_page(&self, section: &str, title: &str, level: u8) -> String {
        let input = json!({
            "kind": "page", "title": title, "pageLevel": level,
            "placement": { "parentId": section, "beforeId": null },
        });
        self.ok("notes_create", json!({ "input": input }))["id"]
            .as_str()
            .expect("an id")
            .to_owned()
    }

    fn titles(&self, parent: Option<&str>) -> Vec<String> {
        let list = match parent {
            None => self.ok("notes_list_notebooks", json!({})),
            Some(id) => self.ok("notes_list_children", json!({ "parentId": id })),
        };
        list.as_array()
            .expect("a list")
            .iter()
            .map(|node| {
                let level = node["pageLevel"].as_u64().unwrap_or(0);
                let title = node["title"].as_str().unwrap_or_default();
                if node["kind"] == "page" {
                    format!("{title}:{level}")
                } else {
                    title.to_owned()
                }
            })
            .collect()
    }

    fn code(&self, command: &str, args: Value) -> (String, Option<String>) {
        let error = self.call(command, args).expect_err("the call fails");
        (error.code, error.field)
    }

    fn page(&self, page: &str) -> PageHandle {
        self.bridge
            .notes(Some(self.notes.clone()), |bridge| bridge.handle(page, "main-1"))
            .expect("the page opens")
    }
}

impl Drop for Lib {
    fn drop(&mut self) {
        self.bridge.shutdown();
    }
}

fn type_text(handle: &PageHandle, seq: u64, markdown: &str) {
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

fn page_json(handle: &PageHandle) -> Value {
    let envelope = handle.envelope(None).expect("an envelope");
    let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).expect("decodes");
    serde_json::from_slice(decoded.page_json).expect("page JSON")
}

/// The folders directly inside `dir`, by name.
fn folders(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn the_tree_lives_in_notebook_folders_in_the_notes_folder() {
    let lib = Lib::new();
    let biology = lib.add(None, "notebook", "Biology");
    let exams = lib.add(Some(&biology), "sectionGroup", "Exam prep");
    let lectures = lib.add(Some(&biology), "section", "Lectures");
    let midterm = lib.add(Some(&exams), "section", "Midterm");
    let cell = lib.add_page(&lectures, "Cell", 0);
    lib.add_page(&lectures, "Membranes", 1);
    lib.add_page(&midterm, "Topics", 0);
    assert_eq!(lib.titles(None), ["Biology"]);
    assert_eq!(lib.titles(Some(&biology)), ["Exam prep", "Lectures"]);
    assert_eq!(lib.titles(Some(&lectures)), ["Cell:0", "Membranes:1"]);
    assert_eq!(lib.titles(Some(&exams)), ["Midterm"]);
    let folder = lib.notes.join("Biology");
    assert!(folder.join("notebook.json").is_file());
    let page = folder.join(&lectures).join(&cell);
    assert!(
        page.join("page.json").is_file(),
        "the page lives in its section in the notebook"
    );
    assert!(!lib.notes.join("Pages").exists());
    let got = lib.ok("notes_get", json!({ "id": cell }));
    assert_eq!(got["parentId"], json!(lectures));
    assert_eq!(
        lib.ok("notes_get", json!({ "id": "01m3s9q9xbpmxwz4cz4ht6twg9" })),
        Value::Null
    );
    let tree = lib.ok("notes_load_initial", json!({ "path": [biology, lectures, cell] }));
    assert_eq!(tree["resolvedPath"].as_array().map(Vec::len), Some(3));
    assert_eq!(tree["page"]["title"], "Cell");
    assert_eq!(tree["library"]["folder"], json!(lib.notes.display().to_string()));
}

#[test]
fn hostile_notebook_names_make_safe_folders_and_keep_their_titles() {
    let lib = Lib::new();
    let names = [
        "a/b\\c:d",
        "CON",
        "nul.txt",
        "..",
        "  Spaced  ",
        "Biology",
        "Biology",
        "what?*<>|\"",
        "trailing dots...",
    ];
    for name in names {
        lib.add(None, "notebook", name);
    }
    let long = "N".repeat(200);
    lib.add(None, "notebook", &long);
    let titles = lib.titles(None);
    assert_eq!(titles.len(), names.len() + 1);
    assert!(titles.contains(&"a/b\\c:d".to_owned()));
    assert!(titles.contains(&"Spaced".to_owned()));
    assert_eq!(titles.iter().filter(|t| *t == "Biology").count(), 2);
    let made = folders(&lib.notes);
    assert_eq!(made.len(), names.len() + 1, "one folder each: {made:?}");
    for folder in &made {
        assert!(
            !folder.contains(['/', '\\', ':', '?', '*', '<', '>', '|', '"']),
            "{folder}"
        );
        assert!(!folder.ends_with('.') && !folder.ends_with(' '), "{folder}");
        assert!(folder.encode_utf16().count() <= 64, "{folder}");
        assert!(
            !folder.eq_ignore_ascii_case("con") && !folder.eq_ignore_ascii_case("nul.txt"),
            "{folder}"
        );
        assert!(lib.notes.join(folder).join("notebook.json").is_file());
    }
    assert!(made.contains(&"Biology".to_owned()) && made.contains(&"Biology (2)".to_owned()));
    // Titles past 200 characters, and empty ones, are refused with their reason.
    let too_long = json!({ "input": { "kind": "notebook", "title": "N".repeat(201), "placement": {} } });
    assert_eq!(
        lib.code("notes_create", too_long),
        ("invalid-name".into(), Some("too-long".into()))
    );
    let empty = json!({ "input": { "kind": "notebook", "title": "   ", "placement": {} } });
    assert_eq!(
        lib.code("notes_create", empty),
        ("invalid-name".into(), Some("empty".into()))
    );
}

#[test]
fn hostile_section_and_page_titles_stay_titles_and_folders_use_ids() {
    let lib = Lib::new();
    let notebook = lib.add(None, "notebook", "Work");
    let section = lib.add(Some(&notebook), "section", "..\\..\\escape");
    let page = lib.add_page(&section, "CON", 0);
    lib.add_page(&section, "a/b:c*?", 0);
    lib.add_page(&section, "a/b:c*?", 0);
    assert_eq!(lib.titles(Some(&section)), ["CON:0", "a/b:c*?:0", "a/b:c*?:0"]);
    let folder = lib.notes.join("Work");
    assert_eq!(folders(&folder).iter().filter(|f| **f == section).count(), 1);
    assert!(folder.join(&section).join(&page).join("page.json").is_file());
    assert!(!lib.notes.join("escape").exists() && !folder.join("CON").exists());
}

#[test]
fn renames_colors_and_the_page_title_is_one_field() {
    let lib = Lib::new();
    let notebook = lib.add(None, "notebook", "Biology");
    let section = lib.add(Some(&notebook), "section", "Lectures");
    let page = lib.add_page(&section, "Cell", 0);
    lib.ok("notes_rename", json!({ "id": notebook, "title": "  Biology 101  " }));
    assert_eq!(lib.titles(None), ["Biology 101"]);
    // The folder keeps its name.
    assert!(lib.notes.join("Biology").join("notebook.json").is_file());
    // Renaming the page in the list changes the page's own title, which its heading shows.
    lib.ok("notes_rename", json!({ "id": page, "title": "Cell structure" }));
    let handle = lib.page(&page);
    assert_eq!(page_json(&handle)["title"], "Cell structure");
    // Typing in the heading renames the page in the list once the page saves.
    let edit: Edit = serde_json::from_value(json!({ "edit": "setPage", "title": "Cells" })).expect("an edit");
    let request = TxnRequest {
        page: handle.id(),
        client: handle.client().clone(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: vec![edit],
    };
    handle.apply(request).expect("applies");
    handle.save_now().expect("saves");
    // The core refreshes the list's copy of the title right after the save.
    let mut titles = lib.titles(Some(&section));
    for _ in 0..100 {
        if titles == ["Cells:0"] {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
        titles = lib.titles(Some(&section));
    }
    assert_eq!(titles, ["Cells:0"]);
    let renamed_empty = lib.code("notes_rename", json!({ "id": page, "title": "" }));
    assert_eq!(renamed_empty, ("invalid-name".into(), Some("empty".into())));
    assert_eq!(
        lib.code("notes_rename", json!({ "id": "nope", "title": "x" })).0,
        "not-found"
    );
    // Colors: pen names only, and never on pages.
    let colored = lib.ok("notes_set_color", json!({ "id": section, "color": "fern" }));
    assert_eq!(colored["color"], "fern");
    let odd = lib.ok("notes_set_color", json!({ "id": section, "color": "#ff0000" }));
    assert_eq!(odd["color"], Value::Null);
    let on_page = lib.ok("notes_set_color", json!({ "id": page, "color": "fern" }));
    assert_eq!(on_page["color"], Value::Null);
    let notebook_color = lib.ok("notes_set_color", json!({ "id": notebook, "color": "plum" }));
    assert_eq!(notebook_color["color"], "plum");
}

#[test]
fn moves_reorder_and_cross_notebooks_with_the_rules_checked() {
    let lib = Lib::new();
    let biology = lib.add(None, "notebook", "Biology");
    let work = lib.add(None, "notebook", "Work");
    let lectures = lib.add(Some(&biology), "section", "Lectures");
    let labs = lib.add(Some(&biology), "section", "Labs");
    let meetings = lib.add(Some(&work), "section", "Meetings");
    let cell = lib.add_page(&lectures, "Cell", 0);
    lib.add_page(&lectures, "Membranes", 1);
    let mitosis = lib.add_page(&lectures, "Mitosis", 0);
    let content = lib.page(&cell);
    type_text(&content, 1, "Kept through moves");
    content.save_now().expect("saves");
    // Notebooks reorder.
    lib.ok(
        "notes_move",
        json!({ "ids": [work], "placement": { "parentId": null, "beforeId": biology } }),
    );
    assert_eq!(lib.titles(None), ["Work", "Biology"]);
    // A section moves to another notebook, with its pages.
    lib.ok(
        "notes_move",
        json!({ "ids": [lectures], "placement": { "parentId": work, "beforeId": meetings } }),
    );
    assert_eq!(lib.titles(Some(&work)), ["Lectures", "Meetings"]);
    assert_eq!(lib.titles(Some(&biology)), ["Labs"]);
    assert_eq!(lib.titles(Some(&lectures)), ["Cell:0", "Membranes:1", "Mitosis:0"]);
    // A page moves with its subpage to another notebook's section, and keeps its content.
    lib.ok(
        "notes_move",
        json!({ "ids": [cell], "placement": { "parentId": labs, "beforeId": null } }),
    );
    assert_eq!(lib.titles(Some(&labs)), ["Cell:0", "Membranes:1"]);
    assert_eq!(lib.titles(Some(&lectures)), ["Mitosis:0"]);
    let moved = lib.page(&cell);
    assert_eq!(page_json(&moved)["blocks"][0]["data"]["markdown"], "Kept through moves");
    // The rules: kinds, cycles, unknown nodes, and siblings.
    assert_eq!(
        lib.code(
            "notes_move",
            json!({ "ids": [mitosis], "placement": { "parentId": biology } })
        )
        .0,
        "invalid-move"
    );
    let group = lib.add(Some(&biology), "sectionGroup", "Group");
    let inner = lib.add(Some(&group), "sectionGroup", "Inner");
    assert_eq!(
        lib.code(
            "notes_move",
            json!({ "ids": [group], "placement": { "parentId": inner } })
        )
        .0,
        "invalid-move"
    );
    assert_eq!(
        lib.code(
            "notes_move",
            json!({ "ids": ["nope"], "placement": { "parentId": biology } })
        )
        .0,
        "not-found"
    );
    let elsewhere = json!({ "ids": [labs], "placement": { "parentId": biology, "beforeId": meetings } });
    assert_eq!(lib.code("notes_move", elsewhere).0, "invalid-move");
    // Groups nest at most 4 deep.
    let three = lib.add(Some(&inner), "sectionGroup", "Three");
    let four = lib.add(Some(&three), "sectionGroup", "Four");
    let five = json!({ "input": { "kind": "sectionGroup", "title": "Five", "placement": { "parentId": four } } });
    assert_eq!(lib.code("notes_create", five).0, "invalid-move");
    // Levels.
    lib.ok("notes_set_page_level", json!({ "ids": [mitosis], "level": 0 }));
    assert_eq!(
        lib.code("notes_set_page_level", json!({ "ids": [mitosis], "level": 1 }))
            .0,
        "invalid-move"
    );
}

#[test]
fn trash_restore_and_purge_keep_trash_in_the_notebook() {
    let lib = Lib::new();
    let biology = lib.add(None, "notebook", "Biology");
    let lectures = lib.add(Some(&biology), "section", "Lectures");
    let cell = lib.add_page(&lectures, "Cell", 0);
    lib.add_page(&lectures, "Membranes", 1);
    let mitosis = lib.add_page(&lectures, "Mitosis", 0);
    let receipt = lib.ok("notes_trash", json!({ "ids": [cell] }));
    assert_eq!(receipt["nodeIds"], json!([cell]));
    assert_eq!(lib.titles(Some(&lectures)), ["Mitosis:0"]);
    let trash = lib.ok("notes_list_trash", json!({}));
    assert_eq!(trash[0]["node"]["id"], json!(cell));
    assert_eq!(trash[0]["pageCount"], 2);
    assert_eq!(trash[0]["originalParentTitle"], "Lectures");
    assert_eq!(
        folders(&lib.notes.join("Biology").join(".opennote").join("trash")).len(),
        1
    );
    // Restore from the list puts it back where it was.
    lib.ok("notes_restore_from_trash", json!({ "ids": [cell] }));
    assert_eq!(lib.titles(Some(&lectures)), ["Cell:0", "Membranes:1", "Mitosis:0"]);
    // Undo of a trash call.
    let receipt = lib.ok("notes_trash", json!({ "ids": [mitosis] }));
    lib.ok("notes_restore", json!({ "receiptId": receipt["id"] }));
    assert_eq!(lib.titles(Some(&lectures)), ["Cell:0", "Membranes:1", "Mitosis:0"]);
    assert_eq!(
        lib.code("notes_restore", json!({ "receiptId": receipt["id"] })).0,
        "not-found"
    );
    assert_eq!(lib.code("notes_restore", json!({ "receiptId": "nope" })).0, "not-found");
    // Purge deletes the item for good.
    lib.ok("notes_trash", json!({ "ids": [mitosis] }));
    lib.ok("notes_purge", json!({ "ids": [mitosis] }));
    assert_eq!(lib.ok("notes_list_trash", json!({})), json!([]));
    assert_eq!(
        lib.code("notes_restore_from_trash", json!({ "ids": [mitosis] })).0,
        "not-found"
    );
    // A notebook in Trash leaves the list and keeps its folder, and comes back.
    lib.ok("notes_trash", json!({ "ids": [biology] }));
    assert!(lib.titles(None).is_empty());
    assert!(lib.notes.join("Biology").join("notebook.json").is_file());
    assert_eq!(lib.ok("notes_list_trash", json!({}))[0]["node"]["kind"], "notebook");
    lib.ok("notes_restore_from_trash", json!({ "ids": [biology] }));
    assert_eq!(lib.titles(None), ["Biology"]);
}

#[test]
fn a_copied_notes_folder_opens_with_its_notebooks_on_another_profile() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    let (biology, page) = {
        let lib = Lib::at(&dir.path().join("first"), &notes);
        let biology = lib.add(None, "notebook", "Biology");
        let section = lib.add(Some(&biology), "section", "Lectures");
        let page = lib.add_page(&section, "Cell", 0);
        lib.add(None, "notebook", "Work");
        type_text(&lib.page(&page), 1, "Copied with the folder");
        (biology, page)
    };
    let copy = dir.path().join("Elsewhere").join("Notes");
    crate::notes::migrate::copy_dir(&notes, &copy).expect("a copy");
    let other = Lib::at(&dir.path().join("second"), &copy);
    let mut found = other.titles(None);
    found.sort();
    assert_eq!(found, ["Biology", "Work"]);
    assert_eq!(other.titles(Some(&biology)), ["Lectures"]);
    assert_eq!(
        page_json(&other.page(&page))["blocks"][0]["data"]["markdown"],
        "Copied with the folder"
    );
}

#[test]
fn changes_send_notes_events() {
    let lib = Lib::new();
    let notebook = lib.add(None, "notebook", "Biology");
    lib.add(Some(&notebook), "section", "Lectures");
    let events = lib.events.lock().expect("the events").clone();
    assert!(events.iter().any(|e| e["type"] == "upserted"
        && e["nodes"]
            .as_array()
            .is_some_and(|n| n.iter().any(|n| n["title"] == "Lectures"))));
    assert!(events
        .iter()
        .any(|e| e["type"] == "childrenChanged" && e["parentId"] == json!(notebook)));
    let (code, _) = lib.code("notes_nothing", json!({}));
    assert_eq!(code, "invalid");
}

#[test]
fn a_notes_folder_used_before_with_unknown_files_still_opens() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let notes = dir.path().join("Notes");
    fs::create_dir_all(notes.join("Holiday photos")).expect("a folder");
    fs::create_dir_all(notes.join(".hidden")).expect("a folder");
    fs::write(notes.join("readme.txt"), "not a notebook").expect("a file");
    let broken = notes.join("Broken");
    fs::create_dir_all(&broken).expect("a folder");
    fs::write(broken.join("notebook.json"), "{ not json").expect("a damaged notebook");
    let lib = Lib::at(&dir.path().join("local"), &notes);
    assert!(lib.titles(None).is_empty());
    lib.add(None, "notebook", "Fresh");
    assert_eq!(lib.titles(None), ["Fresh"]);
}

/// A beta 1 profile: the Phase 2 snapshot, the page map, and the `Pages` notebook that held the page content.
fn beta_one_profile(local: &Path, notes: &Path) -> (String, String) {
    use opennote_core::session::{
        core::{Core, CoreConfig},
        events::{CoreEvent, EventSink},
        notebook::{NodePlacement, ParentRef},
    };
    struct Quiet;
    impl EventSink for Quiet {
        fn emit(&self, _event: CoreEvent) {}
    }
    let data = local.join("phase4").join("core");
    let config = CoreConfig::production(data, "0.1.0-beta.1".into()).expect("a config");
    let core = Core::start(config, Arc::new(Quiet), None).expect("a core");
    let pages = core.create_notebook(notes, "Pages").expect("the Pages notebook");
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    let section = pages.create_section("Pages", top).expect("a section");
    let at = NodePlacement {
        parent: ParentRef::Section(section),
        before: None,
    };
    let cell = pages.create_page(section, at).expect("a page");
    let typed = pages.create_page(section, at).expect("a page");
    let client = opennote_core::ClientId::parse("main-1").expect("a client");
    let handle = pages.open_page(cell, client.clone()).expect("opens");
    type_text(&handle, 1, "Cells divide");
    handle.close(&client).expect("closes");
    let handle = pages.open_page(typed, client.clone()).expect("opens");
    let edit: Edit = serde_json::from_value(json!({ "edit": "setPage", "title": "Heading typed" })).expect("an edit");
    let request = TxnRequest {
        page: handle.id(),
        client: client.clone(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: vec![edit],
    };
    handle.apply(request).expect("applies");
    handle.close(&client).expect("closes");
    pages.close().expect("the notebook closes");
    core.flush_all(std::time::Duration::from_secs(5)).expect("flushed");
    core.shutdown(std::time::Duration::from_secs(5));
    let map = json!({ "p-cell": cell.to_string(), "p-typed": typed.to_string() });
    fs::write(local.join("phase4").join("pages.json"), map.to_string()).expect("the map");
    let snapshot = json!({
        "folder": notes.display().to_string(),
        "notebooks": [{
            "id": "n-bio", "kind": "notebook", "title": "Biology", "color": "fern",
            "children": [
                { "id": "g-exams", "kind": "sectionGroup", "title": "Exam prep", "children": [
                    { "id": "s-mid", "kind": "section", "title": "Midterm", "children": [] }
                ]},
                { "id": "s-lec", "kind": "section", "title": "Lectures", "color": "amber", "children": [
                    { "id": "p-cell", "kind": "page", "title": "Cell", "pageLevel": 0 },
                    { "id": "p-mem", "kind": "page", "title": "Membranes", "pageLevel": 1 },
                    { "id": "p-typed", "kind": "page", "title": "Untitled page", "pageLevel": 0 }
                ]}
            ]
        }, { "id": "n-work", "kind": "notebook", "title": "Work", "children": [] }],
        "trash": [{
            "receiptId": "t-1", "trashedAt": "2026-10-01T10:00:00.000Z", "parentId": "s-lec", "beforeId": null,
            "parentTitle": "Lectures", "notebookId": "n-bio",
            "nodes": [{ "id": "p-old", "kind": "page", "title": "Old page", "pageLevel": 0 }]
        }]
    });
    fs::write(local.join("phase2-notes.json"), snapshot.to_string()).expect("the snapshot");
    (cell.to_string(), typed.to_string())
}

#[test]
fn a_beta_one_profile_moves_into_notebooks_once_with_a_backup() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Documents").join("OpenNote"));
    let (cell, typed) = beta_one_profile(&local, &notes);
    {
        let lib = Lib::at(&local, &notes);
        assert_eq!(lib.titles(None), ["Biology", "Work"]);
        let biology = lib.ok("notes_list_notebooks", json!({}))[0]["id"]
            .as_str()
            .expect("an id")
            .to_owned();
        let children = lib.ok("notes_list_children", json!({ "parentId": biology }));
        assert_eq!(lib.titles(Some(&biology)), ["Exam prep", "Lectures"]);
        assert_eq!(children[1]["color"], "amber");
        let lectures = children[1]["id"].as_str().expect("an id").to_owned();
        // The heading typed on the page wins over the list's default name.
        assert_eq!(
            lib.titles(Some(&lectures)),
            ["Cell:0", "Membranes:1", "Heading typed:0"]
        );
        assert_eq!(
            page_json(&lib.page(&cell))["blocks"][0]["data"]["markdown"],
            "Cells divide"
        );
        assert_eq!(page_json(&lib.page(&typed))["title"], "Heading typed");
        let page_dir = notes.join("Biology").join(&lectures).join(&cell);
        assert!(
            page_dir.join("page.json").is_file(),
            "the content lives in its notebook"
        );
        let trash = lib.ok("notes_list_trash", json!({}));
        assert_eq!(trash[0]["node"]["title"], "Old page");
    }
    assert!(!notes.join("Pages").exists());
    let backup = local.join(crate::notes::migrate::BACKUP_DIR);
    assert!(backup.join("Pages").join("notebook.json").is_file());
    assert!(backup.join("phase2-notes.json").is_file() && backup.join("pages.json").is_file());
    assert!(backup.join("migration.json").is_file());
    assert!(!local.join("phase2-notes.json").exists() && !local.join("phase4").join("pages.json").exists());
    assert!(local.join("core").is_dir());
    // A second start finds nothing to migrate.
    let again = Lib::at(&local, &notes);
    assert_eq!(again.titles(None), ["Biology", "Work"]);
    assert!(!local
        .join(format!("{} (2)", crate::notes::migrate::BACKUP_DIR))
        .exists());
}

#[test]
fn the_sample_library_of_test_builds_matches_the_fixture() {
    let lib = Lib::new();
    let folder = lib.notes.clone();
    lib.bridge
        .notes(Some(folder.clone()), |bridge| {
            crate::notes::migrate::make_library(bridge, &folder, crate::notes::migrate::SAMPLE)
                .map_err(|error| crate::ipc::IpcError::new("io", error))
        })
        .expect("the samples");
    assert_eq!(
        lib.titles(None),
        ["Biology 101", "Work", "Personal", "Recipes", "Travel"]
    );
    let biology = lib.ok("notes_list_notebooks", json!({}))[0]["id"]
        .as_str()
        .expect("an id")
        .to_owned();
    assert_eq!(lib.titles(Some(&biology)), ["Lectures", "Labs", "Exam prep"]);
    let lectures = lib.ok("notes_list_children", json!({ "parentId": biology }))[0]["id"]
        .as_str()
        .expect("an id")
        .to_owned();
    assert_eq!(
        lib.titles(Some(&lectures)),
        [
            "Cell structure:0",
            "Membranes:1",
            "Mitosis:0",
            "Meiosis:0",
            "Photosynthesis:0"
        ]
    );
}
