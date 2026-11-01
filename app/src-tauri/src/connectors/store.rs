//! Where the secrets live: the system's own credential store, under names like `OpenNote/<connector>/<account>`.
//! On Windows that is Credential Manager (generic credentials), on a Mac the login Keychain (generic passwords of
//! the service `OpenNote`), and on Linux the Secret Service over D-Bus (GNOME Keyring or KWallet). This is the only
//! place a token, a refresh token, a pasted personal token, or a sync key is kept. They never go into the notes
//! folder, the settings files, the connections file, a log, a crash report, or the feedback file. The same trait has
//! a memory store for tests and for a Linux desktop with no Secret Service running, where a secret lasts until the
//! app exits and the connection then reads as "Sign-in expired".

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, PoisonError},
};

use super::secret::Secret;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreError;

pub trait SecretStore: Send + Sync {
    fn put(&self, target: &str, secret: &Secret) -> Result<(), StoreError>;
    fn get(&self, target: &str) -> Result<Option<Secret>, StoreError>;
    /// Removes the secret. A secret that isn't there is not an error.
    fn delete(&self, target: &str) -> Result<(), StoreError>;

    /// Whether a secret is still there after the app restarts. Sync is set up only with a store that keeps them.
    fn keeps_secrets(&self) -> bool {
        false
    }

    /// Where the secrets are kept, written to start a sentence, for the messages that say a store failed.
    fn place(&self) -> &'static str {
        "This computer's credential store"
    }
}

/// The credential name for a connector's account. Control characters are dropped and a long name is cut, so the
/// name is always one a credential can have.
pub fn target_name(connector: &str, account: &str) -> String {
    let account: String = account.chars().filter(|c| !c.is_control()).take(100).collect();
    let account = account.trim();
    let account = if account.is_empty() { "default" } else { account };
    format!("OpenNote/{connector}/{account}")
}

/// The store this system has.
pub fn platform_store() -> Arc<dyn SecretStore> {
    #[cfg(windows)]
    {
        Arc::new(windows_store::WindowsStore)
    }
    #[cfg(target_os = "macos")]
    {
        Arc::new(keychain_store::KeychainStore)
    }
    #[cfg(target_os = "linux")]
    {
        if secret_service_store::SecretServiceStore::available() {
            Arc::new(secret_service_store::SecretServiceStore)
        } else {
            Arc::new(MemoryStore::default())
        }
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Arc::new(MemoryStore::default())
    }
}

#[derive(Default)]
pub struct MemoryStore {
    secrets: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn put(&self, target: &str, secret: &Secret) -> Result<(), StoreError> {
        let mut secrets = self.secrets.lock().unwrap_or_else(PoisonError::into_inner);
        secrets.insert(target.to_owned(), secret.expose().to_owned());
        Ok(())
    }

    fn get(&self, target: &str) -> Result<Option<Secret>, StoreError> {
        let secrets = self.secrets.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(secrets.get(target).map(Secret::new))
    }

    fn delete(&self, target: &str) -> Result<(), StoreError> {
        self.secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(target);
        Ok(())
    }
}

#[cfg(windows)]
mod windows_store {
    //! A credential holds at most 2,560 bytes, and a Microsoft refresh token can come close. A longer secret is
    //! split over `<target>`, `<target>#1`, and so on. The first part starts with the number of parts and a bar.

    use windows::{
        core::{HRESULT, HSTRING, PWSTR},
        Win32::{
            Foundation::ERROR_NOT_FOUND,
            Security::Credentials::{
                CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
                CRED_TYPE_GENERIC,
            },
        },
    };

    use super::{Secret, SecretStore, StoreError};

    /// Bytes of secret per credential, well under the limit.
    const PART_BYTES: usize = 1800;
    /// The most parts a secret can have. A count above this in a stored value means the value is not ours.
    const MAX_PARTS: usize = 16;

    pub struct WindowsStore;

    fn part_target(target: &str, index: usize) -> String {
        if index == 0 {
            target.to_owned()
        } else {
            format!("{target}#{index}")
        }
    }

