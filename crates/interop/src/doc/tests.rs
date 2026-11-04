//! Tests of the document model against the shared fixtures of `docs/format/fixtures/markdown/`.

use std::collections::HashMap;

use opennote_core::Timestamp;
use serde_json::Value;

use super::data::{Indent, LineSpacing, NoteKind, Spacing, TextData};
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

/// The first text block of a fixture page, read as block data.
fn text_of(page: &Value) -> (TextData, Vec<Block>) {
    let block = page["blocks"]
        .as_array()
        .and_then(|blocks| blocks.iter().find(|b| b["type"] == "text"))
        .expect("a text block");
    let data = block["data"].as_object().expect("data");
    let ids: Vec<String> = data
        .get("ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().map(str::to_owned))
        .collect();
    let markdown = data["markdown"].as_str().unwrap_or_default();
    (
        TextData::read(&ids, &Default::default(), data),
        parse::parse_page(markdown).blocks,
    )
}

fn paras_fixture(name: &str) -> Value {
    let path = format!(
        "{}/../../docs/format/fixtures/markdown/paras/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("the fixture")).expect("JSON")
}

#[test]
fn every_paragraph_key_reads_from_block_data() {
    let (text, blocks) = text_of(&paras_fixture("every-paragraph-key.json"));
    let elements = text.elements(&blocks);
    assert_eq!(elements.len(), 3);
    let first = elements[0].para.as_ref().expect("the heading's formatting");
    assert_eq!((first.align.as_deref(), first.outline), (Some("center"), Some(1)));
    let p = elements[1].para.as_ref().expect("the second paragraph's formatting");
    assert_eq!(p.after, Some(Spacing::Auto));
    assert_eq!(p.before, Some(Spacing::Points(6.0)));
    assert_eq!(
        p.indent,
        Some(Indent {
            start: 36.0,
            end: 18.0,
            first: -18.0
        })
    );
    assert_eq!(p.line, Some(LineSpacing::Multiple(1.15)));
    assert_eq!(
        (p.keep_lines, p.keep_next, p.widows, p.contextual),
        (Some(true), Some(true), Some(false), Some(true))
    );
    assert_eq!(
        (p.dir.as_deref(), p.lang.as_deref(), p.hyphenate),
        (Some("ltr"), Some("en-US"), Some(true))
    );
    let top = p.border.as_ref().and_then(|b| b.top.clone()).expect("a top border");
    assert_eq!(
        (top.style.as_str(), top.width, top.space, top.color.as_deref()),
        ("double", 0.75, 4, Some("indigo"))
    );
    let between = p
        .border
        .as_ref()
        .and_then(|b| b.between.clone())
        .expect("a between border");
    assert_eq!((between.width, between.space, between.color), (0.5, 1, None));
    let shade = p.shade.as_ref().expect("shading");
    assert_eq!(
        (shade.fill.as_deref(), shade.pattern.as_str()),
        (Some("#f2f2f2"), "pct10")
    );
    let tabs: Vec<(f64, &str, &str)> = p
        .tabs
        .iter()
        .map(|t| (t.pos, t.align.as_str(), t.leader.as_str()))
        .collect();
    assert_eq!(tabs, [(72.0, "decimal", "dot"), (144.5, "end", "none")]);
    let third = elements[2].para.as_ref().expect("the third paragraph's formatting");
    assert_eq!(third.break_before, Some(true));
    assert_eq!(third.line, Some(LineSpacing::Exact(14.0)));
    let drop = third.drop_cap.as_ref().expect("a drop cap");
    assert_eq!((drop.mode.as_str(), drop.lines, drop.distance), ("drop", 3, 2.0));
}

#[test]
fn lists_layout_and_unknown_elements_read_from_block_data() {
    let (text, _) = paras_fixture_text("a-key-that-names-no-element.json");
    assert!(!text.paras.contains_key("01m3sbcmt0000000000000e006"));
    for name in ["lists-that-continue.json", "a-list-that-restarts.json"] {
        let page = paras_fixture(name);
        let (text, blocks) = text_of(&page);
        let has_lists = page["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["data"].get("lists").is_some());
        assert_eq!(!text.lists.is_empty(), has_lists, "{name}");
        let items = text
            .elements(&blocks)
            .into_iter()
            .filter(|e| e.para.as_ref().is_some_and(|p| p.list.is_some()));
        assert!(items.count() > 0, "{name}");
    }
    let (_, blocks) = paras_fixture_text("a-list-that-restarts.json");
    let (text, _) = paras_fixture_text("a-list-that-restarts.json");
    assert!(text.elements(&blocks).iter().any(|e| e
        .para
        .as_ref()
        .and_then(|p| p.list.as_ref())
        .is_some_and(|l| l.restart)));
    let (text, _) = paras_fixture_text("columns.json");
    let layout = text.layout.expect("a layout");
    assert!(layout.columns >= 2, "{layout:?}");
}

fn paras_fixture_text(name: &str) -> (TextData, Vec<Block>) {
    text_of(&paras_fixture(name))
}

#[test]
fn notes_comments_and_suggestions_read_from_block_data() {
    let path = format!(
        "{}/../../docs/format/fixtures/markdown/downlevel/cases.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let root: Value = serde_json::from_str(&std::fs::read_to_string(path).expect("the fixture")).expect("JSON");
    let case = |name: &str| {
        let case = root["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .expect(name);
        text_of(&case["page"])
    };
    let (text, blocks) = case("a footnote");
    let note = text.notes.get("01m3sbcmt0000000000000n001").expect("the note");
    assert_eq!(note.kind, NoteKind::Foot);
    assert!(!note.inlines().is_empty());
    let Some(Block::Paragraph(content)) = blocks.first() else {
        panic!("a paragraph")
    };
    assert!(content
        .iter()
        .any(|i| matches!(i, Inline::Note { id, .. } if id == "01m3sbcmt0000000000000n001")));
    let (text, _) = case("a comment");
    let comment = text.comments.get("01m3sbcmt0000000000000c001").expect("the comment");
    assert!(!comment.author.is_empty() && !comment.markdown.is_empty());
    let (text, _) = case("a suggested format change");
    let suggestion = text
        .suggestions
        .get("01m3sbcmt0000000000000s001")
        .expect("the suggestion");
    assert_eq!(suggestion.kind, "fmt");
    assert!(suggestion.before.is_some());
}

#[test]
fn elements_follow_spec_6_6() {
    // A list item's first paragraph belongs to the item; quotes are not elements, but their blocks are.
    let blocks = parse::parse_page("# A\n\n- one\n\n  more\n- two\n\n> quoted\n\n```\ncode\n```\n\n---").blocks;
    let paths: Vec<Vec<usize>> = TextData::default()
        .elements(&blocks)
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert_eq!(
        paths,
        [
            vec![0],
            vec![1, 0],
            vec![1, 0, 1],
            vec![1, 1],
            vec![2, 0],
            vec![3],
            vec![4]
        ]
    );
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

#[test]
fn a_table_cell_holds_its_sheet_style() {
    let rows = vec![vec![vec![Inline::text("a")], vec![Inline::text("b")]]];
    let plain = Block::table(true, rows.clone());
    assert_eq!(plain.cell_style(0, 0), None);
    let style = cell_style::CellStyle {
        fill: Some(cell_style::Fill::Color("#fde68a".to_owned())),
        ..Default::default()
    };
    let styled = Block::Table {
        header: true,
        rows,
        cell_styles: vec![vec![None, Some(style.clone())]],
    };
    assert_eq!(styled.cell_style(0, 1), Some(&style));
    assert_eq!(styled.cell_style(0, 0), None);
    assert_eq!(styled.cell_style(1, 0), None);
}
