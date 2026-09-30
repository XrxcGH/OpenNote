//! Logging (ARCHITECTURE.md section 8.8). Rust code logs through the `log` facade, and the interface's errors
//! arrive through `log_write`, capped at 2 KB each. Logs never contain note content or titles.
//!
//! The shell work package adds the rotating file sink (five files of 1 MB in the logs folder), the rate limit
//! of 20 messages a second, and the redaction helper. Until then, messages go to the facade with no sink.

use serde::{Deserialize, Serialize};

use crate::ipc::IpcResult;

/// The longest message `log_write` keeps, in bytes.
pub const MAX_MESSAGE_BYTES: usize = 2048;

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

/// Logs a message from the interface.
#[tauri::command]
pub fn log_write(level: LogLevel, message: String) -> IpcResult<()> {
    log::log!(target: "interface", level.into(), "{}", truncate(&message, MAX_MESSAGE_BYTES));
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
}