    fn split(text: &str) -> Vec<&str> {
        let mut parts = Vec::new();
        let mut rest = text;
        while rest.len() > PART_BYTES {
            let cut = (0..=PART_BYTES)
                .rev()
                .find(|&at| rest.is_char_boundary(at))
                .unwrap_or(0);
            let (head, tail) = rest.split_at(cut);
            parts.push(head);
            rest = tail;
        }
        parts.push(rest);
        parts
    }

    fn write_one(target: &str, text: &str) -> Result<(), StoreError> {
        let mut name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let mut user: Vec<u16> = "OpenNote".encode_utf16().chain(Some(0)).collect();
        let mut blob = text.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(name.as_mut_ptr()),
            UserName: PWSTR(user.as_mut_ptr()),
            CredentialBlobSize: u32::try_from(blob.len()).map_err(|_| StoreError)?,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // SAFETY: the credential points at buffers that live until the call returns, and the name and the user
        // name end with a null character. Windows copies everything before CredWriteW returns.
        unsafe { CredWriteW(&credential, 0) }.map_err(|_| StoreError)
    }

    fn read_one(target: &str) -> Result<Option<String>, StoreError> {
        let name = HSTRING::from(target);
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: `found` is a valid place for Windows to put a pointer, and the name is NUL-terminated.
        match unsafe { CredReadW(&name, CRED_TYPE_GENERIC, None, &mut found) } {
            Ok(()) => {
                // SAFETY: CredReadW succeeded, so `found` points at a credential that stays valid until CredFree.
                let text = unsafe {
                    let credential = &*found;
                    let bytes = if credential.CredentialBlob.is_null() {
                        &[][..]
                    } else {
                        std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize)
                    };
                    let text = String::from_utf8(bytes.to_vec());
                    CredFree(found.cast());
                    text
                };
                text.map(Some).map_err(|_| StoreError)
            }
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(None),
            Err(_) => Err(StoreError),
        }
    }

    fn delete_one(target: &str) -> Result<(), StoreError> {
        let name = HSTRING::from(target);
        // SAFETY: the name is NUL-terminated.
        match unsafe { CredDeleteW(&name, CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
            Err(_) => Err(StoreError),
        }
    }

    /// How many parts the stored value has, from the first part. None when there is no first part.
    fn stored_parts(target: &str) -> Result<Option<(usize, String)>, StoreError> {
        let Some(first) = read_one(target)? else {
            return Ok(None);
        };
        let (count, rest) = first.split_once('|').ok_or(StoreError)?;
        let count: usize = count.parse().map_err(|_| StoreError)?;
        if count == 0 || count > MAX_PARTS {
            return Err(StoreError);
        }
        Ok(Some((count, rest.to_owned())))
    }

    impl SecretStore for WindowsStore {
        fn put(&self, target: &str, secret: &Secret) -> Result<(), StoreError> {
            // When the old first part can't be read, its count is unknown, so every possible part goes.
            let old = match stored_parts(target) {
                Ok(Some((count, _))) => count,
                Ok(None) => 0,
                Err(_) => MAX_PARTS,
            };
            let parts = split(secret.expose());
            if parts.len() > MAX_PARTS {
                return Err(StoreError);
            }
            for (index, part) in parts.iter().enumerate().skip(1) {
                write_one(&part_target(target, index), part)?;
            }
            write_one(target, &format!("{}|{}", parts.len(), parts[0]))?;
            for index in parts.len()..old {
                delete_one(&part_target(target, index))?;
            }
            Ok(())
        }

        fn get(&self, target: &str) -> Result<Option<Secret>, StoreError> {
            let Some((count, mut text)) = stored_parts(target)? else {
                return Ok(None);
            };
            for index in 1..count {
                text.push_str(&read_one(&part_target(target, index))?.ok_or(StoreError)?);
            }
            Ok(Some(Secret::new(text)))
        }

        fn delete(&self, target: &str) -> Result<(), StoreError> {
            let count = match stored_parts(target) {
                Ok(Some((count, _))) => count,
                Ok(None) => 1,
                Err(_) => MAX_PARTS,
            };
            for index in (0..count).rev() {
                delete_one(&part_target(target, index))?;
            }
            Ok(())
        }

        fn keeps_secrets(&self) -> bool {
            true
        }

        fn place(&self) -> &'static str {
            "Windows Credential Manager"
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn splits_on_character_boundaries_and_rejoins() {
            let text = "é".repeat(2000);
            let parts = split(&text);
            assert!(parts.iter().all(|part| part.len() <= PART_BYTES));
            assert_eq!(parts.concat(), text);
            assert_eq!(split("short"), vec!["short"]);
        }
    }
}

