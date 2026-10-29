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

/// The file whose presence next to the program turns on portable mode.
pub const PORTABLE_FILE: &str = "portable";

/// The folder beside the program that holds everything in portable mode.
pub const PORTABLE_FOLDER: &str = "OpenNote-data";

/// The profile folder portable mode uses: `OpenNote-data` beside the program, when a file named `portable` is
/// there too. Settings, caches, models, and the Documents default all live inside it, so nothing goes to the
/// Windows profile. The notes folder the person picks is theirs and stays wherever they chose.
pub fn portable_profile(program_dir: &Path) -> Option<PathBuf> {
    program_dir
        .join(PORTABLE_FILE)
        .is_file()
        .then(|| program_dir.join(PORTABLE_FOLDER))
}

/// The profile override: the environment variable wins (tests and E2E runs), then portable mode.
pub fn profile_override(env: Option<PathBuf>, program_dir: Option<&Path>) -> Option<PathBuf> {
    env.or_else(|| program_dir.and_then(portable_profile))
}

/// Whether `path` is a full path to a place on this PC. A network path (`\\host\share`) and the device paths
/// (`\\?\`, `\\.\`) aren't: touching one makes Windows sign in to that host, and the app writes only
/// where the person's own folders are.
pub fn is_local_path(path: &Path) -> bool {
    let text = path.to_string_lossy();
    path.is_absolute() && !text.starts_with(r"\\") && !text.starts_with("//")
}

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
            root.to_lowercase().replace('/', "\\").trim_end_matches('\\').to_owned()
        } else {
            root.into_owned()
        };
        Sha256::digest(root.as_bytes())
            .iter()
            .take(8)
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The default folders: Windows' known folders, so Documents follows OneDrive folder redirection; Application
    /// Support on macOS; the XDG base and user folders on Linux (ADR 0055).
    fn for_user() -> io::Result<Paths> {
        let (roaming, local, documents) = user_folders()?;
        Ok(Self::from_roots(roaming, local, documents))
    }
}

/// OpenNote's roaming and local folders, and Documents.
#[cfg(windows)]
fn user_folders() -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    use windows::Win32::UI::Shell::{FOLDERID_Documents, FOLDERID_LocalAppData, FOLDERID_RoamingAppData};

    Ok((
        known_folder(&FOLDERID_RoamingAppData)?.join(APP_FOLDER),
        known_folder(&FOLDERID_LocalAppData)?.join(APP_FOLDER),
        known_folder(&FOLDERID_Documents)?,
    ))
}

#[cfg(not(windows))]
fn user_folders() -> io::Result<(PathBuf, PathBuf, PathBuf)> {
    let home = env_dir("HOME")?;
    let config = xdg_dir(std::env::var_os("XDG_CONFIG_HOME"), &home, ".config");
    let user_dirs = std::fs::read_to_string(config.join("user-dirs.dirs")).unwrap_or_default();
    Ok(unix_folders(
        cfg!(target_os = "macos"),
        &home,
        std::env::var_os,
        &user_dirs,
    ))
}

/// The folders on macOS or Linux, from the home folder, the environment, and the text of `user-dirs.dirs`.
///
/// - macOS has no roaming profile, so both live in `~/Library/Application Support/OpenNote`, this Mac's files in
///   its `Device` folder. Nothing goes in Caches, which macOS may empty.
/// - Linux follows the XDG base directories: settings in `$XDG_CONFIG_HOME/OpenNote` (`~/.config`), this
///   computer's files in `$XDG_DATA_HOME/OpenNote` (`~/.local/share`), and Documents from `XDG_DOCUMENTS_DIR`
///   in `user-dirs.dirs`, so a translated or moved Documents folder is found. A relative value is ignored, as
///   the specification says.
#[cfg(any(not(windows), test))]
pub(crate) fn unix_folders(
    macos: bool,
    home: &Path,
    env: impl Fn(&str) -> Option<std::ffi::OsString>,
    user_dirs: &str,
) -> (PathBuf, PathBuf, PathBuf) {
    if macos {
        let support = home.join("Library").join("Application Support").join(APP_FOLDER);
        return (support.clone(), support.join("Device"), home.join("Documents"));
    }
    let config = xdg_dir(env("XDG_CONFIG_HOME"), home, ".config");
    let data = xdg_dir(env("XDG_DATA_HOME"), home, ".local/share");
    let documents = user_dir(user_dirs, "XDG_DOCUMENTS_DIR", home).unwrap_or_else(|| home.join("Documents"));
    (config.join(APP_FOLDER), data.join(APP_FOLDER), documents)
}

/// An XDG base folder: the variable's value when it is an absolute path, else `fallback` under the home folder.
#[cfg(any(not(windows), test))]
fn xdg_dir(value: Option<std::ffi::OsString>, home: &Path, fallback: &str) -> PathBuf {
    match value.map(PathBuf::from) {
        Some(dir) if dir.is_absolute() || dir.starts_with("/") => dir,
        _ => home.join(fallback),
    }
}

