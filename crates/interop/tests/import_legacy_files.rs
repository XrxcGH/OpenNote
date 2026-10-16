//! Older Office files chosen one at a time or in a folder: a locked file says why, and a folder of mixed kinds
//! names the files the chosen import leaves out.

use std::fs;
use std::path::PathBuf;

use opennote_interop::testing::TestEnv;
use opennote_interop::{import_docx, import_xlsx, MemorySink};

fn legacy(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/data/legacy")
        .join(name)
}

#[test]
fn a_locked_file_chosen_by_itself_says_how_to_unlock_it() {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    // The reason is in the report, which the import window shows when there is nothing to import.
    for report in [
        import_docx(&legacy("locked.doc"), &world.env(), &mut sink).expect("reported"),
        import_xlsx(&legacy("locked.xls"), &world.env(), &mut sink).expect("reported"),
    ] {
        let losses = report.loss_groups();
        assert!(losses.iter().any(|group| group.why.contains("remove the password")), "{losses:?}");
    }
    assert!(sink.pages.is_empty());
}

#[test]
fn a_folder_import_names_the_files_of_another_kind() {
    let dir = tempfile::tempdir().expect("a temp folder");
    for name in ["notes.doc", "budget.xls", "budget.ods"] {
        fs::copy(legacy(name), dir.path().join(name)).expect("copied");
    }
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_docx(dir.path(), &world.env(), &mut sink).expect("imports");
    let skipped: Vec<&str> = report.general.entries.iter().map(|entry| entry.what.as_str()).collect();
    assert!(
        skipped.contains(&"budget.xls") && skipped.contains(&"budget.ods"),
        "{skipped:?}"
    );
    assert!(!sink.pages.is_empty(), "the document still comes over");
}
