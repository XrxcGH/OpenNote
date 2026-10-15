//! Renaming a notebook renames its folder (A4-4): a safe, free name beside it, the library pointing at the new
//! folder, and the pages still there. With the `failpoints` feature, a crash at each step of the rename leaves the
//! notebook in exactly one folder that the library names at the next start.

mod real_core;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::testing::sample::test_clock;
use real_core::{start, Real};

/// Whether the library file holds no record of a rename under way.
fn no_rename_left(data: &Path) -> bool {
    !std::fs::read_to_string(data.join("library.json"))
        .unwrap_or_default()
        .contains("renaming")
}

fn library_paths(core: &opennote_core::session::core::Core) -> Vec<PathBuf> {
    core.library().notebooks.into_iter().map(|entry| entry.path).collect()
}

#[test]
fn the_folder_takes_the_new_title_and_the_library_follows() {
    let real = Real::new();
    let notes = real.dir.path().join("notes");
    let old = real.notebook.path().to_path_buf();
    assert_eq!(old, notes.join("Biology"));
    real.notebook.rename_notebook("Biology 101: Cells?").unwrap();
    let moved = real.core.rename_notebook_folder(&old).unwrap();
    assert_eq!(
        moved,
        notes.join("Biology 101- Cells"),
        "reserved characters are replaced or left out"
    );
    assert!(!old.exists());
    assert!(moved.join("notebook.json").is_file());
    assert_eq!(library_paths(&real.core), std::slice::from_ref(&moved));
    assert!(no_rename_left(&real.dir.path().join("data")));

    // The notebook is open again in its new folder, with its page.
    let reopened = real.core.find_open(&moved).expect("open in the new folder");
    assert_eq!(reopened.id(), real.notebook.id());
    let page = reopened
        .open_page(real.page, real.client.clone())
        .expect("the page opens");
    assert_eq!(page.id(), real.page);

    // A name already taken beside it gets a number, and a name that already fits changes nothing.
    std::fs::create_dir_all(notes.join("Chemistry")).unwrap();
    reopened.rename_notebook("Chemistry").unwrap();
    let numbered = real.core.rename_notebook_folder(&moved).unwrap();
    assert_eq!(numbered, notes.join("Chemistry (2)"));
    assert_eq!(real.core.rename_notebook_folder(&numbered).unwrap(), numbered);
    assert!(notes.join("Chemistry").is_dir(), "the other folder is untouched");
}

#[test]
fn a_notebook_that_isnt_open_or_is_trashed_has_no_folder_to_rename() {
    let real = Real::new();
    let elsewhere = real.dir.path().join("notes").join("Elsewhere");
    assert!(real.core.rename_notebook_folder(&elsewhere).is_err());
    let path = real.notebook.path().to_path_buf();
    real.core.remove_notebook(&path).unwrap();
    assert!(real.core.rename_notebook_folder(&path).is_err());
    assert!(path.join("notebook.json").is_file());
}

/// Starts a core again on the same data folder, as the next run of the app does, and checks the notebook is in
/// exactly one folder that the library names, with its page.
fn check_after_crash(data: &Path, notes: &Path) -> PathBuf {
    let core = start(data.to_path_buf(), Arc::new(test_clock()));
    let paths = library_paths(&core);
    assert_eq!(paths.len(), 1, "{paths:?}");
    let folders: Vec<_> = std::fs::read_dir(notes)
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().join("notebook.json").is_file())
        .map(|entry| entry.path())
        .collect();
    assert_eq!(folders, paths, "the library names the one notebook folder");
    let notebook = core.open_notebook(&paths[0]).unwrap();
    assert_eq!(notebook.tree().title, "Biology 101", "{paths:?}");
    assert!(no_rename_left(data));
    core.shutdown(std::time::Duration::from_secs(5));
    paths[0].clone()
}

#[cfg(feature = "failpoints")]
mod crashes {
    use std::path::PathBuf;
    use std::process::Command;

    use opennote_core::store::failpoint;

    use super::*;

    const CHILD: &str = "OPENNOTE_RENAME_TEST_CHILD";
    const CHILD_DIR: &str = "OPENNOTE_RENAME_TEST_DIR";

    /// In the child: a notebook titled "Biology 101" in the folder "Biology", then the folder rename, which the armed
    /// point aborts.
    #[test]
    fn child_renames_a_folder() {
        if std::env::var(CHILD).ok().as_deref() != Some("rename") {
            return;
        }
        failpoint::configure_from_env();
        let dir = PathBuf::from(std::env::var_os(CHILD_DIR).unwrap());
        let core = start(dir.join("data"), Arc::new(test_clock()));
        let notes = dir.join("notes");
        let notebook = core.open_notebook(&notes.join("Biology")).unwrap();
        notebook.rename_notebook("Biology 101").unwrap();
        // The title is written by the background writer: wait until it is on disk, so the crash is in the rename.
        let file = notes.join("Biology").join("notebook.json");
        for _ in 0..200 {
            if std::fs::read_to_string(&file).is_ok_and(|text| text.contains("Biology 101")) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        core.rename_notebook_folder(notebook.path()).unwrap();
        eprintln!("child finished the rename");
    }

    #[test]
    fn a_crash_at_each_step_leaves_one_folder_the_library_names() {
        for (point, renamed) in [
            ("notebook.folder.closed:1", false),
            ("notebook.folder.recorded:1", false),
            ("notebook.folder.renamed:1", true),
        ] {
            let real = Real::new();
            let base = real.dir.path().to_path_buf();
            let notes = base.join("notes");
            real.notebook.clone().close().unwrap();
            real.core.shutdown(std::time::Duration::from_secs(5));
            let out = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "crashes::child_renames_a_folder",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(CHILD, "rename")
                .env(CHILD_DIR, &base)
                .env(failpoint::ENV_VAR, point)
                .output()
                .unwrap();
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert!(
                !out.status.success() && !stderr.contains("child finished"),
                "{point}: {stderr}"
            );
            let folder = check_after_crash(&base.join("data"), &notes);
            let expected = if renamed { "Biology 101" } else { "Biology" };
            assert_eq!(folder, notes.join(expected), "{point}");
            drop(real);
        }
    }
}

#[test]
fn moving_a_notebook_copies_it_then_names_the_copy_and_a_failed_copy_changes_nothing() {
    let real = Real::new();
    let old = real.notebook.path().to_path_buf();
    let elsewhere = real.dir.path().join("moved");
    // A copy that fails, as a cancel does, leaves the notebook where it was and open.
    let failed = real.core.move_notebook_folder(&old, &elsewhere, &mut |_, _| {
        Err(opennote_core::CoreError::NotFound("cancelled".into()))
    });
    assert!(failed.is_err());
    assert_eq!(library_paths(&real.core), std::slice::from_ref(&old));
    assert!(real.core.find_open(&old).is_some());
    assert!(no_rename_left(&real.dir.path().join("data")));

    let moved = real
        .core
        .move_notebook_folder(&old, &elsewhere, &mut |from, to| {
            copy_dir(from, to);
            Ok(())
        })
        .unwrap();
    assert_eq!(moved, elsewhere.join("Biology"));
    assert_eq!(library_paths(&real.core), std::slice::from_ref(&moved));
    let reopened = real.core.find_open(&moved).expect("open in the new folder");
    assert!(reopened.open_page(real.page, real.client.clone()).is_ok());
    assert!(
        old.join("notebook.json").is_file(),
        "the old folder stays for the caller to remove"
    );
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap().flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}
