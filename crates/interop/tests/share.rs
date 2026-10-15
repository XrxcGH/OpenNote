//! Sharing as a file: a notebook goes out as one `.opennote` file and comes back as a new notebook, with or without a
//! password.

use opennote_interop::testing::{sample_notebook, TestEnv};
use opennote_interop::{
    detect, export_share, import, preview, Control, ImportOptions, InteropError, MemorySink, MemorySource, Scope,
};

fn titles(sink: &MemorySink) -> Vec<String> {
    let mut titles: Vec<String> = sink.pages.iter().map(|(_, p)| p.page.title.clone()).collect();
    titles.sort();
    titles
}

fn shared(password: Option<&str>) -> (tempfile::TempDir, std::path::PathBuf, MemorySource) {
    let world = TestEnv::new();
    let env = world.env();
    let source = sample_notebook(&env).source;
    let dir = tempfile::tempdir().expect("a folder");
    let done = export_share(&source, Scope::Notebook, password, dir.path(), &Control::none()).expect("shares");
    assert_eq!(done.files.len(), 1);
    assert!(done.files[0].extension().is_some_and(|e| e == "opennote"));
    (dir, done.files[0].clone(), source)
}

#[test]
fn a_shared_notebook_opens_as_a_new_notebook_with_every_page() {
    let (_dir, file, _source) = shared(None);
    let found = detect(&file).expect("known");
    assert!(!found.needs_password && found.supported);
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import(&file, &ImportOptions::default(), &world.env(), &mut sink).expect("opens");
    assert_eq!(titles(&sink), ["Cells: the basics", "Lab report", "Photosynthesis"]);
    assert!(sink.finished);
}

#[test]
fn a_locked_file_asks_for_its_password_and_opens_with_it() {
    let (_dir, file, _source) = shared(Some("pencil case"));
    let found = detect(&file).expect("known");
    assert!(found.needs_password);
    let world = TestEnv::new();
    let none = preview(&file, &ImportOptions::default(), &world.env()).expect("a preview without contents");
    assert!(none.detected.needs_password && none.pages == 0);

    let mut sink = MemorySink::default();
    let missing = import(&file, &ImportOptions::default(), &world.env(), &mut sink);
    assert!(matches!(missing, Err(InteropError::Unsupported { .. })), "{missing:?}");

    let wrong = ImportOptions {
        password: Some("wrong".to_owned()),
        ..ImportOptions::default()
    };
    assert!(import(&file, &wrong, &world.env(), &mut MemorySink::default()).is_err());

    let right = ImportOptions {
        password: Some("pencil case".to_owned()),
        ..ImportOptions::default()
    };
    let mut sink = MemorySink::default();
    import(&file, &right, &world.env(), &mut sink).expect("opens");
    assert_eq!(titles(&sink).len(), 3);
    let seen = preview(&file, &right, &world.env()).expect("previews");
    assert_eq!(seen.pages, 3);
}

#[test]
fn earlier_versions_come_along_as_pages_when_chosen() {
    use opennote_core::model::NotebookFile;
    use opennote_core::{NotebookId, PageId};
    use opennote_interop::export_share_with;
    use opennote_interop::sink::ImportedPage;
    use opennote_interop::testing::at;
    use opennote_interop::tree::{section_orders, SectionBuilder};
    use opennote_interop::NoteSource;

    let world = TestEnv::new();
    let env = world.env();
    let sample = sample_notebook(&env);
    let mut older = sample.source.page(sample.cells).expect("a page");
    older.id = PageId::generate(env.clock);
    older.title = "Cells: the basics (2026-01-01 09:00)".to_owned();
    let created = at("2026-01-05T09:30:00Z");
    let mut history = MemorySource::new(NotebookFile::new(NotebookId::generate(env.clock), "Biology", created));
    let mut section = SectionBuilder::new(&env, "Page history", created);
    section.add_page(&older, None);
    history.add_page(ImportedPage {
        page: older,
        asset_bytes: Default::default(),
    });
    let order = section_orders(1).expect("a key").remove(0);
    history.add_section(section.finish(order).expect("the section"));

    let dir = tempfile::tempdir().expect("a folder");
    let done = export_share_with(
        &sample.source,
        Scope::Notebook,
        None,
        Some(&history),
        dir.path(),
        &Control::none(),
    )
    .expect("shares");
    assert!(done.report.to_markdown().contains("1 earlier version of a page"));
    let mut sink = MemorySink::default();
    import(&done.files[0], &ImportOptions::default(), &world.env(), &mut sink).expect("opens");
    assert!(titles(&sink).contains(&"Cells: the basics (2026-01-01 09:00)".to_owned()));
    let sections: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    assert!(sections.iter().any(|s| s.ends_with("Page history")), "{sections:?}");
}
