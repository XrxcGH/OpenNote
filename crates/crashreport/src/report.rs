//! The crash report: what is written to disk, shown to the person, and sent only if they agree.

use serde::{Deserialize, Serialize};

use crate::pe;
use crate::scrub::Scrubber;

/// The version of the report layout, so a reader knows what to expect.
pub const FORMAT: u32 = 1;

/// The most code offsets a report keeps.
const MAX_FRAMES: usize = 64;
/// The most backtrace lines a report keeps.
const MAX_BACKTRACE_LINES: usize = 128;
/// The longest message a report keeps.
const MAX_MESSAGE: usize = 300;

/// What went wrong.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A Rust panic.
    Panic,
    /// A Windows exception that nothing handled, such as an access violation.
    Exception,
}

/// One place in the code, as a module and an offset into it. The offset needs the matching debug symbols to
/// turn into a function name, so it tells nothing about the person on its own.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    /// The module's file name, such as `opennote.exe` or `ntdll.dll`. Never its folder.
    pub module: String,
    /// The offset from the module's start, in hexadecimal, such as `0x1a2b3c`.
    pub offset: String,
    /// The debug id of the build of the module, so symbols of another build are never applied. See [`crate::pe`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_id: Option<String>,
    /// The function the offset is in, once the report has been symbolicated. See [`crate::symbols`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
}

impl Frame {
    /// A frame with no debug id and no function name.
    pub fn new(module: impl Into<String>, offset: impl Into<String>) -> Frame {
        Frame {
            module: module.into(),
            offset: offset.into(),
            ..Frame::default()
        }
    }
}

/// A crash report. It holds no note content, no paths, and no names of people or files.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    /// The layout version, see [`FORMAT`].
    pub format: u32,
    /// What went wrong.
    pub kind: Kind,
    /// The OpenNote version, such as `1.0.0`.
    pub app_version: String,
    /// The operating system, such as `Windows 10.0.26200 x86_64`.
    pub os: String,
    /// When it happened, in seconds since 1970 (UTC).
    pub time_unix: u64,
    /// The panic message, only when it is a string literal in the program. A message built at run time can
    /// hold note content, so it is never kept.
    pub message: Option<String>,
    /// Where in the source the panic started, such as `store.rs:120:9`.
    pub location: Option<String>,
    /// The Windows exception code, such as `0xc0000005`.
    pub exception_code: Option<String>,
    /// The code offsets of the stack, the top first.
    #[serde(default)]
    pub frames: Vec<Frame>,
    /// The function names of the stack, the top first, when the program has them.
    #[serde(default)]
    pub backtrace: Vec<String>,
}

/// A stack position as the operating system gives it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RawFrame {
    /// The module's name or path, if the address is inside a module.
    pub module: Option<String>,
    /// The offset from the module's start.
    pub offset: Option<u64>,
    /// The debug id of the module's build, if it has one.
    pub debug_id: Option<String>,
}

/// What the hooks collect at the moment of a crash, before scrubbing.
#[derive(Clone, Debug)]
pub struct Capture {
    /// What went wrong.
    pub kind: Kind,
    /// The panic message. A `&'static str` is a literal in the program, so it can't hold note content. A
    /// `String` can't be passed here, which is the point.
    pub message: Option<&'static str>,
    /// The panic location, as `path:line:column`.
    pub location: Option<String>,
    /// The exception code.
    pub exception_code: Option<u32>,
    /// The stack as code offsets.
    pub frames: Vec<RawFrame>,
    /// The stack as text, as the standard library prints a backtrace.
    pub backtrace: String,
}

/// Facts about the running app that do not come from the crash.
#[derive(Clone, Debug)]
pub struct Environment {
    /// The OpenNote version.
    pub app_version: String,
    /// The operating system and its build.
    pub os: String,
    /// The time of the crash, in seconds since 1970.
    pub time_unix: u64,
}

impl Report {
    /// Builds a report from a capture. All text passes through the scrubber.
    pub fn build(capture: Capture, environment: &Environment, scrubber: &Scrubber) -> Report {
        let frames = capture
            .frames
            .iter()
            .filter_map(|frame| {
                Some(Frame {
                    module: frame.module.clone()?,
                    offset: hex(frame.offset?),
                    debug_id: frame.debug_id.clone(),
                    function: None,
                })
            })
            .collect();
        Report {
            format: FORMAT,
            kind: capture.kind,
            app_version: environment.app_version.clone(),
            os: environment.os.clone(),
            time_unix: environment.time_unix,
            message: capture.message.map(str::to_owned),
            location: capture.location,
            exception_code: capture.exception_code.map(|code| hex(u64::from(code))),
            frames,
            backtrace: backtrace_lines(&capture.backtrace, scrubber),
        }
        .scrubbed(scrubber)
    }

