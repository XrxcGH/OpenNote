//! The self-check: the data behind the screen that answers "is everything in order?".
//!
//! [`run`] looks at seven things, each as a [`CheckItem`] with a [`Status`] and the numbers behind it. They are
//! free space for the notebook and for updates, whether the notebook folder can be written, the notebook's volume,
//! the notebook itself, the updater's state, and the saved crash reports. The limits are the constants below, and
//! the README has a table of what passes, warns, and fails.
//!
//! A check that has nothing to look at, such as the notebook's health with no notebook open, is
//! [`Status::Skipped`]. Nothing here changes anything. The notebook is read, the folder is probed with a file that
//! is removed at once, and the updater's file is only read.
//!
//! The result holds file names for the screen, relative to the notebook. [`SelfCheck::redacted`] drops them, for the
//! feedback bundle, which keeps only codes and counts.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use opennote_core::error::CoreError;
use opennote_core::limits::Timings;
use opennote_core::session::notebook::NotebookHandle;
use opennote_core::store::fs::{Fs, SyncTool, VolumeKind};
use opennote_core::store::std_fs::StdFs;
use opennote_core::store::verify::VerifyReport;
use opennote_crashreport::CrashStore;
use opennote_updater::state::UpdaterState;
use serde::{Deserialize, Serialize};

use crate::disk::DiskProbe;

const MIB: u64 = 1024 * 1024;
/// Under this much free space where the notebook lives, the check warns.
pub const NOTEBOOK_WARN_BELOW: u64 = 500 * MIB;
/// Under this much free space where the notebook lives, the check fails.
pub const NOTEBOOK_FAIL_BELOW: u64 = 50 * MIB;
/// Under this much free space where updates and backups go, the check warns.
pub const APP_WARN_BELOW: u64 = 300 * MIB;
/// Under this much free space where updates and backups go, the check fails.
pub const APP_FAIL_BELOW: u64 = 50 * MIB;
/// A check for updates older than this many days warns.
pub const STALE_CHECK_DAYS: u64 = 14;
/// A version that has started this many times without a healthy start is stuck.
pub const STUCK_ATTEMPTS: u8 = 2;
/// The most problems listed with their files.
pub const MAX_LISTED_PROBLEMS: usize = 20;

/// How a check came out. The worst of all checks is the overall result.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// There was nothing to look at.
    Skipped,
    /// All is well.
    Pass,
    /// Something needs attention, but nothing is wrong yet.
    Warn,
    /// Something is wrong.
    Fail,
}

/// Which check.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckId {
    /// Free space where the open notebook lives.
    DiskNotebook,
    /// Free space where updates and backups go.
    DiskApp,
    /// Whether the notebook folder can be written.
    NotebookWritable,
    /// The notebook's volume: its file system, and whether it is shared or synced.
    NotebookStorage,
    /// The notebook's own check.
    NotebookHealth,
    /// The updater's state.
    Updates,
    /// Saved crash reports.
    CrashReports,
}

/// Why a notebook's volume deserves a note.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageNote {
    /// A network share: saves can be slow, and the folder can disappear.
    NetworkShare,
    /// A file system without a metadata log (FAT): a power cut can lose a recent save.
    NoMetadataLog,
    /// A folder that a sync tool manages: it can lock or rewrite files while OpenNote saves.
    SyncFolder(SyncName),
}

/// A sync tool, by name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncName {
    /// Microsoft OneDrive.
    OneDrive,
    /// Dropbox.
    Dropbox,
    /// Google Drive.
    GoogleDrive,
    /// iCloud Drive.
    ICloud,
    /// Another tool.
    Other,
}

/// One problem the notebook's check found.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// A stable code, such as `page.checksum`.
    pub code: String,
    /// The file, relative to the notebook. Empty after [`SelfCheck::redacted`].
    pub file: String,
}

/// How many problems had one code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeCount {
    /// The code.
    pub code: String,
    /// How many.
    pub count: u32,
}

/// A version the updater is still waiting on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    /// The version that was swapped in.
    pub version: String,
    /// The version it replaced.
    pub from: String,
    /// How many times it has started without a healthy start.
    pub attempts: u8,
}

/// A rollback the updater made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RolledBack {
    /// The version that failed.
    pub from: String,
    /// The version that was put back.
    pub to: String,
    /// When, as the updater wrote it.
    pub at: String,
}

