//! Exporting a small generated notebook to Markdown, HTML, and Word.

use std::fs;

use opennote_interop::report::Outcome;
use opennote_interop::testing::{assert_well_formed_xml, png_bytes, sample_notebook, unzip, TestEnv};
use opennote_interop::{export_docx, export_files, Format, Scope};

#[test]
fn a_notebook_becomes_markdown_files_with_assets_and_relative_links() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&sample.source, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    let root = out.path().join("Biology");
    assert_eq!(exported.root, root);
    assert_eq!(exported.files.len(), 3);
    assert_eq!(
        fs::read(root.join("assets/Leaf section.png")).expect("the image is copied"),
        png_bytes()
    );
    assert_eq!(
        fs::read(root.join("assets/notes.txt")).expect("the file is copied"),
        b"attached notes"
    );

    let photo = fs::read_to_string(root.join("Semester 1/Photosynthesis.md")).expect("the page is written");
    assert!(
        photo.starts_with("---\ntitle: Photosynthesis\ncreated: 2026-01-05T09:30:00.000Z\n"),
        "{photo}"
    );
    assert!(
        photo.contains("tags:\n  - biology\n  - exam/unit-3\n---\n\n# Light reactions\n"),
        "{photo}"
    );
    assert!(photo.contains("==key terms=="));
    assert!(photo.contains("[Cells](<Cells- the basics.md>)"), "{photo}");
    assert!(
        photo.contains("![Leaf section](<../assets/Leaf section.png>)"),
        "{photo}"
    );
    assert!(photo.contains("[notes.txt](../assets/notes.txt)"));
    assert!(
        photo.contains("| Stage | Where it happens |\n| --- | --- |\n| Light reactions | Thylakoid |"),
        "{photo}"
    );
    assert!(!photo.contains("asset:") && !photo.contains("opennote:"), "{photo}");
}

#[test]
fn links_to_pages_outside_the_export_keep_only_their_text_and_the_report_says_so() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported =
        export_files(&sample.source, Scope::Page(sample.photo), Format::Markdown, out.path()).expect("exports");
    let photo = fs::read_to_string(&exported.files[0]).expect("the page is written");
    assert!(photo.contains("See Cells and"), "{photo}");
    let page = &exported.report.pages[0];
    let entry = page
        .entries
        .iter()
        .find(|e| e.what.contains("outside the export"))
        .expect("a report entry");
    assert_eq!(entry.outcome, Outcome::Simplified);
    assert!(exported
        .report
        .to_markdown()
        .contains("Simplified: 1 link to a page outside the export"));
}

#[test]
fn a_section_becomes_html_with_an_index() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported =
        export_files(&sample.source, Scope::Section(sample.section), Format::Html, out.path()).expect("exports");
    let root = out.path().join("Semester 1");
    let photo = fs::read_to_string(root.join("Photosynthesis.html")).expect("the page is written");
    assert!(photo.contains("<title>Photosynthesis</title>") && photo.contains("<h2>Light reactions</h2>"));
    assert!(
        photo.contains("<strong>thylakoid</strong>") && photo.contains("<mark data-color=\"honey\">key terms</mark>")
    );
    assert!(photo.contains("href=\"Cells-%20the%20basics.html\""), "{photo}");
    assert!(
        photo.contains("<img src=\"assets/Leaf%20section.png\" alt=\"Leaf section\">"),
        "{photo}"
    );
    assert!(photo.contains("<li class=\"task\"><input type=\"checkbox\" checked disabled> Read chapter 8</li>"));
    assert!(photo.contains("<aside class=\"callout\" data-kind=\"tip\">"));
    assert!(photo.contains("<th>Stage</th>") && photo.contains("<td>Thylakoid</td>"));
    let index = fs::read_to_string(root.join("index.html")).expect("the index is written");
    assert!(index.contains("Photosynthesis") && index.contains("Cells: the basics"));
    assert_eq!(exported.files.len(), 3);
}

