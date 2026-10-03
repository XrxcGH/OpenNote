//! Round trips: what goes out as Markdown comes back in with the same content.

use std::fs;
use std::path::Path;

use opennote_core::model::Page;
use opennote_interop::testing::{describe_pages, png_bytes, sample_notebook, TestEnv};
use opennote_interop::{
    export_files, import_enex_reader, import_markdown_folder, Format, MemorySink, MemorySource, Scope,
};

fn pages(sink: &MemorySink) -> Vec<&Page> {
    sink.pages.iter().map(|(_, imported)| &imported.page).collect()
}

/// Exports a notebook as Markdown, and imports the folder again.
fn round_trip(source: &MemorySource, world: &TestEnv, out: &Path) -> MemorySink {
    let exported = export_files(source, Scope::Notebook, Format::Markdown, out).expect("exports");
    let mut sink = MemorySink::default();
    import_markdown_folder(&exported.root, &world.env(), &mut sink).expect("imports");
    sink
}

#[test]
fn a_notebook_exported_as_markdown_imports_with_the_same_content() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let imported = round_trip(&sample.source, &world, out.path());

    let before = describe_pages(&sample.source.pages());
    let after = describe_pages(&pages(&imported));
    assert_eq!(
        after,
        before,
        "the pages differ after a round trip:\n{}",
        after.join("\n---\n")
    );

    let mut titles: Vec<&str> = imported.sections.iter().map(|s| s.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, vec!["Lab", "Semester 1"]);
    let photo = imported
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Photosynthesis")
        .expect("the page");
    assert!(photo.1.asset_bytes.values().any(|bytes| bytes == &png_bytes()));
}

#[test]
fn a_second_round_trip_changes_nothing() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let first_out = tempfile::tempdir().expect("a temp folder");
    let first = round_trip(&sample.source, &world, first_out.path());
    let second_out = tempfile::tempdir().expect("a temp folder");
    let second = round_trip(
        &MemorySource::from_sink(first).expect("a notebook"),
        &world,
        second_out.path(),
    );
    let again = describe_pages(&pages(&second));
    assert_eq!(again, describe_pages(&sample.source.pages()));
}

#[test]
fn an_obsidian_vault_survives_an_export_and_another_import() {
    let world = TestEnv::new();
    let vault = tempfile::tempdir().expect("a temp folder");
    let root = vault.path();
    fs::create_dir_all(root.join(".obsidian")).expect("creates a folder");
    fs::create_dir_all(root.join("Notes")).expect("creates a folder");
    let welcome =
        "---\ntags: [intro]\ncreated: 2024-03-01 09:30:00\n---\nRead [[Cells]]. ==Key== and **bold** text.\n\n\
        - [x] done\n- [ ] todo\n\n![[leaf.png]]\n\n> [!warning] Careful\n> Wear goggles.\n";
    fs::write(root.join("Welcome.md"), welcome).expect("writes a note");
    fs::write(
        root.join("Notes/Cells.md"),
        "Back to [[Welcome]].\n\n1. one\n2. two\n\n[[notes.pdf]]\n",
    )
    .expect("writes a note");
    fs::write(root.join("leaf.png"), png_bytes()).expect("writes an image");
    fs::write(root.join("notes.pdf"), b"%PDF-1.4 tiny").expect("writes a file");
    let mut first = MemorySink::default();
    import_markdown_folder(root, &world.env(), &mut first).expect("imports");

    let out = tempfile::tempdir().expect("a temp folder");
    let first_pages = describe_pages(&pages(&first));
    let second = round_trip(&MemorySource::from_sink(first).expect("a notebook"), &world, out.path());
    assert_eq!(describe_pages(&pages(&second)), first_pages);
}

#[test]
fn an_evernote_import_survives_an_export_and_another_import() {
    let world = TestEnv::new();
    let enex = include_str!("data/sample.enex");
    let mut first = MemorySink::default();
    import_enex_reader(enex.as_bytes(), "Lab", &world.env(), &mut first).expect("imports");
    let first_pages = describe_pages(&pages(&first));

    let out = tempfile::tempdir().expect("a temp folder");
    let second = round_trip(&MemorySource::from_sink(first).expect("a notebook"), &world, out.path());
    let second_pages = describe_pages(&pages(&second));
    assert_eq!(
        second_pages,
        first_pages,
        "the pages differ after a round trip:\n{}",
        second_pages.join("\n---\n")
    );
}
