//! Read aloud with the voices the system has, where the web view has none (macOS and Linux). macOS speaks through
//! `say`, which has every voice installed in System Settings, and Linux through `espeak-ng`, the engine under
//! speech-dispatcher. Both write a WAV file; this module reads it back with the word boundaries the interface needs
//! to highlight the text being spoken. Windows keeps the web view's voices, so these commands stay unavailable there.
//! The text never leaves the computer: both programs are local.

// Windows keeps the web view's voices, so most of this is built there only for its tests.
#![cfg_attr(windows, allow(dead_code))]

pub mod voices;
pub mod wav;

use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde::Serialize;

use crate::ipc::{codes, IpcError, IpcResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub language: String,
}

/// At most this much text in one `speech_synthesize`; the reader sends one paragraph at a time.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// The longest a synthesis may take before it is stopped.
const SYNTH_TIMEOUT: Duration = Duration::from_secs(120);

/// The voices the system has, or none where no speech program is installed.
#[tauri::command]
pub async fn speech_voices() -> IpcResult<Vec<Voice>> {
    #[cfg(windows)]
    {
        Err(IpcError::not_implemented("speech_voices"))
    }
    #[cfg(not(windows))]
    {
        tauri::async_runtime::spawn_blocking(system_voices)
            .await
            .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
    }
}

/// The JSON length as 4 bytes, the word boundaries as JSON, then the WAV bytes.
#[tauri::command]
pub async fn speech_synthesize(text: String, voice: String) -> IpcResult<tauri::ipc::Response> {
    #[cfg(windows)]
    {
        let _ = (text, voice);
        Err(IpcError::not_implemented("speech_synthesize"))
    }
    #[cfg(not(windows))]
    {
        check_text(&text)?;
        let reply = tauri::async_runtime::spawn_blocking(move || {
            let known = system_voices();
            let chosen = voices::choose(&known, &voice)?;
            let wav = synthesize_with(chosen.as_deref(), &text)?;
            wav::reply(&text, wav)
        })
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))??;
        Ok(tauri::ipc::Response::new(reply))
    }
}

/// Refuses empty text and text over the limit.
pub fn check_text(text: &str) -> IpcResult<()> {
    if text.trim().is_empty() {
        return Err(IpcError::invalid("text", "There is no text to read."));
    }
    if text.len() > MAX_TEXT_BYTES {
        return Err(IpcError::invalid(
            "text",
            "Read aloud takes at most 64 KB of text at a time.",
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn system_voices() -> Vec<Voice> {
    run_for_output("say", &["-v", "?"])
        .map(|out| voices::parse_say(&out))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn synthesize_with(voice: Option<&str>, text: &str) -> IpcResult<Vec<u8>> {
    let file = tempfile::Builder::new()
        .suffix(".wav")
        .tempfile()
        .map_err(IpcError::from)?;
    let mut args: Vec<String> = Vec::new();
    if let Some(voice) = voice {
        args.extend(["-v".to_owned(), voice.to_owned()]);
    }
    args.extend([
        "-o".to_owned(),
        file.path().to_string_lossy().into_owned(),
        "--data-format=LEI16@22050".to_owned(),
        "-f".to_owned(),
        "-".to_owned(),
    ]);
    run_to_file("say", &args, text, file.path())
}

#[cfg(target_os = "linux")]
fn system_voices() -> Vec<Voice> {
    run_for_output("espeak-ng", &["--voices"])
        .map(|out| voices::parse_espeak(&out))
        .unwrap_or_default()
}

#[cfg(target_os = "linux")]
fn synthesize_with(voice: Option<&str>, text: &str) -> IpcResult<Vec<u8>> {
    let file = tempfile::Builder::new()
        .suffix(".wav")
        .tempfile()
        .map_err(IpcError::from)?;
    let mut args: Vec<String> = Vec::new();
    if let Some(voice) = voice {
        args.extend(["-v".to_owned(), voice.to_owned()]);
    }
    args.extend([
        "-w".to_owned(),
        file.path().to_string_lossy().into_owned(),
        "--stdin".to_owned(),
    ]);
    run_to_file("espeak-ng", &args, text, file.path())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn system_voices() -> Vec<Voice> {
    Vec::new()
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn synthesize_with(_voice: Option<&str>, _text: &str) -> IpcResult<Vec<u8>> {
    Err(IpcError::not_implemented("speech_synthesize"))
}

/// What a program prints, or `None` when it is missing or fails.
#[cfg_attr(windows, allow(dead_code))]
fn run_for_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Runs a speech program with `text` on stdin, waits for it, and returns the WAV it wrote to `out`.
#[cfg_attr(windows, allow(dead_code))]
fn run_to_file(program: &str, args: &[String], text: &str, out: &Path) -> IpcResult<Vec<u8>> {
    let unavailable = || {
        IpcError::new(
            codes::NOT_IMPLEMENTED,
            "Read aloud needs a speech program on this system, and none was found.",
        )
    };
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| unavailable())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return Err(IpcError::new(codes::INTERNAL, "The voice could not read that text.")),
            Ok(None) if started.elapsed() < SYNTH_TIMEOUT => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(IpcError::new("timeout", "Reading took too long and was stopped."));
            }
        }
    }
    std::fs::read(out).map_err(IpcError::from)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn text_must_be_present_and_bounded() {
        assert!(check_text("Hello there.").is_ok());
        assert_eq!(check_text("  \n").unwrap_err().code, codes::INVALID);
        assert_eq!(
            check_text(&"a".repeat(MAX_TEXT_BYTES + 1)).unwrap_err().code,
            codes::INVALID
        );
    }
}
