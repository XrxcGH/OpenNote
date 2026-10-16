//! The CUPS path, run against stand-in `lpstat` and `lp` scripts put first on PATH. No real spooler or printer is
//! reached: the scripts only record what they were given. This file holds one test because it changes PATH, and each
//! integration test file runs in its own process.
#![cfg(unix)]
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use opennote_print::{print, Duplex, Fit, PrintRequest, SystemBackend};

fn script(dir: &Path, name: &str, body: &str) {
    let path = dir.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write stub");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod stub");
}

#[test]
fn a_job_goes_to_lp_with_its_options_and_the_pdf_on_stdin() {
    let dir = std::env::temp_dir().join(format!("opennote-cups-stub-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("stub dir");
    let args = dir.join("args.txt");
    let body = dir.join("body.pdf");
    script(
        &dir,
        "lpstat",
        r#"case "$1" in
  -e) printf 'Hall\nOffice\n' ;;
  *) printf 'printer Hall is idle.  enabled since Mon\nprinter Office is idle.  enabled since Mon\nsystem default destination: Office\n' ;;
esac"#,
    );
    script(
        &dir,
        "lp",
        &format!(
            "printf '%s\n' \"$@\" > '{}'\ncat > '{}'\necho 'request id is Hall-7 (0 file(s))'",
            args.display(),
            body.display()
        ),
    );
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{path}", dir.display()));

    let backend = SystemBackend;
    let names: Vec<_> = opennote_print::PrintBackend::printers(&backend)
        .into_iter()
        .map(|p| (p.name, p.default))
        .collect();
    assert_eq!(names, vec![("Hall".to_string(), false), ("Office".to_string(), true)]);

    let pdf = b"%PDF-1.4\nstub\n%%EOF\n";
    let request = PrintRequest {
        printer: Some("Hall".into()),
        copies: 2,
        collate: true,
        duplex: Some(Duplex::LongEdge),
        fit: Fit::ShrinkToFit,
        grayscale: true,
        title: "Notes".into(),
    };
    let receipt = print(&backend, pdf, &request, &mut |_, _| {}).expect("the stub takes the job");
    assert_eq!(receipt.message, "request id is Hall-7");

    let recorded = fs::read_to_string(&args).expect("lp ran");
    let lines: Vec<&str> = recorded.lines().collect();
    for expected in [
        "-d",
        "Hall",
        "-n",
        "2",
        "-t",
        "Notes",
        "sides=two-sided-long-edge",
        "print-color-mode=monochrome",
        "print-scaling=auto-fit",
        "collate=true",
    ] {
        assert!(lines.contains(&expected), "{expected} missing from {lines:?}");
    }
    assert_eq!(fs::read(&body).expect("lp read stdin"), pdf);
    let _ = fs::remove_dir_all(&dir);
}
