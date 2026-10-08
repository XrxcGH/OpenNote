//! The redacted system summary: the facts a maintainer needs to reproduce a problem, and none a person would
//! mind sharing less of.
//!
//! The app gives [`SystemFacts`], the things only it knows, such as its version and the settings that change how
//! it looks. This module adds what the operating system says: the Windows build, the processor, and the memory.
//! Every value passes through the [`Scrubber`] and is cut to a short length, so a summary can never carry a path,
//! a name, or a note. The summary holds no account names, computer names, folder names, or notebook titles, and
//! only counts of notebooks and pages.

use opennote_crashreport::{Redactions, Scrubber};
use serde::{Deserialize, Serialize};

/// The longest value a summary keeps, in characters.
const MAX_VALUE: usize = 120;
/// The most feature flags a summary lists.
const MAX_FLAGS: usize = 80;

/// How much the person has, as counts. Titles and names never appear.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookCounts {
    /// Notebooks in the library.
    pub notebooks: u32,
    /// Sections in all of them.
    pub sections: u32,
    /// Pages in all of them.
    pub pages: u32,
}

/// What the app knows and the operating system does not.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemFacts {
    /// The OpenNote version, such as `1.0.0-beta.2`.
    pub app_version: String,
    /// The release channel: `dev`, `nightly`, `beta`, or `stable`.
    pub channel: String,
    /// The WebView2 Runtime version.
    pub webview2_version: Option<String>,
    /// The interface language, such as `en-US`.
    pub locale: Option<String>,
    /// The display scale of the main window, such as 150.
    pub display_scale_percent: Option<u32>,
    /// The interface text size, such as 100.
    pub text_size_percent: Option<u32>,
    /// `light`, `dark`, or `system`.
    pub theme: Option<String>,
    /// `mouse` or `touch`.
    pub density: Option<String>,
    /// The ids of the feature flags that are on.
    pub enabled_flags: Vec<String>,
    /// How many notebooks, sections, and pages there are.
    pub notebooks: Option<NotebookCounts>,
}

/// One line of the summary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SummaryLine {
    /// What the value is, such as `Windows`.
    pub name: String,
    /// The value, scrubbed.
    pub value: String,
}

/// The summary a person reviews and may share.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSummary {
    /// The lines, in the order they are shown.
    pub lines: Vec<SummaryLine>,
    /// What the scrubber removed from the values.
    pub redactions: Redactions,
}

/// What the operating system says about itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OsFacts {
    /// The system and its build, such as `Windows 10.0.26200 x86_64`.
    pub os: String,
    /// The processor architecture.
    pub arch: String,
    /// The logical processors.
    pub cpus: Option<u32>,
    /// The installed memory in megabytes.
    pub memory_mb: Option<u64>,
}

impl OsFacts {
    /// Asks this computer.
    pub fn detect() -> OsFacts {
        OsFacts {
            os: opennote_crashreport::os_description(),
            arch: std::env::consts::ARCH.to_owned(),
            cpus: std::thread::available_parallelism()
                .ok()
                .and_then(|n| u32::try_from(n.get()).ok()),
            memory_mb: total_memory_mb(),
        }
    }
}

#[cfg(windows)]
fn total_memory_mb() -> Option<u64> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    // SAFETY: an all-zero MEMORYSTATUSEX is valid, and its length field is set before the call.
    let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    // SAFETY: `status` is a valid, writable MEMORYSTATUSEX.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    (ok != 0).then_some(status.ullTotalPhys / (1024 * 1024))
}

#[cfg(not(windows))]
fn total_memory_mb() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kilobytes: u64 = text.lines().find_map(|line| {
        let rest = line.strip_prefix("MemTotal:")?;
        rest.trim().strip_suffix("kB")?.trim().parse().ok()
    })?;
    Some(kilobytes / 1024)
}

/// Cuts a value to [`MAX_VALUE`] characters and replaces control characters, so one value is one short line.
fn tidy(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_VALUE)
        .collect::<String>()
        .trim()
        .to_owned()
}

/// A value made only of letters, digits, and the marks of version numbers and names such as `en-US` has no
/// path, quote, link, or sentence in it, so it is kept as it is. Anything else is scrubbed.
fn clean(value: &str, scrubber: &Scrubber) -> String {
    let value = tidy(value);
    if !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || ".-+_".contains(c)) {
        value
    } else {
        scrubber.text(&value)
    }
}

/// A flag id: letters, digits, and dots, starting with a letter.
fn is_flag_id(id: &str) -> bool {
    id.len() <= 64
        && id.starts_with(|c: char| c.is_ascii_alphabetic())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.')
}

impl SystemSummary {
    /// The summary of this computer and these facts.
    pub fn build(facts: &SystemFacts, scrubber: &Scrubber) -> SystemSummary {
        SystemSummary::build_with(facts, &OsFacts::detect(), scrubber)
    }

    /// The summary for given operating system facts, so a test can say what the computer is.
    pub fn build_with(facts: &SystemFacts, os: &OsFacts, scrubber: &Scrubber) -> SystemSummary {
        let mut raw: Vec<(&str, Option<String>)> = vec![
            ("OpenNote", Some(facts.app_version.clone())),
            ("Channel", Some(facts.channel.clone())),
            ("Windows", Some(os.os.clone())),
            ("Processor", Some(os.arch.clone())),
            ("Logical processors", os.cpus.map(|n| n.to_string())),
            ("Memory", os.memory_mb.map(|mb| format!("{mb} MB"))),
            ("WebView2", facts.webview2_version.clone()),
            ("Language", facts.locale.clone()),
            ("Display scale", facts.display_scale_percent.map(|p| format!("{p}%"))),
            ("Text size", facts.text_size_percent.map(|p| format!("{p}%"))),
            ("Theme", facts.theme.clone()),
            ("Density", facts.density.clone()),
        ];
        if let Some(counts) = facts.notebooks {
            raw.push((
                "Library",
                Some(format!(
                    "{} notebooks, {} sections, {} pages",
                    counts.notebooks, counts.sections, counts.pages
                )),
            ));
        }
        let mut flags: Vec<&str> = facts
            .enabled_flags
            .iter()
            .map(String::as_str)
            .filter(|id| is_flag_id(id))
            .collect();
        flags.sort_unstable();
        flags.dedup();
        flags.truncate(MAX_FLAGS);
        if !flags.is_empty() {
            raw.push(("Feature flags on", Some(flags.join(", "))));
        }
        let mut redactions = Redactions::default();
        let lines = raw
            .into_iter()
            .filter_map(|(name, value)| {
                let scrubbed = clean(&value?, scrubber);
                redactions.add(Redactions::count(&scrubbed));
                (!scrubbed.is_empty()).then(|| SummaryLine {
                    name: name.to_owned(),
                    value: scrubbed,
                })
            })
            .collect();
        SystemSummary { lines, redactions }
    }

    /// The summary as `name: value` lines.
    pub fn render(&self) -> String {
        self.lines
            .iter()
            .map(|l| format!("{}: {}\n", l.name, l.value))
            .collect()
    }
}

#[cfg(test)]
#[path = "summary_tests.rs"]
mod tests;
