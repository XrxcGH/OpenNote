//! A real Windows crash: the test starts itself as a child process, which installs the handler and then
//! reads from a bad address. The parent checks that the child left a report with the exception code and
//! code offsets in the crash folder.
#![cfg(windows)]

use std::process::Command;
use std::time::{Duration, Instant};

use opennote_crashreport::{install, Config, CrashStore, Kind, Scrubber, Settings};
use windows_sys::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_NOGPFAULTERRORBOX};

const DIR_VARIABLE: &str = "OPENNOTE_CRASHREPORT_TEST_DIR";
const ACCESS_VIOLATION: &str = "0xc0000005";

/// The child. It does nothing unless the parent set the folder, so `--ignored` alone is harmless.
#[test]
#[ignore = "started by the test below"]
fn child_crashes() {
    let Some(dir) = std::env::var_os(DIR_VARIABLE) else {
        return;
    };
    // No Windows error window: it would wait for a person to close it.
    // SAFETY: SetErrorMode only changes how this process is reported.
    unsafe { SetErrorMode(SEM_NOGPFAULTERRORBOX) };
    let settings = Settings::opted_in(1, "");
    install(Config {
        app_version: "9.9.9".into(),
        store: CrashStore::new(dir),
        settings,
    });
    // SAFETY: none. This is an access violation on purpose. Address 0x10 is not null, so the standard
    // library's debug check for null pointers does not turn it into a panic first.
    let _ = unsafe { std::ptr::read_volatile(0x10 as *const u8) };
}

#[test]
fn an_unhandled_exception_leaves_a_report() {
    let dir = tempfile::tempdir().unwrap();
    let crashes = dir.path().join("crashes");
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "child_crashes", "--nocapture"])
        .env(DIR_VARIABLE, &crashes)
        .spawn()
        .unwrap();
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            panic!("the child did not crash within a minute");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(!status.success(), "the child was meant to crash");

    let store = CrashStore::new(&crashes);
    let listed = store.list();
    assert_eq!(listed.len(), 1, "one report, found in {}", crashes.display());
    assert_eq!(listed[0].kind, Kind::Exception);
    let report = store.load(&listed[0].id, &Scrubber::detect()).unwrap();
    assert_eq!(report.exception_code.as_deref(), Some(ACCESS_VIOLATION));
    assert_eq!(report.app_version, "9.9.9");
    assert!(report.os.starts_with("Windows "));
    let first = &report.frames[0];
    assert!(
        first.module.ends_with(".exe"),
        "the crash was in this program: {first:?}"
    );
    assert!(first.offset.starts_with("0x"));
    // The build is named, so symbols of another build are never applied to this report. A program linked by
    // MSVC always has an id. One linked another way may not.
    if let Some(id) = &first.debug_id {
        assert!(opennote_crashreport::pe::is_debug_id(id), "{id}");
    }
    assert!(first.function.is_none(), "names are added later, from symbols");
}
