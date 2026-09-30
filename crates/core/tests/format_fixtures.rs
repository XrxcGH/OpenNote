//! The shared fixtures in `docs/format/fixtures` (spec Appendix B.6), which the TypeScript codec and the
//! Python reference reader also read. Every test here has `fixture` in its name, so the fixture CI job runs it.
//!
//! `OPENNOTE_BLESS=1 cargo test -p opennote-core --all-features fixture` writes the generated fixtures instead
//! of comparing them. Only do that while format version 1 is still a draft: afterward they never change.

mod common;
mod format_fixtures {
    pub mod biology;
    pub mod ink;
    pub mod notebook;
    pub mod pages;
}

use std::path::{Path, PathBuf};

use format_fixtures::{biology, ink};
use opennote_core::format::gzip::gunzip;
use opennote_core::format::json;
use opennote_core::format::history_json::{read_versions, write_versions};
use opennote_core::format::markdown::escape_text;
use opennote_core::format::migrate::{upgrade, FileKind};
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::format::readable::{render_index_md, render_ink_svg, render_page_md, render_readme};
use opennote_core::format::segment::decode_segment;
use opennote_core::format::trash_json::{read_trash_item, write_trash_item};
use opennote_core::format::tree_json::{read_notebook, read_section, write_notebook, write_section};
use opennote_core::model::validate::validate_page;
use opennote_core::model::{Access, Ink, Page, ReadOnlyReason, SectionFile};
use opennote_core::Limits;
use serde_json::{json, Value};

fn bless() -> bool {
    std::env::var("OPENNOTE_BLESS").is_ok_and(|v| v == "1")
}

fn fixtures() -> PathBuf {
    common::fixtures_dir()
}

fn notebook_dir() -> PathBuf {
    fixtures().join("notebooks").join("v1")
}

/// Writes the file in bless mode, and otherwise checks that it holds exactly these bytes.
fn check_file(path: &Path, bytes: &[u8]) {
    if bless() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
        return;
    }
    let found = std::fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert!(
        found == bytes,
        "{} differs from what the version 1 writer writes:\n{}",
        path.display(),
        String::from_utf8_lossy(bytes)
    );
}

fn relative(path: &Path, base: &Path) -> String {
    path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/")
}

#[test]
fn fixture_notebook_is_what_the_v1_writer_writes() {
    let dir = notebook_dir();
    let files = biology::files();
    for (path, bytes) in &files {
        check_file(&dir.join(path), bytes);
    }
    let mut on_disk: Vec<String> = common::files_under(&dir).iter().map(|p| relative(p, &dir)).collect();
    on_disk.sort();
    let expected: Vec<String> = files.keys().cloned().collect();
    assert_eq!(
        on_disk, expected,
        "the fixture notebook holds exactly the files the writer makes"
    );
}

fn limits() -> Limits {
    Limits::default()
}

