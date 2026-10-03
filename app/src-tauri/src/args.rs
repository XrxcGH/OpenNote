//! Command-line arguments (ARCHITECTURE.md section 8.2). Relaunches pass `--wait-pid`, so the new process waits
//! for the old one to exit before its instance check. The updater and the move also say where the start came
//! from. Everything else is kept in `rest` for later phases, such as files to open.

use std::{ffi::OsString, path::PathBuf, time::Duration};

/// How long a relaunched process waits for the process it replaces to exit.
pub const WAIT_PID_TIMEOUT: Duration = Duration::from_secs(30);

const KNOWN: [&str; 4] = ["--wait-pid", "--after-update", "--rolled-back-from", "--moved-from"];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Args {
    /// `--wait-pid <pid>`: wait for this process to exit before anything else.
    pub wait_pid: Option<u32>,
    /// `--after-update <version>`: the version this start updated from.
    pub after_update: Option<String>,
    /// `--rolled-back-from <version>`: the version that failed to start and was rolled back.
    pub rolled_back_from: Option<String>,
    /// `--moved-from <path>`: the exe this copy was moved from, which it deletes.
    pub moved_from: Option<PathBuf>,
    /// Every other argument, in order.
    pub rest: Vec<String>,
}

/// Parses this process's arguments.
pub fn parse() -> Args {
    parse_from(std::env::args_os().skip(1))
}

/// Parses arguments without the program name. Accepts `--flag value` and `--flag=value`. A known flag with no
/// valid value is ignored, so a bad relaunch never stops the start.
pub fn parse_from<I: IntoIterator<Item = OsString>>(raw: I) -> Args {
    let mut args = Args::default();
    let mut items = raw.into_iter().map(|item| item.to_string_lossy().into_owned());
    while let Some(item) = items.next() {
        let (flag, value) = match item.split_once('=') {
            Some((flag, value)) if KNOWN.contains(&flag) => (flag.to_owned(), Some(value.to_owned())),
            _ if KNOWN.contains(&item.as_str()) => (item.clone(), items.next()),
            _ => {
                args.rest.push(item);
                continue;
            }
        };
        if !value.is_some_and(|value| apply(&mut args, &flag, &value)) {
            log::warn!("Ignored {flag} without a usable value.");
        }
    }
    args
}

/// Stores a flag's value, and returns false when the value isn't usable.
fn apply(args: &mut Args, flag: &str, value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    match flag {
        "--wait-pid" => match value.parse() {
            Ok(pid) => args.wait_pid = Some(pid),
            Err(_) => return false,
        },
        "--after-update" => args.after_update = Some(value.to_owned()),
        "--rolled-back-from" => args.rolled_back_from = Some(value.to_owned()),
        "--moved-from" => args.moved_from = Some(PathBuf::from(value)),
        _ => return false,
    }
    true
}

/// Waits up to `timeout` for a process to exit, and returns at once when it has already exited. Returns false
/// only when the process was still running at the timeout.
#[cfg(windows)]
pub fn wait_for_exit(pid: u32, timeout: Duration) -> bool {
    use windows::Win32::{
        Foundation::{CloseHandle, WAIT_TIMEOUT},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    };

    // SAFETY: OpenProcess has no preconditions. A failure means the process is gone (or was never ours to wait
    // for), so there's nothing to wait for.
    let Ok(process) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }) else {
        return true;
    };
    let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX);
    // SAFETY: `process` is a handle this function opened with SYNCHRONIZE access, closed exactly once below.
    let waited = unsafe { WaitForSingleObject(process, millis) };
    // SAFETY: as above.
    let _ = unsafe { CloseHandle(process) };
    if waited == WAIT_TIMEOUT {
        log::warn!(
            "Process {pid} was still running after {} s; starting anyway.",
            timeout.as_secs()
        );
        return false;
    }
    true
}

/// Other systems don't relaunch the app, so there's nothing to wait for.
#[cfg(not(windows))]
pub fn wait_for_exit(_pid: u32, _timeout: Duration) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(items: &[&str]) -> Args {
        parse_from(items.iter().map(OsString::from))
    }

    #[test]
    fn reads_every_flag_in_both_forms() {
        let args = parse(&[
            "--wait-pid",
            "42",
            "--after-update=0.4.0",
            "--moved-from",
            "C:\\Downloads\\a.exe",
        ]);
        assert_eq!(args.wait_pid, Some(42));
        assert_eq!(args.after_update.as_deref(), Some("0.4.0"));
        assert_eq!(args.moved_from, Some(PathBuf::from("C:\\Downloads\\a.exe")));
        assert!(args.rest.is_empty());
        assert_eq!(
            parse(&["--rolled-back-from=0.5.0"]).rolled_back_from.as_deref(),
            Some("0.5.0")
        );
    }

    #[test]
    fn keeps_other_arguments_in_order() {
        let args = parse(&["notes.onepkg", "--wait-pid=7", "--unknown", "x=y"]);
        assert_eq!(args.wait_pid, Some(7));
        assert_eq!(args.rest, ["notes.onepkg", "--unknown", "x=y"]);
    }

    #[cfg(windows)]
    #[test]
    fn waits_for_a_process_to_exit() {
        use std::process::{Command, Stdio};

        let slow = |pings: &str| {
            Command::new("ping")
                .args(["-n", pings, "127.0.0.1"])
                .stdout(Stdio::null())
                .spawn()
                .expect("ping starts")
        };
        let mut short = slow("2");
        assert!(wait_for_exit(short.id(), Duration::from_secs(20)));
        assert!(short.try_wait().expect("status").is_some());

        let mut long = slow("30");
        assert!(!wait_for_exit(long.id(), Duration::from_millis(100)));
        long.kill().expect("stops");
        let _ = long.wait();
        assert!(
            wait_for_exit(long.id(), Duration::from_secs(1)),
            "an exited process returns at once"
        );
    }

    #[test]
    fn ignores_flags_without_usable_values() {
        assert_eq!(parse(&["--wait-pid", "soon"]), Args::default());
        assert_eq!(parse(&["--wait-pid=-1"]), Args::default());
        assert_eq!(parse(&["--after-update"]), Args::default());
        assert_eq!(parse(&["--moved-from="]), Args::default());
    }
}
