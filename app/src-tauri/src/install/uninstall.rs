//! The Installed apps entry and `OpenNote.exe --uninstall` (behind `install.uninstallEntry`).
//!
//! Setup's move to `%LOCALAPPDATA%\Programs\OpenNote` writes a per-user entry under
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenNote`, and each start from that folder refreshes
//! it, so an update shows its new version there. Nothing needs administrator rights.
//!
//! Uninstalling asks first, and only runs while no other OpenNote process holds the profile. It removes the
//! Start menu shortcut, the command-line tool's folder from the user's `PATH`, the Installed apps entry, and the
//! app's own folder. It never touches the notes folder, even when the notes folder sits inside the app's folder,
//! and it keeps the settings, so a later install starts where the person left off. A running exe can't delete
//! itself, so the last step runs from a copy in the temporary folder (`--uninstall-finish`), which waits for this
//! process to exit. The finishing copy works out the folder again from the profile, so the argument can't point
//! it anywhere else.

use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use super::{is_inside, programs_dir, same_folder, shortcut_path, INSTALLED_EXE_NAME};
use crate::paths::Paths;

/// Where per-user uninstall entries live, under `HKEY_CURRENT_USER`.
pub const UNINSTALL_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// The entry's own key under [`UNINSTALL_ROOT`].
pub const ENTRY_KEY: &str = "OpenNote";

/// The argument that starts the uninstall.
pub const UNINSTALL_ARG: &str = "--uninstall";

/// The argument of the copy that removes the app's folder once the first process has exited.
pub const FINISH_ARG: &str = "--uninstall-finish";

/// The publisher shown in Installed apps.
pub const PUBLISHER: &str = "OpenNote contributors";

/// A registry value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegValue {
    Text(String),
    Number(u32),
}

/// The part of the registry the entry needs: one key's values, written and removed as a whole.
pub trait Registry {
    /// Creates `key` if needed and sets each value.
    fn write(&self, key: &str, values: &[(&str, RegValue)]) -> io::Result<()>;
    /// Removes `key` with everything under it. A key that isn't there is not an error.
    fn delete(&self, key: &str) -> io::Result<()>;
    /// One value of `key`.
    fn read(&self, key: &str, name: &str) -> Option<RegValue>;
}

/// A registry in memory: the fake root the tests use.
#[derive(Default)]
pub struct MemoryRegistry {
    keys: Mutex<BTreeMap<String, BTreeMap<String, RegValue>>>,
}

impl MemoryRegistry {
    pub fn has_key(&self, key: &str) -> bool {
        self.keys
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(key)
    }
}

impl Registry for MemoryRegistry {
    fn write(&self, key: &str, values: &[(&str, RegValue)]) -> io::Result<()> {
        let mut keys = self.keys.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = keys.entry(key.to_owned()).or_default();
        for (name, value) in values {
            entry.insert((*name).to_owned(), value.clone());
        }
        Ok(())
    }

    fn delete(&self, key: &str) -> io::Result<()> {
        let mut keys = self.keys.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let prefix = format!("{key}\\");
        keys.retain(|name, _| name != key && !name.starts_with(&prefix));
        Ok(())
    }

    fn read(&self, key: &str, name: &str) -> Option<RegValue> {
        let keys = self.keys.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        keys.get(key).and_then(|values| values.get(name)).cloned()
    }
}

/// The entry's full key under `HKEY_CURRENT_USER`.
pub fn entry_key() -> String {
    format!(r"{UNINSTALL_ROOT}\{ENTRY_KEY}")
}

/// The values of the entry for an install in `dir`.
pub fn entry_values(dir: &Path, version: &str, size_kb: u32, date: &str) -> Vec<(&'static str, RegValue)> {
    let exe = dir.join(INSTALLED_EXE_NAME);
    let text = |value: String| RegValue::Text(value);
    vec![
        ("DisplayName", text("OpenNote".into())),
        ("DisplayVersion", text(version.into())),
        ("Publisher", text(PUBLISHER.into())),
        ("InstallLocation", text(dir.display().to_string())),
        ("DisplayIcon", text(format!("\"{}\",0", exe.display()))),
        (
            "UninstallString",
            text(format!("\"{}\" {UNINSTALL_ARG}", exe.display())),
        ),
        ("URLInfoAbout", text("https://github.com/XrxcGH/OpenNote".into())),
        ("InstallDate", text(date.into())),
        ("EstimatedSize", RegValue::Number(size_kb)),
        ("NoModify", RegValue::Number(1)),
        ("NoRepair", RegValue::Number(1)),
    ]
}

/// Writes or refreshes the entry for the install in `dir`.
pub fn write_entry(registry: &dyn Registry, dir: &Path, version: &str) -> io::Result<()> {
    let size = fs::metadata(dir.join(INSTALLED_EXE_NAME))
        .map(|meta| u32::try_from(meta.len() / 1024).unwrap_or(u32::MAX))
        .unwrap_or(0);
    // Keep the first install date across refreshes.
    let date = match registry.read(&entry_key(), "InstallDate") {
        Some(RegValue::Text(date)) if date.len() == 8 => date,
        _ => today(),
    };
    registry.write(&entry_key(), &entry_values(dir, version, size, &date))
}

/// Removes the entry.
pub fn remove_entry(registry: &dyn Registry) -> io::Result<()> {
    registry.delete(&entry_key())
}

/// Today as `YYYYMMDD`, in UTC.
fn today() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() / 86_400)
        .unwrap_or(0);
    let (year, month, day) = civil_from_days(i64::try_from(days).unwrap_or(0));
    format!("{year:04}{month:02}{day:02}")
}

/// The calendar date of a day count since 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = u32::try_from(doy - (153 * mp + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).unwrap_or(1);
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// What an uninstall removes, worked out from the profile alone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// The app's folder, `%LOCALAPPDATA%\Programs\OpenNote`.
    pub app_dir: PathBuf,
    /// The Start menu shortcut.
    pub shortcut: PathBuf,
    /// The notes folder from settings, which is never removed.
    pub notes_folder: Option<PathBuf>,
}

/// The plan for this profile. The notes folder comes from the settings file, read without changing it.
pub fn plan(paths: &Paths) -> Plan {
    let notes_folder = fs::read_to_string(&paths.settings_file)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|json| json["storage"]["notesFolder"].as_str().map(PathBuf::from))
        .filter(|folder| !folder.as_os_str().is_empty());
    Plan {
        app_dir: programs_dir(paths),
        shortcut: shortcut_path(paths),
        notes_folder,
    }
}

/// Removes the app's folder, leaving the notes folder (and everything above it) alone when it sits inside. A
/// folder that isn't the app's folder, or that holds no `OpenNote.exe`, is left alone. Returns how many files
/// were removed.
pub fn remove_app_dir(plan: &Plan) -> io::Result<usize> {
    let dir = &plan.app_dir;
    if !dir.join(INSTALLED_EXE_NAME).is_file() {
        return Ok(0);
    }
    let keep = plan.notes_folder.as_deref();
    let mut removed = 0;
    remove_tree(dir, keep, &mut removed)?;
    Ok(removed)
}

/// Removes `dir`'s contents and then `dir`, skipping the folder `keep` and the folders that lead to it.
fn remove_tree(dir: &Path, keep: Option<&Path>, removed: &mut usize) -> io::Result<()> {
    if keep.is_some_and(|keep| same_folder(dir, keep)) {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        // A link is removed as a link, never followed.
        let kind = entry.file_type()?;
        if kind.is_dir() && !kind.is_symlink() {
            remove_tree(&path, keep, removed)?;
        } else {
            match fs::remove_file(&path) {
                Ok(()) => *removed += 1,
                Err(error) if kind.is_symlink() => fs::remove_dir(&path).map_err(|_| error)?,
                Err(error) => return Err(error),
            }
        }
    }
    let holds_notes = keep.is_some_and(|keep| is_inside(keep, dir));
    if !holds_notes {
        fs::remove_dir(dir)?;
    }
    Ok(())
}

/// The start-menu and registry part of an uninstall, which the first process does before it hands over.
pub fn remove_links(plan: &Plan, registry: &dyn Registry) -> io::Result<()> {
    match fs::remove_file(&plan.shortcut) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    crate::install::path_entry::remove(&plan.app_dir.join(crate::install::path_entry::CLI_DIR));
    remove_entry(registry)
}

/// The registry of this user, `HKEY_CURRENT_USER`.
#[cfg(windows)]
pub struct UserRegistry;

#[cfg(windows)]
impl Registry for UserRegistry {
    fn write(&self, key: &str, values: &[(&str, RegValue)]) -> io::Result<()> {
        use windows::{
            core::HSTRING,
            Win32::System::Registry::{
                RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_DWORD,
                REG_OPTION_NON_VOLATILE, REG_SZ,
            },
        };

        let mut handle = HKEY::default();
        // SAFETY: the key name is NUL-terminated, and `handle` receives an open key that is closed below.
        let created = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(key),
                None,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut handle,
                None,
            )
        };
        if created.is_err() {
            return Err(io::Error::from_raw_os_error(created.0 as i32));
        }
        let mut result = Ok(());
        for (name, value) in values {
            let name = HSTRING::from(*name);
            let status = match value {
                RegValue::Text(text) => {
                    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
                    // SAFETY: the bytes are the NUL-terminated UTF-16 text, which Windows copies.
                    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
                    unsafe { RegSetValueExW(handle, &name, None, REG_SZ, Some(bytes)) }
                }
                RegValue::Number(number) => {
                    let bytes = number.to_le_bytes();
                    // SAFETY: four bytes of a DWORD, which Windows copies.
                    unsafe { RegSetValueExW(handle, &name, None, REG_DWORD, Some(&bytes)) }
                }
            };
            if status.is_err() {
                result = Err(io::Error::from_raw_os_error(status.0 as i32));
                break;
            }
        }
        // SAFETY: `handle` was opened above and is closed once.
        let _ = unsafe { RegCloseKey(handle) };
        result
    }

    fn delete(&self, key: &str) -> io::Result<()> {
        use windows::{
            core::HSTRING,
            Win32::{
                Foundation::ERROR_FILE_NOT_FOUND,
                System::Registry::{RegDeleteTreeW, HKEY_CURRENT_USER},
            },
        };

        // SAFETY: the key name is NUL-terminated.
        let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key)) };
        if status.is_ok() || status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        Err(io::Error::from_raw_os_error(status.0 as i32))
    }

    fn read(&self, key: &str, name: &str) -> Option<RegValue> {
        use windows::{
            core::HSTRING,
            Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ},
        };

        let (key, name) = (HSTRING::from(key), HSTRING::from(name));
        let mut number = 0u32;
        let mut size = 4u32;
        // SAFETY: the buffer is four bytes, as `size` says.
        let read = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &name,
                RRF_RT_REG_DWORD,
                None,
                Some(std::ptr::from_mut(&mut number).cast()),
                Some(&mut size),
            )
        };
        if read.is_ok() {
            return Some(RegValue::Number(number));
        }
        let mut buffer = vec![0u16; 1024];
        let mut size = u32::try_from(buffer.len() * 2).unwrap_or(u32::MAX);
        // SAFETY: the buffer holds `size` bytes.
        let read = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                &key,
                &name,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if read.is_err() {
            return None;
        }
        let chars = (size as usize / 2).saturating_sub(1).min(buffer.len());
        Some(RegValue::Text(String::from_utf16_lossy(&buffer[..chars])))
    }
}

/// The registry this system has. Other systems keep nothing.
pub fn user_registry() -> Box<dyn Registry> {
    #[cfg(windows)]
    {
        Box::new(UserRegistry)
    }
    #[cfg(not(windows))]
    {
        Box::new(MemoryRegistry::default())
    }
}

/// Writes or refreshes the entry when this exe runs from the user's Programs folder and the flag is on. Called
/// after setup's move and at each start.
pub fn refresh_if_installed(paths: &Paths, settings_flags: &BTreeMap<String, bool>) {
    if cfg!(debug_assertions)
        || !crate::platform_flags::is_on_now(crate::platform_flags::UNINSTALL_ENTRY, settings_flags)
    {
        return;
    }
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = programs_dir(paths);
    if !exe.parent().is_some_and(|folder| same_folder(folder, &dir)) {
        return;
    }
    if let Err(error) = write_entry(user_registry().as_ref(), &dir, env!("CARGO_PKG_VERSION")) {
        log::warn!("Couldn't write the Installed apps entry: {error}");
    }
}

/// What the process should do with its arguments: nothing, start an uninstall, or finish one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    None,
    Uninstall,
    /// Finish after the process with this ID has exited.
    Finish {
        wait_pid: Option<u32>,
    },
}

/// Reads the uninstall arguments, which come before anything else on the command line.
pub fn request_from(args: &[String]) -> Request {
    let wait_pid = args
        .iter()
        .position(|arg| arg == "--wait-pid")
        .and_then(|at| args.get(at + 1))
        .and_then(|pid| pid.parse().ok());
    if args.iter().any(|arg| arg == FINISH_ARG) {
        Request::Finish { wait_pid }
    } else if args.iter().any(|arg| arg == UNINSTALL_ARG) {
        Request::Uninstall
    } else {
        Request::None
    }
}

/// Runs an uninstall request from the command line, and returns the exit code, or `None` to start normally.
pub fn run_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match request_from(&args) {
        Request::None => None,
        Request::Uninstall => Some(start_uninstall()),
        Request::Finish { wait_pid } => Some(finish_uninstall(wait_pid)),
    }
}

fn profile_paths() -> io::Result<Paths> {
    let program_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf));
    Paths::resolve(crate::paths::profile_override(
        std::env::var_os(crate::paths::PROFILE_DIR_VAR).map(Into::into),
        program_dir.as_deref(),
    ))
}

/// Asks, checks that OpenNote isn't running, removes the shortcut, the `PATH` entry, and the Installed apps entry,
/// then hands the app's folder to a copy in the temporary folder.
fn start_uninstall() -> i32 {
    let Ok(paths) = profile_paths() else {
        return 1;
    };
    let plan = plan(&paths);
    let notes = plan.notes_folder.as_ref().map_or_else(
        || "your Documents folder".to_owned(),
        |folder| folder.display().to_string(),
    );
    let question = format!(
        "Remove OpenNote from this PC?\n\nYour notes stay where they are, in {notes}. Your settings stay too, so \
         installing OpenNote again picks up where you left off."
    );
    if !dialog::confirm(&question) {
        return 0;
    }
    // Another process holding the profile is told to come forward, and the person is asked to close it.
    let instance = match crate::instance::acquire(&paths, &crate::args::Args::default()) {
        crate::instance::InstanceOutcome::Owner(guard) => guard,
        _ => {
            dialog::inform("OpenNote is open. Close it, then remove it again from Installed apps.");
            return 1;
        }
    };
    if let Err(error) = remove_links(&plan, user_registry().as_ref()) {
        log::warn!("Couldn't remove the shortcut or the Installed apps entry: {error}");
    }
    let running = std::env::current_exe().unwrap_or_default();
    let runs_inside = running.parent().is_some_and(|folder| is_inside(folder, &plan.app_dir));
    if !runs_inside {
        drop(instance);
        return finish_now(&plan);
    }
    match hand_over(&running) {
        Ok(()) => 0,
        Err(error) => {
            log::warn!("Couldn't start the last step of the uninstall: {error}");
            dialog::inform(
                "OpenNote couldn't remove its folder. Delete it by hand if you like; your notes are not in it.",
            );
            1
        }
    }
}

/// Copies this exe to the temporary folder and starts it with [`FINISH_ARG`], waiting for this process.
fn hand_over(running: &Path) -> io::Result<()> {
    let copy = std::env::temp_dir().join(format!("OpenNote-uninstall-{}.exe", std::process::id()));
    fs::copy(running, &copy)?;
    std::process::Command::new(&copy)
        .args([FINISH_ARG, "--wait-pid", &std::process::id().to_string()])
        .spawn()?;
    Ok(())
}

fn finish_uninstall(wait_pid: Option<u32>) -> i32 {
    if let Some(pid) = wait_pid {
        let _ = crate::args::wait_for_exit(pid, crate::args::WAIT_PID_TIMEOUT);
    }
    let Ok(paths) = profile_paths() else {
        return 1;
    };
    finish_now(&plan(&paths))
}

fn finish_now(plan: &Plan) -> i32 {
    match remove_app_dir(plan) {
        Ok(_) => {
            dialog::inform("OpenNote was removed. Your notes are still in their folder.");
            0
        }
        Err(error) => {
            log::warn!("Couldn't remove the app's folder: {error}");
            dialog::inform(
                "OpenNote was mostly removed, but some of its files were in use. Delete its folder later if you like.",
            );
            1
        }
    }
}

/// The two message boxes an uninstall shows, before any window exists.
mod dialog {
    #[cfg(windows)]
    pub fn confirm(text: &str) -> bool {
        use windows::{
            core::{w, HSTRING},
            Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONQUESTION, MB_YESNO},
        };
        // SAFETY: both strings are NUL-terminated and outlive the call.
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from(text),
                w!("Remove OpenNote"),
                MB_YESNO | MB_ICONQUESTION,
            ) == IDYES
        }
    }

    #[cfg(windows)]
    pub fn inform(text: &str) {
        use windows::{
            core::{w, HSTRING},
            Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK},
        };
        // SAFETY: both strings are NUL-terminated and outlive the call.
        let _ = unsafe { MessageBoxW(None, &HSTRING::from(text), w!("OpenNote"), MB_OK | MB_ICONINFORMATION) };
    }

    #[cfg(not(windows))]
    pub fn confirm(_text: &str) -> bool {
        false
    }

    #[cfg(not(windows))]
    pub fn inform(_text: &str) {}
}

#[cfg(test)]
#[path = "uninstall_tests.rs"]
mod tests;
