//! Tests of sections around columns, the limits of a page's paper, list levels, and the dates of comments.

use serde_json::json;

use super::*;

/// A4 with a header that names the page.
fn a4(title: &str) -> Part {
    Part::Section {
        setup: Box::new(PageSetup {
            width: 793.7,
            height: 1122.52,
            header: Some(Bands {
                all: Band {
                    left: "{title}".to_owned(),
                    ..Band::default()
                },
                first: None,
            }),
            ..PageSetup::default()
        }),
        fields: BandFields {
            title: title.to_owned(),
            ..BandFields::default()
        },
    }
}

fn columns(markdown: &str) -> Part {
    text_part(markdown, json!({"layout": {"columns": 2, "gap": 18, "rule": false}}))
}

/// Every `w:sectPr` of the document part, in order.
fn sections(doc: &str) -> Vec<&str> {
    doc.split("<w:sectPr>")
        .skip(1)
        .map(|rest| &rest[..rest.find("</w:sectPr>").expect("a closed section")])
        .collect()
}

/// The text of the default header of a section.
fn header_of<'a>(all: &'a BTreeMap<String, String>, sect: &str) -> &'a str {
    let at = sect
        .find("<w:headerReference w:type=\"default\" r:id=\"")
        .expect("a header")
        + 42;
    let rid = &sect[at..at + sect[at..].find('"').expect("an id")];
    let rels = &all["word/_rels/document.xml.rels"];
    let rel = &rels[rels.find(&format!("Id=\"{rid}\"")).expect("the relationship")..];
    let target = &rel[rel.find("Target=\"").expect("a target") + 8..];
    &all[&format!("word/{}", &target[..target.find('"').expect("a name")])]
}

#[test]
fn columns_on_a_page_use_that_page_setup_and_stay_on_its_sheet() {
    let parts = vec![
        text_part("Before.", json!({})),
        columns("In columns."),
        text_part("After.", json!({})),
        a4("Only"),
    ];
    let all = files(&input(parts, Setup::default()));
    let doc = &all["word/document.xml"];
    let sects = sections(doc);
    assert_eq!(sects.len(), 3, "{doc}");
    for sect in &sects {
        // A4 is 210 x 297 mm: 8.27 x 11.69 inches of 1440 twips.
        assert!(sect.contains("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"), "{sect}");
        assert!(sect.contains("<w:headerReference"), "{sect}");
        assert!(header_of(&all, sect).contains(">Only</w:t>"));
    }
    let new_sheets = sects.iter().filter(|s| !s.contains("w:val=\"continuous\"")).count();
    assert_eq!(new_sheets, 1, "{doc}");
    assert!(
        !sects[0].contains("continuous"),
        "the text before the columns starts the sheet"
    );
    assert!(doc.find("Before.") < doc.find("<w:sectPr>"));
}

#[test]
fn columns_on_a_second_page_start_a_new_sheet_with_that_page_header() {
    let parts = vec![
        text_part("One.", json!({})),
        a4("First"),
        text_part("Two.", json!({})),
        columns("In columns."),
        a4("Second"),
    ];
    let all = files(&input(parts, Setup::default()));
    let doc = &all["word/document.xml"];
    let sects = sections(doc);
    assert_eq!(sects.len(), 4, "{doc}");
    let continuous: Vec<bool> = sects.iter().map(|s| s.contains("w:val=\"continuous\"")).collect();
    assert_eq!(continuous, [false, false, true, true], "{doc}");
    assert!(header_of(&all, sects[0]).contains(">First</w:t>"));
    for sect in &sects[1..] {
        let header = header_of(&all, sect);
        assert!(
            header.contains(">Second</w:t>") && !header.contains("First"),
            "{header}"
        );
    }
}

#[test]
fn a_paper_out_of_range_is_clamped_to_word_limits() {
    let paper = |width: f64, height: f64, margins: [f64; 4]| Part::Section {
        setup: Box::new(PageSetup {
            width,
            height,
            margins,
            ..PageSetup::default()
        }),
        fields: BandFields::default(),
    };
    let cases = [
        // 22 inches of 1440 twips is Word's largest side; one twip its smallest.
        (paper(1e300, 0.0, [96.0; 4]), "<w:pgSz w:w=\"31680\" w:h=\"1\"/>"),
        // Not a size: Letter, 8.5 x 11 inches.
        (
            paper(f64::NAN, 900.0, [96.0; 4]),
            "<w:pgSz w:w=\"12240\" w:h=\"15840\"/>",
        ),
        // Side margins are never negative; top and bottom may be.
        (
            paper(816.0, 1056.0, [-10.0, -10.0, 1e9, f64::INFINITY]),
            "<w:pgMar w:top=\"-150\" w:right=\"0\" w:bottom=\"31680\" w:left=\"1440\"",
        ),
    ];
    for (part, expected) in cases {
        let doc = document(vec![text_part("Text.", json!({})), part]);
        assert!(doc.contains(expected), "{expected}\n{doc}");
    }
}

#[test]
fn a_list_deeper_than_nine_levels_stays_at_the_last_level() {
    let mut ordered = String::new();
    let mut bullets = String::new();
    for depth in 0..12 {
        ordered.push_str(&format!("{}1. item {depth}\n", "   ".repeat(depth)));
        bullets.push_str(&format!("{}- item {depth}\n", "  ".repeat(depth)));
    }
    for markdown in [ordered, bullets] {
        let all = files(&input(vec![text_part(&markdown, json!({}))], Setup::default()));
        let doc = &all["word/document.xml"];
        assert!(doc.contains("<w:ilvl w:val=\"8\"/>"), "{doc}");
        for xml in [doc, &all["word/numbering.xml"]] {
            for level in 9..12 {
                assert!(!xml.contains(&format!("w:ilvl=\"{level}\"")), "{xml}");
                assert!(!xml.contains(&format!("<w:ilvl w:val=\"{level}\"/>")), "{xml}");
            }
        }
    }
}

#[test]
fn a_comment_time_that_is_not_a_timestamp_is_left_out() {
    let markdown = "<span data-comment=\"0ccccccccccccccccccccccccc\">a</span> \
                    <span data-ins=\"0aaaaaaaaaaaaaaaaaaaaaaaaa\">b</span>\n";
    let records = json!({
        "comments": {"0ccccccccccccccccccccccccc": {"author": "Sam", "time": "x\"y", "markdown": "Hi."}},
        "suggestions": {"0aaaaaaaaaaaaaaaaaaaaaaaaa": {"kind": "ins", "author": "Sam", "time": "2026-10-01t09:00:00z"}}
    });
    let all = files(&input(vec![text_part(markdown, records)], Setup::default()));
    let comments = &all["word/comments.xml"];
    assert!(
        comments.contains("w:author=\"Sam\"") && !comments.contains("w:date="),
        "{comments}"
    );
    schema::check_part("word/comments.xml", comments);
    // A timestamp in lowercase is written in the form `xsd:dateTime` allows.
    let doc = &all["word/document.xml"];
    assert!(doc.contains("w:date=\"2026-10-01T09:00:00.000Z\""), "{doc}");
}
