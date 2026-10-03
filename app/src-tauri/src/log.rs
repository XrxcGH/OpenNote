//! Logging (ARCHITECTURE.md section 8.8). Rust code logs through the `log` facade into
//! `%LOCALAPPDATA%\OpenNote\logs\opennote.log`, which rotates through five files of 1 MB. The interface's errors
//! arrive through `log_write`, capped at 2 KB each and 20 a second. Logs never contain note content or titles,
//! and [`redact`] keeps the person's profile path out of them.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::ipc::IpcResult;

/// The longest message `log_write` keeps, in bytes.
pub const MAX_MESSAGE_BYTES: usize = 2048;

/// The most messages `log_write` accepts in one second. Later ones in that second are dropped, and counted.
pub const MAX_MESSAGES_PER_SECOND: u32 = 20;

/// How big a log file grows before it rotates.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// How many log files are kept, the current one included.
pub const FILES_KEPT: usize = 5;

const FILE_NAME: &str = "opennote.log";

/// A level the interface may log at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

impl From<LogLevel> for log::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Info => log::Level::Info,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Error => log::Level::Error,
        }
    }
}

/// The longest prefix of `message` that fits in `max_bytes` without splitting a character.
pub fn truncate(message: &str, max_bytes: usize) -> &str {
    if message.len() <= max_bytes {
        return message;
    }
    let end = (0..=max_bytes)
        .rev()
        .find(|&i| message.is_char_boundary(i))
        .unwrap_or(0);
    &message[..end]
}

/// Replaces the person's profile folder in `message` with `%USERPROFILE%`, so a log they share doesn't carry
/// their user name. Comparison ignores case, as Windows paths do.
pub fn redact(message: &str, profile: &Path) -> String {
    let profile = profile.to_string_lossy();
    if profile.is_empty() {
        return message.to_owned();
    }
    let (haystack, needle) = (message.to_lowercase(), profile.to_lowercase());
    // Lowercasing can change byte lengths for unusual characters, so only trust the match when it doesn't.
    if haystack.len() != message.len() {
        return message.to_owned();
    }
    let mut out = String::with_capacity(message.len());
    let mut rest = 0;
    while let Some(found) = haystack[rest..].find(&needle) {
        let start = rest + found;
        out.push_str(&message[rest..start]);
        out.push_str("%USERPROFILE%");
        rest = start + needle.len();
    }
    out.push_str(&message[rest..]);
    out
}

/// A rule that lets 20 messages through in any one-second window.
pub struct RateLimit {
    window_start: Instant,
    used: u32,
    dropped: u32,
}

impl RateLimit {
    pub fn new(now: Instant) -> Self {
        Self {
            window_start: now,
            used: 0,
            dropped: 0,
        }
    }

    /// Whether a message at `now` may be logged. The second value is how many were dropped in the window that
    /// just ended, to log once, or zero.
    pub fn admit(&mut self, now: Instant) -> (bool, u32) {
        let mut dropped = 0;
        if now.duration_since(self.window_start) >= Duration::from_secs(1) {
            self.window_start = now;
            self.used = 0;
            dropped = std::mem::take(&mut self.dropped);
        }
        if self.used < MAX_MESSAGES_PER_SECOND {
            self.used += 1;
            (true, dropped)
        } else {
            self.dropped += 1;
            (false, dropped)
        }
    }
}

/// The rotating file and the facade's writer.
struct FileSink {
    dir: PathBuf,
    file: Mutex<Option<(File, u64)>>,
    profile: PathBuf,
}

impl FileSink {
    fn path(&self, index: usize) -> PathBuf {
        if index == 0 {
            self.dir.join(FILE_NAME)
        } else {
            self.dir.join(format!("opennote.{index}.log"))
        }
    }

    /// Moves each file up one place and drops the oldest, so `opennote.log` is free for a new file.
    fn rotate(&self) {
        let _ = fs::remove_file(self.path(FILES_KEPT - 1));
        for index in (0..FILES_KEPT - 1).rev() {
            let _ = fs::rename(self.path(index), self.path(index + 1));
        }
    }

    fn open(&self) -> Option<(File, u64)> {
        fs::create_dir_all(&self.dir).ok()?;
        let file = OpenOptions::new().create(true).append(true).open(self.path(0)).ok()?;
        let size = file.metadata().map_or(0, |meta| meta.len());
        Some((file, size))
    }

