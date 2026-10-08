//! The beta feedback bundle: one text document with what a maintainer needs to understand a problem, which the
//! person reads in full before they save it.
//!
//! A bundle holds up to five sections: the person's own description of the problem, a redacted summary of the
//! system, the self-check, the recent log lines, and, only if the person asks for them, their saved crash
//! reports. Every part passes through the [`Scrubber`], and the document starts with a list of what it
//! contains and how many things were removed from each part.
//!
//! The flow has three steps, and the middle one belongs to the person:
//!
//! 1. [`Bundle::build`] collects the sections.
//! 2. [`Bundle::review`] renders the exact text and a digest of it. The interface shows all of it.
//! 3. If the person agrees, [`Review::save`] writes that text to a folder they choose, but only when it is given
//!    the digest of the text that was shown. The text that is saved is the text that was reviewed.
//!
//! Nothing here sends anything. The person attaches the saved file to an issue or an email themselves.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use opennote_crashreport::{CrashStore, Redactions, Scrubber};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::logs::{self, LogExcerpt};
use crate::selfcheck::SelfCheck;
use crate::summary::{OsFacts, SystemFacts, SystemSummary};

/// The longest description a bundle keeps, in characters.
pub const MAX_NOTE: usize = 2000;
/// The most crash reports a bundle can hold.
pub const MAX_CRASH_REPORTS: usize = 3;

/// Which part of the bundle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionId {
    /// What the person wrote.
    Description,
    /// The redacted system summary.
    System,
    /// The self-check.
    SelfCheck,
    /// The recent log lines.
    Logs,
    /// The saved crash reports.
    CrashReports,
}

/// One part of the bundle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// Which part.
    pub id: SectionId,
    /// The heading in the document.
    pub title: String,
    /// The text under the heading.
    pub body: String,
    /// What the scrubber removed from the body.
    pub redactions: Redactions,
    /// How many items the body holds: lines, checks, or reports.
    pub items: u32,
}

/// What goes in the bundle.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BundleOptions {
    /// What the person wrote about the problem. It is kept as written. Only control characters and the
    /// length limit change it, because it is theirs.
    pub description: String,
    /// Whether to include the recent log lines.
    pub include_logs: bool,
    /// Whether to include the saved crash reports. Off until the person chooses.
    pub include_crash_reports: bool,
    /// How many bytes of log lines to keep.
    pub log_budget_bytes: usize,
}

impl Default for BundleOptions {
    fn default() -> BundleOptions {
        BundleOptions {
            description: String::new(),
            include_logs: true,
            include_crash_reports: false,
            log_budget_bytes: logs::DEFAULT_BUDGET,
        }
    }
}

/// What a bundle is built from.
pub struct BundleInputs<'a> {
    /// What the app knows about itself.
    pub facts: &'a SystemFacts,
    /// A self-check to include. It is redacted before it is used.
    pub self_check: Option<&'a SelfCheck>,
    /// The folder of log files.
    pub logs_dir: Option<&'a Path>,
    /// The saved crash reports.
    pub crash_store: Option<&'a CrashStore>,
    /// Removes private text. The app registers the names of the person, the computer, and the open notebook.
    pub scrubber: &'a Scrubber,
    /// When the bundle is made, in seconds since 1970 (UTC).
    pub now_unix: u64,
    /// What to include.
    pub options: &'a BundleOptions,
}

/// The collected parts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    /// When it was made, in seconds since 1970 (UTC).
    pub created_unix: u64,
    /// The parts, in the order they appear.
    pub sections: Vec<Section>,
    /// What the scrubber removed from all parts together.
    pub redactions: Redactions,
}

/// Why a bundle was not saved.
#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    /// The digest is not the one of the text that was shown, so the person has not reviewed this text.
    #[error("the person has not reviewed this text")]
    NotReviewed,
    /// The file could not be written.
    #[error("the bundle could not be saved: {0}")]
    Io(#[from] io::Error),
}

/// Control characters become spaces, except line breaks, and the text is cut to `max` characters.
fn plain(text: &str, max: usize) -> String {
    text.chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .take(max)
        .collect::<String>()
        .trim()
        .to_owned()
}

impl Bundle {
    /// Builds the bundle for this computer.
    pub fn build(inputs: &BundleInputs<'_>) -> Bundle {
        Bundle::build_with(inputs, &OsFacts::detect())
    }