#[cfg(target_os = "macos")]
mod keychain_store {
    //! The login Keychain. Each secret is a generic password of the service `OpenNote` whose account is the
    //! target name. A Keychain item holds a long refresh token whole, so nothing is split.

    use security_framework::base::Error;
    use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};
    use zeroize::Zeroizing;

    use super::{Secret, SecretStore, StoreError};

    const SERVICE: &str = "OpenNote";
    /// `errSecItemNotFound`.
    const NOT_FOUND: i32 = -25300;

    pub struct KeychainStore;

    fn missing(error: &Error) -> bool {
        error.code() == NOT_FOUND
    }

    impl SecretStore for KeychainStore {
        fn put(&self, target: &str, secret: &Secret) -> Result<(), StoreError> {
            // An item that is already there is updated in place.
            set_generic_password(SERVICE, target, secret.expose().as_bytes()).map_err(|_| StoreError)
        }

        fn get(&self, target: &str) -> Result<Option<Secret>, StoreError> {
            match get_generic_password(SERVICE, target) {
                Ok(bytes) => {
                    let bytes = Zeroizing::new(bytes);
                    let text = std::str::from_utf8(&bytes).map_err(|_| StoreError)?;
                    Ok(Some(Secret::new(text)))
                }
                Err(error) if missing(&error) => Ok(None),
                Err(_) => Err(StoreError),
            }
        }

        fn delete(&self, target: &str) -> Result<(), StoreError> {
            match delete_generic_password(SERVICE, target) {
                Ok(()) => Ok(()),
                Err(error) if missing(&error) => Ok(()),
                Err(_) => Err(StoreError),
            }
        }

        fn keeps_secrets(&self) -> bool {
            true
        }

        fn place(&self) -> &'static str {
            "The Keychain"
        }
    }
}

#[cfg(target_os = "linux")]
mod secret_service_store {
    //! The Secret Service, the freedesktop.org keyring that GNOME Keyring and KWallet provide over D-Bus. Each secret
    //! is an item of the default collection with the attributes `application=OpenNote` and `target=<target>`. A
    //! locked collection or item is unlocked first, which may show the desktop's own unlock prompt.

    use std::collections::HashMap;

    use secret_service::blocking::SecretService;
    use secret_service::EncryptionType;
    use zeroize::Zeroizing;

    use super::{Secret, SecretStore, StoreError};

    pub struct SecretServiceStore;

    fn attributes(target: &str) -> HashMap<&str, &str> {
        HashMap::from([("application", "OpenNote"), ("target", target)])
    }

