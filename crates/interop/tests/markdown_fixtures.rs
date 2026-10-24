//! The shared Markdown fixtures of spec 7.8: escaping, and documents paired with canonical Markdown.
//!
//! The JSON files are copies of `docs/format/fixtures/markdown/`, so these tests don't wait for the core's own
//! copy to land. Every case must parse to its document and write back to the same bytes.

use opennote_interop::doc::escape::escape_text;
use opennote_interop::doc::parse::{parse, SoftBreaks};
use opennote_interop::doc::write::to_markdown;
use opennote_interop::doc::{Block, Fold, Inline, Item, Marks, Script};
use serde_json::Value;

fn cases(json: &str) -> Vec<Value> {
    let root: Value = serde_json::from_str(json).expect("fixture JSON is valid");
    root["cases"].as_array().expect("cases is an array").clone()
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}

fn marks(list: &Value) -> Marks {
    let mut marks = Marks::none();
    for mark in list.as_array().into_iter().flatten() {
        match mark.as_str() {
            Some("strong") => marks.strong = true,
            Some("emphasis") => marks.emphasis = true,
            Some("strike") => marks.strike = true,
            Some("underline") => marks.underline = true,
            Some("highlight") => marks.highlight = Some("honey".to_owned()),
            Some("sub") => marks.script = Some(Script::Sub),
            Some("sup") => marks.script = Some(Script::Sup),
            Some("code") => marks.code = true,
            _ => {}
        }
        if let Some(object) = mark.as_object() {
            let (key, value) = object.iter().next().expect("an object mark has one key");
            match key.as_str() {
                "link" => marks.link = Some(text(value)),
                "highlight" => marks.highlight = Some(text(value)),
                "color" => marks.color = Some(text(value)),
                "size" => marks.size = Some(text(value)),
                other => panic!("unknown mark {other}"),
            }
        }
    }
    marks
}

fn inlines(list: &Value) -> Vec<Inline> {
    list.as_array()
        .into_iter()
        .flatten()
        .map(|inline| {
            if inline.get("hardBreak").is_some() {
                Inline::HardBreak
            } else if inline.get("image").is_some() {
                Inline::Image {
                    dest: text(&inline["image"]),
                    alt: text(&inline["alt"]),
                }
            } else {
                Inline::marked(text(&inline["text"]), marks(&inline["marks"]))
            }
        })
        .collect()
}

fn blocks(list: &Value) -> Vec<Block> {
    list.as_array().into_iter().flatten().map(block).collect()
}

fn block(value: &Value) -> Block {
    match value["type"].as_str().expect("a block has a type") {
        "paragraph" => Block::Paragraph(inlines(&value["content"])),
        "heading" => Block::Heading {
            level: value["level"].as_u64().expect("a level") as u8,
            content: inlines(&value["content"]),
        },
        "list" => Block::List {
            ordered: value["ordered"].as_bool().expect("ordered"),
            start: value["start"].as_u64().unwrap_or(1),
            items: value["items"]
                .as_array()
                .expect("items")
                .iter()
                .map(|item| Item {
                    task: match item["task"].as_str() {
                        Some("done") => Some(true),
                        Some("open") => Some(false),
                        _ => None,
                    },
                    blocks: blocks(&item["blocks"]),
                })
                .collect(),
        },
        "quote" => Block::Quote(blocks(&value["blocks"])),
        "callout" => Block::Callout {
            kind: text(&value["callout"]),
            fold: match value["fold"].as_str() {
                Some("folded") => Some(Fold::Folded),
                Some("open") => Some(Fold::Open),
                _ => None,
            },
            title: inlines(&value["title"]),
            blocks: blocks(&value["blocks"]),
        },
        "code" => Block::Code {
            language: text(&value["language"]),
            text: text(&value["text"]),
        },
        "break" => Block::Break,
        other => panic!("unknown block {other}"),
    }
}

#[test]
fn documents_parse_to_their_trees() {
    for case in cases(include_str!("data/markdown-documents.json")) {
        let name = text(&case["name"]);
        let parsed = parse(&text(&case["markdown"]), SoftBreaks::Space);
        assert_eq!(parsed.blocks, blocks(&case["document"]), "parsing {name}");
    }
}

#[test]
fn documents_write_back_byte_for_byte() {
    for case in cases(include_str!("data/markdown-documents.json")) {
        let name = text(&case["name"]);
        assert_eq!(
            to_markdown(&blocks(&case["document"])),
            text(&case["markdown"]),
            "writing {name}"
        );
    }
}

#[test]
fn text_is_escaped_as_the_spec_says() {
    for case in cases(include_str!("data/markdown-escape.json")) {
        let source = text(&case["text"]);
        let line_start = case["atLineStart"].as_bool().expect("atLineStart");
        assert_eq!(
            escape_text(&source, line_start),
            text(&case["escaped"]),
            "escaping {source:?}"
        );
    }
}
