//! The folder of saved reports, `%LOCALAPPDATA%\OpenNote\crashes`. The interface lists, shows, and deletes
//! reports through [`CrashStore`]. Saving a report never sends it anywhere.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::report::{Kind, Report};
use crate::scrub::Scrubber;
use crate::symbols::{SymbolSet, Symbolicated};

/// How many reports are kept. A crash loop can't fill the disk, because the oldest report goes first.
pub const MAX_REPORTS: usize = 20;

/// Why a report could not be read or deleted.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// The id is not one that this store makes.
    #[error("not a crash report id: {0:?}")]
    BadId(String),
    /// There is no report with this id.
    #[error("no crash report {0:?}")]
    Missing(String),
    /// The report could not be read or deleted.
    #[error("crash report folder: {0}")]
    Io(#[from] io::Error),
    /// The file is not a crash report.
    #[error("not a crash report file: {0}")]
    Damaged(#[from] serde_json::Error),
}

/// One line of the list of reports, for the interface.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Summary {
    /// The report's id, to pass to [`CrashStore::load`] and [`CrashStore::delete`].
    pub id: String,
    /// When it happened, in seconds since 1970.
    pub time_unix: u64,
    /// What went wrong.
    pub kind: Kind,
    /// The OpenNote version that crashed.
    pub app_version: String,
    /// The size of the report file.
    pub size_bytes: u64,
}

/// The saved reports in one folder.
#[derive(Clone, Debug)]
pub struct CrashStore {
    dir: PathBuf,
}

impl CrashStore {
    /// A store in `dir`. The folder is made when the first report is saved.
    pub fn new(dir: impl Into<PathBuf>) -> CrashStore {
        CrashStore { dir: dir.into() }
    }

    /// The store in the standard place: `%LOCALAPPDATA%\OpenNote\crashes`. On other systems it is in the
    /// state folder, so tests and Linux builds behave the same way. `None` when the system gives no folder.
    pub fn standard() -> Option<CrashStore> {
        let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
        let base = var("LOCALAPPDATA")
            .or_else(|| var("XDG_STATE_HOME"))
            .or_else(|| var("HOME").map(|home| home.join(".local").join("state")))?;
        Some(CrashStore::new(base.join("OpenNote").join("crashes")))
    }

