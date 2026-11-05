//! Tests of the Word writer: known XML per property, the schema's element order in every part, round trips,
//! page setup, styles, lists, notes, comments, suggestions, headers, fonts, and privacy.

mod features;
mod props;
mod readback;
mod schema;

use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Map, Value};

use super::*;
use crate::doc::data::TextData;
use crate::doc::parse::parse_page;
use crate::doc::{Block, Marks};

const ID1: &str = "0aaaaaaaaaaaaaaaaaaaaaaaaa";
const ID2: &str = "0bbbbbbbbbbbbbbbbbbbbbbbbb";
const ID3: &str = "0ccccccccccccccccccccccccc";

/// The element IDs of a text part with `count` elements.
fn ids(count: usize) -> Vec<String> {
    (0..count).map(|i| format!("0{:a>25}", i + 1)).collect()
}

/// A text part from page Markdown and the records of its block (`paras`, `lists`, `notes`, and so on). `paras`
/// may key its entries by `#0`, `#1`, ... for the elements in order.
fn text_part(markdown: &str, records: Value) -> Part {
    let blocks = parse_page(markdown).blocks;
    let count = TextData::default().elements(&blocks).len();
    let ids = ids(count);
    let mut extra: Map<String, Value> = records.as_object().cloned().unwrap_or_default();
    if let Some(Value::Object(paras)) = extra.get("paras").cloned() {
        let keyed: Map<String, Value> = paras
            .into_iter()
            .map(|(key, value)| {
                let key = match key.strip_prefix('#').and_then(|n| n.parse::<usize>().ok()) {
                    Some(n) => ids[n].clone(),
                    None => key,
                };
                (key, value)
            })
            .collect();
        extra.insert("paras".to_owned(), Value::Object(keyed));
    }
    let styles = match extra.remove("styles") {
        Some(Value::Object(styles)) => styles
            .into_iter()
            .filter_map(|(k, v)| {
                let key = match k.strip_prefix('#').and_then(|n| n.parse::<usize>().ok()) {
                    Some(n) => ids[n].clone(),
                    None => k,
                };
                Some((key, v.as_str()?.to_owned()))
            })
            .collect(),
        _ => BTreeMap::new(),
    };
    let data = TextData::read(&ids, &styles, &extra);
    Part::Text {
        blocks,
        data: Box::new(data),
    }
}

fn input(parts: Vec<Part>, setup: Setup) -> WordInput {
    WordInput {
        title: "Test".to_owned(),
        created: crate::testing::at("2026-01-05T09:30:00Z"),
        modified: crate::testing::at("2026-02-10T18:45:00Z"),
        parts,
        media: HashMap::new(),
        setup,
    }
}

/// Builds a file and returns its parts as text, by name.
fn files(input: &WordInput) -> BTreeMap<String, String> {
    let bytes = build(input).expect("the file builds");
    read_parts(&bytes)
        .into_iter()
        .map(|(name, bytes)| (name, String::from_utf8_lossy(&bytes).into_owned()))
        .collect()
}

fn document(parts: Vec<Part>) -> String {
    files(&input(parts, Setup::default()))["word/document.xml"].clone()
}

