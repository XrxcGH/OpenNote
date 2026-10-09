//! Where the tool keeps its key: Windows Credential Manager, in the same `<parts>|<text>` form the app uses
//! (app/src-tauri/src/connectors/store.rs), so the tool can also read the key that proves the listener is
//! OpenNote's. Tests keep keys in memory.

use std::{collections::HashMap, sync::Mutex};

/// The tool's own key, as `opennote` uses it.
pub const CLI_TOKEN: &str = "OpenNote/cli/token";

/// An assistant's key, by the name it connects as.
pub fn assistant_token(name: &str) -> String {
    let slug: String = name
        .chars()
        .filter_map(|c| {
            if c.is_ascii_alphanumeric() {
                Some(c.to_ascii_lowercase())
            } else if c == ' ' || c == '-' || c == '_' {
                Some('-')
            } else {
                None
            }
        })
        .take(40)
        .collect();
    format!("OpenNote/mcp/{}", if slug.is_empty() { "assistant" } else { &slug })
}

/// A place for secrets.
pub trait Secrets: Send + Sync {
    fn get(&self, target: &str) -> Option<String>;
    fn put(&self, target: &str, secret: &str) -> bool;
    fn delete(&self, target: &str);
}

/// Secrets in memory, for tests.
#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

impl Secrets for MemorySecrets {
    fn get(&self, target: &str) -> Option<String> {
        self.0.lock().ok()?.get(target).cloned()
    }

    fn put(&self, target: &str, secret: &str) -> bool {
        self.0
            .lock()
            .map(|mut map| map.insert(target.into(), secret.into()))
            .is_ok()
    }

    fn delete(&self, target: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(target);
        }
    }
}

/// Unwraps the app's `<parts>|<text>` form. The tool's values are always one part.
pub fn unwrap_parts(value: &str) -> Option<String> {
    let (count, text) = value.split_once('|')?;
    (count == "1").then(|| text.to_owned())
}

#[cfg(windows)]
pub use self::windows_store::CredentialManager;

#[cfg(windows)]
mod windows_store {
    use windows::{
        core::{HSTRING, PWSTR},
        Win32::Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        },
    };

    use super::{unwrap_parts, Secrets};

    /// Windows Credential Manager, for this user.
    pub struct CredentialManager;

    impl Secrets for CredentialManager {
        fn get(&self, target: &str) -> Option<String> {
            let name = HSTRING::from(target);
            let mut found: *mut CREDENTIALW = std::ptr::null_mut();
            // SAFETY: `found` is a valid place for a pointer, and the name is NUL-terminated.
            unsafe { CredReadW(&name, CRED_TYPE_GENERIC, None, &mut found) }.ok()?;
            // SAFETY: CredReadW succeeded, so `found` points at a credential that stays valid until CredFree.
            let text = unsafe {
                let credential = &*found;
                let bytes = if credential.CredentialBlob.is_null() {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize)
                        .to_vec()
                };
                CredFree(found.cast());
                String::from_utf8(bytes).ok()
            }?;
            unwrap_parts(&text)
        }

        fn put(&self, target: &str, secret: &str) -> bool {
            let mut name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
            let mut user: Vec<u16> = "OpenNote".encode_utf16().chain(Some(0)).collect();
            let mut blob = format!("1|{secret}").into_bytes();
            let Ok(size) = u32::try_from(blob.len()) else {
                return false;
            };
            let credential = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: PWSTR(name.as_mut_ptr()),
                UserName: PWSTR(user.as_mut_ptr()),
                CredentialBlobSize: size,
                CredentialBlob: blob.as_mut_ptr(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..Default::default()
            };
            // SAFETY: the buffers live until the call returns, and Windows copies them.
            unsafe { CredWriteW(&credential, 0) }.is_ok()
        }

        fn delete(&self, target: &str) {
            let name = HSTRING::from(target);
            // SAFETY: the name is NUL-terminated.
            let _ = unsafe { CredDeleteW(&name, CRED_TYPE_GENERIC, None) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_assistant_its_own_key() {
        assert_eq!(assistant_token("Claude Desktop"), "OpenNote/mcp/claude-desktop");
        assert_eq!(assistant_token("../evil\\name"), "OpenNote/mcp/evilname");
        assert_eq!(assistant_token("***"), "OpenNote/mcp/assistant");
        assert_eq!(unwrap_parts("1|abc"), Some("abc".into()));
        assert_eq!(unwrap_parts("2|abc"), None);
        assert_eq!(unwrap_parts("abc"), None);
    }
}
