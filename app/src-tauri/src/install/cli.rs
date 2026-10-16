//! The `opennote` command-line tool beside the app (docs/help/command-line.md). A release exe carries the tool
//! (build.rs, `OPENNOTE_CLI_EXE`) and writes it to `bin\opennote.exe` in its folder: when setup moves OpenNote into
//! the Programs folder, and at each start from there, so an update brings the matching tool. Adding the `bin` folder
//! to the user's PATH is the person's choice, in App permissions (path_entry.rs).

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use super::path_entry::{CLI_DIR, CLI_EXE};

/// The tool, as the release build put it in. Empty in development builds.
pub const EMBEDDED: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/opennote-cli.bin"));

/// Where the tool goes for the app in `app_dir`.
pub fn tool_path(app_dir: &Path) -> PathBuf {
    app_dir.join(CLI_DIR).join(CLI_EXE)
}

/// Writes `bytes` to `app_dir\bin\opennote.exe` unless the same bytes are there. Returns whether it wrote. The file
/// is written beside, then moved into place, so a half-written tool never runs.
pub fn install_bytes(app_dir: &Path, bytes: &[u8]) -> io::Result<bool> {
    if bytes.is_empty() {
        return Ok(false);
    }
    let target = tool_path(app_dir);
    if fs::read(&target).is_ok_and(|current| Sha256::digest(&current) == Sha256::digest(bytes)) {
        return Ok(false);
    }
    let folder = app_dir.join(CLI_DIR);
    fs::create_dir_all(&folder)?;
    let temp = folder.join("opennote.exe.new");
    fs::write(&temp, bytes)?;
    // A running tool can't be replaced; it gets the new one next start.
    match fs::rename(&temp, &target) {
        Ok(()) => Ok(true),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

/// Installs the tool this exe carries beside the app in `app_dir`.
pub fn install(app_dir: &Path) {
    if let Err(error) = install_bytes(app_dir, EMBEDDED) {
        log::warn!("Couldn't install the opennote command: {error}");
    }
}

/// Brings the tool up to date when this exe runs from the user's Programs folder. Runs at each start.
pub fn refresh(paths: &crate::paths::Paths, settings_flags: &std::collections::BTreeMap<String, bool>) {
    if EMBEDDED.is_empty() || !crate::platform_flags::is_on_now(crate::platform_flags::API_LOCAL, settings_flags) {
        return;
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = super::programs_dir(paths);
    if exe.parent().is_some_and(|folder| super::same_folder(folder, &dir)) {
        install(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_tool_once_and_replaces_it_when_it_changes() {
        let dir = tempfile::tempdir().expect("a folder");
        assert!(!install_bytes(dir.path(), b"").expect("nothing to do"));
        assert!(!tool_path(dir.path()).exists());
        assert!(install_bytes(dir.path(), b"MZ one").expect("written"));
        assert!(!install_bytes(dir.path(), b"MZ one").expect("the same"));
        assert!(install_bytes(dir.path(), b"MZ two").expect("replaced"));
        assert_eq!(fs::read(tool_path(dir.path())).expect("read"), b"MZ two");
        assert!(!dir.path().join(CLI_DIR).join("opennote.exe.new").exists());
    }
}