/// The numbers behind a check.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Detail {
    /// There was nothing to look at, such as no notebook open.
    NotApplicable,
    /// Free space, and the limits it was judged by.
    #[serde(rename_all = "camelCase")]
    FreeSpace {
        /// Bytes a program can still write.
        free_bytes: u64,
        /// Under this the check warns.
        warn_below: u64,
        /// Under this the check fails.
        fail_below: u64,
    },
    /// The system said no, with the kind of error and no path.
    #[serde(rename_all = "camelCase")]
    Unavailable {
        /// The kind of error, such as `PermissionDenied`.
        reason: String,
    },
    /// Whether a file could be created in the notebook folder.
    #[serde(rename_all = "camelCase")]
    Writable {
        /// Whether it could.
        writable: bool,
        /// The kind of error when it could not.
        reason: Option<String>,
    },
    /// The notebook's volume.
    #[serde(rename_all = "camelCase")]
    Storage {
        /// The file system, such as `NTFS`.
        file_system: String,
        /// Why the volume deserves a note, if it does.
        notes: Vec<StorageNote>,
    },
    /// The notebook's own check.
    #[serde(rename_all = "camelCase")]
    Health {
        /// Files checked.
        files: u32,
        /// All problems found.
        problem_count: u32,
        /// The problems by code, most frequent first.
        by_code: Vec<CodeCount>,
        /// The first problems, with their files.
        problems: Vec<Problem>,
        /// Whether the notebook has changes that are not saved yet.
        unsaved_changes: bool,
        /// Why the check could not run, as a kind of error.
        failed: Option<String>,
    },
    /// The updater's state.
    #[serde(rename_all = "camelCase")]
    Updates {
        /// When it last checked, as it wrote it.
        last_check: Option<String>,
        /// Whole days since then.
        days_since_check: Option<u64>,
        /// A downloaded update waiting to be applied.
        staged_version: Option<String>,
        /// A swapped-in version that has not had a healthy start yet.
        pending: Option<PendingUpdate>,
        /// The last rollback.
        rolled_back: Option<RolledBack>,
        /// Versions it will not install.
        blocked_versions: Vec<String>,
    },
    /// Saved crash reports.
    #[serde(rename_all = "camelCase")]
    Reports {
        /// How many are saved.
        count: u32,
    },
}

/// One check.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    /// Which check.
    pub id: CheckId,
    /// How it came out.
    pub status: Status,
    /// The numbers behind it.
    pub detail: Detail,
}

/// All the checks.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheck {
    /// When it ran, in seconds since 1970 (UTC).
    pub created_unix: u64,
    /// The checks, in the order the screen shows them.
    pub items: Vec<CheckItem>,
}

impl SelfCheck {
    /// The worst status of any check, or [`Status::Skipped`] when none ran.
    pub fn overall(&self) -> Status {
        self.items
            .iter()
            .map(|item| item.status)
            .max()
            .unwrap_or(Status::Skipped)
    }

    /// The check with this id.
    pub fn item(&self, id: CheckId) -> Option<&CheckItem> {
        self.items.iter().find(|item| item.id == id)
    }

    /// A copy for sharing: no file names, and nothing but codes, counts, versions, and kinds of error.
    pub fn redacted(&self) -> SelfCheck {
        let mut copy = self.clone();
        for item in &mut copy.items {
            if let Detail::Health { problems, .. } = &mut item.detail {
                problems.clear();
            }
        }
        copy
    }
}

/// The open notebook, as far as the self-check needs to know it. [`NotebookHandle`] implements it, and tests
/// can supply their own.
pub trait NotebookProbe {
    /// The notebook's folder.
    fn path(&self) -> &Path;
    /// The notebook's own check.
    fn verify(&self) -> Result<VerifyReport, CoreError>;
    /// Whether changes wait to be saved.
    fn has_unsaved(&self) -> bool;
}

impl NotebookProbe for NotebookHandle {
    fn path(&self) -> &Path {
        NotebookHandle::path(self)
    }

    fn verify(&self) -> Result<VerifyReport, CoreError> {
        NotebookHandle::verify(self)
    }

    fn has_unsaved(&self) -> bool {
        NotebookHandle::has_unsaved(self)
    }
}

/// What the self-check looks at.
pub struct Inputs<'a> {
    /// When it runs, in seconds since 1970 (UTC).
    pub now_unix: u64,
    /// `%LOCALAPPDATA%\OpenNote`, where updates, backups, and logs go.
    pub app_data_dir: &'a Path,
    /// The updater's folder, `updates` under the app data folder, or `None` when updates are off.
    pub updates_dir: Option<&'a Path>,
    /// The open notebook, if there is one.
    pub notebook: Option<&'a dyn NotebookProbe>,
    /// The saved crash reports, if the app keeps them.
    pub crash_store: Option<&'a CrashStore>,
}

