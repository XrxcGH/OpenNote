//! The kill harness end to end: writers killed during saves leave no damaged or lost page, and a writer that
//! damages a page on purpose is caught (plan 14.3). The core workload's runs need WP5.

use std::path::Path;
use std::process::Output;

const EXE: &str = env!("CARGO_BIN_EXE_opennote-crashtest");

fn run(dir: &Path, workload: &str, iterations: u32, extra: &[&str]) -> (Output, serde_json::Value) {
    let output = std::process::Command::new(EXE)
        .args(["run", "--workload", workload, "--seed", "11"])
        .args(["--iterations", &iterations.to_string()])
        .arg("--notebook")
        .arg(dir.join("notebook"))
        .arg("--data")
        .arg(dir.join("data"))
        .args(extra)
        .output()
        .unwrap();
    let summary = serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
    (output, summary)
}

fn failures(summary: &serde_json::Value) -> Vec<String> {
    let list = summary["failures"].as_array().cloned().unwrap_or_default();
    list.iter().map(|f| f.as_str().unwrap_or_default().to_owned()).collect()
}

#[test]
fn fs_writers_killed_during_saves_leave_every_page_whole() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(dir.path(), "fs", 20, &[]);
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(summary["iterations"], 20);
    assert!(failures(&summary).is_empty());
    assert!(summary["acks"].as_u64().unwrap() > 0 && summary["save_steps"].as_u64().unwrap() > 0);
}

#[test]
fn the_harness_catches_a_writer_that_damages_pages() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(
        dir.path(),
        "fs",
        5,
        &["--sabotage", "--failpoint", "fsw.sabotage.half_written"],
    );
    assert_eq!(output.status.code(), Some(1));
    let failures = failures(&summary);
    assert_eq!(failures.len(), 1);
    assert!(failures[0].contains("damaged (I1)"), "{failures:?}");
}

#[test]
fn fail_points_inside_the_save_primitives_are_reached() {
    for point in ["fs.renamed", "save.page.tmp_flushed", "fsw.journal.synced"] {
        let dir = tempfile::tempdir().unwrap();
        let (output, summary) = run(dir.path(), "fs", 2, &["--failpoint", point]);
        assert!(output.status.success(), "{point}: {:?}", failures(&summary));
        assert!(
            summary["fail_points_reached"].as_u64().unwrap() >= 1,
            "{point} was never reached"
        );
    }
}

#[test]
#[ignore = "needs WP5"]
fn core_writers_killed_during_saves_lose_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(dir.path(), "core", 50, &[]);
    assert!(output.status.success(), "{:?}", failures(&summary));
}

#[test]
#[ignore = "needs WP5"]
fn the_harness_catches_a_core_writer_that_damages_pages() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(dir.path(), "core", 5, &["--sabotage", "--no-hostile"]);
    assert_eq!(output.status.code(), Some(1), "{:?}", failures(&summary));
}
