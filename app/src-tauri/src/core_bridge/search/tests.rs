//! The search commands against a real core and real notebooks: typed text, titles, links, Trash, a restart, and a
//! notebook that arrives in the notes folder.

use std::{
    path::Path,
    time::{Duration, Instant},
};

use opennote_core::ops::resolve::{Edit, NewBlock, TxnRequest};
use serde_json::{json, Value};

use super::{internal, CoreBridge};
use crate::{core_bridge::Bridge, ipc::codes, ipc::IpcError};

fn create(bridge: &mut Bridge, kind: &str, parent: Option<&str>, title: &str) -> Result<String, IpcError> {
    let input = json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null }, "title": title });
    let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
    Ok(node["id"].as_str().unwrap_or_default().to_owned())
}

/// A notebook with a section and one page for each title; returns the notebook, the section, and the pages.
fn notebook(bridge: &CoreBridge, notes: &Path, name: &str, section: &str, pages: &[&str]) -> Vec<String> {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let notebook = create(bridge, "notebook", None, name)?;
            let section = create(bridge, "section", Some(&notebook), section)?;
            let mut made = vec![notebook, section.clone()];
            for title in pages {
                made.push(create(bridge, "page", Some(&section), title)?);
            }
            Ok(made)
        })
        .expect("a notebook")
}

fn type_text(bridge: &CoreBridge, notes: &Path, page: &str, markdown: &str) {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let handle = bridge.handle(page, "main-1")?;
            let block: NewBlock = serde_json::from_value(json!({
                "id": format!("01k6f0000000000000000{:05}", page.len() * 7 + markdown.len()),
                "type": "text",
                "data": { "markdown": markdown }
            }))
            .expect("a new block");
            let request = TxnRequest {
                page: handle.id(),
                client: handle.client().clone(),
                client_seq: 1,
                coalesce: None,
                ui: None,
                edits: vec![Edit::InsertBlock {
                    block,
                    after: None,
                    before: None,
                }],
            };
            handle.apply(request).expect("applies");
            handle.save_now().map_err(internal)
        })
        .expect("typed text");
}

