//! The Word import end to end: files made of hand-written parts, and fixtures laid out as Word and Google Docs
//! save documents. Expected values come from ECMA-376 and from converting each fixture's units by hand.

use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use serde_json::{json, Map, Value};

use crate::testing::{zip_bytes, zip_dir, TestEnv};
use crate::{import_docx, MemorySink};

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/word-v2/import")
        .join(name)
}

/// Imports a Word file from its bytes.
pub(super) fn import_bytes(bytes: &[u8]) -> MemorySink {
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("Document.docx");
    std::fs::write(&path, bytes).expect("writes the file");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import_docx(&path, &world.env(), &mut sink).expect("imports");
    sink
}

/// A Word file of a document body and, optionally, other parts of the `word` folder.
pub(super) fn docx(body: &str, parts: &[(&str, &str)]) -> Vec<u8> {
    let document = format!("<w:document {W}><w:body>{body}</w:body></w:document>");
    let mut files: Vec<(String, Vec<u8>)> = vec![("word/document.xml".to_owned(), document.into_bytes())];
    for (name, xml) in parts {
        files.push((format!("word/{name}"), xml.as_bytes().to_vec()));
    }
    let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
    zip_bytes(&refs)
}

pub(super) fn first_page(sink: &MemorySink) -> &Page {
    &sink.pages.first().expect("a page").1.page
}

/// The text blocks of a page, in order: markdown and data.
pub(super) fn text_blocks(page: &Page) -> Vec<(String, opennote_core::model::TextData)> {
    let mut blocks: Vec<_> = page.blocks.iter().collect();
    blocks.sort_by(|a, b| a.order.cmp(&b.order));
    blocks
        .into_iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some((t.markdown.to_string(), t.clone())),
            _ => None,
        })
        .collect()
}

/// The page as JSON that does not depend on generated IDs: each block with its Markdown and data, element
/// entries by index, and record IDs as `id1`, `id2`, ... in order of first use.
pub(super) fn summary(page: &Page) -> Value {
    let mut blocks: Vec<_> = page.blocks.iter().collect();
    blocks.sort_by(|a, b| a.order.cmp(&b.order));
    let mut out = Vec::new();
    let mut record_ids: Vec<String> = Vec::new();
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
        let mut entry = Map::new();
        entry.insert("kind".to_owned(), Value::from("text"));
        entry.insert("markdown".to_owned(), Value::from(t.markdown.to_string()));
        entry.insert("elements".to_owned(), Value::from(t.ids.len()));
        entry.insert("styles".to_owned(), Value::Object(styles));
        if let Some(paras) = t.extra.get("paras").and_then(Value::as_object) {
            let paras: Map<String, Value> = paras
                .iter()
                .filter_map(|(id, v)| Some((index(id)?, v.clone())))
                .collect();
            entry.insert("paras".to_owned(), Value::Object(paras));
        }
        for key in ["lists", "notes", "comments", "suggestions"] {
            if let Some(value) = t.extra.get(key) {
                if key != "lists" {
                    record_ids.extend(value.as_object().into_iter().flat_map(|m| m.keys().cloned()));
                }
                entry.insert(key.to_owned(), value.clone());
            }
        }
        out.push(Value::Object(entry));
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
    if let Some(print) = page.view.extra.get("print") {
        summary["print"] = print.clone();
    }
    let mut text = summary.to_string();
    let mut order: Vec<(usize, String)> = record_ids
        .into_iter()
        .filter_map(|id| Some((text.find(&id)?, id)))
        .collect();
    order.sort();
    order.dedup_by(|a, b| a.1 == b.1);
    for (n, (_, id)) in order.iter().enumerate() {
        text = text.replace(id.as_str(), &format!("id{}", n + 1));
    }
    let mut value: Value = serde_json::from_str(&text).expect("JSON");
    // Whole numbers compare as numbers, however they were written.
    normalize(&mut value);
    value
}

fn normalize(value: &mut Value) {
    match value {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f.abs() < 1e15 {
                    *value = Value::from(f as i64);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize),
        Value::Object(map) => map.values_mut().for_each(normalize),
        _ => {}
    }
}

