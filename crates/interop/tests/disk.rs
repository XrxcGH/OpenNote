//! Imports written through the core's storage open as notebooks, and exports read them back.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use opennote_core::session::core::{Core, CoreConfig};
use opennote_core::testing::fakes::NullSink;
use opennote_interop::testing::TestEnv;
use opennote_interop::ImportSink as _;
use opennote_interop::{
    export_files, import_markdown_folder, DiskSink, DiskSource, Format, InteropError, NoteSource, Scope,
};

fn vault(root: &Path) {
    fs::create_dir_all(root.join(".obsidian")).expect("creates a folder");
    fs::create_dir_all(root.join("Unit 1")).expect("creates a folder");
    fs::write(
        root.join("Welcome.md"),
        "---\ntags: [intro]\ncreated: 2024-03-01 09:30:00\n---\nRead [[Cells]] and **learn**.\n\n![[leaf.png]]\n",
    )
    .expect("writes");
    fs::write(root.join("Unit 1/Cells.md"), "Back to [[Welcome]].\n\n- one\n- two\n").expect("writes");
    fs::write(root.join("leaf.png"), opennote_interop::testing::png_bytes()).expect("writes");
}

fn start_core(data: &Path) -> Core {
    let config = CoreConfig::production(data.to_path_buf(), "test".to_owned()).expect("a core config");
    Core::start(config, Arc::new(NullSink), None).expect("a core")
}

#[test]
fn an_import_written_through_the_core_opens_and_verifies() {
    let world = TestEnv::new();
    let source = tempfile::tempdir().expect("a temp folder");
    let root = source.path().join("My vault");
    vault(&root);
    let library = tempfile::tempdir().expect("a temp folder");
    let mut sink = DiskSink::standard(library.path());
    let report = import_markdown_folder(&root, &world.env(), &mut sink).expect("imports");
    assert_eq!(report.pages.len(), 2);

    let dir = sink.notebook_dir().expect("the import finished").to_path_buf();
    assert_eq!(dir.file_name().and_then(|n| n.to_str()), Some("My vault"));
    let leftovers: Vec<_> = fs::read_dir(library.path())
        .expect("lists")
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(".importing"))
        .collect();
    assert!(leftovers.is_empty(), "no staging folder is left behind");

    let data = tempfile::tempdir().expect("a temp folder");
    let core = start_core(data.path());
    let notebook = core.open_notebook(&dir).expect("the core opens the import");
    let verify = notebook.verify().expect("verifies");
    assert!(verify.is_clean(), "problems: {:?}", verify.problems);
    let tree = notebook.tree();
    assert_eq!(tree.title, "My vault");
    let mut titles: Vec<String> = tree
        .sections
        .iter()
        .flat_map(|s| s.pages.iter().map(|p| p.title.clone()))
        .collect();
    titles.sort();
    assert_eq!(titles, ["Cells", "Welcome"]);
    notebook.close().expect("closes");
    core.shutdown(std::time::Duration::from_secs(5));
}

#[test]
fn attachments_with_thai_and_devanagari_names_are_written_and_verify() {
    // Each name holds a combining vowel sign: Thai sara uu (Mn) and Devanagari vowel sign i (Mc).
    let thai = "\u{e23}\u{e39}\u{e1b}.png";
    let hindi = "\u{91a}\u{93f}\u{924}\u{94d}\u{930}.png";
    let world = TestEnv::new();
    let source = tempfile::tempdir().expect("a temp folder");
    let root = source.path().join("Pictures");
    fs::create_dir_all(&root).expect("creates a folder");
    fs::write(root.join("Note.md"), format!("![[{thai}]]\n\n![[{hindi}]]\n")).expect("writes");
    fs::write(root.join(thai), opennote_interop::testing::png_bytes()).expect("writes");
    let mut other = opennote_interop::testing::png_bytes();
    other.push(0);
    fs::write(root.join(hindi), other).expect("writes");

    let library = tempfile::tempdir().expect("a temp folder");
    let mut sink = DiskSink::standard(library.path());
    let report = import_markdown_folder(&root, &world.env(), &mut sink).expect("imports");
    assert_eq!(report.pages.len(), 1);
    let dir = sink.notebook_dir().expect("the import finished").to_path_buf();

    let data = tempfile::tempdir().expect("a temp folder");
    let core = start_core(data.path());
    let notebook = core.open_notebook(&dir).expect("the core opens the import");
    let verify = notebook.verify().expect("verifies");
    assert!(verify.is_clean(), "problems: {:?}", verify.problems);
    notebook.close().expect("closes");
    core.shutdown(std::time::Duration::from_secs(5));
}