    /// Builds the bundle for given operating system facts, so a test can say what the computer is.
    pub fn build_with(inputs: &BundleInputs<'_>, os: &OsFacts) -> Bundle {
        let mut sections = Vec::new();
        let note = plain(&inputs.options.description, MAX_NOTE);
        if !note.is_empty() {
            sections.push(Section {
                id: SectionId::Description,
                title: "What you wrote".to_owned(),
                items: u32::try_from(note.chars().count()).unwrap_or(u32::MAX),
                body: note,
                redactions: Redactions::default(),
            });
        }
        let summary = SystemSummary::build_with(inputs.facts, os, inputs.scrubber);
        sections.push(Section {
            id: SectionId::System,
            title: "System".to_owned(),
            items: u32::try_from(summary.lines.len()).unwrap_or(u32::MAX),
            body: summary.render(),
            redactions: summary.redactions,
        });
        if let Some(check) = inputs.self_check {
            sections.push(self_check_section(check));
        }
        if inputs.options.include_logs {
            if let Some(dir) = inputs.logs_dir {
                sections.push(logs_section(logs::collect(
                    dir,
                    inputs.scrubber,
                    inputs.options.log_budget_bytes,
                )));
            }
        }
        if inputs.options.include_crash_reports {
            if let Some(store) = inputs.crash_store {
                sections.push(crash_section(store, inputs.scrubber));
            }
        }
        let mut redactions = Redactions::default();
        for section in &sections {
            redactions.add(section.redactions);
        }
        Bundle {
            created_unix: inputs.now_unix,
            sections,
            redactions,
        }
    }

    /// The part with this id, if the bundle has it.
    pub fn section(&self, id: SectionId) -> Option<&Section> {
        self.sections.iter().find(|s| s.id == id)
    }

    /// The whole document: what it contains and what was removed, then each part.
    pub fn render(&self) -> String {
        let mut text = String::new();
        text.push_str("OpenNote feedback bundle\n");
        text.push_str(&format!("Made: {}\n\n", crate::utc(self.created_unix)));
        text.push_str(
            "OpenNote made this file on your computer and did not send it anywhere. Read all of it. If you are\n\
             happy with it, attach it to your report or email. Nothing from your notes is in it, apart from\n\
             what you wrote in the description.\n\n",
        );
        text.push_str("Contents\n");
        for section in &self.sections {
            text.push_str(&format!("- {}: {}\n", section.title, describe(section)));
        }
        for (id, title) in [
            (SectionId::Logs, "Recent log lines"),
            (SectionId::CrashReports, "Crash reports"),
        ] {
            if self.section(id).is_none() {
                text.push_str(&format!("- {title}: not included\n"));
            }
        }
        text.push_str(&format!("\nRemoved from this file: {}\n", removed(&self.redactions)));
        for section in &self.sections {
            text.push_str(&format!("\n=== {} ===\n{}\n", section.title, section.body.trim_end()));
        }
        text
    }

    /// The exact text, and a digest of it, for the person to review.
    pub fn review(&self) -> Review {
        let text = self.render();
        let digest = Sha256::digest(text.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        Review {
            file_name: format!(
                "OpenNote-feedback-{}.txt",
                crate::utc(self.created_unix)
                    .replace([':', 'T'], "-")
                    .trim_end_matches('Z')
            ),
            text,
            digest,
        }
    }
}

fn describe(section: &Section) -> String {
    let count = section.items;
    let what = match section.id {
        SectionId::Description => format!("{count} characters, as you wrote them"),
        SectionId::System => format!("{count} lines"),
        SectionId::SelfCheck => format!("{count} checks, without file names"),
        SectionId::Logs => format!("{count} lines"),
        SectionId::CrashReports => format!("{count} reports"),
    };
    if section.redactions.total() > 0 {
        format!("{what}, {} things removed", section.redactions.total())
    } else {
        what
    }
}

fn removed(redactions: &Redactions) -> String {
    let kinds = [
        (redactions.paths, "paths"),
        (redactions.quoted, "pieces of quoted text"),
        (redactions.links, "web links"),
        (redactions.emails, "email addresses"),
        (redactions.ids, "device and account identifiers"),
        (redactions.tokens, "keys"),
        (redactions.names, "names"),
        (redactions.private, "notebook names"),
    ];
    let parts: Vec<String> = kinds
        .iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, name)| format!("{count} {name}"))
        .collect();
    if parts.is_empty() {
        "nothing needed to be removed".to_owned()
    } else {
        format!("{}. Each was replaced by a mark such as <path>", parts.join(", "))
    }
}

