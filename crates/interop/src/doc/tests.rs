//! Tests of the document model against the shared fixtures of `docs/format/fixtures/markdown/`.

use std::collections::HashMap;

use opennote_core::Timestamp;
use serde_json::Value;

use super::*;
use crate::docx::{build, read_parts, Part, WordInput};

/// The `document.xml` of a Word file that holds one paragraph.
fn word_body(inlines: Vec<Inline>) -> String {
    let input = WordInput {
        title: "Sizes".to_owned(),
        created: Timestamp::EPOCH,
        modified: Timestamp::EPOCH,
        parts: vec![Part::Blocks(vec![Block::Paragraph(inlines)])],
        media: HashMap::new(),
    };
    let docx = build(&input).expect("the file builds");
    let (_, xml) = read_parts(&docx)
        .into_iter()
        .find(|(name, _)| name == "word/document.xml")
        .expect("a document part");
    String::from_utf8(xml).expect("UTF-8")
}

fn sized(size: &str) -> Inline {
    Inline::marked(
        "word",
        Marks {
            size: Some(size.to_owned()),
            ..Marks::none()
        },
    )
}

#[test]
fn size_names_scale_the_12_point_body() {
    assert_eq!(size_points("small"), Some(10.0));
    assert_eq!(size_points("large"), Some(15.0));
    assert_eq!(size_points("xlarge"), Some(18.0));
    assert_eq!(size_points("10.5"), Some(10.5));
    assert_eq!(size_points("0.5"), None);
    assert_eq!(size_points("huge"), None);
    assert_eq!(size_value(" Large ").as_deref(), Some("large"));
    assert_eq!(size_value("10.5").as_deref(), Some("10.5"));
    assert_eq!(size_value("10.50"), None);
}

#[test]
fn large_writes_as_30_half_points_downstream() {
    // w:sz is in half-points (ECMA-376 Part 1, 17.3.2.38): 15 points is 30, 10 is 20, and 18 is 36.
    for (size, half_points) in [("large", 30), ("small", 20), ("xlarge", 36), ("10.5", 21)] {
        let xml = word_body(vec![sized(size)]);
        assert!(
            xml.contains(&format!("<w:sz w:val=\"{half_points}\"/>")),
            "{size}: {xml}"
        );
    }
}

/// The marks of a fixture run (`docs/format/fixtures/markdown/README.md`).
fn fixture_marks(list: &Value) -> Marks {
    let mut marks = Marks::none();
    let text = |v: &Value| v.as_str().map(str::to_owned);
    for mark in list.as_array().into_iter().flatten() {
        if let Some(name) = mark.as_str() {
            match name {
                "strong" => marks.strong = true,
                "emphasis" => marks.emphasis = true,
                "strike" => marks.strike = true,
                "underline" => marks.underline = true,
                "highlight" => marks.highlight = Some("honey".to_owned()),
                "sub" => marks.script = Some(Script::Sub),
                "sup" => marks.script = Some(Script::Sup),
                "code" => marks.code = true,
                other => panic!("unknown mark {other}"),
            }
            continue;
        }
        let (key, value) = mark.as_object().and_then(|o| o.iter().next()).expect("a mark");
        match key.as_str() {
            "float" => marks.float = text(value),
            "link" => marks.link = text(value),
            "comment" => marks.comments.extend(text(value)),
            "ins" => marks.insertion = text(value),
            "del" => marks.deletion = text(value),
            "fmt" => marks.format_change = text(value),
            "dir" => marks.dir = text(value),
            "lang" => marks.lang = text(value),
            "style" => marks.char_style = text(value),
            "weight" => marks.weight = text(value),
            "strike" => {
                marks.strike = true;
                marks.strike_double = value == "double";
            }
            "underline" => {
                marks.underline = true;
                marks.underline_line = text(&value["line"]);
                marks.underline_color = text(&value["color"]);
            }
            "highlight" => marks.highlight = text(value),
            "shade" => marks.shade = text(value),
            "color" => marks.color = text(value),
            "font" => marks.font = text(value),
            "size" => marks.size = text(value),
            "caps" => marks.caps = text(value),
            "tracking" => marks.tracking = text(value),
            "scale" => marks.scale = text(value),
            "shift" => marks.shift = text(value),
            "kern" => marks.kern = text(value),
            "otf" => marks.otf = text(value),
            "effect" => marks.effect = text(value),
            "box" => {
                marks.text_box = text(&value["style"]);
                marks.box_color = text(&value["color"]);
            }
            "foreign" => marks.foreign.extend(text(value)),
            other => panic!("unknown mark {other}"),
        }
    }
    marks
}

