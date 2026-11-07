//! Round trips through the crate's own Word import: notes, comments with replies, suggestions, headers,
//! footers, and the paper.

use std::collections::BTreeMap;

use serde_json::json;

use super::props::joined;
use super::*;
use crate::doc::data::TextData;

const NOTE1: &str = "0eeeeeeeeeeeeeeeeeeeeeeeee";
const NOTE2: &str = "0fffffffffffffffffffffffff";
const FMT: &str = "0ddddddddddddddddddddddddd";

/// Whether `s` is an element ID: 26 lowercase letters and digits.
fn is_id(s: &str) -> bool {
    s.len() == 26 && s.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
}

/// The blocks and the records they point to, with each ID replaced by its place in reading order. The import
/// makes new IDs, so two models are equal when these strings are.
fn canonical(blocks: &[Block], data: &TextData) -> String {
    let text = format!("{:?}", joined(blocks));
    let mut order: Vec<String> = Vec::new();
    for piece in text.split('"') {
        if is_id(piece) && !order.iter().any(|id| id == piece) {
            order.push(piece.to_owned());
        }
    }
    let mut out = text;
    let mut records = String::new();
    for (n, id) in order.iter().enumerate() {
        out = out.replace(&format!("\"{id}\""), &format!("\"#{n}\""));
        if let Some(note) = data.notes.get(id) {
            records.push_str(&format!("\n#{n} {note:?}"));
        }
        if let Some(comment) = data.comments.get(id) {
            records.push_str(&format!("\n#{n} {comment:?}"));
        }
        if let Some(suggestion) = data.suggestions.get(id) {
            records.push_str(&format!("\n#{n} {suggestion:?}"));
        }
    }
    out + &records
}

/// The text part of the T3 document: a comment with a reply, an insertion, a deletion, a format change, a
/// footnote with marks and a link, and an endnote. Times carry milliseconds, as the import writes them. The links
/// in the footnote and the comment go through the notes' and comments' own relationships parts.
fn annotated_part() -> Part {
    let markdown = format!(
        "Plain **bold** <span data-comment=\"{ID3}\">commented</span> <span data-ins=\"{ID1}\">added</span> \
         <span data-del=\"{ID2}\">gone</span> <span data-fmt=\"{FMT}\">changed</span> \
         note[^{NOTE1}] end[^{NOTE2}]"
    );
    let records = json!({
        "notes": {
            NOTE1: {"kind": "foot", "markdown": "A **footnote** in *two* marks, see [the site](https://example.org/a)."},
            NOTE2: {"kind": "end", "markdown": "An endnote."}
        },
        "comments": {
            ID3: {"author": "Sam", "time": "2026-10-01T09:00:00.000Z", "markdown": "Check [this](https://example.org/b).",
                "replies": [{"author": "Ana", "time": "2026-10-02T09:00:00.000Z", "markdown": "Done."}],
                "resolved": true}
        },
        "suggestions": {
            ID1: {"kind": "ins", "author": "Sam", "time": "2026-10-01T09:00:00.000Z"},
            ID2: {"kind": "del", "author": "Sam", "time": "2026-10-01T09:00:00.000Z"},
            FMT: {"kind": "fmt", "author": "Ana", "time": "2026-10-01T09:00:00.000Z", "before": "**changed**"}
        }
    });
    text_part(&markdown, records)
}

#[test]
fn notes_comments_and_suggestions_come_back_through_the_import() {
    let part = annotated_part();
    let Part::Text { blocks, data } = &part else {
        unreachable!("a text part")
    };
    let expected = canonical(blocks, data);
    let bytes = build(&input(vec![part.clone()], Setup::default())).expect("builds");
    let (got_blocks, got_data) = readback::import_text(&bytes);
    assert_eq!(canonical(&got_blocks, &got_data), expected);
    // Every record came back: two notes, one comment with its reply, and three suggestions.
    assert_eq!(
        (
            got_data.notes.len(),
            got_data.comments.len(),
            got_data.suggestions.len()
        ),
        (2, 1, 3)
    );
}

#[test]
fn headers_footers_and_the_paper_come_back_through_the_import() {
    let header = Bands {
        all: Band {
            left: "Draft".to_owned(),
            center: "Page {page} of {pages}".to_owned(),
            right: "{date}".to_owned(),
        },
        first: Some(Band::default()),
    };
    let footer = Bands {
        all: Band {
            center: "{page}".to_owned(),
            ..Band::default()
        },
        first: None,
    };
    let parts = vec![
        Part::Blocks(parse_page("Body.").blocks),
        Part::Section {
            setup: Box::new(PageSetup {
                width: 1122.52,
                height: 793.7,
                landscape: true,
                header: Some(header),
                footer: Some(footer),
                ..PageSetup::default()
            }),
            fields: BandFields::default(),
        },
    ];
    let bytes = build(&input(parts, Setup::default())).expect("builds");
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("bands.docx");
    std::fs::write(&path, &bytes).expect("writes");
    let world = crate::testing::TestEnv::new();
    let mut sink = crate::MemorySink::default();
    crate::import_docx_with(&path, crate::WordPages::Single, &world.env(), &mut sink).expect("imports");
    let page = &sink.pages[0].1.page;
    // A4 landscape: 297 x 210 mm is 1122.5 x 793.7 CSS pixels at 96 per inch.
    let paper = &page.view.paper;
    assert_eq!(
        (format!("{:?}", paper.size), format!("{:?}", paper.orientation)),
        ("a4".to_owned(), "landscape".to_owned())
    );
    assert!((paper.width - 1122.52).abs() < 0.05 && (paper.height - 793.7).abs() < 0.05);
    let empty = json!({"left": "", "center": "", "right": ""});
    assert_eq!(
        page.view.extra.get("print"),
        Some(&json!({
            "header": {"left": "Draft", "center": "Page {page} of {pages}", "right": "{date}", "firstPage": empty},
            "footer": {"left": "", "center": "{page}", "right": "", "firstPage": empty}
        }))
    );
}

/// The ID of the only element of a one-paragraph text part, and its records, for the property below.
pub(super) fn one_paragraph(runs: &[(String, Marks)], para: serde_json::Value) -> (Part, crate::doc::data::Para) {
    let blocks = vec![Block::Paragraph(
        runs.iter()
            .map(|(w, m)| crate::doc::Inline::marked(w.clone(), m.clone()))
            .collect(),
    )];
    let ids = vec![ID1.to_owned()];
    let mut extra = serde_json::Map::new();
    extra.insert("paras".into(), json!({ ID1: para }));
    let data = TextData::read(&ids, &BTreeMap::new(), &extra);
    let expected = data.paras.get(ID1).cloned().unwrap_or_default();
    (
        Part::Text {
            blocks,
            data: Box::new(data),
        },
        expected,
    )
}
