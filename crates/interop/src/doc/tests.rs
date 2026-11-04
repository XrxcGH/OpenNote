//! Tests of the document model against the shared fixtures of `docs/format/fixtures/markdown/`.

use std::collections::HashMap;

use opennote_core::Timestamp;

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
