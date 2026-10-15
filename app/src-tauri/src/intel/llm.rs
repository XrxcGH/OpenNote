//! The language model program, from the app's side (A3-23). Ask and the writing tools send a prompt and get text
//! back. The program (`opennote-llm`, in `crates/llm-host`) runs llama.cpp in a process of its own and talks over
//! its standard input and output. It starts on the first request, ends after a quiet spell so its memory goes back to
//! the computer, and is started only with a language model the person downloaded. Nothing it is sent is written to
//! disk or logged here.

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex, MutexGuard, PoisonError,
    },
    thread,
    time::{Duration, Instant},
};

use opennote_intel_engines::protocol::{self, FailureCode, Request, Response};

/// How long the program waits for its first word that it is ready.
const START_TIMEOUT: Duration = Duration::from_secs(30);
/// The longest one answer may take.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(180);
/// How long the program stays loaded when nothing is asked of it.
const IDLE_LIMIT: Duration = Duration::from_secs(120);

/// Why a request to the program failed. The interface picks its own words from the code.
#[derive(Debug, PartialEq, Eq)]
pub enum LlmError {
    /// The program is not in this install.
    NoHost,
    /// The program would not start or stopped.
    Host(String),
    /// The model is missing or cannot be read.
    Model(String),
    /// The request is over a limit.
    Invalid(String),
    /// The program took too long.
    Timeout,
}

impl LlmError {
    pub fn code(&self) -> &'static str {
        match self {
            LlmError::NoHost => "unavailable",
            LlmError::Host(_) | LlmError::Timeout => "engine",
            LlmError::Model(_) => "model",
            LlmError::Invalid(_) => "invalid",
        }
    }

    pub fn message(&self) -> String {
        match self {
            LlmError::NoHost => "This install has no language model program.".to_owned(),
            LlmError::Host(message) | LlmError::Model(message) | LlmError::Invalid(message) => message.clone(),
            LlmError::Timeout => "The language model took too long.".to_owned(),
        }
    }
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Response>,
    last_used: Instant,
}

impl Drop for Running {
    fn drop(&mut self) {
        let _ = writeln!(
            self.stdin,
            "{}",
            serde_json::to_string(&Request::Quit).unwrap_or_default()
        );
        // A program that is mid-answer would take its time. The computer has the memory back sooner this way.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Inner {
    host: Option<PathBuf>,
    running: Mutex<Option<Running>>,
    next_id: AtomicU64,
}

/// The language model program, started when needed.
#[derive(Clone)]
pub struct Llm(Arc<Inner>);

/// The program's file name.
const HOST_NAME: &str = if cfg!(windows) {
    "opennote-llm.exe"
} else {
    "opennote-llm"
};

/// The program, inside the app's own file. A release is one signed exe and nothing else, so the program travels in
/// it and is written to this device's folder the first time it is needed.
#[cfg(feature = "embed-llm-host")]
static EMBEDDED_HOST: &[u8] = include_bytes!(env!("OPENNOTE_LLM_HOST_BIN"));
#[cfg(not(feature = "embed-llm-host"))]
static EMBEDDED_HOST: &[u8] = &[];

/// Writes `bytes` as a program in `dir`, under a name that holds their SHA-256, so a different build gets a file of
/// its own and a file that is there is never run unless it is exactly these bytes.
pub fn extract_host(bytes: &[u8], dir: &Path) -> std::io::Result<PathBuf> {
    use sha2::{Digest, Sha256};
    let hash: String = Sha256::digest(bytes)
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect();
    let stem = HOST_NAME.trim_end_matches(".exe");
    let name = if cfg!(windows) {
        format!("{stem}-{hash}.exe")
    } else {
        format!("{stem}-{hash}")
    };
    let target = dir.join(name);
    if std::fs::read(&target).is_ok_and(|have| have == bytes) {
        return Ok(target);
    }
    std::fs::create_dir_all(dir)?;
    let temporary = dir.join(format!(".{hash}.tmp"));
    std::fs::write(&temporary, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o755))?;
    }
    match std::fs::rename(&temporary, &target) {
        Ok(()) => {}
        // A running copy keeps the file locked on Windows. If it is the same program, it is fine.
        Err(_) if std::fs::read(&target).is_ok_and(|have| have == bytes) => {
            let _ = std::fs::remove_file(&temporary);
        }
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
    }
    Ok(target)
}

/// Where the program is in an install: beside the app if a build left it there, and otherwise the copy in the app's
/// own file, written to `dir`.
pub fn default_host(dir: &Path) -> Option<PathBuf> {
    if let Some(beside) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.join(HOST_NAME)))
        .filter(|path| path.is_file())
    {
        return Some(beside);
    }
    if EMBEDDED_HOST.is_empty() {
        return None;
    }
    extract_host(EMBEDDED_HOST, dir).ok()
}