/// Runs every check. It never fails: a check that cannot run reports why.
pub fn run(inputs: &Inputs<'_>, disk: &dyn DiskProbe) -> SelfCheck {
    let mut items = vec![
        match inputs.notebook {
            Some(notebook) => free_space(
                CheckId::DiskNotebook,
                notebook.path(),
                disk,
                NOTEBOOK_WARN_BELOW,
                NOTEBOOK_FAIL_BELOW,
            ),
            None => not_applicable(CheckId::DiskNotebook),
        },
        free_space(
            CheckId::DiskApp,
            inputs.app_data_dir,
            disk,
            APP_WARN_BELOW,
            APP_FAIL_BELOW,
        ),
    ];
    match inputs.notebook {
        Some(notebook) => {
            items.push(writable(notebook.path()));
            items.push(storage(notebook.path()));
            items.push(health(notebook));
        }
        None => {
            for id in [
                CheckId::NotebookWritable,
                CheckId::NotebookStorage,
                CheckId::NotebookHealth,
            ] {
                items.push(not_applicable(id));
            }
        }
    }
    items.push(match inputs.updates_dir {
        Some(dir) => updates(dir, inputs.now_unix),
        None => not_applicable(CheckId::Updates),
    });
    items.push(match inputs.crash_store {
        Some(store) => CheckItem {
            id: CheckId::CrashReports,
            status: Status::Pass,
            detail: Detail::Reports {
                count: u32::try_from(store.list().len()).unwrap_or(u32::MAX),
            },
        },
        None => not_applicable(CheckId::CrashReports),
    });
    SelfCheck {
        created_unix: inputs.now_unix,
        items,
    }
}

fn not_applicable(id: CheckId) -> CheckItem {
    CheckItem {
        id,
        status: Status::Skipped,
        detail: Detail::NotApplicable,
    }
}

/// The kind of an I/O error, which says what happened without a path or a message.
fn kind_of(error: &io::Error) -> String {
    format!("{:?}", error.kind())
}

fn free_space(id: CheckId, path: &Path, disk: &dyn DiskProbe, warn_below: u64, fail_below: u64) -> CheckItem {
    match disk.free_bytes(path) {
        Ok(free_bytes) => CheckItem {
            id,
            status: if free_bytes < fail_below {
                Status::Fail
            } else if free_bytes < warn_below {
                Status::Warn
            } else {
                Status::Pass
            },
            detail: Detail::FreeSpace {
                free_bytes,
                warn_below,
                fail_below,
            },
        },
        Err(error) => CheckItem {
            id,
            status: Status::Warn,
            detail: Detail::Unavailable {
                reason: kind_of(&error),
            },
        },
    }
}

/// Creates a file in the notebook folder and removes it, which is the only thing a save needs the folder for.
fn writable(dir: &Path) -> CheckItem {
    let probe = dir.join(format!(".opennote-selfcheck-{}.tmp", std::process::id()));
    let result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|_| std::fs::remove_file(&probe));
    let _ = std::fs::remove_file(&probe);
    CheckItem {
        id: CheckId::NotebookWritable,
        status: if result.is_ok() { Status::Pass } else { Status::Fail },
        detail: Detail::Writable {
            writable: result.is_ok(),
            reason: result.err().map(|error| kind_of(&error)),
        },
    }
}

fn file_system_name(kind: &VolumeKind) -> String {
    match kind {
        VolumeKind::Ntfs => "NTFS".to_owned(),
        VolumeKind::Refs => "ReFS".to_owned(),
        VolumeKind::Fat32 => "FAT32".to_owned(),
        VolumeKind::ExFat => "exFAT".to_owned(),
        VolumeKind::Fat => "FAT".to_owned(),
        VolumeKind::Apfs => "APFS".to_owned(),
        VolumeKind::Ext4 => "ext4".to_owned(),
        VolumeKind::Other(name) => name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(16)
            .collect(),
    }
}

fn storage(dir: &Path) -> CheckItem {
    let fs = StdFs::new(&Timings::default());
    match fs.volume(dir) {
        Ok(volume) => {
            let mut notes = Vec::new();
            if volume.remote {
                notes.push(StorageNote::NetworkShare);
            }
            if matches!(volume.kind, VolumeKind::Fat32 | VolumeKind::ExFat | VolumeKind::Fat) {
                notes.push(StorageNote::NoMetadataLog);
            }
            if let Some(tool) = volume.sync_root {
                notes.push(StorageNote::SyncFolder(match tool {
                    SyncTool::OneDrive => SyncName::OneDrive,
                    SyncTool::Dropbox => SyncName::Dropbox,
                    SyncTool::GoogleDrive => SyncName::GoogleDrive,
                    SyncTool::ICloud => SyncName::ICloud,
                    SyncTool::Other => SyncName::Other,
                }));
            }
            CheckItem {
                id: CheckId::NotebookStorage,
                status: if notes.is_empty() { Status::Pass } else { Status::Warn },
                detail: Detail::Storage {
                    file_system: file_system_name(&volume.kind),
                    notes,
                },
            }
        }
        Err(_) => CheckItem {
            id: CheckId::NotebookStorage,
            status: Status::Warn,
            detail: Detail::Unavailable {
                reason: "VolumeUnknown".to_owned(),
            },
        },
    }
}