#[test]
fn a_canceled_or_failed_import_leaves_no_folder() {
    let world = TestEnv::new();
    let source = tempfile::tempdir().expect("a temp folder");
    let root = source.path().join("Vault");
    vault(&root);
    let library = tempfile::tempdir().expect("a temp folder");
    let token = opennote_interop::CancelToken::new();
    token.cancel();
    let env = world.env().with_control(opennote_interop::Control::with_cancel(token));
    let mut sink = DiskSink::standard(library.path());
    let outcome = import_markdown_folder(&root, &env, &mut sink);
    assert!(matches!(outcome, Err(InteropError::Canceled)));
    assert!(sink.notebook_dir().is_none());
    let names: Vec<_> = fs::read_dir(library.path()).expect("lists").flatten().collect();
    assert!(names.is_empty(), "the staging folder was removed: {names:?}");
}

#[test]
fn two_imports_with_one_title_get_two_folders() {
    let world = TestEnv::new();
    let source = tempfile::tempdir().expect("a temp folder");
    let root = source.path().join("Vault");
    vault(&root);
    let library = tempfile::tempdir().expect("a temp folder");
    let mut first = DiskSink::standard(library.path());
    import_markdown_folder(&root, &world.env(), &mut first).expect("imports");
    let mut second = DiskSink::standard(library.path());
    import_markdown_folder(&root, &world.env(), &mut second).expect("imports");
    let one = first.notebook_dir().expect("done").to_path_buf();
    let two = second.notebook_dir().expect("done").to_path_buf();
    assert_ne!(one, two);
    let title = |dir: &Path| {
        let text = std::fs::read_to_string(dir.join("notebook.json")).expect("notebook.json");
        serde_json::from_str::<serde_json::Value>(&text).expect("json")["title"].clone()
    };
    assert_eq!(title(&one), "Vault");
    assert_eq!(title(&two), "Vault (2)", "the title carries the folder's counter");
}

#[test]
fn an_exported_disk_notebook_matches_the_import() {
    let world = TestEnv::new();
    let source = tempfile::tempdir().expect("a temp folder");
    let root = source.path().join("Vault");
    vault(&root);
    let library = tempfile::tempdir().expect("a temp folder");
    let mut sink = DiskSink::standard(library.path());
    import_markdown_folder(&root, &world.env(), &mut sink).expect("imports");
    let disk = DiskSource::open(sink.notebook_dir().expect("done")).expect("opens the folder");
    assert_eq!(disk.notebook().title, "Vault");
    assert_eq!(disk.sections().len(), 2);
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&disk, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    assert_eq!(exported.files.len(), 2);
    let welcome = fs::read_to_string(
        exported
            .files
            .iter()
            .find(|p| p.file_name().is_some_and(|n| n == "Welcome.md"))
            .expect("the page"),
    )
    .expect("reads");
    assert!(welcome.contains("tags:") && welcome.contains("intro"), "{welcome}");
    assert!(exported.root.join("assets").read_dir().expect("assets").count() == 1);
}

#[test]
fn a_notebook_with_every_block_round_trips_through_the_core_and_back_out() {
    use opennote_interop::testing::{describe_pages, sample_notebook};
    use opennote_interop::{import_markdown_folder, MemorySink};

    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let library = tempfile::tempdir().expect("a temp folder");
    let mut sink = DiskSink::standard(library.path());
    sample.source.write_to(&mut sink).expect("writes the notebook");
    sink.finish().expect("finishes");
    let dir = sink.notebook_dir().expect("done").to_path_buf();

    // A real core opens it and finds nothing wrong.
    let data = tempfile::tempdir().expect("a temp folder");
    let core = start_core(data.path());
    let notebook = core.open_notebook(&dir).expect("opens");
    assert!(notebook.verify().expect("verifies").is_clean());
    notebook.close().expect("closes");
    core.shutdown(std::time::Duration::from_secs(5));

    // The pages read back from disk export and import again with the same content.
    let disk = DiskSource::open(&dir).expect("opens the folder");
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&disk, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    let mut again = MemorySink::default();
    import_markdown_folder(&exported.root, &world.env(), &mut again).expect("imports");
    let pages: Vec<_> = again.pages.iter().map(|(_, p)| &p.page).collect();
    assert_eq!(describe_pages(&pages), describe_pages(&sample.source.pages()));
}
