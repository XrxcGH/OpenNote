//! Plain text imports: files and folders of text, in the encodings that Windows tools write.

use std::fs;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::TestEnv;
use opennote_interop::{import_markdown_folder, import_text_folder, MemorySink};

fn text_of(page: &Page) -> String {
    page.blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[test]
fn a_text_file_becomes_one_page_named_after_it() {
    let world = TestEnv::new();
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = dir.path().join("Shopping list.txt");
    fs::write(&file, "Things to buy:\n- milk\n- eggs\n\nAnd *stars* stay literal.\n").expect("writes");
    let mut sink = MemorySink::default();
    let report = import_text_folder(&file, &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.pages.len(), 1);
    assert_eq!(sink.notebook.as_ref().map(|n| n.title.as_str()), Some("Shopping list"));
    let page = &sink.pages[0].1.page;
    assert_eq!(page.title, "Shopping list");
    let text = text_of(page);
    assert!(text.contains("- milk") && text.contains("- eggs"), "{text}");
    assert!(
        text.contains(r"\*stars\*"),
        "asterisks are escaped, not formatting: {text}"
    );
    assert!(report.to_markdown().contains("Shopping list"));
}

#[test]
fn folders_become_sections_and_old_encodings_are_read_and_reported() {
    let world = TestEnv::new();
    let dir = tempfile::tempdir().expect("a temp folder");
    let root = dir.path().join("Notes");
    fs::create_dir_all(root.join("School")).expect("creates");
    fs::write(root.join("Top.txt"), "plain").expect("writes");
    fs::write(root.join("School/French.txt"), b"caf\xe9 au lait").expect("writes");
    let utf16: Vec<u8> = [
        &[0xff, 0xfe][..],
        &"Bonjour \u{e0} tous"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<u8>>(),
    ]
    .concat();
    fs::write(root.join("School/Utf16.txt"), utf16).expect("writes");
    let mut sink = MemorySink::default();
    let report = import_text_folder(&root, &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.pages.len(), 3);
    let mut sections: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    sections.sort_unstable();
    assert_eq!(sections, ["Notes", "School"]);
    let french = sink.pages.iter().find(|(_, p)| p.page.title == "French").expect("page");
    assert_eq!(text_of(&french.1.page), "caf\u{e9} au lait");
    let utf16 = sink.pages.iter().find(|(_, p)| p.page.title == "Utf16").expect("page");
    assert_eq!(text_of(&utf16.1.page), "Bonjour \u{e0} tous");
    let markdown = report.to_markdown();
    assert!(
        markdown.contains("windows-1252"),
        "the guessed encoding is reported: {markdown}"
    );
}

#[test]
fn a_single_markdown_file_imports_as_a_one_page_notebook() {
    let world = TestEnv::new();
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = dir.path().join("Idea.md");
    fs::write(&file, "---\ntags: [spark]\n---\n# Idea\n\nText with **bold**.\n").expect("writes");
    let mut sink = MemorySink::default();
    import_markdown_folder(&file, &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.pages.len(), 1);
    let page = &sink.pages[0].1.page;
    assert_eq!(
        (page.title.as_str(), page.tags.as_slice()),
        ("Idea", &["spark".to_owned()][..])
    );
}
