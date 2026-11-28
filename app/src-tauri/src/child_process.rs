//! Runs a helper program with a time limit. On macOS the system's spell checker and voice list are separate
//! programs (`osascript`, `say`). One may never answer: a script stuck in a loop, or a service that never starts.
//! It must not hold the thread that asked, or the lock that thread holds, forever.
//!
//! Its output is read on threads to the end of each pipe. The end comes when every process that holds the pipe has
//! closed it. That is the program, and any program it started that inherited the pipe and still runs. So the wait for
//! the end is bounded too, and what was read by then is kept. A grandchild can't hold the call. A reader that starts
//! late, on a loaded machine, still gets everything the program wrote.

use std::{
    io::{ErrorKind, Read},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
    time::{Duration, Instant},
};

/// How often a running program is looked at.
const POLL: Duration = Duration::from_millis(10);

/// What a reader has taken from one pipe so far.
#[derive(Default)]
struct Taken {
    bytes: Vec<u8>,
    /// The pipe reached its end: nothing more can come.
    ended: bool,
}

/// One pipe's output, filled by its reader thread as it reads.
#[derive(Default)]
struct Output {
    taken: Mutex<Taken>,
    changed: Condvar,
}

impl Output {
    fn taken(&self) -> MutexGuard<'_, Taken> {
        self.taken.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Waits for the pipe's end until `deadline`. Returns what was read, and whether that is all of it.
    fn wait(&self, deadline: Instant) -> (Vec<u8>, bool) {
        let mut taken = self.taken();
        while !taken.ended {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break;
            }
            taken = self
                .changed
                .wait_timeout(taken, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        (taken.bytes.clone(), taken.ended)
    }
}

/// Reads a pipe to its end on its own thread, so a program that writes more than the pipe holds never blocks. It
/// keeps what it reads as it comes. A wait that ends early still has it. The reader waits `late` before its
/// first read; only tests set it, to stand for a reader that a loaded machine runs late.
fn read_all(pipe: Option<impl Read + Send + 'static>, late: Duration) -> Arc<Output> {
    let output = Arc::new(Output::default());
    let Some(mut pipe) = pipe else {
        output.taken().ended = true;
        return output;
    };
    let filled = Arc::clone(&output);
    std::thread::spawn(move || {
        std::thread::sleep(late);
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => filled.taken().bytes.extend_from_slice(&chunk[..read]),
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
            filled.changed.notify_all();
        }
        filled.taken().ended = true;
        filled.changed.notify_all();
    });
    output
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Why a program gave no output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    /// It ran past its limit and was stopped, rather than failing or not starting.
    pub timed_out: bool,
    pub reason: String,
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.reason)
    }
}

fn failed(reason: String) -> Failure {
    Failure {
        timed_out: false,
        reason,
    }
}

/// What `command` printed when it ends with success within `limit`. Otherwise why not: it couldn't start, it
/// failed (with the start of what it wrote to stderr), or it ran past `limit` and was stopped.
///
/// After the program ends, its output is waited for until the pipe ends, for at most `limit` again. Only a program
/// it started that kept the pipe open makes it wait that long. Then what was read is used, and the cut is told: in
/// the log on success, in the reason on failure. So the call takes at most twice `limit`.
pub fn output_within(command: &mut Command, limit: Duration) -> Result<String, Failure> {
    run(command, limit, Duration::ZERO)
}

fn run(command: &mut Command, limit: Duration, late: Duration) -> Result<String, Failure> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| failed(format!("{program} didn't start: {error}")))?;
    let stdout = read_all(child.stdout.take(), late);
    let stderr = read_all(child.stderr.take(), late);
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < limit => std::thread::sleep(POLL),
            Ok(None) => {
                stop(&mut child);
                return Err(Failure {
                    timed_out: true,
                    reason: format!(
                        "{program} gave no answer within {} ms and was stopped",
                        limit.as_millis()
                    ),
                });
            }
            Err(error) => {
                stop(&mut child);
                return Err(failed(format!("{program} couldn't be watched: {error}")));
            }
        }
    };
    answer(&program, status, &stdout, &stderr, Instant::now() + limit)
}

