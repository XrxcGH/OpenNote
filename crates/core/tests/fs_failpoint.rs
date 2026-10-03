//! Fail points abort the process on their n-th hit (plan 13.6). Each test runs this test binary again as a child,
//! with `OPENNOTE_FAILPOINT` set, and checks what the abort left on disk.

#![cfg(feature = "failpoints")]

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use opennote_core::store::failpoint;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::parse_temp_name;
use opennote_core::store::std_fs::StdFs;

/// Set in the child, naming what it does.
const CHILD: &str = "OPENNOTE_FAILPOINT_TEST_CHILD";
/// The folder the child works in.
const CHILD_DIR: &str = "OPENNOTE_FAILPOINT_TEST_DIR";

/// Runs the test `name` of this binary in a child process with the fail point armed.
fn run_child(name: &str, point: &str, dir: &Path) -> Output {
    Command::new(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture", "--test-threads=1"])
        .env(CHILD, name)
        .env(CHILD_DIR, dir)
        .env(failpoint::ENV_VAR, point)
        .output()
        .unwrap()
}

/// The child's folder, when this process is the child running `name`.
fn child_dir(name: &str) -> Option<PathBuf> {
    (std::env::var(CHILD).ok()? == name).then(|| PathBuf::from(std::env::var_os(CHILD_DIR).unwrap()))
}

#[test]
fn child_counts_hits() {
    if child_dir("child_counts_hits").is_none() {
        return;
    }
    failpoint::configure_from_env();
    for _ in 0..5 {
        failpoint::hit("tests.point");
        eprintln!("passed the point");
    }
}

#[test]
fn aborts_on_the_nth_hit_only() {
    let dir = common::temp_dir();
    let out = run_child("child_counts_hits", "tests.point:3", dir.path());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success(), "{stderr}");
    assert!(stderr.contains("FAILPOINT tests.point 3"), "{stderr}");
    assert_eq!(stderr.matches("passed the point").count(), 2);
    let out = run_child("child_counts_hits", "other.point:1", dir.path());
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8_lossy(&out.stderr).matches("passed the point").count(),
        5
    );
}

#[test]
fn child_saves_a_page() {
    let Some(dir) = child_dir("child_saves_a_page") else {
        return;
    };
    let fs = StdFs::new(&opennote_core::Timings::default());
    fs.replace_durable(&dir.join("page.json"), b"new").unwrap();
    eprintln!("saved");
}

fn save_with(point: &str) -> (Vec<u8>, usize) {
    let dir = common::temp_dir();
    std::fs::write(dir.path().join("page.json"), b"old").unwrap();
    let out = run_child("child_saves_a_page", point, dir.path());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success() && !stderr.contains("saved"), "{point}: {stderr}");
    let temps = std::fs::read_dir(dir.path())
        .unwrap()
        .filter(|e| parse_temp_name(&e.as_ref().unwrap().file_name().to_string_lossy()).is_some())
        .count();
    (std::fs::read(dir.path().join("page.json")).unwrap(), temps)
}

#[test]
fn the_page_save_points_split_the_replace() {
    assert_eq!(save_with("save.page.tmp_flushed:1"), (b"old".to_vec(), 1));
    assert_eq!(save_with("fs.tmp_flushed:1"), (b"old".to_vec(), 1));
    assert_eq!(save_with("save.page.renamed:1"), (b"new".to_vec(), 0));
    assert_eq!(save_with("fs.renamed:1"), (b"new".to_vec(), 0));
}
