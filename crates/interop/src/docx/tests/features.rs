//! Tests of page setup, weights and faces, styles, the theme, fonts, privacy, and comment ranges.

use serde_json::json;

use super::*;

#[test]
fn a_page_export_writes_the_page_paper_not_letter() {
    use crate::page_builder::PageBuilder;
    use crate::testing::{at, TestEnv};
    use crate::tree::{section_orders, SectionBuilder};
    use opennote_core::model::{Named, NotebookFile, Paper, PaperSize};
    use opennote_core::NotebookId;

    let world = TestEnv::new();
    let env = world.env();
    let created = at("2026-01-05T09:30:00Z");
    let mut builder = PageBuilder::new(&env, "On A4", created, created);
    builder.push_blocks(parse_page("Hello.").blocks);
    let mut page = builder.finish().expect("the page builds");
    page.page.view.paper = Paper {
        size: Named::Known(PaperSize::A4),
        width: 793.7,
        height: 1122.52,
        margins: [72.0; 4],
        ..Paper::default()
    };
    let notebook = NotebookFile::new(NotebookId::generate(env.clock), "Book", created);
    let mut source = crate::MemorySource::new(notebook);
    let mut section = SectionBuilder::new(&env, "Unit", created);
    section.add_page(&page.page, None);
    let page_id = page.page.id;
    source.add_page(page);
    let key = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(key).expect("the section builds"));
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = crate::export_docx(&source, crate::Scope::Page(page_id), out.path()).expect("exports");
    let bytes = std::fs::read(&exported.files[0]).expect("the file");
    let doc = read_parts(&bytes)
        .into_iter()
        .find(|(name, _)| name == "word/document.xml")
        .map(|(_, b)| String::from_utf8(b).expect("UTF-8"))
        .expect("the document");
    assert!(doc.contains("<w:pgSz w:w=\"11906\" w:h=\"16838\"/>"), "{doc}");
    assert!(!doc.contains("w:w=\"12240\""), "Letter is not written");
    // The page's 72 unit margins are 1080 twips (0.75 inch).
    assert!(doc.contains("<w:pgMar w:top=\"1080\" w:right=\"1080\" w:bottom=\"1080\" w:left=\"1080\""));
}

/// Exports one page, with `text` as its `view.text`, and returns its document part.
fn page_doc(text: Value) -> String {
    use crate::page_builder::PageBuilder;
    use crate::testing::{at, TestEnv};
    use crate::tree::{section_orders, SectionBuilder};
    use opennote_core::model::NotebookFile;
    use opennote_core::NotebookId;

    let world = TestEnv::new();
    let env = world.env();
    let created = at("2026-01-05T09:30:00Z");
    let mut builder = PageBuilder::new(&env, "Numbers", created, created);
    builder.push_blocks(parse_page("Hello.").blocks);
    let mut page = builder.finish().expect("the page builds");
    page.page.view.extra.insert("text".to_owned(), text);
    let notebook = NotebookFile::new(NotebookId::generate(env.clock), "Book", created);
    let mut source = crate::MemorySource::new(notebook);
    let mut section = SectionBuilder::new(&env, "Unit", created);
    section.add_page(&page.page, None);
    let page_id = page.page.id;
    source.add_page(page);
    let key = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(key).expect("the section builds"));
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = crate::export_docx(&source, crate::Scope::Page(page_id), out.path()).expect("exports");
    let bytes = std::fs::read(&exported.files[0]).expect("the file");
    read_parts(&bytes)
        .into_iter()
        .find(|(name, _)| name == "word/document.xml")
        .map(|(_, b)| String::from_utf8(b).expect("UTF-8"))
        .expect("the document")
}

#[test]
fn a_page_number_format_outside_st_number_format_is_written_as_decimal() {
    // ECMA-376 Part 1, 17.18.59: "foo" is not one of the ST_NumberFormat values, so Word would call the file unreadable.
    let doc = page_doc(json!({"pageNumbers": {"format": "foo", "start": 3}}));
    assert!(doc.contains("<w:pgNumType w:fmt=\"decimal\" w:start=\"3\"/>"), "{doc}");
    schema::check_part("word/document.xml", &doc);
    // A value from 17.18.59 is kept.
    let doc = page_doc(json!({"pageNumbers": {"format": "upperRoman"}}));
    assert!(doc.contains("<w:pgNumType w:fmt=\"upperRoman\"/>"), "{doc}");
    schema::check_part("word/document.xml", &doc);
}