#[test]
fn every_property_writes_its_known_xml() {
    let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/word-v2/export/known-xml.json"))
        .expect("the fixture is JSON");
    let cases = fixture["cases"].as_array().expect("cases");
    assert!(cases.len() >= 26);
    let mut failures = Vec::new();
    for case in cases {
        let markdown = case["markdown"].as_str().expect("markdown");
        let records = match case.get("para") {
            Some(para) => json!({ "paras": { "#0": para } }),
            None => json!({}),
        };
        let xml = document(vec![text_part(markdown, records)]);
        for expected in case["expect"].as_array().expect("expect") {
            let expected = expected.as_str().expect("a string");
            if !xml.contains(expected) {
                failures.push(format!("{}: {expected}\n{xml}", case["name"]));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}

#[test]
fn every_written_part_is_well_formed_and_follows_the_schema_order() {
    let parts = rich_document();
    let mut setup = rich_setup();
    setup.options.embed_fonts = vec![EmbedFont {
        family: fonts::APP_SANS.to_owned(),
        bold: false,
        italic: false,
        bytes: schema::tiny_font(0),
    }];
    let all = files(&input(parts, setup));
    let mut checked = 0;
    for (name, text) in &all {
        if !(name.ends_with(".xml") || name.ends_with(".rels")) {
            continue;
        }
        schema::check_part(name, text);
        checked += 1;
    }
    for wanted in [
        "word/footnotes.xml",
        "word/endnotes.xml",
        "word/comments.xml",
        "word/commentsExtended.xml",
        "word/header1.xml",
        "word/footer2.xml",
        "word/fontTable.xml",
        "word/theme/theme1.xml",
        "word/settings.xml",
    ] {
        assert!(
            all.contains_key(wanted),
            "{wanted} in {:?}",
            all.keys().collect::<Vec<_>>()
        );
    }
    assert!(checked >= 15, "{checked}");
}

/// Styles for the rich document.
fn rich_setup() -> Setup {
    Setup {
        styles: styles::sheet_from_json(&json!({
            "h1": {"sizePt": 20, "textColor": "theme:accent1", "align": "center", "keepNext": true},
            "u-note": {"label": "Note", "italic": true, "before": 6, "border": {"top": {"style": "double", "width": 0.75, "space": 2}}},
            "u-key": {"type": "character", "weight": 700, "caps": "small"},
        })),
        ..Setup::default()
    }
}

/// A document with every kind of content the writer knows.
fn rich_document() -> Vec<Part> {
    let markdown = concat!(
        "# Heading\n\n",
        "Plain **bold** *it* <u data-line=\"wave\" data-line-color=\"brick\">wavy</u> ",
        "<span data-font=\"Georgia\"><span data-size=\"10.5\">small</span></span> ",
        "<span data-otf=\"dlig onum ss02 tnum\">feat</span> <span data-box=\"thick\" data-box-color=\"fern\">box</span> ",
        "<span data-comment=\"0ccccccccccccccccccccccccc\">commented</span> ",
        "<span data-ins=\"0aaaaaaaaaaaaaaaaaaaaaaaaa\">added</span> <span data-del=\"0bbbbbbbbbbbbbbbbbbbbbbbbb\">gone</span> ",
        "<span data-fmt=\"0ddddddddddddddddddddddddd\">changed</span> note[^0eeeeeeeeeeeeeeeeeeeeeeeee] ",
        "end[^0fffffffffffffffffffffffff]\n\n",
        "1. one\n2. two\n\n",
        "- bullet\n\n",
        "Dropped cap paragraph.\n",
    );
    let records = json!({
        "paras": {
            "#1": {"align": "justify", "indent": {"start": 36, "end": 12, "first": 18}, "line": {"rule": "atLeast", "value": 14},
                   "tabs": [{"pos": 72, "align": "center", "leader": "none"}],
                   "shade": {"fill": "#eeeeee", "pattern": "pct10", "color": "#000000"},
                   "border": {"top": {"style": "single", "width": 1, "space": 1}, "between": {"style": "dotted", "width": 0.5, "space": 0}},
                   "keepNext": true, "keepLines": true, "widows": false, "contextual": true, "dir": "rtl", "lang": "fr-CA",
                   "outline": 3, "hyphenate": false, "breakBefore": true},
            "#2": {"list": {"id": "l1"}},
            "#3": {"list": {"id": "l1", "restart": true}},
            "#5": {"dropCap": {"mode": "drop", "lines": 3, "distance": 2}}
        },
        "styles": {"#1": "u-note"},
        "lists": {"l1": {"levels": [{"format": "upperRoman", "text": "%1)", "start": 3}]}},
        "notes": {
            "0eeeeeeeeeeeeeeeeeeeeeeeee": {"kind": "foot", "markdown": "A **footnote** with [a link](https://example.org)."},
            "0fffffffffffffffffffffffff": {"kind": "end", "markdown": "An endnote."}
        },
        "comments": {
            "0ccccccccccccccccccccccccc": {"author": "Sam", "time": "2026-10-01T09:00:00Z", "markdown": "Check this.",
                "replies": [{"author": "Ana", "time": "2026-10-02T09:00:00Z", "markdown": "Done."}], "resolved": true}
        },
        "suggestions": {
            "0aaaaaaaaaaaaaaaaaaaaaaaaa": {"kind": "ins", "author": "Sam", "time": "2026-10-01T09:00:00Z"},
            "0bbbbbbbbbbbbbbbbbbbbbbbbb": {"kind": "del", "author": "Sam", "time": "2026-10-01T09:00:00Z"},
            "0ddddddddddddddddddddddddd": {"kind": "fmt", "author": "Ana", "time": "2026-10-01T09:00:00Z", "before": "**changed**"}
        },
        "layout": {"columns": 2, "gap": 18, "rule": true}
    });
    let header = Bands {
        all: Band {
            left: "{title}".to_owned(),
            center: "{section}".to_owned(),
            right: "Page {page} of {pages}".to_owned(),
        },
        first: Some(Band::default()),
    };
    vec![
        Part::Title {
            text: "First".to_owned(),
            bookmark: Some("page_1".to_owned()),
        },
        text_part(markdown, records),
        Part::ColumnBreak,
        Part::Section {
            setup: Box::new(PageSetup {
                header: Some(header),
                page_numbers: Some(("lowerRoman".to_owned(), Some(1))),
                ..PageSetup::default()
            }),
            fields: BandFields {
                title: "First".to_owned(),
                notebook: "Book".to_owned(),
                section: "Unit 1".to_owned(),
            },
        },
        Part::Title {
            text: "Second".to_owned(),
            bookmark: None,
        },
        Part::Blocks(parse_page("More text.").blocks),
        Part::Section {
            setup: Box::new(PageSetup {
                width: 1122.52,
                height: 793.7,
                landscape: true,
                footer: Some(Bands {
                    all: Band {
                        center: "{date}".to_owned(),
                        ..Band::default()
                    },
                    first: None,
                }),
                ..PageSetup::default()
            }),
            fields: BandFields::default(),
        },
    ]
}

#[test]
fn a_rich_document_writes_notes_comments_changes_lists_and_sections() {
    let all = files(&input(rich_document(), rich_setup()));
    let doc = &all["word/document.xml"];
    // Notes.
    assert!(doc.contains("<w:footnoteReference w:id=\"1\"/>"), "{doc}");
    assert!(doc.contains("<w:endnoteReference w:id=\"1\"/>"));
    let foot = &all["word/footnotes.xml"];
    assert!(foot.contains("w:type=\"separator\" w:id=\"-1\"") && foot.contains("<w:footnoteRef/>"));
    assert!(foot.contains(">footnote</w:t>") && foot.contains("<w:b/>"), "{foot}");
    assert!(
        !foot.contains("r:id="),
        "a note has no relationships of its own: {foot}"
    );
    assert!(all["word/settings.xml"].contains("<w:footnotePr>"));
    // Comments: the comment and its reply, both resolved, each with a range around the text.
    let comments = &all["word/comments.xml"];
    assert!(comments.contains("w:author=\"Sam\" w:date=\"2026-10-01T09:00:00Z\""));
    assert!(comments.contains("w:author=\"Ana\""));
    let starts = doc.matches("<w:commentRangeStart").count();
    let ends = doc.matches("<w:commentRangeEnd").count();
    assert_eq!((starts, ends), (2, 2), "{doc}");
    let ex = &all["word/commentsExtended.xml"];
    assert_eq!(ex.matches("w15:done=\"1\"").count(), 2);
    assert!(ex.contains("w15:paraIdParent="));
    // Suggestions.
    assert!(doc.contains("<w:ins w:id=") && doc.contains("w:author=\"Sam\""));
    assert!(doc.contains("<w:delText xml:space=\"preserve\">gone</w:delText>"));
    assert!(doc.contains("<w:rPrChange w:id=") && doc.contains("w:author=\"Ana\""));
    let change = &doc[doc.find("<w:rPrChange").expect("a change")..];
    assert!(change.starts_with("<w:rPrChange") && change[..change.find("</w:rPrChange>").unwrap()].contains("<w:b/>"));
    // Lists: a definition of its own, a restart, and the plain bullets.
    let numbering = &all["word/numbering.xml"];
    assert!(numbering.contains("<w:start w:val=\"3\"/><w:numFmt w:val=\"upperRoman\"/><w:lvlText w:val=\"%1)\"/>"));
    assert_eq!(
        numbering.matches("<w:startOverride w:val=\"3\"/>").count(),
        2,
        "{numbering}"
    );
    // Paragraph keys, a paragraph style, and a drop cap.
    assert!(
        doc.contains("<w:pStyle w:val=\"u-note\"/>"),
        "the element's style: {doc}"
    );
    assert!(doc.contains("<w:framePr w:dropCap=\"drop\" w:lines=\"3\" w:hSpace=\"40\""));
    assert!(doc.contains(">D</w:t>") && doc.contains(">ropped cap paragraph.</w:t>"));
    assert!(doc.contains("<w:outlineLvl w:val=\"2\"/>") && doc.contains("<w:bidi/>"));
    assert!(doc.contains("<w:spacing w:line=\"280\" w:lineRule=\"atLeast\"/>"));
    assert!(doc.contains("<w:ind w:left=\"720\" w:right=\"240\" w:firstLine=\"360\"/>"));
    assert!(doc.contains("<w:shd w:val=\"pct10\" w:color=\"000000\" w:fill=\"EEEEEE\"/>"));
    // Columns, breaks, and sections with headers, footers, and page numbers.
    assert!(doc.contains("<w:cols w:num=\"2\" w:space=\"360\" w:sep=\"1\"/>"));
    assert!(doc.contains("<w:br w:type=\"column\"/>"));
    assert!(doc.contains("<w:pgNumType w:fmt=\"lowerRoman\" w:start=\"1\"/>"));
    assert!(doc.contains("<w:titlePg/>") && doc.contains("w:type=\"first\""));
    assert!(
        doc.contains("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\"/>"),
        "{doc}"
    );
    let header = &all["word/header1.xml"];
    assert!(
        header.contains(">First</w:t>") && header.contains(">Unit 1</w:t>"),
        "{header}"
    );
    assert!(header.contains("w:instr=\" PAGE \"") && header.contains("w:instr=\" NUMPAGES \""));
    // The first section has no footer of its own, so it gets an empty one; Word would otherwise reuse the next
    // section's footer only after it, which is right, but a header-less section after one with a header is not.
    assert!(all.keys().any(|k| k.starts_with("word/footer")));
    assert!(all.values().any(|xml| xml.contains("w:instr=\" DATE ")));
}
