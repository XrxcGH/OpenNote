use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use opennote_interop::{CancelToken, Control, Event, ImportOptions, InteropError, Phase, Unit};
use serde_json::{json, Value};

use super::{
    commands::run_import,
    export::{self, ExportFormat, ExportPage, ExportRequest, ExportScope, ExportSection, TreeSource},
    jobs,
    restore::{self, ImportedTree},
};
use crate::core_bridge::CoreBridge;

/// A small Markdown vault: two notes in a folder and one at the top.
fn vault(base: &Path) -> PathBuf {
    let vault = base.join("Vault");
    fs::create_dir_all(vault.join("Biology")).expect("a folder");
    fs::write(
        vault.join("Biology").join("Cells.md"),
        "# Cells\n\nCells divide by mitosis.\n",
    )
    .expect("a note");
    fs::write(
        vault.join("Biology").join("Plants.md"),
        "# Plants\n\nPlants make sugar from light.\n",
    )
    .expect("a note");
    fs::write(vault.join("Welcome.md"), "# Welcome\n\nStart here.\n").expect("a note");
    vault
}

struct Imported {
    notes: PathBuf,
    notebook: PathBuf,
    tree: ImportedTree,
}

/// Imports the vault through the same steps as the command: write into the notes folder, open it in the core as a
/// notes command does, and read the tree.
fn import_vault(bridge: &CoreBridge, base: &Path) -> Imported {
    let notes = base.join("Notes");
    // The notes folder already holds a notebook, as it does after setup.
    bridge
        .notes(Some(notes.clone()), |bridge| {
            let input =
                json!({ "kind": "notebook", "placement": { "parentId": null, "beforeId": null }, "title": "Mine" });
            bridge.dispatch("notes_create", &json!({ "input": input })).map(|_| ())
        })
        .expect("a first notebook");
    let device = bridge.with(|bridge| Ok(bridge.core.device())).expect("a device");
    restore::clean_staging(&notes);
    let (report, notebook) = run_import(&notes, &vault(base), &ImportOptions::default(), device, Control::none())
        .expect("the vault imports");
    assert_eq!(report.pages.len(), 3);
    let tree = bridge
        .notes(Some(notes.clone()), |bridge| {
            let handle = bridge.core.open_notebook(&notebook).expect("the notebook opens");
            Ok(restore::tree_of(&handle))
        })
        .expect("the tree");
    Imported { notes, notebook, tree }
}

/// The core page IDs of the tree, in display order.
fn pages_of(tree: &ImportedTree) -> Vec<String> {
    tree.sections
        .iter()
        .flat_map(|section| &section.pages)
        .map(|page| page.core.clone())
        .collect()
}

fn page_json(bridge: &CoreBridge, notes: &Path, page: &str) -> String {
    bridge
        .notes(Some(notes.to_path_buf()), |bridge| {
            let handle = bridge.handle(page, "main-1")?;
            let envelope = handle.envelope(None).expect("an envelope");
            let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).expect("decodes");
            Ok(String::from_utf8_lossy(decoded.page_json).into_owned())
        })
        .expect("the page opens")
}