#[test]
fn the_schema_check_rejects_a_number_format_outside_st_number_format() {
    let bad = |xml: &'static str| std::panic::catch_unwind(|| schema::check_part("bad", xml)).is_err();
    assert!(bad("<w:sectPr xmlns:w=\"x\"><w:pgNumType w:fmt=\"foo\"/></w:sectPr>"));
    assert!(bad("<w:lvl xmlns:w=\"x\"><w:numFmt w:val=\"foo\"/></w:lvl>"));
    schema::check_part(
        "good",
        "<w:sectPr xmlns:w=\"x\"><w:pgNumType w:fmt=\"lowerRoman\"/></w:sectPr>",
    );
}

#[test]
fn a_weight_names_the_device_face_and_is_bold_from_600() {
    let faces = vec![
        "Segoe UI".to_owned(),
        "Segoe UI Semibold".to_owned(),
        "Segoe UI Light".to_owned(),
    ];
    let marks = |weight: &str| Marks {
        font: Some("Segoe UI".to_owned()),
        weight: Some(weight.to_owned()),
        ..Marks::none()
    };
    let with = rpr::RunContext {
        faces: &faces,
        mono: fonts::APP_MONO,
    };
    let semibold = rpr::run_props(&marks("600"), &with, "");
    assert!(semibold.contains("<w:b/>"), "{semibold}");
    assert!(semibold.contains("w:ascii=\"Segoe UI Semibold\""), "{semibold}");
    let light = rpr::run_props(&marks("300"), &with, "");
    assert!(
        !light.contains("<w:b/>") && light.contains("w:ascii=\"Segoe UI Light\""),
        "{light}"
    );
    // Without the face on the device, the family stays and 600 is still bold.
    let without = rpr::run_props(&marks("600"), &rpr::RunContext::default(), "");
    assert!(
        without.contains("<w:b/>") && without.contains("w:ascii=\"Segoe UI\""),
        "{without}"
    );
    assert_eq!(weight_face("segoe ui", 600, &faces), Some("Segoe UI Semibold"));
}

#[test]
fn styles_come_from_the_notebook_and_the_page_sheet() {
    let notebook = styles::sheet_from_json(&json!({
        "normal": {"font": "Georgia", "sizePt": 11, "line": {"rule": "multiple", "value": 1.15}},
        "h1": {"sizePt": 20, "textColor": "#2f5496", "font": "+heading"},
        "u-callout": {"label": "Callout box", "basedOn": "quote", "shade": {"fill": "#fff2cc", "pattern": "clear"}},
        "u-mark": {"type": "character", "highlight": "#00ff00"},
        "code": {"size": 16},
    }));
    let page = styles::sheet_from_json(&json!({"h1": {"sizePt": 22}}));
    let setup = Setup {
        styles: merge_styles(notebook, &[&page]),
        ..Setup::default()
    };
    let parts = vec![text_part(
        "# Title\n\nBody <span data-style=\"u-mark\">marked</span>",
        json!({"styles": {"#1": "u-callout"}}),
    )];
    let all = files(&input(parts, setup));
    let styles_xml = &all["word/styles.xml"];
    let style = |id: &str| {
        let at = styles_xml
            .find(&format!("w:styleId=\"{id}\""))
            .unwrap_or_else(|| panic!("{id} in {styles_xml}"));
        let end = styles_xml[at..].find("</w:style>").expect("an end") + at;
        styles_xml[at..end].to_owned()
    };
    let normal = style("Normal");
    assert!(
        normal.contains("w:ascii=\"Georgia\"") && normal.contains("<w:sz w:val=\"22\"/>"),
        "{normal}"
    );
    assert!(normal.contains("w:line=\"276\" w:lineRule=\"auto\""));
    let h1 = style("Heading1");
    assert!(h1.contains("<w:sz w:val=\"44\"/>"), "the page sheet wins: {h1}");
    assert!(h1.contains("<w:color w:val=\"2F5496\"/>") && h1.contains("<w:next w:val=\"Normal\"/>"));
    let callout = style("u-callout");
    assert!(
        callout.contains("w:customStyle=\"1\"") || styles_xml.contains("w:customStyle=\"1\" w:styleId=\"u-callout\"")
    );
    assert!(callout.contains("<w:name w:val=\"Callout box\"/>") && callout.contains("<w:basedOn w:val=\"Quote\"/>"));
    assert!(callout.contains("w:fill=\"FFF2CC\""));
    let mark = style("u-mark");
    assert!(styles_xml.contains("<w:style w:type=\"character\" w:customStyle=\"1\" w:styleId=\"u-mark\">"));
    assert!(mark.contains("<w:highlight w:val=\"green\"/>"), "{mark}");
    // Version 1 `size` is in page units: 16 is 12 points.
    assert!(style("Code").contains("<w:sz w:val=\"24\"/>"));
    let doc = &all["word/document.xml"];
    assert!(
        doc.contains("<w:pStyle w:val=\"u-callout\"/>") && doc.contains("<w:rStyle w:val=\"u-mark\"/>"),
        "{doc}"
    );
    assert!(all["word/fontTable.xml"].contains("<w:font w:name=\"Georgia\">"));
    assert!(all["word/fontTable.xml"].contains("<w:family w:val=\"roman\"/>"));
}

