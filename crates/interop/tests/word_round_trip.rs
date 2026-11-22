//! The 15-feature Word page survives export then import with no change to its document JSON.
//!
//! The page is the fixture saved by Word (`tests/fixtures/word-v2/import/word-15-features`). The test reads it,
//! writes it back as a Word file, reads that file, and compares what each read produced.

use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{zip_dir, TestEnv};
use opennote_interop::{export_docx, import_docx, MemorySink, MemorySource, Scope};
use serde_json::{json, Map, Value};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/word-v2/import")
        .join(name)
}

fn import_file(path: &std::path::Path) -> MemorySink {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import_docx(path, &world.env(), &mut sink).expect("imports");
    sink
}

/// The page as JSON that does not depend on generated IDs: each text block's Markdown, element count, element
/// styles and paragraph attributes by element index, then the page's style sheet, theme, and paper.
fn document_json(page: &Page) -> Value {
    let mut blocks: Vec<_> = page.blocks.iter().collect();
    blocks.sort_by(|a, b| a.order.cmp(&b.order));
    let mut out = Vec::new();
    for block in blocks {
        let BlockData::Text(t) = &block.data else {
            out.push(json!({"kind": "other"}));
            continue;
        };
        let index = |id: &str| t.ids.iter().position(|e| e.to_string() == id).map(|n| n.to_string());
        let styles: Map<String, Value> = t
            .styles
            .iter()
            .filter_map(|(id, name)| Some((index(&id.to_string())?, Value::from(name.clone()))))
            .collect();
        let paras: Map<String, Value> = t
            .extra
            .get("paras")
            .and_then(Value::as_object)
            .map(|paras| {
                paras
                    .iter()
                    .filter_map(|(id, v)| Some((index(id)?, v.clone())))
                    .collect()
            })
            .unwrap_or_default();
        out.push(json!({
            "markdown": t.markdown.to_string(),
            "elements": t.ids.len(),
            "styles": styles,
            "paras": paras,
        }));
    }
    let paper = &page.view.paper;
    let mut summary = json!({
        "blocks": out,
        "paper": {
            "size": paper.size.as_str(),
            "orientation": paper.orientation.as_str(),
            "width": paper.width,
            "height": paper.height,
            "margins": paper.margins,
        },
    });
    for key in ["styles", "theme"] {
        if let Some(value) = page.extra.get(key) {
            summary[key] = value.clone();
        }
    }
    summary
}

#[test]
fn the_15_feature_page_is_unchanged_by_a_word_export_and_import() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let original = dir.path().join("Original.docx");
    std::fs::write(&original, zip_dir(&fixture("word-15-features"))).expect("writes the fixture");
    let first = import_file(&original);
    let before = document_json(&first.pages.first().expect("a page").1.page);

    let id = first.pages.first().expect("a page").1.page.id;
    let source = MemorySource::from_sink(first).expect("a notebook");
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_docx(&source, Scope::Page(id), out.path()).expect("exports");
    let file = exported.files.first().expect("a file").clone();

    let second = import_file(&file);
    let mut after = document_json(&second.pages.first().expect("a page").1.page);
    // The export writes the page's title as a Title paragraph, and the import turns it back into the page title.
    // The Title style it used stays in the sheet, so the sheet may gain `title` and `subtitle`. Nothing else may
    // be added, and every style the original had must come back with the same values.
    if let Some(sheet) = after["styles"].as_object_mut() {
        for extra in ["title", "subtitle"] {
            if before["styles"].get(extra).is_none() {
                sheet.remove(extra);
            }
        }
    }
    assert_eq!(
        after,
        before,
        "after:
{}
before:
{}",
        serde_json::to_string_pretty(&after).unwrap_or_default(),
        serde_json::to_string_pretty(&before).unwrap_or_default()
    );
}