#[test]
fn an_imported_notebook_is_a_real_notebook_folder_in_the_notes_tree_and_survives_a_restart() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let local = dir.path().join("app");
    let bridge = CoreBridge::at(local.clone());
    let imported = import_vault(&bridge, dir.path());
    assert_eq!(imported.notebook.parent(), Some(imported.notes.as_path()));
    assert!(imported.notebook.join("notebook.json").is_file());
    // The notes commands list it beside the notebook that was there, with the IDs the tree gave.
    let listed = bridge
        .notes(Some(imported.notes.clone()), |bridge| {
            bridge.dispatch("notes_list_notebooks", &json!({}))
        })
        .expect("the notebooks");
    let ids: Vec<&str> = listed
        .as_array()
        .expect("a list")
        .iter()
        .filter_map(|node| node["id"].as_str())
        .collect();
    assert_eq!(ids.len(), 2, "{listed}");
    assert!(ids.contains(&imported.tree.notebook_id.as_str()));
    let pages = pages_of(&imported.tree);
    assert_eq!(pages.len(), 3);
    let node = bridge
        .notes(Some(imported.notes.clone()), |bridge| {
            bridge.dispatch("notes_get", &json!({ "id": pages[0] }))
        })
        .expect("a page node");
    assert_eq!(node["kind"], "page");
    let all: String = pages
        .iter()
        .map(|page| page_json(&bridge, &imported.notes, page))
        .collect();
    assert!(all.contains("mitosis") && all.contains("sugar from light") && all.contains("Start here"));
    bridge.shutdown();

    // Another start opens the imported notebook from the notes folder like any other.
    let again = CoreBridge::at(local);
    let all: String = pages
        .iter()
        .map(|page| page_json(&again, &imported.notes, page))
        .collect();
    let after = again
        .notes(Some(imported.notes.clone()), |bridge| {
            bridge.dispatch("notes_list_notebooks", &json!({}))
        })
        .expect("the notebooks");
    again.shutdown();
    assert!(all.contains("mitosis") && all.contains("Start here"));
    assert_eq!(after.as_array().expect("a list").len(), 2);
}

#[test]
fn an_import_leaves_the_notes_folder_with_only_notebook_folders() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let bridge = CoreBridge::at(dir.path().join("app"));
    let imported = import_vault(&bridge, dir.path());
    bridge.shutdown();
    let names: Vec<String> = fs::read_dir(&imported.notes)
        .expect("the notes folder")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|name| !name.starts_with(".importing-")), "{names:?}");
    assert_eq!(names.len(), 2, "{names:?}");
}

#[test]
fn a_crashed_imports_working_folder_is_cleaned_up() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let stale = dir.path().join(".importing-1234");
    fs::create_dir_all(stale.join("half")).expect("a leftover");
    fs::create_dir_all(dir.path().join("Biology")).expect("a notebook folder");
    restore::clean_staging(dir.path());
    assert!(!stale.exists());
    assert!(dir.path().join("Biology").is_dir());
}

fn request(format: ExportFormat, scope: ExportScope, folder: &Path, pages: &[String]) -> ExportRequest {
    let page = |ui: &str, title: &str, level: u8| ExportPage {
        ui: ui.to_owned(),
        title: title.to_owned(),
        level,
    };
    ExportRequest {
        format,
        scope,
        title: "Biology".to_owned(),
        sections: vec![ExportSection {
            title: "Unit one".to_owned(),
            pages: vec![
                page(&pages[0], "Cells", 0),
                page(&pages[1], "Plants", 1),
                // A page the core doesn't know has no files to read.
                page("ui-never", "Fresh page", 0),
            ],
        }],
        folder: folder.to_string_lossy().into_owned(),
    }
}

fn imported_bridge(dir: &Path) -> (CoreBridge, Imported) {
    let bridge = CoreBridge::at(dir.join("app"));
    let imported = import_vault(&bridge, dir);
    (bridge, imported)
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in fs::read_dir(&next).expect("a folder").flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                found.push(path);
            }
        }
    }
    found.sort();
    found
}

#[test]
fn a_markdown_export_writes_the_interface_tree_with_its_pages() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (bridge, imported) = imported_bridge(dir.path());
    let pages = pages_of(&imported.tree);
    let out = dir.path().join("out");
    fs::create_dir_all(&out).expect("an output folder");
    let request = request(ExportFormat::Markdown, ExportScope::Notebook, &out, &pages);
    let source = bridge
        .with(|bridge| Ok(TreeSource::build(bridge, &request)))
        .expect("the bridge")
        .expect("the source");
    let exported = export::run(&source, &request, &Control::none()).expect("the export");
    bridge.shutdown();
    assert_eq!(exported.files.len(), 3);
    let text: String = files_under(&exported.root)
        .iter()
        .filter(|path| path.extension().is_some_and(|ext| ext == "md"))
        .map(|path| fs::read_to_string(path).expect("a page"))
        .collect();
    assert!(text.contains("mitosis"), "{text}");
    assert!(text.contains("Fresh page"), "{text}");
}