#[test]
fn the_theme_part_holds_the_theme_fonts_and_colors() {
    let mut theme = Theme::default();
    theme.read(
        json!({"fonts": {"heading": "Literata", "body": "Carlito"}, "colors": {"accent1": "#112233"}})
            .as_object()
            .expect("an object"),
    );
    let setup = Setup {
        theme,
        ..Setup::default()
    };
    let all = files(&input(vec![text_part("a", json!({}))], setup));
    let theme = &all["word/theme/theme1.xml"];
    assert!(
        theme.contains("<a:majorFont><a:latin typeface=\"Literata\"/>"),
        "{theme}"
    );
    assert!(theme.contains("<a:minorFont><a:latin typeface=\"Carlito\"/>"));
    assert!(theme.contains("<a:accent1><a:srgbClr val=\"112233\"/></a:accent1>"));
    let table = &all["word/fontTable.xml"];
    assert!(
        table.contains("<w:font w:name=\"Carlito\"><w:altName w:val=\"Calibri\"/>"),
        "{table}"
    );
}

#[test]
fn only_bundled_fonts_that_the_document_uses_are_embedded() {
    let offer = |family: &str, bytes: Vec<u8>| EmbedFont {
        family: family.to_owned(),
        bold: false,
        italic: false,
        bytes,
    };
    let mut setup = Setup::default();
    setup.options.embed_fonts = vec![
        offer("Carlito", schema::tiny_font(0)),
        offer("Literata", schema::tiny_font(0)),
        offer("Segoe UI", schema::tiny_font(0)),
        offer("Caladea", schema::tiny_font(0x0002)),
    ];
    let parts = vec![text_part(
        "<span data-font=\"Carlito\">a</span> <span data-font=\"Segoe UI\">b</span> <span data-font=\"Caladea\">c</span>",
        json!({}),
    )];
    let all = files(&input(parts, setup));
    let fonts: Vec<&String> = all.keys().filter(|k| k.starts_with("word/fonts/")).collect();
    assert_eq!(
        fonts,
        ["word/fonts/font1.odttf"],
        "Carlito only: Literata is unused, Segoe UI is not bundled, \
         and Caladea's license restricts embedding"
    );
    let table = &all["word/fontTable.xml"];
    assert!(table.contains("<w:embedRegular r:id=\"rId1\" w:fontKey=\"{"), "{table}");
    assert!(all["word/_rels/fontTable.xml.rels"].contains("Target=\"fonts/font1.odttf\""));
    assert!(all["[Content_Types].xml"].contains("Extension=\"odttf\""));
    assert!(all["word/settings.xml"].contains("<w:embedTrueTypeFonts/>"));
    // Nothing is embedded unless asked.
    let plain = files(&input(
        vec![text_part("<span data-font=\"Carlito\">a</span>", json!({}))],
        Setup::default(),
    ));
    assert!(!plain.keys().any(|k| k.starts_with("word/fonts/")));
}

#[test]
fn obfuscation_xors_the_reversed_guid_over_the_first_32_bytes() {
    // Worked by hand from ECMA-376 Part 1, 17.8.1: the GUID's digits are 00112233445566778899AABBCCDDEEFF, so the
    // key read from the last pair to the first is FF EE DD CC BB AA 99 88 77 66 55 44 33 22 11 00.
    let guid = "{00112233-4455-6677-8899-AABBCCDDEEFF}";
    let font: Vec<u8> = (0..40u8).collect();
    let out = fonts::obfuscate(&font, guid);
    let key = [
        0xFF, 0xEE, 0xDD, 0xCC, 0xBB, 0xAA, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x00,
    ];
    for i in 0..32 {
        assert_eq!(out[i], font[i] ^ key[i % 16], "byte {i}");
    }
    assert_eq!(&out[32..], &font[32..], "bytes after 32 are kept");
    assert_eq!(out[0], 0xFF);
    assert_eq!(out[17], 0x11 ^ 0xEE);
}

