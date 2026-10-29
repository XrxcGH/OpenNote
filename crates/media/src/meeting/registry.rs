//! Which apps are using the microphone, from the Windows registry.
//!
//! The system keeps a record of this under the current user's `CapabilityAccessManager\ConsentStore`
//! key, which is what powers the microphone indicator in the taskbar. Each app has a subkey with two
//! times: when it last started using the microphone, and when it last stopped. A stop time of zero means
//! it is using the microphone now. Desktop apps are filed under a `NonPackaged` subkey, with their path as
//! the name. The record names the app and nothing else, so this sees which app, never what is said.

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
};

use super::{app_name_from_key, MicrophoneUsers};
use crate::audio::Result;

const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
const NON_PACKAGED: &str = "NonPackaged";

/// Reads the registry on each call. It is cheap: a few dozen keys.
#[derive(Default)]
pub struct RegistryUsers;

impl MicrophoneUsers for RegistryUsers {
    fn current(&mut self) -> Result<Vec<String>> {
        let mut names = Vec::new();
        if let Some(base) = Key::open(HKEY_CURRENT_USER, BASE) {
            collect(&base, &mut names, |name| name != NON_PACKAGED);
            if let Some(desktop) = Key::open(base.0, NON_PACKAGED) {
                collect(&desktop, &mut names, |_| true);
            }
        }
        names.sort();
        names.dedup();
        Ok(names)
    }
}

/// Adds the apps among the subkeys of `parent` that are using the microphone.
fn collect(parent: &Key, names: &mut Vec<String>, wanted: impl Fn(&str) -> bool) {
    for name in parent.subkeys().filter(|name| wanted(name)) {
        let in_use = Key::open(parent.0, &name).is_some_and(|key| {
            let (start, stop) = (key.time("LastUsedTimeStart"), key.time("LastUsedTimeStop"));
            start.is_some_and(|start| start != 0) && stop == Some(0)
        });
        if in_use {
            names.push(app_name_from_key(&name));
        }
    }
}

struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful RegOpenKeyExW and is closed once.
        unsafe { RegCloseKey(self.0) };
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

impl Key {
    fn open(parent: HKEY, path: &str) -> Option<Key> {
        let mut handle: HKEY = null_mut();
        // SAFETY: the path is null-terminated and the pointer for the result is valid.
        let status = unsafe { RegOpenKeyExW(parent, wide(path).as_ptr(), 0, KEY_READ, &mut handle) };
        (status == ERROR_SUCCESS).then_some(Key(handle))
    }

    /// The names of the subkeys, which are short.
    fn subkeys(&self) -> impl Iterator<Item = String> + '_ {
        (0u32..).map_while(move |index| {
            let mut name = [0u16; 512];
            let mut length = name.len() as u32;
            // SAFETY: the buffer and its length are valid, and the other pointers are optional.
            let status = unsafe {
                RegEnumKeyExW(
                    self.0,
                    index,
                    name.as_mut_ptr(),
                    &mut length,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            (status == ERROR_SUCCESS).then(|| String::from_utf16_lossy(&name[..length as usize]))
        })
    }

    /// A 64-bit value, or none if it is missing or another size.
    fn time(&self, value: &str) -> Option<u64> {
        let mut data = [0u8; 8];
        let mut size = data.len() as u32;
        // SAFETY: the buffer and its size are valid, and the type is not wanted.
        let status = unsafe {
            RegQueryValueExW(
                self.0,
                wide(value).as_ptr(),
                null_mut(),
                null_mut(),
                data.as_mut_ptr(),
                &mut size,
            )
        };
        (status == ERROR_SUCCESS && size == 8).then(|| u64::from_le_bytes(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_registry_can_be_read_whoever_is_using_the_microphone() {
        // Nothing can be said about who is using it, but reading must work and give clean names.
        let names = RegistryUsers.current().unwrap();
        assert!(
            names.iter().all(|name| !name.is_empty() && !name.contains('#')),
            "{names:?}"
        );
    }
}
