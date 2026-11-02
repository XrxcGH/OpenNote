//! The kill harness end to end: writers killed during saves leave no damaged or lost page, and a writer that
//! damages a page on purpose is caught (plan 14.3).

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
        // The writer runs until it reaches the point, so every iteration must.
        let reached = summary["fail_points_reached"].as_u64().unwrap();
        assert_eq!(reached, 2, "{point} was reached in {reached} of 2 iterations");
    }
}

#[test]
fn core_writers_killed_during_saves_lose_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(dir.path(), "core", 50, &[]);
    assert!(output.status.success(), "{:?}", failures(&summary));
}

#[test]
fn the_harness_catches_a_core_writer_that_damages_pages() {
    let dir = tempfile::tempdir().unwrap();
    let (output, summary) = run(
        dir.path(),
        "core",
        5,
        &["--sabotage", "--failpoint", "corew.sabotage.damaged", "--no-hostile"],
    );
    assert_eq!(output.status.code(), Some(1), "{:?}", failures(&summary));
    // The writer runs until it has damaged a page, so the check after the first iteration must catch it.
    let failures = failures(&summary);
    assert_eq!(failures.len(), 1);
    assert!(failures[0].starts_with("iteration 0 "), "{failures:?}");
    assert!(
        failures[0].contains("(I1)") && failures[0].contains("page.invalid"),
        "{failures:?}"
    );
    assert_eq!(summary["fail_points_reached"], 1);
}

/// The nightly kill job's own command line, with its folders, a run-number seed, and a few kills, runs to the
/// end. The job once left out `--data` and exited with 2 before killing anything.
#[test]
fn the_nightly_kill_command_runs() {
    let workflow = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.github/workflows/nightly.yml");
    let workflow = std::fs::read_to_string(workflow).unwrap();
    let line = workflow
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("target/debug/opennote-crashtest run "))
        .expect("the kill job runs the harness");
    let dir = tempfile::tempdir().unwrap();
    let args: Vec<String> = line
        .split_whitespace()
        .skip(1)
        .map(|word| match word.trim_matches('"') {
            "$KILL_NOTEBOOK" => dir.path().join("kill-notebook").display().to_string(),
            "$KILL_DATA" => dir.path().join("kill-data").display().to_string(),
            "$KILLS" => "3".to_owned(),
            "$GITHUB_RUN_ID" => "41184765694".to_owned(),
            other => {
                assert!(!other.starts_with('$'), "the test knows the variable {other}");
                other.to_owned()
            }
        })
        .collect();
    std::fs::create_dir_all(dir.path().join("kill-notebook")).unwrap();
    let output = std::process::Command::new(EXE).args(&args).output().unwrap();
    assert!(
        output.status.success(),
        "{line}\n{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let summary: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(summary["iterations"], 3);
    assert!(failures(&summary).is_empty());
}
