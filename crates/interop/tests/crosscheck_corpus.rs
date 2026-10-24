//! Writes one Word, PowerPoint, and Excel export of the sample notebook for the cross-check tools
//! (`tests/crosscheck/`, docs/CHECKS.md). It does nothing unless `OPENNOTE_CROSSCHECK_DIR` names a folder, so a
//! normal `cargo test` writes no files.

use std::fs;
use std::path::PathBuf;

use opennote_interop::run::Control;
use opennote_interop::testing::{sample_notebook, TestEnv};
use opennote_interop::{export_docx, export_pptx, export_tables, Scope, TableFormat};

#[test]
fn the_exports_are_written_for_the_cross_check_tools_when_asked() {
    let Some(dir) = std::env::var_os("OPENNOTE_CROSSCHECK_DIR") else {
        return;
    };
    let dir = PathBuf::from(dir);
    fs::create_dir_all(&dir).expect("the corpus folder is made");
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let control = Control::none();
    let word = export_docx(&sample.source, Scope::Notebook, &dir).expect("the Word export");
    let slides = export_pptx(&sample.source, Scope::Notebook, &dir, &control).expect("the PowerPoint export");
    let sheets =
        export_tables(&sample.source, Scope::Notebook, TableFormat::Xlsx, &dir, &control).expect("the Excel export");
    for exported in [word, slides, sheets] {
        assert!(!exported.files.is_empty());
    }
}