/// P9 and the canonical form: every JSON file of the fixture notebook upgrades, validates, and is written back
/// byte for byte.
#[test]
fn fixture_notebook_files_round_trip() {
    let dir = notebook_dir();
    let mut checked = 0;
    for path in common::files_under(&dir) {
        let bytes = std::fs::read(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let kind = match name.as_str() {
            "notebook.json" => FileKind::Notebook,
            "section.json" => FileKind::Section,
            "page.json" => FileKind::Page,
            "item.json" => FileKind::TrashItem,
            "versions.json" => FileKind::Versions,
            n if n.ends_with(".json.gz") => {
                let page = gunzip(&bytes, limits().gunzip_bytes).unwrap();
                assert_eq!(write_page(&read_page(&page, &limits()).unwrap().page), page, "{name}");
                continue;
            }
            _ => continue,
        };
        let mut value: Value = serde_json::from_slice(&bytes).unwrap();
        let report = upgrade(kind, &mut value).unwrap();
        assert!(report.applied.is_empty(), "version 1 files need no migration");
        assert_eq!(round_trip(kind, &bytes), bytes, "{}", path.display());
        checked += 1;
    }
    assert!(checked >= 12, "only {checked} JSON files");
}

fn round_trip(kind: FileKind, bytes: &[u8]) -> Vec<u8> {
    match kind {
        FileKind::Notebook => write_notebook(&read_notebook(bytes, &limits()).unwrap()),
        FileKind::Section => write_section(&read_section(bytes, &limits()).unwrap()),
        FileKind::TrashItem => write_trash_item(&read_trash_item(bytes, &limits()).unwrap()),
        FileKind::Versions => write_versions(&read_versions(bytes, &limits()).unwrap()),
        FileKind::Page => {
            let read = read_page(bytes, &limits()).unwrap();
            let access = &read.page.format.access;
            let encrypted = *access == Access::ReadOnly(ReadOnlyReason::Encrypted);
            assert!(encrypted || *access == Access::ReadWrite, "{:?}", read.warnings);
            assert!(validate_page(&read.page, &limits()).is_valid());
            write_page(&read.page)
        }
    }
}

/// Loads a page folder: `page.json` and its segments, replayed into live ink.
fn load_page(dir: &Path) -> Page {
    let mut page = read_page(&std::fs::read(dir.join("page.json")).unwrap(), &limits())
        .unwrap()
        .page;
    let segments = page.ink.segments().to_vec();
    let records = segments
        .iter()
        .map(|s| {
            let bytes = std::fs::read(dir.join("ink").join(format!("{}.onk", s.id))).unwrap();
            let decoded = decode_segment(&bytes, s, page.id, &limits()).unwrap();
            assert!(decoded.footer_ok && decoded.damaged.is_empty());
            decoded.records
        })
        .collect();
    let (ink, warnings) = Ink::replay(segments, records);
    assert!(warnings.is_empty(), "{warnings:?}");
    page.ink = ink;
    let report = validate_page(&page, &limits());
    assert!(
        report.warnings.iter().all(|w| w.code != "ink.strokeCount"),
        "{report:?}"
    );
    page
}

/// The readable copies in the fixture notebook come from its own files: `page.md` and `ink.svg` from each
/// page, and `index.md` from the tree files. This is what the reference reader does too.
#[test]
fn fixture_notebook_readable_copies_come_from_its_files() {
    let dir = notebook_dir();
    let notebook = read_notebook(&std::fs::read(dir.join("notebook.json")).unwrap(), &limits()).unwrap();
    let mut sections: Vec<SectionFile> = Vec::new();
    for entry in std::fs::read_dir(&dir).unwrap().flatten() {
        let file = entry.path().join("section.json");
        if file.is_file() {
            sections.push(read_section(&std::fs::read(file).unwrap(), &limits()).unwrap());
        }
    }
    let links = biology::NotebookLinks {
        sections: sections
            .iter()
            .flat_map(|s| s.pages.iter().map(move |p| (p.id, s.id)))
            .collect(),
    };
    let mut rendered = 0;
    for section in sections.iter().filter(|s| s.encryption.is_none()) {
        for entry in &section.pages {
            let page_dir = dir.join(section.id.to_string()).join(entry.id.to_string());
            let page = load_page(&page_dir);
            check_file(&page_dir.join("page.md"), &render_page_md(&page, &links));
            if !page.ink.is_empty() {
                check_file(&page_dir.join("ink.svg"), &render_ink_svg(&page));
            }
            rendered += 1;
        }
    }
    assert_eq!(rendered, 5);
    check_file(
        &dir.join("index.md"),
        &render_index_md(&biology::tree(&notebook, &sections)),
    );
    check_file(&dir.join("README.md"), &render_readme(&notebook.title));
}

/// Writes JSON with every character outside ASCII escaped, so invisible characters stay visible in the file.
fn ascii_json(value: &Value) -> Vec<u8> {
    let map = value.as_object().unwrap();
    let text = String::from_utf8(json::write_document(&json::Obj::new().finish(map))).unwrap();
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii() {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out.into_bytes()
}

#[test]
fn fixture_ink_segments_decode_as_recorded() {
    let dir = fixtures().join("ink");
    let cases = ink::cases();
    for case in &cases {
        let result = decode_segment(&case.bytes, &case.expect, case.page, &limits());
        check_file(&dir.join(format!("{}.onk", case.name)), &case.bytes);
        check_file(
            &dir.join(format!("{}.json", case.name)),
            &ascii_json(&ink::case_json(case, &result)),
        );
    }
    let names: Vec<&str> = cases.iter().map(|c| c.name).collect();
    assert!(names.contains(&"appendix-b2") && names.len() >= 10);
    let appendix = std::fs::read(dir.join("appendix-b2.onk")).unwrap();
    assert_eq!(
        appendix,
        spec_hex_dump("### B.2 A segment file"),
        "the fixture is the spec's test vector"
    );
}

/// The bytes of a hex dump in the spec, under a heading.
fn spec_hex_dump(heading: &str) -> Vec<u8> {
    let spec = std::fs::read_to_string(common::repo_dir().join("docs/format/README.md")).unwrap();
    let section = &spec[spec.find(heading).unwrap()..];
    let block = &section[section.find("```text\n").unwrap() + 8..];
    let block = &block[..block.find("```").unwrap()];
    block
        .lines()
        .flat_map(|line| {
            line.split_whitespace()
                .skip(1)
                .take_while(|t| t.len() == 2 && t.bytes().all(|b| b.is_ascii_hexdigit()))
                .map(|t| u8::from_str_radix(t, 16).unwrap())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Texts for the escaping fixtures, each as a paragraph line and in the middle of one.
const ESCAPE_TEXTS: &[&str] = &[
    "5 * 3 = 15",
    "a == b",
    "Costs $5",
    "#biology and C#",
    "snake_case and _draft",
    "[draft]",
    "AT&T and &amp;",
    "x < y",
    "~5 minutes",
    "{note}",
    "1. Not a list",
    "- not a bullet",
    " leading space",
    "trailing space ",
    "a\ttab",
    "line one\nline two",
    "first\n> not a quote",
    "über_straße and 日本_語",
    "12) item and 1234567890. no",
    "=== and = alone",
    "back\\slash and `code` and |pipe|",
    "&#32; and &x; and &;",
    "+ plus and a+b",
    "zero\u{0}width\u{200b}space",
];

#[test]
fn fixture_escaping_cases_match_the_escaper() {
    let cases: Vec<Value> = ESCAPE_TEXTS
        .iter()
        .flat_map(|text| {
            [true, false].map(|start| json!({"text": text, "atLineStart": start, "escaped": escape_text(text, start)}))
        })
        .collect();
    let path = fixtures().join("markdown").join("escape").join("cases.json");
    check_file(&path, &ascii_json(&json!({ "cases": cases })));
}

/// The complete `page.json` of spec 5.5, and the `page.md` of spec 11.1 with its checksum of Appendix B.4.
#[test]
fn fixture_spec_example_page() {
    let spec = std::fs::read_to_string(common::repo_dir().join("docs/format/README.md")).unwrap();
    let code_block = |heading: &str, fence: &str| {
        let section = &spec[spec.find(heading).unwrap()..];
        let start = section.find(fence).unwrap() + fence.len();
        let body = &section[start..];
        body[..body.find("\n```").unwrap() + 1].to_owned()
    };
    let page_json = code_block("### 5.5 A complete page.json", "```json\n");
    let page_md = code_block("### 11.1 page.md", "```markdown\n");
    let dir = fixtures().join("readable").join("spec-example");
    check_file(&dir.join("page.json"), page_json.as_bytes());
    check_file(&dir.join("page.md"), page_md.as_bytes());
    let mut page = read_page(page_json.as_bytes(), &limits()).unwrap().page;
    assert_eq!(
        write_page(&page),
        page_json.as_bytes(),
        "the spec's example is in canonical form"
    );
    let md = render_page_md(&page, &opennote_core::testing::NoLinks);
    assert_eq!(String::from_utf8(md).unwrap(), page_md);
    assert!(page_md.contains("checksum: \"crc32:d69a2039\""));
    // The first segment of the example is illustrative. The second is the vector of Appendix B.2, and the
    // `ink.svg` of spec 11.3 shows its one stroke. The image is a stand-in: its size and hash don't match.
    let segment = page.ink.segments()[1].clone();
    let bytes = spec_hex_dump("### B.2 A segment file");
    check_file(&dir.join("ink").join(format!("{}.onk", segment.id)), &bytes);
    check_file(
        &dir.join("assets").join("01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png"),
        &format_fixtures::notebook::PNG,
    );
    let records = decode_segment(&bytes, &segment, page.id, &limits()).unwrap().records;
    page.ink = Ink::replay(vec![segment], vec![records]).0;
    let svg = String::from_utf8(render_ink_svg(&page)).unwrap();
    check_file(&dir.join("ink.svg"), svg.as_bytes());
    let example = code_block("### 11.3 ink.svg", "```xml\n");
    let at = svg.find("crc32:").unwrap() + 6;
    assert_eq!(format!("{}00000000{}", &svg[..at], &svg[at + 8..]), example);
}

/// Plain text of a paragraph of unmarked runs and hard breaks, or `None` for anything richer.
fn plain_paragraph(document: &Value) -> Option<String> {
    let [block] = document.as_array()?.as_slice() else {
        return None;
    };
    let mut text = String::new();
    for inline in block.get("content")?.as_array()? {
        if inline.get("hardBreak").is_some() {
            text.push('\n');
        } else if inline["marks"].as_array()?.is_empty() {
            text.push_str(inline["text"].as_str()?);
        } else {
            return None;
        }
    }
    Some(text)
}

/// The document fixtures are canonical Markdown (spec 7.7), and plain paragraphs are escaped as spec 7.6 says.
#[test]
fn fixture_markdown_documents_are_canonical() {
    let path = fixtures().join("markdown").join("documents").join("cases.json");
    let cases: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let mut plain = 0;
    for case in cases["cases"].as_array().unwrap() {
        let markdown = case["markdown"].as_str().unwrap();
        let name = case["name"].as_str().unwrap();
        assert!(!markdown.ends_with('\n') && !markdown.starts_with('\n'), "{name}");
        assert!(!markdown.contains("\n\n\n") && !markdown.contains(" \n"), "{name}");
        assert!(case["document"].is_array(), "{name}");
        if let Some(text) = plain_paragraph(&case["document"]) {
            assert_eq!(escape_text(&text, true), markdown, "{name}");
            plain += 1;
        }
    }
    assert!(plain >= 2);
}
