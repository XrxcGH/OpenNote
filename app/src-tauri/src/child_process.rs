//! Runs a helper program with a time limit. The system's spell checker and voice list are separate programs on
//! macOS (`osascript`, `say`), and a program that never answers, such as a script stuck in a loop or a system
//! service that never starts, must not hold the thread that asked, or the lock that thread holds, forever.

use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

/// How often a running program is looked at.
const POLL: Duration = Duration::from_millis(10);
/// How long the output is waited for after the program ended. A grandchild that kept the pipe open can't hold the
/// call longer than this.
const DRAIN: Duration = Duration::from_millis(500);

/// Reads a pipe to its end on its own thread, so a program that writes more than the pipe holds never blocks.
fn drain(pipe: Option<impl Read + Send + 'static>) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    if let Some(mut pipe) = pipe {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = pipe.read_to_end(&mut bytes);
            let _ = tx.send(bytes);
        });
    }
    rx
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
pub fn output_within(command: &mut Command, limit: Duration) -> Result<String, Failure> {
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| failed(format!("{program} didn't start: {error}")))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
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
    let text = |rx: &mpsc::Receiver<Vec<u8>>| {
        String::from_utf8_lossy(&rx.recv_timeout(DRAIN).unwrap_or_default()).into_owned()
    };
    if status.success() {
        Ok(text(&stdout))
    } else {
        let said: String = text(&stderr).trim().chars().take(200).collect();
        Err(failed(format!("{program} failed ({status}): {said}")))
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
}