#[test]
fn a_section_export_and_a_word_export_each_write_their_files() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (bridge, imported) = imported_bridge(dir.path());
    let pages = pages_of(&imported.tree);
    let out = dir.path().join("out");
    fs::create_dir_all(&out).expect("an output folder");
    let word = request(ExportFormat::Docx, ExportScope::Section, &out, &pages);
    let single = request(ExportFormat::HtmlSingle, ExportScope::Notebook, &out, &pages);
    let (word_done, single_done) = bridge
        .with(|bridge| {
            let word_source = TreeSource::build(bridge, &word).expect("the source");
            let single_source = TreeSource::build(bridge, &single).expect("the source");
            Ok((
                export::run(&word_source, &word, &Control::none()),
                export::run(&single_source, &single, &Control::none()),
            ))
        })
        .expect("the bridge");
    bridge.shutdown();
    let word_done = word_done.expect("the Word export");
    let single_done = single_done.expect("the single page export");
    assert!(word_done
        .files
        .iter()
        .any(|path| path.extension().is_some_and(|ext| ext == "docx")));
    assert!(single_done
        .files
        .iter()
        .any(|path| path.extension().is_some_and(|ext| ext == "html")));
}

#[test]
fn pdf_export_says_it_is_not_here_yet_and_writes_nothing() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (bridge, imported) = imported_bridge(dir.path());
    let pages = pages_of(&imported.tree);
    let out = dir.path().join("out");
    fs::create_dir_all(&out).expect("an output folder");
    let request = request(ExportFormat::Pdf, ExportScope::Notebook, &out, &pages);
    let result = bridge
        .with(|bridge| {
            let source = TreeSource::build(bridge, &request).expect("the source");
            Ok(export::run(&source, &request, &Control::none()))
        })
        .expect("the bridge");
    bridge.shutdown();
    assert!(matches!(result, Err(InteropError::Unsupported { .. })));
    assert!(files_under(&out).is_empty());
}

#[test]
fn a_canceled_import_leaves_no_notebook_behind() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let bridge = CoreBridge::at(dir.path().join("app"));
    let device = bridge.with(|bridge| Ok(bridge.core.device())).expect("a device");
    let token = CancelToken::new();
    token.cancel();
    let parent = dir.path().join("imports");
    let result = run_import(
        &parent,
        &vault(dir.path()),
        &ImportOptions::default(),
        device,
        Control::with_cancel(token),
    );
    bridge.shutdown();
    assert!(matches!(result, Err(InteropError::Canceled)));
    assert_eq!(fs::read_dir(&parent).expect("the parent").count(), 0);
}

#[test]
fn a_running_job_cancels_by_name_and_forgets_itself_when_done() {
    let emit: jobs::Emit = Arc::new(|_| {});
    let (job, control) = jobs::Job::start("job-a", emit);
    assert!(!control.token().is_canceled());
    assert!(jobs::cancel("job-a"));
    assert!(control.token().is_canceled());
    drop(job);
    assert!(!jobs::cancel("job-a"));
}

#[test]
fn progress_events_are_thinned_but_the_ends_of_a_job_always_arrive() {
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = seen.clone();
    let emit: jobs::Emit = Arc::new(move |payload| sink.lock().expect("the log").push(payload));
    let (job, control) = jobs::Job::start("job-b", emit);
    control.emit(&Event::Started {
        what: "Import".to_owned(),
    });
    control.begin(Phase::Converting, Unit::Items, Some(500));
    for _ in 0..500 {
        control.step(Phase::Converting, 1, "page");
    }
    control.emit(&Event::Finished { pages: 500 });
    drop(job);
    let seen = seen.lock().expect("the log");
    let kinds: Vec<&str> = seen.iter().filter_map(|payload| payload["event"].as_str()).collect();
    assert_eq!(kinds.first(), Some(&"started"));
    assert_eq!(kinds.last(), Some(&"finished"));
    assert!(
        kinds.iter().filter(|kind| **kind == "progress").count() < 50,
        "{}",
        kinds.len()
    );
    assert!(seen.iter().all(|payload| payload["job"] == "job-b"));
}