/// Runs a method until its answer satisfies `done`, because the index follows saves in the background.
fn eventually(bridge: &CoreBridge, method: &str, args: Value, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let answer = bridge.search.call(method, args.clone()).expect("a search answer");
        if done(&answer) || Instant::now() > deadline {
            return answer;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn titles(answer: &Value) -> Vec<String> {
    answer["hits"]
        .as_array()
        .map(|hits| {
            hits.iter()
                .filter_map(|hit| hit["title"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn found(answer: &Value) -> bool {
    !titles(answer).is_empty()
}

struct World {
    _dir: tempfile::TempDir,
    local: std::path::PathBuf,
    notes: std::path::PathBuf,
    bridge: CoreBridge,
}

fn start() -> World {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Notes"));
    let bridge = CoreBridge::at(local.clone());
    World {
        _dir: dir,
        local,
        notes,
        bridge,
    }
}

#[test]
fn typed_text_is_found_under_the_page_and_its_title() {
    let world = start();
    let made = notebook(
        &world.bridge,
        &world.notes,
        "Biology",
        "Lectures",
        &["Cell biology", "Shopping"],
    );
    type_text(&world.bridge, &world.notes, &made[2], "Mitochondria make energy");
    let answer = eventually(&world.bridge, "query", json!({ "text": "mitochondria" }), found);
    assert_eq!(answer["hits"][0]["page"], made[2].as_str());
    assert_eq!(titles(&answer), ["Cell biology"]);
    let by_title = eventually(&world.bridge, "query", json!({ "text": "shopping" }), found);
    assert_eq!(by_title["hits"][0]["page"], made[3].as_str());
    world.bridge.shutdown();
}

#[test]
fn every_notebook_of_the_notes_folder_is_searched() {
    let world = start();
    let first = notebook(&world.bridge, &world.notes, "Biology", "Lectures", &["Cells"]);
    let second = notebook(&world.bridge, &world.notes, "Cooking", "Recipes", &["Bread"]);
    type_text(&world.bridge, &world.notes, &first[2], "Osmosis moves water");
    type_text(&world.bridge, &world.notes, &second[2], "Osmosis in brine");
    let answer = eventually(&world.bridge, "query", json!({ "text": "osmosis" }), |answer| {
        titles(answer).len() == 2
    });
    let mut names = titles(&answer);
    names.sort();
    assert_eq!(names, ["Bread", "Cells"]);
    // The in: operator names a notebook or a section of the real tree.
    let scoped = eventually(
        &world.bridge,
        "query",
        json!({ "text": "osmosis in:cooking" }),
        |answer| titles(answer).len() == 1,
    );
    assert_eq!(titles(&scoped), ["Bread"]);
    world.bridge.shutdown();
}

#[test]
fn links_resolve_by_title_and_show_as_backlinks() {
    let world = start();
    let made = notebook(&world.bridge, &world.notes, "Biology", "Lectures", &["Alpha", "Beta"]);
    type_text(
        &world.bridge,
        &world.notes,
        &made[3],
        "See [[Alpha]] and [[Nowhere]] for more",
    );
    let backlinks = eventually(&world.bridge, "backlinks", json!({ "page": made[2] }), |answer| {
        answer.as_array().is_some_and(|list| !list.is_empty())
    });
    assert_eq!(backlinks[0]["source"], made[3].as_str());
    assert_eq!(backlinks[0]["sourceTitle"], "Beta");
    let resolved = world
        .bridge
        .search
        .call(
            "resolve",
            json!({ "from": made[3], "links": [{ "title": "Alpha" }, { "title": "Nowhere" }] }),
        )
        .expect("resolutions");
    assert_eq!(resolved[0]["status"], "resolved");
    assert_eq!(resolved[0]["targets"][0]["page"], made[2].as_str());
    assert_eq!(resolved[1]["status"], "broken");
    let suggestions = world
        .bridge
        .search
        .call("suggestPages", json!({ "prefix": "al" }))
        .expect("suggestions");
    assert_eq!(suggestions[0]["page"], made[2].as_str());
    world.bridge.shutdown();
}

#[test]
fn a_page_in_trash_leaves_the_index_and_comes_back_with_restore() {
    let world = start();
    let made = notebook(&world.bridge, &world.notes, "Biology", "Lectures", &["Keep", "Gone"]);
    eventually(&world.bridge, "query", json!({ "text": "gone" }), found);
    let receipt = world
        .bridge
        .notes(Some(world.notes.clone()), |bridge| {
            bridge.dispatch("notes_trash", &json!({ "ids": [made[3]] }))
        })
        .expect("trashed");
    let answer = eventually(&world.bridge, "query", json!({ "text": "gone" }), |answer| {
        !found(answer)
    });
    assert!(!found(&answer), "a page in Trash is not found");
    world
        .bridge
        .notes(Some(world.notes.clone()), |bridge| {
            bridge.dispatch("notes_restore", &json!({ "receiptId": receipt["id"] }))
        })
        .expect("restored");
    let back = eventually(&world.bridge, "query", json!({ "text": "gone" }), found);
    assert_eq!(titles(&back), ["Gone"]);
    world.bridge.shutdown();
}

#[test]
fn a_renamed_page_is_found_by_its_new_title() {
    let world = start();
    let made = notebook(&world.bridge, &world.notes, "Biology", "Lectures", &["Draft"]);
    eventually(&world.bridge, "query", json!({ "text": "draft" }), found);
    world
        .bridge
        .notes(Some(world.notes.clone()), |bridge| {
            bridge.dispatch("notes_rename", &json!({ "id": made[2], "title": "Final copy" }))
        })
        .expect("renamed");
    let answer = eventually(&world.bridge, "query", json!({ "text": "final" }), found);
    assert_eq!(titles(&answer), ["Final copy"]);
    world.bridge.shutdown();
}

#[test]
fn the_index_follows_the_notes_after_a_restart_and_a_notebook_that_arrives() {
    let world = start();
    let made = notebook(&world.bridge, &world.notes, "Biology", "Lectures", &["Cells"]);
    type_text(&world.bridge, &world.notes, &made[2], "Ribosomes build proteins");
    eventually(&world.bridge, "query", json!({ "text": "ribosomes" }), found);
    world.bridge.shutdown();
    drop(world.bridge);

    // Another computer's notebook arrives in the notes folder while the app is closed.
    let other = start_at(
        &world.local.with_file_name("other-local"),
        &world.notes.with_file_name("Elsewhere"),
    );
    let arrived = notebook(&other.bridge, &other.notes, "Chemistry", "Labs", &["Titration"]);
    type_text(&other.bridge, &other.notes, &arrived[2], "Ribosomes of acids");
    other.bridge.shutdown();
    drop(other.bridge);
    let folder = std::fs::read_dir(&other.notes)
        .expect("the other notes folder")
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.join("notebook.json").is_file())
        .expect("the notebook's folder");
    copy_dir(&folder, &world.notes.join("Chemistry"));

    let again = CoreBridge::at(world.local.clone());
    again
        .notes(Some(world.notes.clone()), |_| Ok(()))
        .expect("the notebooks open");
    let answer = eventually(&again, "query", json!({ "text": "ribosomes" }), |answer| {
        titles(answer).len() == 2
    });
    let mut names = titles(&answer);
    names.sort();
    assert_eq!(names, ["Cells", "Titration"]);
    again.shutdown();
}

struct Other {
    notes: std::path::PathBuf,
    bridge: CoreBridge,
}

fn start_at(local: &Path, notes: &Path) -> Other {
    Other {
        notes: notes.to_path_buf(),
        bridge: CoreBridge::at(local.to_path_buf()),
    }
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("a folder");
    for entry in std::fs::read_dir(from).expect("a listing").flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).expect("a copy");
        }
    }
}

#[test]
fn a_bad_pattern_is_reported_and_an_unknown_method_is_refused() {
    let world = start();
    world.bridge.with(|_| Ok(())).expect("the core starts");
    let answer = world
        .bridge
        .search
        .call("query", json!({ "text": "(unclosed", "regex": true }))
        .expect("an answer");
    assert!(answer["patternError"]
        .as_str()
        .is_some_and(|message| !message.is_empty()));
    let error = world.bridge.search.call("nothing", json!({})).expect_err("refused");
    assert_eq!(error.code, codes::INVALID);
    world.bridge.shutdown();
}