fn markdown(page: &Page) -> String {
    text_blocks(page)
        .into_iter()
        .map(|(m, _)| m)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn run(rpr: &str, text: &str) -> String {
    format!(r#"<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

#[test]
fn toggles_in_styles_cancel_and_direct_bold_is_bold() {
    // ECMA-376 Part 1, 17.7.3: bold in the paragraph style plus bold in the character style is not bold, and
    // direct formatting sets the value.
    let styles = format!(
        r#"<w:styles {W}>
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="Loud"><w:name w:val="Loud"/><w:basedOn w:val="Normal"/><w:rPr><w:b/>
        </w:rPr></w:style>
        <w:style w:type="character" w:styleId="Strongish"><w:name w:val="Strongish"/><w:rPr><w:b/></w:rPr></w:style>
        </w:styles>"#
    );
    let style_run = |direct: &str, text: &str| run(&format!(r#"<w:rStyle w:val="Strongish"/>{direct}"#), text);
    let body = format!(
        r#"<w:p><w:pPr><w:pStyle w:val="Loud"/></w:pPr>{}{}</w:p><w:p>{}</w:p>"#,
        style_run("", "neither"),
        style_run("<w:b/>", " direct"),
        style_run("", "bold"),
    );
    let sink = import_bytes(&docx(&body, &[("styles.xml", &styles)]));
    let page = first_page(&sink);
    let text = markdown(page);
    assert_eq!(
        text, "<span data-style=\"u-plain-b\">neither</span> direct\n\n**bold**",
        "the style's bold is turned off for the first run only"
    );
    let sheet = page.extra.get("styles").expect("a page style sheet");
    assert_eq!(sheet["u-loud"]["weight"], json!(700), "the paragraph style is bold");
    assert_eq!(sheet["u-plain-b"]["type"], json!("character"));
    assert_eq!(sheet["u-plain-b"]["weight"], json!(400), "the run is not bold");
    let (_, data) = &text_blocks(page)[0];
    assert_eq!(
        data.styles.values().collect::<Vec<_>>(),
        ["u-loud"],
        "the first paragraph has its style"
    );
}

#[test]
fn named_weight_faces_split_only_for_families_that_have_them() {
    // "Segoe UI Semibold" and "Segoe UI Light" are faces of Segoe UI. "Arial Black" and "Franklin Gothic Medium"
    // are families of their own, and "Segoe UI Semilight" weighs 350, which no weight name gives.
    let font = |name: &str| format!(r#"<w:rFonts w:ascii="{name}" w:hAnsi="{name}"/>"#);
    let body = format!(
        "<w:p>{} {} {} {} {}</w:p>",
        run(&font("Segoe UI Semibold"), "semi"),
        run(&format!("{}<w:b/>", font("Segoe UI Light")), "light"),
        run(&font("Arial Black"), "black"),
        run(&font("Franklin Gothic Medium"), "medium"),
        run(&font("Segoe UI Semilight"), "semilight"),
    );
    let sink = import_bytes(&docx(&body, &[]));
    let text = markdown(first_page(&sink));
    for expected in [
        r#"<span data-weight="600"><span data-font="Segoe UI">semi</span></span>"#,
        r#"<span data-weight="300"><span data-font="Segoe UI">light</span></span>"#,
        r#"<span data-font="Arial Black">black</span>"#,
        r#"<span data-font="Franklin Gothic Medium">medium</span>"#,
        r#"<span data-font="Segoe UI Semilight">semilight</span>"#,
    ] {
        assert!(text.contains(expected), "{expected} in {text}");
    }
    assert!(!text.contains("**"), "a light face with w:b is not also bold: {text}");
}

#[test]
fn theme_fonts_resolve_through_the_theme() {
    let theme = r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
        <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
        <a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#;
    let styles = format!(
        r#"<w:styles {W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>
            </w:rPrDefault></w:docDefaults>
        <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>"#
    );
    let body = format!(
        "<w:p>{}{}</w:p>",
        run(
            r#"<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/>"#,
            "body"
        ),
        run(
            r#"<w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/>"#,
            " heading"
        ),
    );
    let sink = import_bytes(&docx(&body, &[("styles.xml", &styles), ("theme/theme1.xml", theme)]));
    let page = first_page(&sink);
    assert_eq!(
        markdown(page),
        // A font does not show on spaces, so the space at the edge moves outside the tag (R-WS-1).
        r#"<span data-font="Calibri">body</span> <span data-font="Calibri Light">heading</span>"#
    );
    assert_eq!(page.extra["styles"]["normal"]["font"], json!("Georgia"));
}

#[test]
fn highlights_keep_their_exact_colors() {
    // ECMA-376 Part 1, 17.18.40: darkYellow is 808000 and lightGray is C0C0C0.
    let body = format!(
        "<w:p>{}{}</w:p>",
        run(r#"<w:highlight w:val="darkYellow"/>"#, "dark yellow"),
        run(r#"<w:highlight w:val="lightGray"/>"#, " light gray"),
    );
    let sink = import_bytes(&docx(&body, &[]));
    assert_eq!(
        markdown(first_page(&sink)),
        r##"<mark data-color="#808000">dark yellow</mark><mark data-color="#c0c0c0"> light gray</mark>"##
    );
}

#[test]
fn sizes_and_indents_become_points() {
    // w:sz is in half-points, so 21 is 10.5 points; w:ind is in twips, so 720 is 36 points and 360 is 18.
    let body = format!(
        r#"<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>{}</w:p>"#,
        run(r#"<w:sz w:val="21"/>"#, "small print"),
    );
    let sink = import_bytes(&docx(&body, &[]));
    let page = first_page(&sink);
    let summary = summary(page);
    assert_eq!(
        summary["blocks"][0]["markdown"],
        json!(r#"<span data-size="10.5">small print</span>"#)
    );
    assert_eq!(
        summary["blocks"][0]["paras"],
        json!({"0": {"indent": {"start": 36, "end": 0, "first": -18}}})
    );
}

#[test]
fn a_document_saved_by_word_imports_to_the_expected_json() {
    let sink = import_bytes(&zip_dir(&fixture("word-15-features")));
    let expected: Value = serde_json::from_str(
        &std::fs::read_to_string(fixture("word-15-features.expected.json")).expect("the expected JSON"),
    )
    .expect("JSON");
    let mut expected = expected;
    normalize(&mut expected);
    let actual = summary(first_page(&sink));
    assert_eq!(
        actual,
        expected,
        "{}",
        serde_json::to_string_pretty(&actual).unwrap_or_default()
    );
}

#[test]
fn a_google_docs_export_brings_docs_style_values_into_the_page_sheet() {
    let sink = import_bytes(&zip_dir(&fixture("google-docs-headings-lists")));
    let page = first_page(&sink);
    assert_eq!(page.title, "Trip plan");
    let mut sheet = page.extra.get("styles").cloned().expect("a page style sheet");
    normalize(&mut sheet);
    // Normal is Arial 11 at line spacing 1.15 (276 / 240); 11 points are 14.67 page units.
    assert_eq!(sheet["normal"]["font"], json!("Arial"));
    assert_eq!(sheet["normal"]["sizePt"], json!(11));
    assert_eq!(sheet["normal"]["line"], json!({"rule": "multiple", "value": 1.15}));
    // Title 26, Subtitle 15 in #666666, Heading 1 20, Heading 2 16, Heading 3 14 in #434343 (half-points / 2).
    assert_eq!(sheet["title"]["sizePt"], json!(26));
    assert_eq!(sheet["subtitle"]["sizePt"], json!(15));
    assert_eq!(sheet["subtitle"]["textColor"], json!("#666666"));
    assert_eq!(sheet["h1"]["sizePt"], json!(20));
    assert_eq!(sheet["h1"]["before"], json!(20), "400 twips before");
    assert_eq!(sheet["h1"]["after"], json!(6), "120 twips after");
    assert_eq!(sheet["h2"]["sizePt"], json!(16));
    assert_eq!(sheet["h3"]["sizePt"], json!(14));
    assert_eq!(sheet["h3"]["textColor"], json!("#434343"));
    assert_eq!(
        sheet["h1"]["font"],
        json!("Arial"),
        "the headings inherit the default font"
    );
    let summary = summary(page);
    let block = &summary["blocks"][0];
    assert_eq!(
        block["markdown"],
        json!(concat!(
            "## Spring 2026\n\n# Packing\n\n- Tent\n\n  - Stakes\n\n- Stove\n\n## Route\n\n",
            "1. Drive north\n2. Camp by the lake\n\n### Notes\n\nBring water."
        ))
    );
    assert_eq!(block["styles"], json!({"0": "subtitle"}));
    let bullets = json!({"list": {"id": "a1"}});
    let numbers = json!({"list": {"id": "a2"}});
    assert_eq!(
        block["paras"],
        json!({"2": bullets, "3": bullets, "4": bullets, "6": numbers, "7": numbers})
    );
    // Docs' bullets are filled circle, circle, and square; levels indent by 720 twips (36 points).
    assert_eq!(
        block["lists"]["a1"],
        json!({"levels": [
            {"format": "bullet", "symbol": "\u{25cf}", "indent": 36, "hanging": 18},
            {"format": "bullet", "symbol": "\u{25cb}", "indent": 72, "hanging": 18},
            {"format": "bullet", "symbol": "\u{25a0}", "indent": 108, "hanging": 18}
        ]})
    );
    assert_eq!(
        block["lists"]["a2"]["levels"][2],
        json!({"format": "lowerRoman", "text": "%3.", "indent": 108, "hanging": 18, "align": "end"})
    );
}

#[test]
fn tracked_insertions_become_suggestions_with_author_and_time() {
    let body = format!(
        r#"<w:p>{}<w:ins w:id="1" w:author="Ann Lee" w:date="2026-10-01T09:30:00Z">{}</w:ins>
        <w:del w:id="2" w:author="Ben Ito" w:date="2026-10-02T11:00:00Z"><w:r>
        <w:delText xml:space="preserve"> old</w:delText></w:r></w:del></w:p>"#,
        run("", "Kept "),
        run("", "added"),
    );
    let sink = import_bytes(&docx(&body, &[]));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(
        block["markdown"],
        json!(r#"Kept <span data-ins="id1">added</span><span data-del="id2"> old</span>"#)
    );
    assert_eq!(
        block["suggestions"],
        json!({
            "id1": {"kind": "ins", "author": "Ann Lee", "time": "2026-10-01T09:30:00.000Z"},
            "id2": {"kind": "del", "author": "Ben Ito", "time": "2026-10-02T11:00:00.000Z"}
        })
    );
}
