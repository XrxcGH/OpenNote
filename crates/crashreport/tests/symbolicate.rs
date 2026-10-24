//! The `opennote-symbolicate` tool, run as a program on real files.

use std::fs;
use std::process::Command;

use opennote_crashreport::Report;

const TOOL: &str = env!("CARGO_BIN_EXE_opennote-symbolicate");
const ID: &str = "3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71";

fn write_report(dir: &std::path::Path) -> std::path::PathBuf {
    // The example report has no function names, so the tool has something to add.
    let mut report = Report::example("1.0.0", 1_790_000_000);
    report.frames[0].function = None;
    let path = dir.join("crash.json");
    fs::write(&path, report.to_json()).unwrap();
    path
}

fn write_symbols(dir: &std::path::Path, id: &str) {
    let text =
        format!("MODULE windows x86_64 {id} opennote.pdb\nFUNC 1a2b00 120 0 opennote_core::store::Store::save_page\n");
    fs::write(dir.join("opennote.sym"), text).unwrap();
}

#[test]
fn names_the_frames_of_the_build_that_crashed() {
    let dir = tempfile::tempdir().unwrap();
    let report = write_report(dir.path());
    let symbols = dir.path().join("symbols");
    fs::create_dir(&symbols).unwrap();
    write_symbols(&symbols, ID);
    fs::write(symbols.join("readme.txt"), "ignored").unwrap();
    fs::write(symbols.join("broken.sym"), "not symbols").unwrap();

    let output = Command::new(TOOL).arg(&report).arg(&symbols).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let done = Report::from_json(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert_eq!(
        done.frames[0].function.as_deref(),
        Some("opennote_core::store::Store::save_page")
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("1 of 3 frames named"), "{stderr}");
    assert!(stderr.contains("skipped broken.sym"), "{stderr}");
}

#[test]
fn writes_to_a_file_when_asked_and_takes_a_single_symbol_file() {
    let dir = tempfile::tempdir().unwrap();
    let report = write_report(dir.path());
    write_symbols(dir.path(), ID);
    let out = dir.path().join("done.json");
    let status = Command::new(TOOL)
        .arg(&report)
        .arg(dir.path().join("opennote.sym"))
        .arg("--out")
        .arg(&out)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(status.stdout.is_empty());
    let done = Report::from_json(&fs::read_to_string(out).unwrap()).unwrap();
    assert!(done.frames[0].function.is_some());
}

#[test]
fn symbols_of_another_build_name_nothing_and_say_so_in_the_exit_code() {
    let dir = tempfile::tempdir().unwrap();
    let report = write_report(dir.path());
    write_symbols(dir.path(), "ABCDEF0123456789");
    let output = Command::new(TOOL)
        .arg(&report)
        .arg(dir.path().join("opennote.sym"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let done = Report::from_json(&String::from_utf8(output.stdout).unwrap()).unwrap();
    assert!(done.frames.iter().all(|f| f.function.is_none()));
}

#[test]
fn bad_arguments_and_bad_files_fail_with_a_message() {
    let dir = tempfile::tempdir().unwrap();
    let nothing = Command::new(TOOL).output().unwrap();
    assert_eq!(nothing.status.code(), Some(1));
    let help = Command::new(TOOL).arg("--help").output().unwrap();
    assert!(help.status.success() && String::from_utf8_lossy(&help.stdout).contains("usage"));
    let missing = Command::new(TOOL)
        .arg(dir.path().join("missing.json"))
        .arg(dir.path())
        .output()
        .unwrap();
    assert_eq!(missing.status.code(), Some(1));
    fs::write(dir.path().join("not-a-report.json"), "{}").unwrap();
    let wrong = Command::new(TOOL)
        .arg(dir.path().join("not-a-report.json"))
        .arg(dir.path())
        .output()
        .unwrap();
    assert_eq!(wrong.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&wrong.stderr).contains("not a crash report"));
}
