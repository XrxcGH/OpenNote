//! Feeds every fuzz corpus file and every past crash through the fuzz entry points, with stable Rust, on every
//! pull request (plan 13.3). A crash fixed once stays fixed.

mod common;

use opennote_core::fuzzing::{replay_dir, TARGETS};

#[test]
fn corpus_and_past_crashes_never_panic() {
    let fuzz = common::fuzz_dir();
    for target in TARGETS {
        for folder in ["corpus", "regressions"] {
            let dir = fuzz.join(folder).join(target.name);
            replay_dir(target, &dir).unwrap_or_else(|err| panic!("{}: {err}", dir.display()));
        }
    }
}

#[test]
fn every_target_has_a_file_and_a_manifest_entry() {
    let fuzz = common::fuzz_dir();
    let manifest = std::fs::read_to_string(fuzz.join("Cargo.toml")).unwrap();
    for target in TARGETS {
        let file = fuzz.join("fuzz_targets").join(format!("{}.rs", target.name));
        let source = std::fs::read_to_string(&file).unwrap_or_else(|_| panic!("missing {}", file.display()));
        assert!(
            source.contains(&format!("::{}(data)", target.name)),
            "{} calls its entry point",
            target.name
        );
        assert!(
            manifest.contains(&format!("name = \"{}\"", target.name)),
            "{} is in the manifest",
            target.name
        );
    }
}

#[test]
fn helpers_find_the_repository() {
    assert!(common::repo_dir()
        .join("docs")
        .join("format")
        .join("README.md")
        .is_file());
    let config = common::cases(7);
    assert!(config.cases > 0);
    let (fs, notebook) = common::mem_notebook();
    assert!(fs.exists(&notebook));
    assert!(common::files_under(&common::fixtures_dir().join("no-such-folder")).is_empty());
}
