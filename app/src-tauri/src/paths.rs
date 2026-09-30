//! Every folder and file the shell uses (ARCHITECTURE.md section 8.4). They're built here, not by Tauri, whose
//! app folders would be named after the app identifier. `OPENNOTE_PROFILE_DIR=<dir>` moves them all under one
//! folder, for tests, E2E runs, and portable setups.

use std::{
    io,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

/// The environment variable that moves every folder under one profile folder.
pub const PROFILE_DIR_VAR: &str = "OPENNOTE_PROFILE_DIR";

const APP_FOLDER: &str = "OpenNote";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    /// Personal settings that roam with the Windows profile: `%APPDATA%\OpenNote`.
    pub roaming: PathBuf,
    /// This device's files: `%LOCALAPPDATA%\OpenNote`.
    pub local: PathBuf,
    /// The Documents folder, where the notes folder is proposed.
    pub documents: PathBuf,
    pub settings_file: PathBuf,
    pub state_file: PathBuf,
    pub updates: PathBuf,
    pub previous: PathBuf,
    pub backups: PathBuf,
    pub logs: PathBuf,
    pub webview: PathBuf,
    pub snapshot_file: PathBuf,
}

impl Paths {
    /// The folders for this user, or under `profile_override` when it's set.
    pub fn resolve(profile_override: Option<PathBuf>) -> io::Result<Paths> {
        match profile_override {
            Some(dir) => Ok(Self::under_profile(&dir)),
            None => Self::for_user(),
        }
    }

    /// The layout under an `OPENNOTE_PROFILE_DIR` folder: `roaming`, `local`, and `Documents` inside it.
    pub fn under_profile(dir: &Path) -> Paths {
        Self::from_roots(dir.join("roaming"), dir.join("local"), dir.join("Documents"))
    }

    /// Builds every path from the three roots.
    pub fn from_roots(roaming: PathBuf, local: PathBuf, documents: PathBuf) -> Paths {
        Paths {
            settings_file: roaming.join("settings.json"),
            state_file: local.join("state.json"),
            updates: local.join("updates"),
            previous: local.join("previous"),
            backups: local.join("backups"),
            logs: local.join("logs"),
            webview: local.join("webview"),
            snapshot_file: local.join("phase2-notes.json"),
            roaming,
            local,
            documents,
        }
    }

    /// A short key that names this profile: the first 16 hex digits of the SHA-256 of the roaming folder. The
    /// instance lock uses it, so two profiles can run side by side.
    pub fn profile_key(&self) -> String {
        let root = self.roaming.to_string_lossy();
        // Windows paths ignore case, so C:\Users and c:\users name the same profile.
        let root = if cfg!(windows) {
            root.to_lowercase()
        } else {
            root.into_owned()
        };
        Sha256::digest(root.as_bytes())
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The default folders, from Windows' known folders, so Documents follows OneDrive folder redirection.
    fn for_user() -> io::Result<Paths> {
        let (roaming, local, documents) = user_roots()?;
        Ok(Self::from_roots(
            roaming.join(APP_FOLDER),
            local.join(APP_FOLDER),
            documents,
        ))
    }
}

/// The roaming and local application data folders and Documents.
#[cfg(windows)]
fn user_roots() -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    use windows::Win32::UI::Shell::{FOLDERID_Documents, FOLDERID_LocalAppData, FOLDERID_RoamingAppData};

    Ok((
        known_folder(&FOLDERID_RoamingAppData)?,
        known_folder(&FOLDERID_LocalAppData)?,
        known_folder(&FOLDERID_Documents)?,
    ))
}

#[cfg(not(windows))]
fn user_roots() -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    let home = env_dir("HOME")?;
    Ok((
        home.join(".config"),
        home.join(".local").join("share"),
        home.join("Documents"),
    ))
}

/// A Windows known folder, such as `FOLDERID_Documents`, wherever the person or an administrator moved it.
#[cfg(windows)]
pub fn known_folder(id: &windows::core::GUID) -> io::Result<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    use windows::Win32::{
        System::Com::CoTaskMemFree,
        UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT},
    };

    // SAFETY: `id` is a valid GUID. On success the returned string is a NUL-terminated buffer that Windows
    // allocated; it is copied, then freed with CoTaskMemFree exactly once.
    unsafe {
        let path = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).map_err(io::Error::other)?;
        let folder = PathBuf::from(OsString::from_wide(path.as_wide()));
        CoTaskMemFree(Some(path.0.cast_const().cast()));
        Ok(folder)
    }
}

#[cfg(not(windows))]
fn env_dir(name: &str) -> io::Result<PathBuf> {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, format!("{name} isn't set")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_every_folder_under_a_profile_override() {
        let dir = PathBuf::from("C:\\profile");
        let paths = Paths::resolve(Some(dir.clone())).expect("an override always resolves");
        assert_eq!(paths.settings_file, dir.join("roaming").join("settings.json"));
        assert_eq!(paths.documents, dir.join("Documents"));
        let local = [
            &paths.state_file,
            &paths.updates,
            &paths.previous,
            &paths.backups,
            &paths.logs,
        ];
        let local = local.into_iter().chain([&paths.webview, &paths.snapshot_file]);
        for path in local {
            assert!(path.starts_with(dir.join("local")), "{}", path.display());
        }
    }

    #[cfg(windows)]
    #[test]
    fn finds_this_users_known_folders() {
        let paths = Paths::resolve(None).expect("known folders resolve");
        assert!(paths.roaming.ends_with(APP_FOLDER) && paths.local.ends_with(APP_FOLDER));
        assert!(paths.roaming.parent().is_some_and(Path::is_dir));
        assert!(paths.local.parent().is_some_and(Path::is_dir));
        assert!(paths.documents.is_absolute());
        assert_ne!(paths.roaming, paths.local);
    }

    #[test]
    fn names_each_profile_with_a_short_stable_key() {
        let one = Paths::under_profile(Path::new("C:\\one"));
        let key = one.profile_key();
        assert_eq!(key.len(), 16);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(key, Paths::under_profile(Path::new("C:\\one")).profile_key());
        assert_ne!(key, Paths::under_profile(Path::new("C:\\two")).profile_key());
    }
}