impl Llm {
    /// The program, found when first needed. `dir` is where a copy inside the app is written.
    pub fn new(dir: &Path) -> Llm {
        Llm::with_host(default_host(dir))
    }

    pub fn with_host(host: Option<PathBuf>) -> Llm {
        Llm(Arc::new(Inner {
            host,
            running: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }))
    }

    /// Whether this install has the program.
    pub fn has_host(&self) -> bool {
        self.0.host.is_some()
    }

    fn running(&self) -> MutexGuard<'_, Option<Running>> {
        self.0.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Ends the program, if it is running.
    pub fn stop(&self) {
        *self.running() = None;
    }

    fn start(host: &Path) -> Result<Running, LlmError> {
        let mut command = Command::new(host);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| LlmError::Host(error.to_string()))?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            return Err(LlmError::Host("The program has no pipes.".to_owned()));
        };
        let (sender, lines) = mpsc::channel();
        thread::Builder::new()
            .name("llm-reader".to_owned())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    // A line that is not a message, such as noise from a library, is skipped.
                    if let Ok(response) = serde_json::from_str::<Response>(&line) {
                        if sender.send(response).is_err() {
                            break;
                        }
                    }
                }
            })
            .map_err(|error| LlmError::Host(error.to_string()))?;
        let running = Running {
            child,
            stdin,
            lines,
            last_used: Instant::now(),
        };
        match running.lines.recv_timeout(START_TIMEOUT) {
            Ok(Response::Ready { .. }) => Ok(running),
            Ok(Response::Failed { message, .. }) => Err(LlmError::Host(message)),
            Ok(Response::Done { .. }) | Err(RecvTimeoutError::Disconnected) => {
                Err(LlmError::Host("The program stopped at start.".to_owned()))
            }
            Err(RecvTimeoutError::Timeout) => Err(LlmError::Timeout),
        }
    }

    /// Asks the model in `model` to write an answer. One request runs at a time.
    pub fn generate(
        &self,
        model: &Path,
        system: &str,
        prompt: &str,
        max_tokens: u32,
        temperature: f32,
    ) -> Result<String, LlmError> {
        let host = self.0.host.as_deref().ok_or(LlmError::NoHost)?;
        let id = self.0.next_id.fetch_add(1, Ordering::Relaxed);
        let request = Request::Generate {
            id,
            model: model.to_string_lossy().into_owned(),
            system: system.to_owned(),
            prompt: prompt.to_owned(),
            max_tokens,
            temperature,
        };
        protocol::check(&request).map_err(LlmError::Invalid)?;
        let mut slot = self.running();
        let result = Self::ask(&mut slot, host, &request, id);
        match &result {
            Ok(_) | Err(LlmError::Model(_) | LlmError::Invalid(_)) => {
                if let Some(running) = slot.as_mut() {
                    running.last_used = Instant::now();
                }
                drop(slot);
                self.reap_later();
            }
            // A program that failed or timed out may be stuck. The next request starts a fresh one.
            Err(_) => *slot = None,
        }
        result
    }

    fn ask(slot: &mut Option<Running>, host: &Path, request: &Request, id: u64) -> Result<String, LlmError> {
        if slot.is_none() {
            *slot = Some(Self::start(host)?);
        }
        let Some(running) = slot.as_mut() else {
            return Err(LlmError::NoHost);
        };
        // Answers left over from an earlier request that timed out are not this one's.
        while running.lines.try_recv().is_ok() {}
        let line = serde_json::to_string(request).map_err(|error| LlmError::Host(error.to_string()))?;
        writeln!(running.stdin, "{line}")
            .and_then(|()| running.stdin.flush())
            .map_err(|error| LlmError::Host(error.to_string()))?;
        let deadline = Instant::now() + ANSWER_TIMEOUT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match running.lines.recv_timeout(left) {
                Ok(Response::Done { id: answered, text }) if answered == id => return Ok(text),
                Ok(Response::Failed {
                    id: answered,
                    code,
                    message,
                }) if answered == id => {
                    return Err(match code {
                        FailureCode::Model => LlmError::Model(message),
                        FailureCode::Invalid => LlmError::Invalid(message),
                        FailureCode::Engine => LlmError::Host(message),
                    });
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => return Err(LlmError::Timeout),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(LlmError::Host("The program stopped.".to_owned()));
                }
            }
        }
    }

    /// Ends the program once it has been quiet for [`IDLE_LIMIT`].
    fn reap_later(&self) {
        let this = self.clone();
        let _ = thread::Builder::new()
            .name("llm-reaper".to_owned())
            .spawn(move || loop {
                thread::sleep(IDLE_LIMIT / 4);
                let mut slot = this.running();
                match slot.as_ref() {
                    None => return,
                    Some(running) if running.last_used.elapsed() >= IDLE_LIMIT => {
                        *slot = None;
                        return;
                    }
                    Some(_) => {}
                }
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test program starts itself again as the language model program when this variable is set.
    const AS_HOST: &str = "OPENNOTE_TEST_AS_LLM_HOST";

    /// Not a test of its own: when the variable is set, this process is the program, and it answers "echo: " and the
    /// prompt, fails for a model file whose name has `missing`, and never answers for one with `hang`.
    #[test]
    fn the_stand_in_program() {
        if std::env::var_os(AS_HOST).is_none() {
            return;
        }
        let stdin = std::io::stdin();
        let mut out = std::io::stdout();
        let mut say = |response: &Response| {
            let _ = writeln!(out, "{}", serde_json::to_string(response).unwrap());
            let _ = out.flush();
        };
        say(&Response::Ready {
            runtime: "stand-in".to_owned(),
        });
        for line in stdin.lock().lines() {
            let Ok(Request::Generate { id, model, prompt, .. }) = serde_json::from_str(&line.unwrap()) else {
                return;
            };
            if model.contains("hang") {
                std::thread::sleep(Duration::from_secs(3600));
            } else if model.contains("missing") {
                say(&Response::Failed {
                    id,
                    code: FailureCode::Model,
                    message: "no file".to_owned(),
                });
            } else {
                say(&Response::Done {
                    id,
                    text: format!("echo: {prompt}"),
                });
            }
        }
    }

    /// A stand-in program is a copy of this test program told to act as one. Libtest prints its own lines first,
    /// which the reader skips because they are not messages.
    fn stand_in() -> Llm {
        let exe = std::env::current_exe().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let script = if cfg!(windows) {
            let path = dir.path().join("host.cmd");
            std::fs::write(
                &path,
                format!(
                    "@echo off\r\nset {AS_HOST}=1\r\n\"{}\" the_stand_in_program --nocapture\r\n",
                    exe.display()
                ),
            )
            .unwrap();
            path
        } else {
            let path = dir.path().join("host.sh");
            std::fs::write(
                &path,
                format!(
                    "#!/bin/sh\n{AS_HOST}=1 exec \"{}\" the_stand_in_program --nocapture\n",
                    exe.display()
                ),
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        };
        std::mem::forget(dir);
        Llm::with_host(Some(script))
    }

    #[test]
    fn a_request_goes_out_and_the_answer_comes_back() {
        let llm = stand_in();
        let model = Path::new("model.gguf");
        assert_eq!(llm.generate(model, "s", "one", 10, 0.0).as_deref(), Ok("echo: one"));
        // The program is kept for the next request.
        assert_eq!(llm.generate(model, "s", "two", 10, 0.0).as_deref(), Ok("echo: two"));
        llm.stop();
    }

    #[test]
    fn a_missing_model_is_reported_and_the_program_goes_on() {
        let llm = stand_in();
        let error = llm.generate(Path::new("missing.gguf"), "s", "x", 10, 0.0).unwrap_err();
        assert_eq!(error.code(), "model");
        assert_eq!(
            llm.generate(Path::new("m.gguf"), "s", "after", 10, 0.0).as_deref(),
            Ok("echo: after")
        );
        llm.stop();
    }

    #[test]
    fn limits_are_checked_before_anything_starts() {
        let llm = Llm::with_host(Some(PathBuf::from("does-not-exist")));
        let error = llm.generate(Path::new("m.bin"), "s", "x", 10, 0.0).unwrap_err();
        assert_eq!(error.code(), "invalid");
        let error = llm.generate(Path::new("m.gguf"), "s", "x", 10, 0.0).unwrap_err();
        assert_eq!(
            error.code(),
            "engine",
            "a program that will not start is an engine failure"
        );
    }

    #[test]
    fn a_program_inside_the_app_is_written_once_under_its_hash_and_never_trusted_when_it_differs() {
        let dir = tempfile::tempdir().unwrap();
        let first = extract_host(b"program one", dir.path()).unwrap();
        assert_eq!(std::fs::read(&first).unwrap(), b"program one");
        assert_eq!(extract_host(b"program one", dir.path()).unwrap(), first);
        // A different build gets a file of its own, and a damaged file is written again.
        let second = extract_host(b"program two", dir.path()).unwrap();
        assert_ne!(first, second);
        std::fs::write(&first, b"tampered").unwrap();
        assert_eq!(extract_host(b"program one", dir.path()).unwrap(), first);
        assert_eq!(std::fs::read(&first).unwrap(), b"program one");
        let leftovers = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(leftovers, 2, "no temporary file stays behind");
    }

    #[test]
    fn an_install_without_the_program_says_so() {
        let llm = Llm::with_host(None);
        assert!(!llm.has_host());
        assert_eq!(
            llm.generate(Path::new("m.gguf"), "s", "x", 10, 0.0).unwrap_err(),
            LlmError::NoHost
        );
    }
}