#[test]
fn removing_personal_information_drops_authors_and_dates() {
    let mut setup = Setup::default();
    setup.options.remove_personal = true;
    let all = files(&input(rich_document(), setup));
    for name in ["word/document.xml", "word/comments.xml"] {
        let xml = &all[name];
        assert!(!xml.contains("Sam") && !xml.contains("Ana"), "{name}: {xml}");
        assert!(!xml.contains("w:date="), "{name}");
        assert!(xml.contains("w:author=\"Author\""), "{name}");
    }
    let core = &all["docProps/core.xml"];
    assert!(
        !core.contains("dcterms:created") && !core.contains("dcterms:modified"),
        "{core}"
    );
    assert!(all["word/settings.xml"].contains("<w:removePersonalInformation/><w:removeDateAndTime/>"));
    // Kept otherwise.
    let kept = files(&input(rich_document(), Setup::default()));
    assert!(kept["word/comments.xml"].contains("w:author=\"Sam\""));
    assert!(kept["docProps/core.xml"].contains("dcterms:created"));
}

#[test]
fn a_comment_over_several_paragraphs_ends_after_its_last_run() {
    let c = ID3;
    let markdown = format!("<span data-comment=\"{c}\">one</span>\n\n<span data-comment=\"{c}\">two</span> after");
    let records = json!({"comments": {c: {"author": "Sam", "time": "2026-10-01T09:00:00Z", "markdown": "Note."}}});
    let doc = document(vec![text_part(&markdown, records)]);
    let start = doc.find("<w:commentRangeStart").expect("a start");
    let end = doc.find("<w:commentRangeEnd").expect("an end");
    let two = doc.find(">two</w:t>").expect("two");
    let after = doc.find("> after</w:t>").expect("after");
    assert!(
        start < doc.find(">one</w:t>").unwrap() && two < end && end < after,
        "{doc}"
    );
    assert_eq!(doc.matches("<w:commentRangeStart").count(), 1);
    // A comment without a record writes no range.
    let doc = document(vec![text_part(
        &format!("<span data-comment=\"{ID1}\">x</span>"),
        json!({}),
    )]);
    assert!(!doc.contains("commentRange"));
    let _ = ID2;
}

#[test]
fn a_break_block_is_a_page_break() {
    let doc = document(vec![Part::Blocks(parse_page("a").blocks), Part::PageBreak]);
    assert!(doc.contains("<w:r><w:br w:type=\"page\"/></w:r>"));
}

#[test]
fn a_page_number_start_above_st_decimal_number_is_clamped() {
    // ECMA-376 Part 1: w:start has the type ST_DecimalNumber (xsd:int), so at most 2,147,483,647.
    let doc = page_doc(json!({"pageNumbers": {"start": 4_000_000_000_u64}}));
    assert!(doc.contains("w:start=\"2147483647\""), "{doc}");
    let doc = page_doc(json!({"pageNumbers": {"start": 2_147_483_647_u64}}));
    assert!(doc.contains("w:start=\"2147483647\""), "{doc}");
}

#[test]
fn a_user_style_named_like_a_fixed_style_gets_its_own_style_id() {
    let fixed = [
        "CommentReference",
        "CommentText",
        "EndnoteReference",
        "EndnoteText",
        "Footer",
        "FootnoteReference",
        "FootnoteText",
        "Header",
        "Hyperlink",
        "ListParagraph",
    ];
    let mut sheet = serde_json::Map::new();
    for name in fixed {
        sheet.insert(name.to_owned(), json!({"type": "character", "textColor": "#112233"}));
    }
    // Only a malformed notebook file holds such a name; a style based on it still points at it.
    sheet.insert(
        "u-child".to_owned(),
        json!({"type": "character", "basedOn": "Hyperlink"}),
    );
    let setup = Setup {
        styles: styles::sheet_from_json(&Value::Object(sheet)),
        ..Setup::default()
    };
    let parts = vec![text_part("Body.", json!({}))];
    let all = files(&input(parts, setup));
    let styles_xml = &all["word/styles.xml"];
    let mut ids: Vec<&str> = styles_xml
        .split("w:styleId=\"")
        .skip(1)
        .map(|rest| &rest[..rest.find('"').expect("a quote")])
        .collect();
    let count = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), count, "every w:styleId is unique: {styles_xml}");
    for name in fixed {
        assert!(ids.contains(&name), "the fixed {name} style is kept");
        assert!(
            ids.contains(&format!("{name}-user").as_str()),
            "the user {name} style is renamed"
        );
    }
    assert!(
        styles_xml.contains("<w:basedOn w:val=\"Hyperlink-user\"/>"),
        "{styles_xml}"
    );
}
