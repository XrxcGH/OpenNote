//! The local API's backend over a real core in a temporary folder: listing, reading as Markdown, adding a page with
//! its source link, adding to a page, and the "via <app>" names in page history.

use std::sync::Arc;

use serde_json::json;

use super::*;
use crate::core_bridge::CoreBridge;

struct Fixture {
    _dir: tempfile::TempDir,
    bridge: Arc<CoreBridge>,
    notes: PathBuf,
    notebook: String,
    section: String,
    page: String,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("a temp folder");
    let (local, notes) = (dir.path().join("local"), dir.path().join("Notes"));
    let bridge = Arc::new(CoreBridge::at(local));
    let (notebook, section, page) = bridge
        .notes(Some(notes.clone()), |bridge| {
            let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>, title: &str| {
                let input =
                    json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null }, "title": title });
                let node = bridge.dispatch("notes_create", &json!({ "input": input }))?;
                Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
            };
            let notebook = create(bridge, "notebook", None, "Biology")?;
            let section = create(bridge, "section", Some(notebook.clone()), "Cells")?;
            let page = create(bridge, "page", Some(section.clone()), "Membranes")?;
            Ok((notebook, section, page))
        })
        .expect("a notebook");
    Fixture {
        _dir: dir,
        bridge,
        notes,
        notebook,
        section,
        page,
    }
}

fn backend(fixture: &Fixture) -> CoreBackend {
    CoreBackend::new(Notes::Test(fixture.bridge.clone(), fixture.notes.clone()))
}

fn history_names(fixture: &Fixture, page: &str) -> Vec<String> {
    fixture
        .bridge
        .notes(Some(fixture.notes.clone()), |bridge| {
            let handle = bridge.handle(page, "history-check")?;
            let names = handle
                .history()
                .map_err(|error| IpcError::new("io", error.to_string()))?
                .into_iter()
                .filter_map(|entry| entry.name)
                .collect();
            bridge.close_client(page, "history-check");
            Ok(names)
        })
        .expect("history")
}

#[test]
fn lists_the_notebook_its_sections_and_pages() {
    let fixture = fixture();
    let api = backend(&fixture);
    let notebooks = api.notebooks().expect("notebooks");
    assert!(notebooks
        .iter()
        .any(|notebook| notebook.id == fixture.notebook && notebook.title == "Biology"));
    let sections = api.sections(&fixture.notebook).expect("sections");
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0].title, "Cells");
    assert!(!sections[0].locked);
    let pages = api.pages(&fixture.section).expect("pages");
    assert_eq!(
        pages.iter().map(|page| page.title.as_str()).collect::<Vec<_>>(),
        ["Membranes"]
    );
    let place = api.locate(&fixture.page).expect("located");
    assert_eq!(place.notebook_id, fixture.notebook);
    assert_eq!(place.section_id.as_deref(), Some(fixture.section.as_str()));
    assert_eq!(
        api.locate("01k6f00000000000000000zzzz").unwrap_err(),
        BackendError::NotFound
    );
}

#[test]
fn adds_a_page_with_its_source_and_names_it_in_page_history() {
    let fixture = fixture();
    let api = backend(&fixture);
    let created = api
        .create_page(
            &fixture.section,
            NewPage {
                title: "Clipped".into(),
                markdown: "Cell walls are rigid.".into(),
                source_url: Some("https://example.org/cells".into()),
                attachments: Vec::new(),
            },
            "Web clipper",
        )
        .expect("created");
    assert_eq!(created.title, "Clipped");
    let text = api.read_page(&created.id).expect("read");
    assert!(text.markdown.starts_with("# Clipped"), "{}", text.markdown);
    assert!(
        text.markdown.contains("Source: <https://example.org/cells>"),
        "{}",
        text.markdown
    );
    assert!(text.markdown.contains("Cell walls are rigid."));
    assert_eq!(history_names(&fixture, &created.id), ["Added via Web clipper"]);
}

#[test]
fn adds_to_the_end_of_a_page_as_one_named_step() {
    let fixture = fixture();
    let api = backend(&fixture);
    api.append(&fixture.page, "First line.", "opennote").expect("appended");
    api.append(&fixture.page, "Second line.", "opennote")
        .expect("appended again");
    let text = api.read_page(&fixture.page).expect("read").markdown;
    let (first, second) = (
        text.find("First line.").expect("first"),
        text.find("Second line.").expect("second"),
    );
    assert!(first < second, "{text}");
    assert_eq!(
        history_names(&fixture, &fixture.page),
        ["Changed via opennote", "Changed via opennote"]
    );
}

#[test]
fn refuses_to_put_a_page_anywhere_but_a_section() {
    let fixture = fixture();
    let api = backend(&fixture);
    let page = NewPage {
        title: "Nope".into(),
        ..NewPage::default()
    };
    assert!(matches!(
        api.create_page(&fixture.notebook, page.clone(), "x"),
        Err(BackendError::Invalid(_))
    ));
    assert!(matches!(
        api.create_page(&fixture.page, page, "x"),
        Err(BackendError::Invalid(_))
    ));
}

#[test]
fn the_daily_note_is_made_once_and_added_to() {
    let fixture = fixture();
    let api = backend(&fixture);
    let first = api.append_daily("Met with Sam.", "opennote").expect("daily");
    let again = api.append_daily("Then lunch.", "opennote").expect("daily again");
    assert_eq!(first.id, again.id);
    assert_eq!(first.title, local_today());
    let text = api.read_page(&first.id).expect("read").markdown;
    assert!(text.contains("Met with Sam.") && text.contains("Then lunch."), "{text}");
    let target = api.daily_target().expect("target");
    assert_eq!(target.section_id.as_deref(), Some(first.section_id.as_str()));
}
