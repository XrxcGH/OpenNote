//! Edits made outside OpenNote (docs/FEATURES.md, Phase 3): a person edits `page.md` in another program, OpenNote
//! keeps that copy aside, and offers to bring its text into the page.

mod real_core;

use opennote_core::id::{BlockId, Id};
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::store::external::import::TextChange;
use real_core::{page_json, Real};
use serde_json::{json, Value};

fn text_block(n: u128, markdown: &str) -> (BlockId, Edit) {
    let id = BlockId(Id::from_parts(1_800_000_000_000, n));
    let block = NewBlock {
        id,
        type_name: "text".into(),
        frame: None,
        data: json!({"markdown": markdown}).as_object().cloned().unwrap(),
        fallback: None,
    };
    let edit = Edit::InsertBlock {
        block,
        after: None,
        before: None,
    };
    (id, edit)
}

fn texts(page: &Value) -> Vec<String> {
    let blocks = page["blocks"].as_array().cloned().unwrap_or_default();
    blocks
        .iter()
        .map(|b| b["data"]["markdown"].as_str().unwrap_or_default().to_owned())
        .collect()
}

/// Waits for the maintenance thread, which writes the readable copies a moment after a save.
fn kept_copies(handle: &opennote_core::session::page::PageHandle) -> Vec<opennote_core::store::external::EditedCopy> {
    for _ in 0..200 {
        let copies = handle.edited_copies().unwrap();
        if !copies.is_empty() {
            return copies;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Vec::new()
}

/// The `page.md` the maintenance thread writes after the first save.
fn written_page_md(path: &std::path::Path) -> String {
    for _ in 0..200 {
        if let Ok(text) = std::fs::read_to_string(path) {
            if text.contains("Gamma") {
                return text;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    String::new()
}

#[test]
fn text_edited_in_another_program_comes_back_in_one_undo_step() {
    let mut real = Real::new();
    let handle = real.open();
    let ((first, a), (second, b)) = (text_block(1, "Alpha beta"), text_block(2, "Gamma"));
    handle.apply(real.request(vec![a])).unwrap();
    let after_first = Edit::InsertBlock {
        block: match b {
            Edit::InsertBlock { block, .. } => block,
            _ => unreachable!(),
        },
        after: Some(first),
        before: None,
    };
    handle.apply(real.request(vec![after_first])).unwrap();
    let saved = handle.save_now().unwrap();
    handle.name_version(saved.revision, None, false).unwrap();

    // Another program edits page.md: one word added, and a paragraph at the end.
    let page_dir = real
        .notebook
        .path()
        .join(real.section.to_string())
        .join(real.page.to_string());
    let path = page_dir.join("page.md");
    let written = written_page_md(&path);
    assert!(written.contains("Alpha beta\n\nGamma"), "{written}");
    let edited = written.replace("Alpha beta\n\nGamma", "Alpha beta gamma\n\nGamma\n\nEpsilon");
    std::fs::write(&path, edited).unwrap();

    // OpenNote keeps editing: its next save finds the edited file and keeps it aside.
    let change = Edit::SetText {
        block: second,
        markdown: "Gamma!".into(),
    };
    handle.apply(real.request(vec![change])).unwrap();
    handle.save_now().unwrap();
    let copies = kept_copies(&handle);
    assert_eq!(copies.len(), 1, "{copies:?}");
    assert_eq!(copies[0].file, "page.md");

    let import = handle.plan_edited_import(&copies[0].path).unwrap();
    assert!(import.base_known);
    assert_eq!(import.plan.changes.len(), 2, "{:?}", import.plan);
    assert!(import.plan.changes.contains(&TextChange::Replace {
        block: first,
        markdown: "Alpha beta gamma".into()
    }));
    assert!(import.plan.changes.contains(&TextChange::Insert {
        after: Some(second),
        before: None,
        markdown: "Epsilon".into()
    }));
    assert!(
        import.plan.conflicts.is_empty(),
        "the app's edit to the second block is not a conflict"
    );

    handle.apply(real.request(import.edits.clone())).unwrap();
    assert_eq!(texts(&page_json(&handle)), ["Alpha beta gamma", "Gamma!", "Epsilon"]);
    handle.undo(&real.client).unwrap().unwrap();
    assert_eq!(
        texts(&page_json(&handle)),
        ["Alpha beta", "Gamma!"],
        "one step takes all of it back"
    );

    handle.discard_edited_copy(&copies[0].path).unwrap();
    assert!(handle.edited_copies().unwrap().is_empty());
}

#[test]
fn only_listed_copies_can_be_read_or_deleted() {
    let real = Real::new();
    let handle = real.open();
    let elsewhere = real.dir.path().join("notes.txt");
    std::fs::write(&elsewhere, "keep me").unwrap();
    assert_eq!(
        handle.plan_edited_import(&elsewhere).unwrap_err().to_string(),
        format!("not found: edited copy {}", elsewhere.display())
    );
    assert!(handle.discard_edited_copy(&elsewhere).is_err());
    assert!(elsewhere.exists());
    assert!(handle.cloud_only_files().is_empty());
}

/// The `page.json` of the only page under `folder`.
fn page_file(folder: &std::path::Path) -> std::path::PathBuf {
    for entry in std::fs::read_dir(folder).unwrap() {
        let path = entry.unwrap().path();
        let hidden = path.file_name().unwrap().to_string_lossy().starts_with('.');
        if path.is_dir() && !hidden {
            let found = page_file(&path);
            if found.exists() {
                return found;
            }
        } else if path.file_name().unwrap() == "page.json" {
            return path;
        }
    }
    folder.join("page.json")
}

#[test]
fn a_page_a_newer_version_saved_elsewhere_is_never_replaced() {
    let mut real = Real::new();
    let handle = real.open();
    let (_, edit) = text_block(1, "Mine");
    handle.apply(real.request(vec![edit])).unwrap();
    let path = page_file(real.notebook.path());
    let mut theirs: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    theirs["formatVersion"] = json!(999);
    theirs["minReaderVersion"] = json!(999);
    let newer = serde_json::to_vec(&theirs).unwrap();
    std::fs::write(&path, &newer).unwrap();

    let error = handle.save_now().unwrap_err();
    assert!(matches!(error, opennote_core::error::CoreError::ReadOnly(_)), "{error}");
    assert!(matches!(
        handle.read_only(),
        Some(opennote_core::model::ReadOnlyReason::NewerFormat)
    ));
    assert!(handle.has_unsaved(), "the edit stays in memory and in the journal");
    assert_eq!(std::fs::read(&path).unwrap(), newer, "the newer file stays as it is");
}