/// What an ended program said: its stdout on success, the start of its stderr on failure. The pipe is waited for
/// until `deadline`.
fn answer(
    program: &str,
    status: ExitStatus,
    stdout: &Output,
    stderr: &Output,
    deadline: Instant,
) -> Result<String, Failure> {
    if status.success() {
        let (bytes, whole) = stdout.wait(deadline);
        if !whole {
            log::warn!("{program} ended, but a program it started kept its output open; what came by then is used");
        }
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    } else {
        let (bytes, whole) = stderr.wait(deadline);
        let said: String = String::from_utf8_lossy(&bytes).trim().chars().take(200).collect();
        let cut = if whole {
            ""
        } else {
            " (the message may be cut off: a program it started kept it open)"
        };
        Err(failed(format!("{program} failed ({status}): {said}{cut}")))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// A program that runs for about 30 seconds and prints nothing.
    fn sleeper() -> Command {
        if cfg!(windows) {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        } else {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        }
    }

    #[test]
    fn a_program_that_never_answers_is_stopped_at_the_limit() {
        let started = Instant::now();
        let error = output_within(&mut sleeper(), Duration::from_millis(300)).unwrap_err();
        assert!(error.timed_out && error.reason.contains("no answer"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10), "stopped, not waited for");
    }

    #[test]
    fn output_failure_and_a_missing_program_are_told_apart() {
        let missing = output_within(&mut Command::new("opennote-no-such-program"), Duration::from_secs(5));
        let missing = missing.unwrap_err();
        assert!(
            !missing.timed_out && missing.reason.contains("didn't start"),
            "{missing}"
        );
        let (shell, flag) = if cfg!(windows) { ("cmd", "/C") } else { ("sh", "-c") };
        let said = output_within(Command::new(shell).args([flag, "echo hello"]), Duration::from_secs(20)).unwrap();
        assert_eq!(said.trim(), "hello");
        let failed = output_within(
            Command::new(shell).args([flag, "echo nope 1>&2 && exit 3"]),
            Duration::from_secs(20),
        );
        let failed = failed.unwrap_err();
        assert!(!failed.timed_out && failed.reason.contains("nope"), "{failed}");
    }

    fn shell(script: &str) -> Command {
        let (shell, flag) = if cfg!(windows) { ("cmd", "/C") } else { ("sh", "-c") };
        let mut command = Command::new(shell);
        command.args([flag, script]);
        command
    }

    /// The readers start well after the program has ended, as on a loaded machine. What it wrote is still in the
    /// pipes and must be read, not given up on after a fixed wait.
    #[test]
    fn output_is_kept_when_the_readers_start_late() {
        let late = Duration::from_millis(1500);
        let said = run(&mut shell("echo hello"), Duration::from_secs(20), late).unwrap();
        assert_eq!(said.trim(), "hello");
        let failed = run(&mut shell("echo nope 1>&2 && exit 3"), Duration::from_secs(20), late).unwrap_err();
        assert!(!failed.timed_out && failed.reason.contains("nope"), "{failed}");
    }

    /// More than a pipe holds, on both pipes at once, read by late readers: nothing is lost and nothing blocks.
    #[test]
    fn a_lot_of_output_on_both_pipes_is_read_whole() {
        let folder = tempfile::tempdir().unwrap();
        let line = "0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\n";
        let text = line.repeat(16_000);
        std::fs::write(folder.path().join("big.txt"), &text).unwrap();
        let both = if cfg!(windows) {
            "type big.txt && type big.txt 1>&2"
        } else {
            "cat big.txt && cat big.txt 1>&2"
        };
        let late = Duration::from_millis(500);
        let said = run(shell(both).current_dir(folder.path()), Duration::from_secs(30), late).unwrap();
        assert_eq!(said.len(), text.len());
        assert!(said == text, "stdout came back changed");
        let failed = run(
            shell(&format!("{both} && exit 3")).current_dir(folder.path()),
            Duration::from_secs(30),
            late,
        )
        .unwrap_err();
        assert!(failed.reason.contains("0123456789abcdef"), "{failed}");
    }

    /// The program starts a grandchild that inherits its pipes and outlives it. The call ends soon after the
    /// program does, with what the program wrote, and says the output may be cut off.
    #[test]
    fn a_grandchild_that_keeps_the_pipes_open_cannot_hold_the_call() {
        let background = if cfg!(windows) {
            "start /b ping -n 20 127.0.0.1 &"
        } else {
            "sleep 20 &"
        };
        let limit = Duration::from_secs(2);
        let started = Instant::now();
        let said = output_within(&mut shell(&format!("{background} echo done")), limit).unwrap();
        assert!(said.contains("done"), "{said:?}");
        let failed = output_within(&mut shell(&format!("{background} echo nope 1>&2 && exit 3")), limit).unwrap_err();
        assert!(!failed.timed_out && failed.reason.contains("nope"), "{failed}");
        assert!(failed.reason.contains("cut off"), "{failed}");
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "the call waited for the grandchild"
        );
    }
}