#[test]
fn a_notebook_becomes_one_well_formed_word_file() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_docx(&sample.source, Scope::Notebook, out.path()).expect("exports");
    let bytes = fs::read(out.path().join("Biology.docx")).expect("the file is written");
    assert_eq!(exported.files.len(), 1);
    let parts = unzip(&bytes);
    let names: Vec<&str> = parts.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names[0], "[Content_Types].xml");
    assert!(names.contains(&"word/media/image1.png"));
    for (name, data) in &parts {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            assert_well_formed_xml(std::str::from_utf8(data).expect("XML is UTF-8"));
        }
    }
    let part = |wanted: &str| {
        let (_, data) = parts.iter().find(|(name, _)| name == wanted).expect("the part exists");
        String::from_utf8(data.clone()).expect("XML is UTF-8")
    };
    let document = part("word/document.xml");
    for expected in [
        "Light reactions",
        "<w:pStyle w:val=\"Heading1\"/>",
        "<w:b/>",
        "<w:bookmarkStart",
        "w:anchor=\"page_",
        "\u{2611} Read chapter 8",
        "<w:pStyle w:val=\"Code\"/>",
        "<w:tbl>",
        "r:embed=\"rId",
        "5 * 3 = 15",
    ] {
        assert!(document.contains(expected), "missing {expected} in {document}");
    }
    assert!(part("word/_rels/document.xml.rels").contains("Target=\"https://example.org/a_b\" TargetMode=\"External\""));
    assert!(part("word/numbering.xml").contains("w:numId=\"2\""));
    assert!(part("docProps/core.xml").contains("<dc:title>Biology</dc:title>"));
    let notes = exported
        .report
        .general
        .entries
        .iter()
        .find(|e| e.what.contains("attachment"))
        .expect("attachments are noted");
    assert_eq!(notes.outcome, Outcome::Simplified);
}

#[test]
fn a_page_that_cannot_be_read_is_reported_and_the_rest_still_exports() {
    let world = TestEnv::new();
    let env = world.env();
    let mut sample = sample_notebook(&env);
    let mut missing = opennote_interop::page_builder::PageBuilder::new(&env, "Gone", sample_time(), sample_time());
    missing.push_blocks(Vec::new());
    let page = missing.finish().expect("builds").page;
    let mut section = opennote_interop::tree::SectionBuilder::new(&env, "Broken", sample_time());
    section.add_page(&page, None);
    let key = opennote_interop::tree::section_orders(1).expect("a key").remove(0);
    sample
        .source
        .add_section(section.finish(key).expect("the section builds"));
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&sample.source, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    assert_eq!(exported.files.len(), 3);
    let skipped = &exported.report.general.entries;
    assert!(skipped
        .iter()
        .any(|e| e.outcome == Outcome::Skipped && e.what.contains("Gone")));
}

#[test]
fn a_section_named_assets_does_not_mix_with_the_assets_folder() {
    let world = TestEnv::new();
    let env = world.env();
    let notebook = opennote_core::model::NotebookFile::new(
        opennote_core::NotebookId::generate(&world.clock),
        "Odd",
        sample_time(),
    );
    let mut source = opennote_interop::MemorySource::new(notebook);
    let mut page = opennote_interop::page_builder::PageBuilder::new(&env, "Picture", sample_time(), sample_time());
    let image = page.add_asset("pic.png", None, png_bytes());
    page.push_image(image, "A pixel".to_owned());
    let page = page.finish().expect("builds");
    let mut section = opennote_interop::tree::SectionBuilder::new(&env, "Assets", sample_time());
    section.add_page(&page.page, None);
    source.add_page(page);
    let key = opennote_interop::tree::section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(key).expect("the section builds"));
    let out = tempfile::tempdir().expect("a temp folder");
    export_files(&source, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    let root = out.path().join("Odd");
    assert!(root.join("assets/pic.png").is_file());
    let page_text = fs::read_to_string(root.join("Assets (2)/Picture.md")).expect("the page is in its own folder");
    assert!(page_text.contains("![A pixel](../assets/pic.png)"), "{page_text}");
}

fn sample_time() -> opennote_core::Timestamp {
    opennote_interop::testing::at("2026-01-01T00:00:00Z")
}