    fn connect() -> Result<SecretService<'static>, StoreError> {
        SecretService::connect(EncryptionType::Dh).map_err(|_| StoreError)
    }

    impl SecretServiceStore {
        /// Whether a Secret Service answers on the session bus. A desktop without one keeps secrets in memory.
        pub fn available() -> bool {
            connect().is_ok_and(|service| service.get_default_collection().is_ok())
        }
    }

    impl SecretStore for SecretServiceStore {
        fn put(&self, target: &str, secret: &Secret) -> Result<(), StoreError> {
            let service = connect()?;
            let collection = service.get_default_collection().map_err(|_| StoreError)?;
            collection.ensure_unlocked().map_err(|_| StoreError)?;
            // `replace` swaps an item with the same attributes for the new one.
            collection
                .create_item(
                    &format!("OpenNote: {target}"),
                    attributes(target),
                    secret.expose().as_bytes(),
                    true,
                    "text/plain",
                )
                .map(|_| ())
                .map_err(|_| StoreError)
        }

        fn get(&self, target: &str) -> Result<Option<Secret>, StoreError> {
            let service = connect()?;
            let found = service.search_items(attributes(target)).map_err(|_| StoreError)?;
            let Some(item) = found.unlocked.first().or(found.locked.first()) else {
                return Ok(None);
            };
            item.ensure_unlocked().map_err(|_| StoreError)?;
            let bytes = Zeroizing::new(item.get_secret().map_err(|_| StoreError)?);
            let text = std::str::from_utf8(&bytes).map_err(|_| StoreError)?;
            Ok(Some(Secret::new(text)))
        }

        fn delete(&self, target: &str) -> Result<(), StoreError> {
            let service = connect()?;
            let found = service.search_items(attributes(target)).map_err(|_| StoreError)?;
            for item in found.unlocked.iter().chain(&found.locked) {
                item.ensure_unlocked().map_err(|_| StoreError)?;
                item.delete().map_err(|_| StoreError)?;
            }
            Ok(())
        }

        fn keeps_secrets(&self) -> bool {
            true
        }

        fn place(&self) -> &'static str {
            "The system keyring"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The round trip every store must pass: put, get, replace, delete, and a missing secret.
    pub(super) fn round_trip(store: &dyn SecretStore, target: &str) {
        assert_eq!(store.get(target), Ok(None));
        let first = Secret::new("first-secret-value");
        store.put(target, &first).expect("stores");
        assert_eq!(store.get(target), Ok(Some(first)));
        let longer = Secret::new(format!("{}é", "x".repeat(4500)));
        store.put(target, &longer).expect("replaces with a longer secret");
        assert_eq!(store.get(target), Ok(Some(longer)));
        let shorter = Secret::new("short");
        store.put(target, &shorter).expect("replaces with a shorter secret");
        assert_eq!(store.get(target), Ok(Some(shorter)));
        store.delete(target).expect("deletes");
        assert_eq!(store.get(target), Ok(None));
        store.delete(target).expect("deleting what isn't there is fine");
    }

    #[test]
    fn names_follow_opennote_connector_account() {
        assert_eq!(
            target_name("google", "sam@example.com"),
            "OpenNote/google/sam@example.com"
        );
        assert_eq!(target_name("readwise", ""), "OpenNote/readwise/default");
        assert_eq!(target_name("slack", "Team\nName"), "OpenNote/slack/TeamName");
        assert_eq!(
            target_name("slack", &"a".repeat(300)).len(),
            "OpenNote/slack/".len() + 100
        );
    }

    #[test]
    fn the_memory_store_round_trips() {
        round_trip(&MemoryStore::default(), "OpenNote/test/memory");
    }

    #[test]
    fn only_a_system_store_says_it_keeps_secrets() {
        assert!(!MemoryStore::default().keeps_secrets());
        // Windows and macOS always have their store. Linux has one only when a Secret Service is running.
        if cfg!(any(windows, target_os = "macos")) {
            assert!(platform_store().keeps_secrets());
        }
    }

    #[test]
    fn two_connectors_keep_separate_secrets() {
        let store = MemoryStore::default();
        store.put("OpenNote/a/x", &Secret::new("one")).expect("stores");
        store.put("OpenNote/b/x", &Secret::new("two")).expect("stores");
        store.delete("OpenNote/a/x").expect("deletes");
        assert_eq!(store.get("OpenNote/b/x"), Ok(Some(Secret::new("two"))));
    }

    /// The real Credential Manager, under a name no connector uses, removed at the end.
    #[cfg(windows)]
    #[test]
    fn windows_credential_manager_round_trips() {
        let target = format!("OpenNote-test/{}/round-trip", std::process::id());
        let store = windows_store::WindowsStore;
        round_trip(&store, &target);
        store.delete(&target).expect("cleans up");
    }

    /// The real Keychain, under a name no connector uses, removed at the end.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_keychain_round_trips() {
        let target = format!("OpenNote-test/{}/round-trip", std::process::id());
        let store = keychain_store::KeychainStore;
        round_trip(&store, &target);
        store.delete(&target).expect("cleans up");
    }

    /// The real Secret Service when the session has one. A build machine without a desktop has none.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_secret_service_round_trips_when_there_is_one() {
        if !secret_service_store::SecretServiceStore::available() {
            assert!(
                !platform_store().keeps_secrets(),
                "without a Secret Service, secrets stay in memory"
            );
            return;
        }
        let target = format!("OpenNote-test/{}/round-trip", std::process::id());
        let store = secret_service_store::SecretServiceStore;
        round_trip(&store, &target);
        store.delete(&target).expect("cleans up");
    }
}