/// A folder from `user-dirs.dirs`, whose lines read `XDG_DOCUMENTS_DIR="$HOME/Documents"`. The value is an
/// absolute path or starts with `$HOME/`. The home folder itself means the folder is turned off.
#[cfg(any(not(windows), test))]
fn user_dir(text: &str, key: &str, home: &Path) -> Option<PathBuf> {
    let value = text.lines().find_map(|line| {
        let (name, value) = line.trim().split_once('=')?;
        (name.trim() == key).then(|| value.trim().trim_matches('"').to_owned())
    })?;
    match value.strip_prefix("$HOME/") {
        Some("") => None,
        Some(rest) => Some(home.join(rest)),
        None if value.starts_with('/') => Some(PathBuf::from(value)),
        None => None,
    }
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
    fn keeps_macos_files_in_application_support() {
        let home = Path::new("/Users/ada");
        let (roaming, local, documents) = unix_folders(true, home, |_| None, "");
        assert_eq!(
            roaming,
            PathBuf::from("/Users/ada/Library/Application Support/OpenNote")
        );
        assert_eq!(
            local,
            PathBuf::from("/Users/ada/Library/Application Support/OpenNote/Device")
        );
        assert_eq!(documents, PathBuf::from("/Users/ada/Documents"));
    }

    #[test]
    fn follows_the_xdg_folders_on_linux() {
        let home = Path::new("/home/ada");
        let (roaming, local, documents) = unix_folders(false, home, |_| None, "");
        assert_eq!(roaming, PathBuf::from("/home/ada/.config/OpenNote"));
        assert_eq!(local, PathBuf::from("/home/ada/.local/share/OpenNote"));
        assert_eq!(documents, PathBuf::from("/home/ada/Documents"));

        let env = |name: &str| match name {
            "XDG_CONFIG_HOME" => Some("/srv/conf".into()),
            "XDG_DATA_HOME" => Some("relative/data".into()),
            _ => None,
        };
        let dirs = "# written by xdg-user-dirs-update
XDG_DESKTOP_DIR=\"$HOME/Schreibtisch\"
XDG_DOCUMENTS_DIR=\"$HOME/Dokumente\"
";
        let (roaming, local, documents) = unix_folders(false, home, env, dirs);
        assert_eq!(roaming, PathBuf::from("/srv/conf/OpenNote"));
        // A relative XDG_DATA_HOME is ignored.
        assert_eq!(local, PathBuf::from("/home/ada/.local/share/OpenNote"));
        assert_eq!(documents, PathBuf::from("/home/ada/Dokumente"));
    }

    #[test]
    fn reads_only_usable_documents_folders_from_user_dirs() {
        let home = Path::new("/home/ada");
        let read = |text: &str| user_dir(text, "XDG_DOCUMENTS_DIR", home);
        assert_eq!(
            read("XDG_DOCUMENTS_DIR=\"/data/docs\""),
            Some(PathBuf::from("/data/docs"))
        );
        assert_eq!(read("XDG_DOCUMENTS_DIR=\"$HOME/\""), None);
        assert_eq!(read("XDG_DOCUMENTS_DIR=\"docs\""), None);
        assert_eq!(read("XDG_DOCUMENTS_DIRS=\"/elsewhere\""), None);
        assert_eq!(
            read(
                "not a line at all
="
            ),
            None
        );
    }

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

    #[cfg(windows)]
    #[test]
    fn a_local_path_is_a_drive_path() {
        assert!(is_local_path(Path::new(r"D:\Notes")));
        assert!(is_local_path(Path::new(r"C:\Users\ada\Documents\OpenNote")));
        for other in [
            r"Notes",
            r"\Notes",
            r"\\host\share",
            r"\\?\C:\Notes",
            r"\\?\UNC\host\share",
            r"\\.\pipe\x",
            "//host/share",
        ] {
            assert!(!is_local_path(Path::new(other)), "{other}");
        }
    }

    #[test]
    fn a_portable_file_moves_the_profile_beside_the_program() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert_eq!(portable_profile(dir.path()), None);
        std::fs::write(dir.path().join(PORTABLE_FILE), b"").expect("the marker file");
        let profile = portable_profile(dir.path()).expect("portable mode is on");
        assert_eq!(profile, dir.path().join(PORTABLE_FOLDER));
        let paths = Paths::resolve(Some(profile.clone())).expect("resolves");
        assert!(paths.settings_file.starts_with(&profile) && paths.webview.starts_with(&profile));
        // The environment variable still wins, so tests can run from a portable folder.
        let env = PathBuf::from(r"C:\profile");
        assert_eq!(profile_override(Some(env.clone()), Some(dir.path())), Some(env));
        assert_eq!(profile_override(None, Some(dir.path())), Some(profile));
        assert_eq!(profile_override(None, None), None);
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

    #[cfg(windows)]
    #[test]
    fn spells_one_windows_profile_the_same_with_either_slash() {
        let back = Paths::under_profile(Path::new("C:\\one\\profile")).profile_key();
        assert_eq!(back, Paths::under_profile(Path::new("C:/one/profile")).profile_key());
        assert_eq!(
            back,
            Paths::under_profile(Path::new("c:\\ONE\\profile\\")).profile_key()
        );
    }
}