/// The kind of a core error, without its message, which may hold a path.
fn core_error_kind(error: &CoreError) -> &'static str {
    match error {
        CoreError::Format(_) => "format",
        CoreError::Fs(_) => "fs",
        CoreError::Apply(_) => "apply",
        CoreError::Edit(_) => "edit",
        CoreError::ReadOnly(_) => "readOnly",
        CoreError::NotFound(_) => "notFound",
        CoreError::Journal(_) => "journal",
        CoreError::Conflict(_) => "conflict",
    }
}

fn health(notebook: &dyn NotebookProbe) -> CheckItem {
    let unsaved_changes = notebook.has_unsaved();
    let (status, detail) = match notebook.verify() {
        Ok(report) => {
            let root = notebook.path();
            let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
            for (_, warning) in &report.problems {
                *counts.entry(warning.code).or_default() += 1;
            }
            let mut by_code: Vec<CodeCount> = counts
                .into_iter()
                .map(|(code, count)| CodeCount {
                    code: code.to_owned(),
                    count,
                })
                .collect();
            by_code.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code.cmp(&b.code)));
            let problems = report
                .problems
                .iter()
                .take(MAX_LISTED_PROBLEMS)
                .map(|(file, warning)| Problem {
                    code: warning.code.to_owned(),
                    file: relative(root, file),
                })
                .collect();
            let status = if !report.is_clean() {
                Status::Fail
            } else if unsaved_changes {
                Status::Warn
            } else {
                Status::Pass
            };
            (
                status,
                Detail::Health {
                    files: report.files,
                    problem_count: u32::try_from(report.problems.len()).unwrap_or(u32::MAX),
                    by_code,
                    problems,
                    unsaved_changes,
                    failed: None,
                },
            )
        }
        Err(error) => (
            Status::Fail,
            Detail::Health {
                files: 0,
                problem_count: 0,
                by_code: Vec::new(),
                problems: Vec::new(),
                unsaved_changes,
                failed: Some(core_error_kind(&error).to_owned()),
            },
        ),
    };
    CheckItem {
        id: CheckId::NotebookHealth,
        status,
        detail,
    }
}

/// `file` relative to `root`, with forward slashes. A path outside `root` gives only its file name.
fn relative(root: &Path, file: &Path) -> String {
    let shown: PathBuf = match file.strip_prefix(root) {
        Ok(rest) => rest.to_path_buf(),
        Err(_) => file.file_name().map(PathBuf::from).unwrap_or_default(),
    };
    shown.to_string_lossy().replace('\\', "/")
}

/// A version number as the updater writes it: letters, digits, dots, plus signs, and dashes. Any program can write
/// the updater's file, so anything else is not repeated.
fn version_text(text: &str) -> String {
    let plain =
        !text.is_empty() && text.len() <= 40 && text.chars().all(|c| c.is_ascii_alphanumeric() || ".+-".contains(c));
    if plain {
        text.to_owned()
    } else {
        "unknown".to_owned()
    }
}

/// A time in the form the updater writes, or "unknown".
fn time_text(text: &str) -> String {
    if opennote_updater::time::parse(text).is_some() {
        text.to_owned()
    } else {
        "unknown".to_owned()
    }
}

fn updates(dir: &Path, now_unix: u64) -> CheckItem {
    let state = UpdaterState::load(dir);
    let last_check = state
        .last_check
        .as_deref()
        .filter(|text| opennote_updater::time::parse(text).is_some())
        .map(str::to_owned);
    let days_since_check = last_check
        .as_deref()
        .and_then(opennote_updater::time::parse)
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|since| now_unix.saturating_sub(since.as_secs()) / 86_400);
    let pending = state.pending.as_ref().map(|p| PendingUpdate {
        version: version_text(&p.version),
        from: version_text(&p.from),
        attempts: p.attempts,
    });
    let rolled_back = state.rolled_back.as_ref().map(|r| RolledBack {
        from: version_text(&r.from),
        to: version_text(&r.to),
        at: time_text(&r.at),
    });
    let stuck = pending.as_ref().is_some_and(|p| p.attempts >= STUCK_ATTEMPTS);
    let stale = days_since_check.is_some_and(|days| days >= STALE_CHECK_DAYS);
    CheckItem {
        id: CheckId::Updates,
        status: if rolled_back.is_some() || stuck || stale {
            Status::Warn
        } else {
            Status::Pass
        },
        detail: Detail::Updates {
            last_check,
            days_since_check,
            staged_version: state.staged.as_ref().map(|s| version_text(&s.version)),
            pending,
            rolled_back,
            blocked_versions: state.blocked_versions.iter().map(|v| version_text(v)).collect(),
        },
    }
}

#[cfg(test)]
#[path = "selfcheck_tests.rs"]
mod tests;