    /// A copy with every field checked and scrubbed again. A report is scrubbed when it is built and again
    /// when it is loaded. That keeps a file that was edited, or written by an older version, safe to show
    /// and to send. Scrubbing a scrubbed report changes nothing.
    pub fn scrubbed(&self, scrubber: &Scrubber) -> Report {
        let version_ok = !self.app_version.is_empty()
            && self.app_version.len() <= 40
            && self
                .app_version
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".+-".contains(c));
        Report {
            format: self.format,
            kind: self.kind,
            app_version: if version_ok {
                self.app_version.clone()
            } else {
                "unknown".to_owned()
            },
            os: truncate(scrubber.text(&self.os), 80),
            time_unix: self.time_unix,
            message: self.message.as_ref().map(|m| truncate(scrubber.text(m), MAX_MESSAGE)),
            location: self.location.as_ref().map(|l| scrubber.source(l)),
            exception_code: self.exception_code.clone().filter(|code| is_hex(code, 8)),
            frames: self
                .frames
                .iter()
                .filter(|frame| is_hex(&frame.offset, 16))
                .filter_map(|frame| {
                    Some(Frame {
                        module: scrubber.module(&frame.module)?,
                        offset: frame.offset.clone(),
                        debug_id: frame.debug_id.clone().filter(|id| pe::is_debug_id(id)),
                        function: frame.function.as_deref().map(|name| scrubber.symbol(name)),
                    })
                })
                .take(MAX_FRAMES)
                .collect(),
            backtrace: backtrace_lines(&self.backtrace.join("\n"), scrubber),
        }
    }

    /// A made-up report in the real format, for the consent screen to show what a report looks like. It is
    /// built from the same types as a real one, so it can never drift from what is saved. It holds no
    /// information about the person or the computer.
    pub fn example(app_version: &str, time_unix: u64) -> Report {
        let frame = |module: &str, offset: &str, id: &str, function: Option<&str>| Frame {
            debug_id: Some(id.to_owned()),
            function: function.map(str::to_owned),
            ..Frame::new(module, offset)
        };
        Report {
            format: FORMAT,
            kind: Kind::Exception,
            app_version: app_version.to_owned(),
            os: "Windows 10.0.26200 x86_64".to_owned(),
            time_unix,
            message: None,
            location: None,
            exception_code: Some("0xc0000005".to_owned()),
            frames: vec![
                frame(
                    "opennote.exe",
                    "0x1a2b3c",
                    "3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71",
                    Some("opennote_core::store::Store::save_page"),
                ),
                frame("opennote.exe", "0x2f40a8", "3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71", None),
                frame("ntdll.dll", "0x9f2c0", "8D1C7A5B3E9F4A6C8B2D0E1F3A4B5C6D2", None),
            ],
            backtrace: Vec::new(),
        }
    }

    /// The report as the JSON that is saved, shown, and sent.
    pub fn to_json(&self) -> String {
        // Serializing plain strings and numbers can't fail.
        serde_json::to_string_pretty(self).unwrap_or_default() + "\n"
    }

    /// Reads a report from JSON.
    pub fn from_json(json: &str) -> Result<Report, serde_json::Error> {
        serde_json::from_str(json)
    }
}

fn hex(value: u64) -> String {
    format!("{value:#x}")
}

/// Whether `text` is `0x` and one to `max` lowercase hexadecimal digits.
fn is_hex(text: &str, max: usize) -> bool {
    text.strip_prefix("0x").is_some_and(|digits| {
        (1..=max).contains(&digits.len()) && digits.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

fn truncate(mut text: String, max: usize) -> String {
    if let Some((index, _)) = text.char_indices().nth(max) {
        text.truncate(index);
    }
    text
}

/// Splits a backtrace line such as `  12: core::fmt::write` into its number and function name.
fn split_frame(line: &str) -> Option<(&str, &str)> {
    let (number, symbol) = line.split_once(':')?;
    let numeric = !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit());
    numeric.then(|| (number, symbol.trim()))
}

/// Turns the standard library's backtrace text into scrubbed lines, `N: function` and `at file.rs:line`.
/// Any other line is dropped, because only these two shapes are known to hold code and nothing else.
fn backtrace_lines(text: &str, scrubber: &Scrubber) -> Vec<String> {
    let mut lines = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some((number, symbol)) = split_frame(line) {
            lines.push(format!("{number}: {}", scrubber.symbol(symbol)));
        } else if let Some(source) = line.strip_prefix("at ") {
            lines.push(format!("at {}", scrubber.source(source.trim())));
        }
        if lines.len() >= MAX_BACKTRACE_LINES {
            break;
        }
    }
    lines
}

/// Removes the frames at the top of a panic backtrace that belong to the panic machinery and to this crate,
/// so the first line is the code that panicked.
pub fn drop_panic_frames(text: &str) -> String {
    const MACHINERY: [&str; 8] = [
        "std::backtrace",
        "std::panicking",
        "std::sys::backtrace",
        "core::panicking",
        "rust_begin_unwind",
        "opennote_crashreport::",
        "<alloc::boxed::Box",
        "core::ops::function::",
    ];
    let mut out = String::new();
    let mut skipping = true;
    let mut keep = true;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some((number, symbol)) = split_frame(trimmed) {
            keep = !(skipping && MACHINERY.iter().any(|m| symbol.contains(m)));
            skipping = skipping && !keep;
            if keep {
                out.push_str(&format!("{number}: {symbol}\n"));
            }
        } else if keep {
            out.push_str(trimmed);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
#[path = "report_tests.rs"]
mod tests;
