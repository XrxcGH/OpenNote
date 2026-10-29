//! The ZIP package of a notes app's file, opened with limits for hostile files.
//!
//! Goodnotes, Notability, and Samsung Notes files are all ZIP archives. Nothing is unpacked to disk: entries are
//! read into memory one at a time, under a cap on each entry, on all entries together, and on how far an entry may
//! expand compared with its stored size. Names that climb out of the package or are absolute are refused, and the
//! whole read of one file has a time budget.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::archive::{ArchiveLimits, ZipArchive};
use crate::error::{InteropError, Result};

/// Limits for one notes file.
#[derive(Clone, Copy, Debug)]
pub struct PackageLimits {
    /// The archive reader's own limits.
    pub archive: ArchiveLimits,
    /// The most bytes all entries read may expand to.
    pub total_bytes: u64,
    /// How many times its stored size an entry larger than [`RATIO_FLOOR`] may expand to.
    pub max_ratio: u64,
    /// How long reading one file may take.
    pub budget: Duration,
}

/// Entries this small may expand any amount: a page of zeros compresses very well and is harmless.
pub const RATIO_FLOOR: u64 = 1 << 20;

impl Default for PackageLimits {
    fn default() -> PackageLimits {
        PackageLimits {
            archive: ArchiveLimits {
                entry_bytes: 256 << 20,
                total_bytes: 1 << 30,
                entries: 20_000,
            },
            total_bytes: 1 << 30,
            max_ratio: 200,
            budget: Duration::from_secs(120),
        }
    }
}

/// One entry that can be read.
#[derive(Clone, Debug)]
pub struct Member {
    /// Its index in the archive.
    pub index: usize,
    /// Its path inside the package, with `/` separators.
    pub name: String,
    /// Its unpacked size.
    pub size: u64,
}

impl Member {
    /// The last part of the name.
    pub fn file_name(&self) -> &str {
        self.name.rsplit('/').next().unwrap_or(&self.name)
    }

    /// The extension of the name, in lowercase.
    pub fn extension(&self) -> String {
        self.file_name()
            .rsplit_once('.')
            .map_or_else(String::new, |(_, e)| e.to_ascii_lowercase())
    }
}

/// An open package.
pub struct Package {
    archive: ZipArchive<BufReader<File>>,
    limits: PackageLimits,
    started: Instant,
    read_bytes: u64,
    /// The readable entries, in archive order.
    pub members: Vec<Member>,
    /// Entries left out, with the reason.
    pub refused: Vec<(String, String)>,
}

/// Whether a name stays inside the package.
pub fn safe_name(name: &str) -> bool {
    let name = name.replace('\\', "/");
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains(':')
        && !name.contains('\0')
        && name.split('/').all(|part| part != "..")
}

impl Package {
    /// Opens a package with the default limits.
    pub fn open(path: &Path) -> Result<Package> {
        Package::open_with(path, PackageLimits::default())
    }

    /// Opens a package with set limits.
    pub fn open_with(path: &Path, limits: PackageLimits) -> Result<Package> {
        let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
        let shown = path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let archive = ZipArchive::new(BufReader::new(file), limits.archive).map_err(|error| match error {
            InteropError::Format { .. } => {
                InteropError::format(&shown, "it is not a ZIP package, so it is not a file this app saved")
            }
            other => other,
        })?;
        let mut members = Vec::new();
        let mut refused = Vec::new();
        for (index, entry) in archive.entries().iter().enumerate() {
            if entry.is_dir || entry.name.starts_with("__MACOSX/") {
                continue;
            }
            if entry.is_link {
                refused.push((
                    entry.name.clone(),
                    "It is a link, and imports do not follow links.".to_owned(),
                ));
            } else if !safe_name(&entry.name) {
                refused.push((
                    entry.name.clone(),
                    "Its name points outside the file, so it was left out.".to_owned(),
                ));
            } else if entry.size > RATIO_FLOOR && entry.size / entry.packed_size().max(1) > limits.max_ratio {
                refused.push((
                    entry.name.clone(),
                    "It expands far more than real notes do, so it was left out to keep this computer safe.".to_owned(),
                ));
            } else {
                members.push(Member {
                    index,
                    name: entry.name.replace('\\', "/"),
                    size: entry.size,
                });
            }
        }
        Ok(Package {
            archive,
            limits,
            started: Instant::now(),
            read_bytes: 0,
            members,
            refused,
        })
    }

    /// Fails when reading this file has taken longer than its budget.
    pub fn check_time(&self) -> Result<()> {
        if self.started.elapsed() > self.limits.budget {
            return Err(InteropError::TooBig(format!(
                "this file, which took longer than {} seconds to read",
                self.limits.budget.as_secs()
            )));
        }
        Ok(())
    }

    /// Reads a member. `Ok(Err(why))` means this entry was left out and the rest can go on.
    pub fn read(&mut self, member: &Member) -> Result<std::result::Result<Vec<u8>, String>> {
        self.check_time()?;
        let total = self.read_bytes.saturating_add(member.size);
        if total > self.limits.total_bytes {
            return Ok(Err("The file holds more than OpenNote reads from one file.".to_owned()));
        }
        match self.archive.read(member.index) {
            Ok(bytes) => {
                self.read_bytes = self.read_bytes.saturating_add(bytes.len() as u64);
                Ok(Ok(bytes))
            }
            Err(InteropError::Canceled) => Err(InteropError::Canceled),
            Err(error) => Ok(Err(format!("It could not be read ({error})."))),
        }
    }
}