    fn write_line(&self, line: &str) {
        let mut slot = self.file.lock().unwrap_or_else(PoisonError::into_inner);
        if slot.as_ref().is_some_and(|(_, size)| *size >= MAX_FILE_BYTES) {
            *slot = None;
            self.rotate();
        }
        if slot.is_none() {
            *slot = self.open();
        }
        if let Some((file, size)) = slot.as_mut() {
            if file.write_all(line.as_bytes()).is_ok() {
                *size += line.len() as u64;
            }
        }
    }
}

impl log::Log for FileSink {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info || cfg!(debug_assertions)
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let message = redact(&record.args().to_string(), &self.profile);
        let line = format!(
            "{} {:<5} {} {}\n",
            crate::boot::now_epoch_ms() as u64,
            record.level(),
            record.target(),
            message.replace('\n', " | ")
        );
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        self.write_line(&line);
    }

    fn flush(&self) {
        if let Some((file, _)) = self.file.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
            let _ = file.flush();
        }
    }
}

/// Starts logging to `dir`, and logs panics too. Safe to call once; later calls are ignored.
pub fn init(dir: &Path, profile: &Path) {
    let sink = FileSink {
        dir: dir.to_owned(),
        file: Mutex::new(None),
        profile: profile.to_owned(),
    };
    // The logger lives as long as the process, so leaking it is how the facade wants it.
    if log::set_logger(Box::leak(Box::new(sink))).is_ok() {
        log::set_max_level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        });
        std::panic::set_hook(Box::new(|info| log::error!("Panic: {info}")));
    }
}

static LIMIT: Mutex<Option<RateLimit>> = Mutex::new(None);

/// Logs a message from the interface.
#[tauri::command]
pub fn log_write(level: LogLevel, message: String) -> IpcResult<()> {
    let now = Instant::now();
    let (admitted, dropped) = LIMIT
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(|| RateLimit::new(now))
        .admit(now);
    if dropped > 0 {
        log::warn!(target: "interface", "Dropped {dropped} messages over the limit of {MAX_MESSAGES_PER_SECOND} a second.");
    }
    if admitted {
        log::log!(target: "interface", level.into(), "{}", truncate(&message, MAX_MESSAGE_BYTES));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_on_a_character_boundary() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("abcdef", 3), "abc");
        assert_eq!(truncate("añb", 2), "a");
        assert_eq!(truncate(&"é".repeat(2000), MAX_MESSAGE_BYTES).len(), MAX_MESSAGE_BYTES);
    }

    #[test]
    fn keeps_the_profile_folder_out_of_messages() {
        let profile = Path::new(r"C:\Users\Ada Lovelace");
        assert_eq!(
            redact(
                r"Couldn't read c:\users\ada lovelace\Documents\OpenNote\a.json",
                profile
            ),
            r"Couldn't read %USERPROFILE%\Documents\OpenNote\a.json"
        );
        assert_eq!(redact("Nothing to hide", profile), "Nothing to hide");
        assert_eq!(redact("Nothing to hide", Path::new("")), "Nothing to hide");
    }

    #[test]
    fn lets_twenty_messages_a_second_through() {
        let start = Instant::now();
        let mut limit = RateLimit::new(start);
        let admitted = (0..30).filter(|_| limit.admit(start).0).count();
        assert_eq!(admitted, 20);
        // The next second starts fresh and reports the ten that were dropped.
        assert_eq!(limit.admit(start + Duration::from_millis(1100)), (true, 10));
    }

    #[test]
    fn rotates_through_five_files_of_one_megabyte() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let sink = FileSink {
            dir: dir.path().to_owned(),
            file: Mutex::new(None),
            profile: PathBuf::new(),
        };
        let line = "x".repeat(1024 * 100) + "\n";
        for _ in 0..80 {
            sink.write_line(&line);
        }
        let mut names: Vec<_> = fs::read_dir(dir.path())
            .expect("the folder")
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "opennote.1.log",
                "opennote.2.log",
                "opennote.3.log",
                "opennote.4.log",
                "opennote.log"
            ]
        );
        for name in &names {
            let size = fs::metadata(dir.path().join(name)).expect("a file").len();
            assert!(size <= MAX_FILE_BYTES + line.len() as u64, "{name} is {size} bytes");
        }
    }
}
