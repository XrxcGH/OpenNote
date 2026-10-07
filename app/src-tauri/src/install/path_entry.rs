//! The command-line tool's folder in the user's `PATH` (`HKCU\Environment`, value `Path`). Setup adds it only
//! when the person ticks "Add the opennote command to PATH", and an uninstall takes it out. The folder is
//! `bin` inside the app's folder, because Windows names are case-insensitive: `opennote.exe` beside
//! `OpenNote.exe` would be the same file.

use std::path::Path;

/// The tool's folder inside the app's folder.
pub const CLI_DIR: &str = "bin";

/// The tool's file name.
pub const CLI_EXE: &str = "opennote.exe";

fn same_entry(entry: &str, dir: &str) -> bool {
    entry
        .trim()
        .trim_end_matches(['\\', '/'])
        .eq_ignore_ascii_case(dir.trim_end_matches(['\\', '/']))
}

/// `path` with `dir` added at the end, unless it is already there.
pub fn with_entry(path: &str, dir: &str) -> String {
    if path.split(';').any(|entry| same_entry(entry, dir)) {
        return path.to_owned();
    }
    let trimmed = path.trim_end_matches(';');
    if trimmed.is_empty() {
        dir.to_owned()
    } else {
        format!("{trimmed};{dir}")
    }
}

/// `path` without `dir`, keeping every other entry as it was.
pub fn without_entry(path: &str, dir: &str) -> String {
    path.split(';')
        .filter(|entry| !same_entry(entry, dir))
        .collect::<Vec<_>>()
        .join(";")
}

/// Adds `dir` to the user's `PATH`. Returns whether it changed anything.
pub fn add(dir: &Path) -> bool {
    let dir = dir.display().to_string();
    let current = system::read().unwrap_or_default();
    let next = with_entry(&current, &dir);
    next != current && system::write(&next)
}

/// Takes `dir` out of the user's `PATH`. Returns whether it changed anything.
pub fn remove(dir: &Path) -> bool {
    let dir = dir.display().to_string();
    let Some(current) = system::read() else {
        return false;
    };
    let next = without_entry(&current, &dir);
    next != current && system::write(&next)
}

/// Whether `dir` is in the user's `PATH`.
pub fn contains(dir: &Path) -> bool {
    let dir = dir.display().to_string();
    system::read().is_some_and(|path| path.split(';').any(|entry| same_entry(entry, &dir)))
}

#[cfg(windows)]
mod system {
    use windows::{
        core::{w, HSTRING},
        Win32::{
            Foundation::{LPARAM, WPARAM},
            System::Registry::{
                RegCloseKey, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
                REG_EXPAND_SZ, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
            },
            UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE},
        },
    };

    /// The user's own `Path` value, unexpanded.
    pub fn read() -> Option<String> {
        let mut size = 0u32;
        // SAFETY: the first call only asks for the size.
        let sized = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                w!("Path"),
                RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND,
                None,
                None,
                Some(&mut size),
            )
        };
        if sized.is_err() {
            return None;
        }
        let mut buffer = vec![0u16; size as usize / 2 + 1];
        let mut size = u32::try_from(buffer.len() * 2).ok()?;
        // SAFETY: the buffer holds `size` bytes.
        let read = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Environment"),
                w!("Path"),
                RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if read.is_err() {
            return None;
        }
        let chars = (size as usize / 2).saturating_sub(1).min(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..chars]))
    }

    /// Writes the user's `Path` and tells running programs that the environment changed.
    pub fn write(value: &str) -> bool {
        let mut key = HKEY::default();
        // SAFETY: `key` receives an open key that is closed below.
        if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, w!("Environment"), None, KEY_SET_VALUE, &mut key) }.is_err() {
            return false;
        }
        let wide: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the bytes are the NUL-terminated UTF-16 text, which Windows copies.
        let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
        let written = unsafe { RegSetValueExW(key, w!("Path"), None, REG_EXPAND_SZ, Some(bytes)) }.is_ok();
        // SAFETY: `key` was opened above and is closed once.
        let _ = unsafe { RegCloseKey(key) };
        if written {
            let environment = HSTRING::from("Environment");
            // SAFETY: the string outlives the call, which waits at most a second for each window.
            unsafe {
                let _ = SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    WPARAM(0),
                    LPARAM(environment.as_ptr() as isize),
                    SMTO_ABORTIFHUNG,
                    1000,
                    None,
                );
            }
        }
        written
    }
}

#[cfg(not(windows))]
mod system {
    pub fn read() -> Option<String> {
        None
    }

    pub fn write(_value: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_once_at_the_end() {
        let dir = r"C:\Users\Ada\AppData\Local\Programs\OpenNote\bin";
        assert_eq!(with_entry("", dir), dir);
        assert_eq!(with_entry(r"C:\Tools;", dir), format!(r"C:\Tools;{dir}"));
        let once = with_entry(r"C:\Tools", dir);
        assert_eq!(with_entry(&once, dir), once);
        assert_eq!(
            with_entry(&once.to_uppercase(), dir),
            once.to_uppercase(),
            "case doesn't matter"
        );
    }

    #[test]
    fn removes_only_its_own_folder() {
        let dir = r"C:\Programs\OpenNote\bin";
        let path = format!(r"%USERPROFILE%\bin;{dir}\;C:\Tools");
        assert_eq!(without_entry(&path, dir), r"%USERPROFILE%\bin;C:\Tools");
        assert_eq!(
            without_entry(r"C:\Programs\OpenNote\binary", dir),
            r"C:\Programs\OpenNote\binary"
        );
    }
}
