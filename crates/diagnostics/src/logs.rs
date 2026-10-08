//! The recent log lines for the feedback bundle.
//!
//! OpenNote logs to `opennote.log` and keeps four older files, `opennote.1.log` to `opennote.4.log`. A line is
//! the time in milliseconds since 1970, the level, the module that logged it, and the message. The log is
//! written by code that never logs note content or titles, and it already replaces the profile folder. This
//! module does not rely on that: every message passes through the [`Scrubber`] again, and every line is cut
//! to a short length, so a message that holds a path, a link, or quoted text is cleaned before anyone sees it.
//! A panic's message can be bare text, which no scrubbing finds, so only where the panic started is kept.

use std::fs;
use std::io::Read;
use std::path::Path;

use opennote_crashreport::{Redactions, Scrubber};
use serde::{Deserialize, Serialize};

/// How many bytes of log lines a bundle keeps in all, newest first.
pub const DEFAULT_BUDGET: usize = 256 * 1024;
/// The longest line a bundle keeps, in characters.
pub const MAX_LINE: usize = 400;
/// The most a single log file is read, in bytes. The app rotates at 1 MB.
const MAX_FILE: u64 = 4 * 1024 * 1024;
/// The log files the app keeps, the newest first.
const FILES: [&str; 5] = [
    "opennote.log",
    "opennote.1.log",
    "opennote.2.log",
    "opennote.3.log",
    "opennote.4.log",
];

/// One log file's kept lines.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    /// The file's name, such as `opennote.log`.
    pub name: String,
    /// The kept lines, oldest first, as the bundle shows them.
    pub lines: Vec<String>,
    /// Lines of this file left out to fit the budget. They are the oldest.
    pub omitted_lines: u32,
}

/// The kept log lines of every file, and what was removed from them.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExcerpt {
    /// The files, the newest first.
    pub files: Vec<LogFile>,
    /// What the scrubber removed from the lines.
    pub redactions: Redactions,
    /// Whether the budget left out any older lines or files.
    pub truncated: bool,
}

impl LogExcerpt {
    /// How many lines are kept.
    pub fn line_count(&self) -> usize {
        self.files.iter().map(|f| f.lines.len()).sum()
    }

    /// The excerpt as text, a heading for each file and its lines.
    pub fn render(&self) -> String {
        let mut text = String::new();
        for file in &self.files {
            text.push_str(&format!("== {}", file.name));
            if file.omitted_lines > 0 {
                text.push_str(&format!(" ({} older lines left out)", file.omitted_lines));
            }
            text.push('\n');
            for line in &file.lines {
                text.push_str(line);
                text.push('\n');
            }
        }
        text
    }
}

/// Reads the log files in `dir`, newest first, until `budget` bytes of lines are kept. Files that are missing
/// or unreadable are left out. A folder without logs gives an empty excerpt.
pub fn collect(dir: &Path, scrubber: &Scrubber, budget: usize) -> LogExcerpt {
    let mut excerpt = LogExcerpt::default();
    let mut left = budget;
    for name in FILES {
        let Some(text) = read_limited(&dir.join(name)) else {
            continue;
        };
        if left == 0 {
            excerpt.truncated = true;
            break;
        }
        let lines: Vec<String> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| clean_line(l, scrubber))
            .collect();
        // Keep the newest lines of the file that fit, which are at its end.
        let mut kept = Vec::new();
        let mut used = 0usize;
        for line in lines.iter().rev() {
            let cost = line.len() + 1;
            if used + cost > left {
                break;
            }
            used += cost;
            kept.push(line.clone());
        }
        kept.reverse();
        let omitted = lines.len() - kept.len();
        left -= used;
        for line in &kept {
            excerpt.redactions.add(Redactions::count(line));
        }
        if omitted > 0 {
            excerpt.truncated = true;
        }
        excerpt.files.push(LogFile {
            name: name.to_owned(),
            lines: kept,
            omitted_lines: u32::try_from(omitted).unwrap_or(u32::MAX),
        });
        if omitted > 0 {
            left = 0;
        }
    }
    excerpt
}

fn read_limited(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The first word of `text` and what follows it, or `None` when there is no word.
fn next_token(text: &str) -> Option<(&str, &str)> {
    let text = text.trim_start();
    if text.is_empty() {
        return None;
    }
    Some(text.split_once(char::is_whitespace).unwrap_or((text, "")))
}

/// What replaces a panic's message in a log line.
pub const PANIC_MESSAGE: &str = "<message left out>";

/// Where a panic started, at the start of `text`: everything up to the first `:line:column`.
fn panic_location(text: &str) -> Option<&str> {
    let digits = |from: usize| {
        text.as_bytes()[from..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count()
    };
    text.match_indices(':').find_map(|(colon, _)| {
        let line = digits(colon + 1);
        let at = colon + 1 + line;
        if line == 0 || text.as_bytes().get(at) != Some(&b':') {
            return None;
        }
        let column = digits(at + 1);
        (column > 0).then(|| &text[..at + 1 + column])
    })
}

/// A panic's message as the bundle shows it, or `None` when `message` is not a panic. The crash report keeps a
/// panic's message only when it is a string literal in the program, because one built at run time can hold note
/// content. A log line can't tell the two apart, so the bundle keeps only where the panic started.
fn clean_panic(message: &str, scrubber: &Scrubber) -> Option<String> {
    let rest = message.strip_prefix("Panic:")?.trim_start();
    let rest = rest.strip_prefix("panicked at ").unwrap_or(rest);
    let location = panic_location(rest).map_or_else(|| "<path>".to_owned(), |l| scrubber.source(l));
    Some(format!("Panic: panicked at {location}: {PANIC_MESSAGE}"))
}

/// One log line as the bundle shows it: the time in UTC, the level, the module, and the scrubbed message. A
/// line that is not in that shape is scrubbed whole and marked.
pub fn clean_line(line: &str, scrubber: &Scrubber) -> String {
    let plain: String = line.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let parsed = (|| {
        let (ms, rest) = next_token(&plain)?;
        let (level, rest) = next_token(rest)?;
        let (target, message) = next_token(rest)?;
        let ms: u64 = ms.parse().ok()?;
        ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"]
            .contains(&level)
            .then_some((ms, level, target, message))
    })();
    let text = match parsed {
        Some((ms, level, target, message)) => {
            let target = if target.len() <= 80 && target.chars().all(|c| c.is_ascii_alphanumeric() || "_:".contains(c))
            {
                target
            } else {
                "<module>"
            };
            let message = message.trim();
            let message = clean_panic(message, scrubber).unwrap_or_else(|| scrubber.text(message));
            format!("{} {level:<5} {target} {message}", crate::utc(ms / 1000))
        }
        None => {
            let plain = plain.trim();
            let text = plain
                .find("Panic:")
                .and_then(|at| clean_panic(&plain[at..], scrubber))
                .unwrap_or_else(|| scrubber.text(plain));
            format!("? {text}")
        }
    };
    text.chars().take(MAX_LINE).collect()
}

#[cfg(test)]
#[path = "logs_tests.rs"]
mod tests;
