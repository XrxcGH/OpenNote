//! Helpers shared by the integration tests in `crates/core/tests`. Each test file uses `mod common;`.

// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use opennote_core::testing::sample;
use opennote_core::testing::MemFs;
use opennote_core::TestClock;
use proptest::test_runner::Config;

/// The crate folder, `crates/core`.
pub fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The repository's root folder.
pub fn repo_dir() -> PathBuf {
    crate_dir().join("..").join("..")
}

/// The shared fixtures in `docs/format/fixtures` (spec Appendix B.6).
pub fn fixtures_dir() -> PathBuf {
    repo_dir().join("docs").join("format").join("fixtures")
}

/// The fuzz crate, `crates/core/fuzz`, with its corpus and regressions.
pub fn fuzz_dir() -> PathBuf {
    crate_dir().join("fuzz")
}

/// Every file under `dir`, sorted, or none if it doesn't exist.
pub fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

/// A property test configuration with `cases` cases, unless `PROPTEST_CASES` sets another number, as the
/// nightly run does.
pub fn cases(cases: u32) -> Config {
    let from_env = std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok());
    Config {
        cases: from_env.unwrap_or(cases),
        ..Config::default()
    }
}

/// A test clock at `2026-09-30T14:00:00.000Z`.
pub fn clock() -> TestClock {
    sample::test_clock()
}

/// An in-memory file system with an empty notebook folder at `/notebooks/Biology` and a data folder at
/// `/data`, as a device would have them.
pub fn mem_notebook() -> (MemFs, PathBuf) {
    let fs = MemFs::new();
    let notebook = PathBuf::from("/notebooks/Biology");
    fs.mkdir_all(&notebook);
    fs.mkdir_all(Path::new("/data"));
    (fs, notebook)
}

/// A temporary folder on the real disk, deleted when dropped.
pub fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temporary folder")
}