fn self_check_section(check: &SelfCheck) -> Section {
    let shared = check.redacted();
    let mut body = format!(
        "Overall: {}\n",
        serde_json::to_string(&shared.overall())
            .unwrap_or_default()
            .trim_matches('"')
    );
    for item in &shared.items {
        let id = serde_json::to_string(&item.id).unwrap_or_default();
        let status = serde_json::to_string(&item.status).unwrap_or_default();
        let detail = serde_json::to_string(&item.detail).unwrap_or_default();
        body.push_str(&format!(
            "{}: {} {}\n",
            id.trim_matches('"'),
            status.trim_matches('"'),
            detail
        ));
    }
    // The self-check holds only codes, counts, versions, and kinds of error, and the one file it reads that other
    // programs can write is checked field by field. It is not passed through the scrubber, which would treat its
    // JSON strings as quoted text.
    Section {
        id: SectionId::SelfCheck,
        title: "Self-check".to_owned(),
        items: u32::try_from(shared.items.len()).unwrap_or(u32::MAX),
        redactions: Redactions::default(),
        body,
    }
}

fn logs_section(excerpt: LogExcerpt) -> Section {
    let body = if excerpt.files.is_empty() {
        "No log files were found.".to_owned()
    } else {
        excerpt.render()
    };
    Section {
        id: SectionId::Logs,
        title: "Recent log lines".to_owned(),
        items: u32::try_from(excerpt.line_count()).unwrap_or(u32::MAX),
        body,
        redactions: excerpt.redactions,
    }
}

fn crash_section(store: &CrashStore, scrubber: &Scrubber) -> Section {
    let mut body = String::new();
    let mut redactions = Redactions::default();
    let mut items = 0u32;
    for summary in store.list().iter().take(MAX_CRASH_REPORTS) {
        let Ok(report) = store.load(&summary.id, scrubber) else {
            continue;
        };
        let json = report.to_json();
        redactions.add(Redactions::count(&json));
        body.push_str(&format!("-- {}\n{json}\n", summary.id));
        items += 1;
    }
    if items == 0 {
        body.push_str("There are no saved crash reports.");
    }
    Section {
        id: SectionId::CrashReports,
        title: "Crash reports".to_owned(),
        items,
        body,
        redactions,
    }
}

/// The text of a bundle, ready to show, and the means to save exactly that text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Review {
    text: String,
    digest: String,
    file_name: String,
}

impl Review {
    /// Exactly what would be saved. Show all of it.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// A fingerprint of [`Review::text`], to pass back to [`Review::save`].
    pub fn digest(&self) -> &str {
        &self.digest
    }

    /// A file name for the bundle, such as `OpenNote-feedback-2026-10-02-12-00-00.txt`.
    pub fn suggested_file_name(&self) -> &str {
        &self.file_name
    }

    /// Saves the reviewed text in `dir`, which must exist, under the suggested name. It refuses unless
    /// `reviewed_digest` is the digest of this text, and it never overwrites a file: a name in use gets a
    /// number. Returns the path it wrote.
    pub fn save(&self, reviewed_digest: &str, dir: &Path) -> Result<PathBuf, BundleError> {
        if reviewed_digest != self.digest {
            return Err(BundleError::NotReviewed);
        }
        let stem = self.file_name.trim_end_matches(".txt");
        for n in 0..100 {
            let name = if n == 0 {
                self.file_name.clone()
            } else {
                format!("{stem}-{n}.txt")
            };
            let path = dir.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let written = file.write_all(self.text.as_bytes()).and_then(|()| file.sync_all());
                    if let Err(error) = written {
                        drop(file);
                        let _ = fs::remove_file(&path);
                        return Err(error.into());
                    }
                    return Ok(path);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err(io::Error::other("too many bundles with the same name").into())
    }
}

#[cfg(test)]
#[path = "bundle_tests.rs"]
mod tests;