    /// The folder the reports are in.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Saves a report as a new file, and removes the oldest reports beyond [`MAX_REPORTS`]. Returns its id.
    /// It never overwrites a report. The report is written to a temporary file and moved into place, so a
    /// crash while saving, or a power cut, leaves no half-written report under a report's name.
    pub fn save(&self, report: &Report) -> io::Result<String> {
        fs::create_dir_all(&self.dir)?;
        let json = report.to_json();
        for n in 0..1000 {
            let id = format!("crash-{}-{n}", report.time_unix);
            if self.path(&id).exists() {
                continue;
            }
            match self.write_temporary(&id, &json) {
                Ok(temporary) => {
                    if let Err(err) = fs::rename(&temporary, self.path(&id)) {
                        let _ = fs::remove_file(&temporary);
                        return Err(err);
                    }
                    self.prune();
                    return Ok(id);
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            }
        }
        Err(io::Error::other("too many crash reports in the same second"))
    }

    /// Replaces the report `id`, such as with its symbolicated copy. The old file stays until the new one is
    /// complete on disk.
    pub fn replace(&self, id: &str, report: &Report) -> Result<(), StoreError> {
        check_id(id)?;
        if !self.path(id).exists() {
            return Err(StoreError::Missing(id.to_owned()));
        }
        let temporary = self.write_temporary(id, &report.to_json())?;
        if let Err(err) = fs::rename(&temporary, self.path(id)) {
            let _ = fs::remove_file(&temporary);
            return Err(err.into());
        }
        Ok(())
    }

    /// Writes `json` to the temporary file of `id`, which must not exist yet, and flushes it to disk.
    fn write_temporary(&self, id: &str, json: &str) -> io::Result<PathBuf> {
        let temporary = self.dir.join(format!("{id}.tmp"));
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        let written = file.write_all(json.as_bytes()).and_then(|()| file.sync_all());
        drop(file);
        match written {
            Ok(()) => Ok(temporary),
            Err(err) => {
                let _ = fs::remove_file(&temporary);
                Err(err)
            }
        }
    }

    /// The folder where symbol tables go, next to the reports: `%LOCALAPPDATA%\OpenNote\symbols`.
    pub fn symbols_dir(&self) -> PathBuf {
        self.dir.parent().unwrap_or(&self.dir).join("symbols")
    }

    /// Adds function names to every saved report that the symbols can name, and saves the reports again. Reports
    /// without a match are left as they are. Returns the total over all reports.
    pub fn symbolicate_all(&self, symbols: &SymbolSet, scrubber: &Scrubber) -> Symbolicated {
        let mut total = Symbolicated::default();
        for summary in self.list() {
            let Ok(report) = self.load(&summary.id, scrubber) else {
                continue;
            };
            let (done, counts) = report.symbolicated(symbols, scrubber);
            if counts.resolved > 0 && self.replace(&summary.id, &done).is_ok() {
                total.resolved += counts.resolved;
            }
            total.unresolved += counts.unresolved;
        }
        total
    }

    /// Removes what a crash or a power cut can leave behind: temporary files and files that are not reports.
    /// The app calls it at start-up. Returns how many files it removed. Files that are not part of the store's
    /// naming are never touched.
    pub fn sweep(&self) -> usize {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return 0;
        };
        entries
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    return false;
                };
                if let Some(id) = name.strip_suffix(".tmp") {
                    return check_id(id).is_ok();
                }
                name.strip_suffix(".json")
                    .is_some_and(|id| check_id(id).is_ok() && self.read(id).is_err())
            })
            .filter(|entry| fs::remove_file(entry.path()).is_ok())
            .count()
    }

    /// The saved reports, newest first. Files that are not reports are left out.
    pub fn list(&self) -> Vec<Summary> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut summaries: Vec<Summary> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let id = entry.file_name().to_str()?.strip_suffix(".json")?.to_owned();
                let size = entry.metadata().ok()?.len();
                let report = self.read(&id).ok()?;
                Some(Summary {
                    id,
                    time_unix: report.time_unix,
                    kind: report.kind,
                    app_version: report.app_version,
                    size_bytes: size,
                })
            })
            .collect();
        summaries.sort_by(|a, b| (b.time_unix, &b.id).cmp(&(a.time_unix, &a.id)));
        summaries
    }

    /// Reads one report, scrubbed again with `scrubber`, so what the person reviews and sends is clean even
    /// if the file was changed after it was saved.
    pub fn load(&self, id: &str, scrubber: &Scrubber) -> Result<Report, StoreError> {
        Ok(self.read(id)?.scrubbed(scrubber))
    }

    /// Deletes one report.
    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        check_id(id)?;
        fs::remove_file(self.path(id)).map_err(|err| not_found(err, id))
    }

    /// Deletes every report, and returns how many there were.
    pub fn delete_all(&self) -> usize {
        self.list()
            .iter()
            .filter(|summary| self.delete(&summary.id).is_ok())
            .count()
    }

    fn read(&self, id: &str) -> Result<Report, StoreError> {
        check_id(id)?;
        let json = fs::read_to_string(self.path(id)).map_err(|err| not_found(err, id))?;
        Ok(Report::from_json(&json)?)
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn prune(&self) {
        for old in self.list().iter().skip(MAX_REPORTS) {
            // Best effort: a report that can't be removed now goes at the next crash.
            let _ = self.delete(&old.id);
        }
    }
}

/// An id is `crash-`, digits, a dash, and digits, so it can never hold a path.
fn check_id(id: &str) -> Result<(), StoreError> {
    let ok = id
        .strip_prefix("crash-")
        .and_then(|rest| rest.split_once('-'))
        .is_some_and(|(time, n)| {
            let digits = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
            digits(time) && digits(n)
        });
    if ok {
        Ok(())
    } else {
        Err(StoreError::BadId(id.to_owned()))
    }
}

fn not_found(err: io::Error, id: &str) -> StoreError {
    if err.kind() == io::ErrorKind::NotFound {
        StoreError::Missing(id.to_owned())
    } else {
        StoreError::Io(err)
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