fn fixture_inlines(list: &Value) -> Vec<Inline> {
    let text = |v: &Value| v.as_str().unwrap_or_default().to_owned();
    list.as_array()
        .into_iter()
        .flatten()
        .map(|inline| {
            if inline.get("hardBreak").is_some() {
                Inline::HardBreak
            } else if let Some(id) = inline.get("footnote") {
                Inline::Note {
                    id: text(id),
                    marks: fixture_marks(&inline["marks"]),
                }
            } else if let Some(dest) = inline.get("image") {
                Inline::Image {
                    dest: text(dest),
                    alt: text(&inline["alt"]),
                }
            } else {
                Inline::marked(text(&inline["text"]), fixture_marks(&inline["marks"]))
            }
        })
        .collect()
}

/// The inline-v2 cases: Markdown, the tree it reads as, and the canonical form when that differs.
pub(super) fn inline_v2_cases() -> Vec<(String, String, Vec<Block>, Option<String>)> {
    let json = include_str!("../../../../docs/format/fixtures/markdown/inline-v2/cases.json");
    let root: Value = serde_json::from_str(json).expect("fixture JSON");
    let cases = root["cases"].as_array().expect("cases").iter();
    cases
        .map(|case| {
            let tree = case["tree"].as_array().expect("tree").iter();
            let blocks = tree
                .map(|block| {
                    assert_eq!(block["type"], "paragraph");
                    Block::Paragraph(fixture_inlines(&block["content"]))
                })
                .collect();
            let field = |key: &str| case[key].as_str().map(str::to_owned);
            (
                field("name").unwrap_or_default(),
                field("markdown").unwrap_or_default(),
                blocks,
                field("canonical"),
            )
        })
        .collect()
}

#[test]
fn every_inline_v2_fixture_parses_to_its_tree() {
    let mut failed = Vec::new();
    let cases = inline_v2_cases();
    assert!(cases.len() >= 250, "{} cases", cases.len());
    for (name, markdown, tree, _) in &cases {
        let parsed = parse::parse_page(markdown).blocks;
        if &parsed != tree {
            failed.push(format!(
                "{name}\n  markdown {markdown:?}\n  got  {parsed:?}\n  want {tree:?}"
            ));
        }
    }
    assert!(
        failed.is_empty(),
        "{} of {} cases:\n{}",
        failed.len(),
        cases.len(),
        failed.join("\n")
    );
}

#[test]
fn foreign_tags_pass_through_the_model_unchanged() {
    // Foreign marks nest in code point order of their tags (R-INL-10), so this is the canonical form.
    let markdown = "a <span data-x=\"1\">b </span><ins data-y=\"two words\"><span data-x=\"1\">c</span></ins> d";
    let blocks = parse::parse_page(markdown).blocks;
    let Some(Block::Paragraph(content)) = blocks.first() else {
        panic!("a paragraph: {blocks:?}");
    };
    let foreign: Vec<&Vec<String>> = content
        .iter()
        .filter_map(|i| match i {
            Inline::Text { marks, .. } => Some(&marks.foreign),
            _ => None,
        })
        .collect();
    assert_eq!(foreign[1], &vec!["<span data-x=\"1\">".to_owned()]);
    assert_eq!(
        foreign[2],
        &vec![
            "<ins data-y=\"two words\">".to_owned(),
            "<span data-x=\"1\">".to_owned()
        ]
    );
    assert_eq!(write::to_markdown(&blocks), markdown);
}

#[test]
fn every_inline_v2_tree_writes_its_canonical_markdown() {
    let mut failed = Vec::new();
    let cases = inline_v2_cases();
    for (name, markdown, tree, canonical) in &cases {
        let want = canonical.as_deref().unwrap_or(markdown);
        let written = write::to_markdown(tree);
        if written != want {
            failed.push(format!("{name}\n  tree {tree:?}\n  got  {written:?}\n  want {want:?}"));
        }
    }
    assert!(
        failed.is_empty(),
        "{} of {} cases:\n{}",
        failed.len(),
        cases.len(),
        failed.join("\n")
    );
}
