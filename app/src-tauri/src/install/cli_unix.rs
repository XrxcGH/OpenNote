//! The `opennote` command-line tool on macOS and Linux. A release build carries the tool inside the app (build.rs,
//! `OPENNOTE_CLI_EXE`, or the one for each processor on a universal Mac app), and each start writes it to
//! `~/.local/bin/opennote`, so an update brings the matching tool. A dmg or an AppImage can't hold a second program
//! the shell finds by itself, which is why the app puts it where a shell looks. Whether `~/.local/bin` is on PATH is
//! the person's choice (docs/help/command-line.md).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

/// Where the tool goes for the person whose home folder is `home`.
pub fn tool_path(home: &Path) -> PathBuf {
    home.join(".local").join("bin").join("opennote")
}

/// Writes `bytes` to `~/.local/bin/opennote` unless the same bytes are there, and makes it runnable. Returns whether
/// it wrote. The file is written beside, then moved into place, so a half-written tool never runs.
pub fn install_bytes(home: &Path, bytes: &[u8]) -> io::Result<bool> {
    if bytes.is_empty() {
        return Ok(false);
    }
    let target = tool_path(home);
    if fs::read(&target).is_ok_and(|current| Sha256::digest(&current) == Sha256::digest(bytes)) {
        return Ok(false);
    }
    let folder = target.parent().map(Path::to_path_buf).unwrap_or_default();
    fs::create_dir_all(&folder)?;
    let temp = folder.join("opennote.new");
    fs::write(&temp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o755))?;
    }
    match fs::rename(&temp, &target) {
        Ok(()) => Ok(true),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

/// Brings the tool up to date. Runs at each start, when the API-and-tool setting is on.
pub fn refresh(settings_flags: &std::collections::BTreeMap<String, bool>) {
    if super::cli::EMBEDDED.is_empty()
        || !crate::platform_flags::is_on_now(crate::platform_flags::API_LOCAL, settings_flags)
    {
        return;
    }
    let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) else {
        return;
    };
    if let Err(error) = install_bytes(Path::new(&home), super::cli::EMBEDDED) {
        log::warn!("Couldn't install the opennote command: {error}");
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_tool_once_and_replaces_it_when_it_changes() {
        let home = tempfile::tempdir().unwrap();
        assert!(install_bytes(home.path(), b"one").unwrap());
        assert_eq!(fs::read(tool_path(home.path())).unwrap(), b"one");
        assert!(
            !install_bytes(home.path(), b"one").unwrap(),
            "the same bytes aren't written again"
        );
        assert!(install_bytes(home.path(), b"two").unwrap());
        assert_eq!(fs::read(tool_path(home.path())).unwrap(), b"two");
        assert!(!home.path().join(".local/bin/opennote.new").exists());
    }

    #[test]
    fn a_build_without_the_tool_writes_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert!(!install_bytes(home.path(), b"").unwrap());
        assert!(!tool_path(home.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_can_run() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        install_bytes(home.path(), b"#!/bin/sh\n").unwrap();
        assert_eq!(
            fs::metadata(tool_path(home.path())).unwrap().permissions().mode() & 0o111,
            0o111
        );
    }
}
