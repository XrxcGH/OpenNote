//! The access log: one line of JSON for each thing an app asked for, read, or changed, and for each webhook
//! delivery. It names the app, the action, the page or section by ID and title, and the outcome. It never holds a
//! token, a request body, or note text. The file is `api-access.log` in the app's log folder; at 1 MB it moves to
//! `api-access.1.log`, and two older files are kept, so it never grows past about 3 MB.

use std::{
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::grants::lock;

/// The size at which the log moves aside.
pub const ROTATE_AT: u64 = 1024 * 1024;

/// How many older files are kept.
pub const KEEP: usize = 2;

/// How an access ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Allowed,
    /// The grant doesn't cover it, the section is locked, or the person said no.
    Refused,
    Failed,
}

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Unix milliseconds.
    pub time: u64,
    /// The app's ID, or `webhook:<id>`, or `-` for a request without a valid token.
    pub app: String,
    /// The app's name as the person knows it.
    pub name: String,
    /// Such as `notebooks.list`, `page.read`, `page.create`, `page.append`, `search`, `pair`, `webhook.deliver`.
    pub action: String,
    /// The ID of the page, section, or notebook, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Its title, so the log reads well after the page is renamed or gone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub outcome: Outcome,
    /// A short reason, such as `locked`, `notInGrant`, `declined`, or an HTTP status for a delivery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Entry {
    pub fn new(app: &str, name: &str, action: &str, outcome: Outcome) -> Entry {
        Entry {
            time: crate::now_millis(),
            app: short(app, 64),
            name: short(name, 60),
            action: short(action, 40),
            target: None,
            title: None,
            outcome,
            detail: None,
        }
    }

    pub fn target(mut self, id: &str, title: Option<&str>) -> Entry {
        self.target = Some(short(id, 64));
        self.title = title.map(|title| short(title, 120));
        self
    }

    pub fn detail(mut self, detail: &str) -> Entry {
        self.detail = Some(short(detail, 120));
        self
    }
}

/// One line, at most `max` characters, with control characters dropped.
fn short(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control()).take(max).collect()
}

/// The log file and its rotation.
pub struct AccessLog {
    path: Option<PathBuf>,
    rotate_at: u64,
    /// The recent entries, for a log without a file and to save reading the file for App permissions.
    recent: Mutex<Vec<Entry>>,
    write: Mutex<()>,
}

/// How many entries are kept in memory.
const RECENT: usize = 500;

impl AccessLog {
    pub fn at(path: &Path) -> AccessLog {
        let log = AccessLog {
            path: Some(path.to_path_buf()),
            rotate_at: ROTATE_AT,
            recent: Mutex::default(),
            write: Mutex::default(),
        };
        let earlier = log.read_file(RECENT);
        *lock(&log.recent) = earlier;
        log
    }

    /// A log that keeps entries in memory only.
    pub fn memory() -> AccessLog {
        AccessLog {
            path: None,
            rotate_at: ROTATE_AT,
            recent: Mutex::default(),
            write: Mutex::default(),
        }
    }

    /// A smaller rotation size, for tests.
    pub fn rotating_at(mut self, bytes: u64) -> AccessLog {
        self.rotate_at = bytes;
        self
    }

    fn rotated(path: &Path, n: usize) -> PathBuf {
        let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or("api-access");
        path.with_file_name(format!("{stem}.{n}.log"))
    }

    /// Adds an entry. A log that can't be written is reported to the app's log, and the request goes on.
    pub fn add(&self, entry: Entry) {
        if let Err(error) = self.write(&entry) {
            log::warn!("Couldn't write the API access log: {error}");
        }
        let mut recent = lock(&self.recent);
        recent.push(entry);
        let extra = recent.len().saturating_sub(RECENT);
        recent.drain(..extra);
    }

    fn write(&self, entry: &Entry) -> io::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let _writing = lock(&self.write);
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder)?;
        }
        if fs::metadata(path).is_ok_and(|meta| meta.len() >= self.rotate_at) {
            for n in (1..KEEP + 1).rev() {
                let from = if n == 1 {
                    path.to_path_buf()
                } else {
                    Self::rotated(path, n - 1)
                };
                if from.exists() {
                    fs::rename(&from, Self::rotated(path, n))?;
                }
            }
        }
        let mut line = serde_json::to_vec(entry).map_err(io::Error::other)?;
        line.push(b'\n');
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?
            .write_all(&line)
    }

    /// The newest entries first, at most `limit`.
    pub fn recent(&self, limit: usize) -> Vec<Entry> {
        lock(&self.recent).iter().rev().take(limit).cloned().collect()
    }

    /// The entries of the file and its older copies, oldest first, at most the last `limit`.
    fn read_file(&self, limit: usize) -> Vec<Entry> {
        let Some(path) = &self.path else {
            return Vec::new();
        };
        let mut files: Vec<PathBuf> = (1..=KEEP).rev().map(|n| Self::rotated(path, n)).collect();
        files.push(path.to_path_buf());
        let mut entries = Vec::new();
        for file in files {
            let Ok(opened) = fs::File::open(&file) else {
                continue;
            };
            entries.extend(
                BufReader::new(opened)
                    .lines()
                    .map_while(Result::ok)
                    .filter_map(|line| serde_json::from_str::<Entry>(&line).ok()),
            );
        }
        let extra = entries.len().saturating_sub(limit);
        entries.drain(..extra);
        entries
    }

    /// Removes every entry and file, for "Clear log".
    pub fn clear(&self) {
        let _writing = lock(&self.write);
        lock(&self.recent).clear();
        if let Some(path) = &self.path {
            let _ = fs::remove_file(path);
            for n in 1..=KEEP {
                let _ = fs::remove_file(Self::rotated(path, n));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_and_keeps_two_older_files() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("api-access.log");
        let log = AccessLog::at(&path).rotating_at(400);
        for n in 0..40 {
            log.add(Entry::new("a1", "opennote", "page.read", Outcome::Allowed).target(&format!("p{n}"), Some("Bio")));
        }
        assert!(path.exists());
        assert!(dir.path().join("api-access.1.log").exists());
        assert!(dir.path().join("api-access.2.log").exists());
        assert!(!dir.path().join("api-access.3.log").exists());
        let total: u64 = fs::read_dir(dir.path())
            .expect("files")
            .map(|entry| entry.expect("an entry").metadata().expect("meta").len())
            .sum();
        assert!(total < 3 * 400 + 400, "{total}");

        let again = AccessLog::at(&path);
        let recent = again.recent(3);
        assert_eq!(recent[0].target.as_deref(), Some("p39"));
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn keeps_each_field_to_one_short_line() {
        let entry = Entry::new("a\n1", &"x".repeat(200), "page.read", Outcome::Refused).detail("locked\r\nsecret");
        assert_eq!(entry.app, "a1");
        assert_eq!(entry.name.len(), 60);
        assert_eq!(entry.detail.as_deref(), Some("lockedsecret"));
    }

    #[test]
    fn clearing_removes_the_files() {
        let dir = tempfile::tempdir().expect("a folder");
        let path = dir.path().join("api-access.log");
        let log = AccessLog::at(&path);
        log.add(Entry::new("a1", "x", "search", Outcome::Allowed));
        log.clear();
        assert!(!path.exists());
        assert!(log.recent(10).is_empty());
    }
}
