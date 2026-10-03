//! Swapping the running exe (ARCHITECTURE.md section 18.7): the previous copy with its hash, the staged copy next
//! to the exe, `self_replace`, and restoring a working exe when a swap fails halfway. Every copy is checked
//! against its SHA-256 before anything depends on it. Nothing changes the exe until the new copy sits next to it,
//! so a full disk or a locked folder fails before the swap.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use crate::{config::Config, stage::copy_name, state::PreviousRecord, verify::sha256_of, UpdateError};

/// Finds and replaces the running exe. Tests use a fake in temporary folders.
pub trait Replacer: Send + Sync {
    fn current_exe(&self) -> io::Result<PathBuf>;
    /// Replaces the running exe with a copy that already sits in the exe's folder.
    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()>;
}

/// The production replacer: the real exe path, and `self_replace` for the swap. In `self-replace` 1.5.0 on
/// Windows, the swap renames the running exe aside and schedules its deletion for after exit. Then it copies the
/// new file to a temporary name next to it, and renames that into place.
#[derive(Debug, Default, Clone, Copy)]
pub struct SelfReplace;

impl Replacer for SelfReplace {
    fn current_exe(&self) -> io::Result<PathBuf> {
        std::env::current_exe()
    }

    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()> {
        self_replace::self_replace(staged_next_to_exe)
    }
}

fn file_hash(path: &Path) -> io::Result<String> {
    sha256_of(fs::File::open(path)?)
}

/// Copies `source` to `target` through `<target>.tmp`, checks the copy's SHA-256, then renames it into place.
pub fn copy_checked(source: &Path, target: &Path, sha256: &str) -> Result<(), UpdateError> {
    let mut temporary = target.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    fs::copy(source, &temporary)?;
    if file_hash(&temporary)? != sha256 {
        let _ = fs::remove_file(&temporary);
        return Err(UpdateError::Swap(format!(
            "the copy of {} doesn't match its hash",
            source.display()
        )));
    }
    fs::rename(&temporary, target)?;
    Ok(())
}

/// Keeps a hashed copy of the running exe in `previous\` (step 2), replacing any older copy. It must exist before
/// the swap, because `self_replace` deletes the renamed exe when the process exits.
pub fn keep_previous(config: &Config, exe: &Path) -> Result<PreviousRecord, UpdateError> {
    let previous = &config.dirs.previous;
    fs::create_dir_all(previous)?;
    let target = previous.join(copy_name(&config.current, config.platform));
    let sha256 = file_hash(exe)?;
    copy_checked(exe, &target, &sha256)?;
    for entry in fs::read_dir(previous)?.flatten() {
        if entry.path() != target {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(PreviousRecord {
        version: config.current.to_string(),
        path: target.display().to_string(),
        sha256,
        unknown: Default::default(),
    })
}

/// Where a copy waits next to the exe before the swap: `<exe name>.new`.
pub fn next_to_exe(exe: &Path) -> PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(".new");
    PathBuf::from(name)
}

/// Copies `source` next to the exe and checks its hash (step 3), so any copy across drives happens while nothing
/// has changed yet.
pub fn place_next_to_exe(exe: &Path, source: &Path, sha256: &str) -> Result<PathBuf, UpdateError> {
    let new = next_to_exe(exe);
    copy_checked(source, &new, sha256)?;
    Ok(new)
}

/// Swaps `new` in. When the swap fails after the running exe was renamed aside, the exe path would be empty, so
/// `fallback`, a checked copy, goes back into place.
pub fn replace_or_restore(replacer: &dyn Replacer, exe: &Path, new: &Path, fallback: &Path) -> Result<(), UpdateError> {
    let result = replacer.replace_running_exe(new);
    let _ = fs::remove_file(new);
    let Err(error) = result else {
        return Ok(());
    };
    if !exe.exists() {
        match fs::copy(fallback, exe) {
            Ok(_) => log::warn!("The swap failed after renaming the exe, so the previous copy is back in place."),
            Err(restore) => log::error!("The swap failed, and restoring {} failed: {restore}", exe.display()),
        }
    }
    Err(UpdateError::Swap(error.to_string()))
}

/// The previous copy a record names, if it's where it belongs and its SHA-256 still matches. The path is rebuilt
/// inside `previous\` from the recorded file name, which must name the recorded version.
pub fn checked_previous(previous_dir: &Path, record: &PreviousRecord) -> Option<PathBuf> {
    let name = Path::new(&record.path).file_name()?.to_str()?;
    let expected_start = format!("OpenNote-{}-", record.version);
    if !name.starts_with(&expected_start) || !name.ends_with(".exe") {
        return None;
    }
    let path = previous_dir.join(name);
    (file_hash(&path).ok()? == record.sha256).then_some(path)
}

/// The SHA-256 of the file at a path, when it can be read.
pub fn hash_of(path: &Path) -> Option<String> {
    file_hash(path).ok()
}
