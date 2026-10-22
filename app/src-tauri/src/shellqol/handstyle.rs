//! My handwriting (flag `ink.myHandwriting`): the person's handwriting style, kept only on this device and encrypted.
//!
//! The style is the letters they wrote on the calibration page, with pressure and timing, and the measures of how
//! they write. It is never synced, exported, indexed, logged, or put in a crash report. The file lives in the local
//! (not roaming) folder, outside the notes folder, so neither sync, backups, nor the search index ever see it.
//! Nothing in this module logs the style or any error that could hold it.
//!
//! Only audited RustCrypto crates do the cryptography, with the scheme crates/interop/src/lock.rs uses:
//! XChaCha20-Poly1305 (`chacha20poly1305`) under a random 192 bit nonce from the operating system, with the header
//! as associated data. The 256 bit key is random and kept in Windows Credential Manager as a generic credential.
//! The key and every decrypted buffer are wiped when dropped (`zeroize`). A wrong key and a damaged file give the
//! same answer.
//!
//! Layout of the file: `ONHAND01`, a 24 byte nonce, then the ciphertext with its 16 byte Poly1305 tag at the end.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

use super::{arg, ok};
use crate::{
    connectors::{platform_store, Secret, SecretStore},
    ipc::{IpcError, IpcResult},
    paths::Paths,
};

/// The first bytes of the style file.
pub const MAGIC: &[u8; 8] = b"ONHAND01";
/// The folder in the local app data, and the file in it.
pub const FOLDER: &str = "handwriting";
pub const FILE: &str = "style.bin";
/// The credential that holds the key.
pub const KEY_TARGET: &str = "OpenNote/handwriting-style/key";
/// The largest style file read or written.
pub const MAX_BYTES: usize = 64 * 1024 * 1024;

const NONCE: usize = 24;
const TAG: usize = 16;
const HEADER: usize = MAGIC.len() + NONCE;

static LOCK: Mutex<()> = Mutex::new(());

/// Why the style could not be read or written. It never holds any of the style.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StyleError {
    /// The file is damaged, or the key is not the one it was written with.
    Unreadable,
    /// The key store or the disk refused.
    Unavailable,
    TooBig,
}

type Key = Zeroizing<[u8; 32]>;

fn cipher(key: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(key.into())
}

/// Encrypts `plain` with `key`.
pub fn seal(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, StyleError> {
    if plain.len() > MAX_BYTES {
        return Err(StyleError::TooBig);
    }
    let mut nonce = [0u8; NONCE];
    getrandom::fill(&mut nonce).map_err(|_| StyleError::Unavailable)?;
    let mut out = Vec::with_capacity(HEADER + plain.len() + TAG);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    let sealed = cipher(key)
        .encrypt(&XNonce::from(nonce), Payload { msg: plain, aad: &out })
        .map_err(|_| StyleError::Unavailable)?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Decrypts a sealed style. A wrong key and damaged bytes give the same error.
pub fn open(key: &[u8; 32], sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>, StyleError> {
    if sealed.len() > MAX_BYTES + HEADER + TAG {
        return Err(StyleError::TooBig);
    }
    if sealed.len() < HEADER + TAG || !sealed.starts_with(MAGIC) {
        return Err(StyleError::Unreadable);
    }
    let (header, body) = sealed.split_at(HEADER);
    let nonce: [u8; NONCE] = header[MAGIC.len()..].try_into().map_err(|_| StyleError::Unreadable)?;
    cipher(key)
        .decrypt(&XNonce::from(nonce), Payload { msg: body, aad: header })
        .map(Zeroizing::new)
        .map_err(|_| StyleError::Unreadable)
}

fn hex(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity(bytes.len() * 2));
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn unhex(text: &str) -> Option<Key> {
    let text = text.trim();
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let mut key = Zeroizing::new([0u8; 32]);
    for (i, slot) in key.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(key)
}

/// Where the style lives and where its key is kept.
pub struct StyleStore {
    file: PathBuf,
    keys: Arc<dyn SecretStore>,
}

impl StyleStore {
    pub fn new(local: &Path, keys: Arc<dyn SecretStore>) -> StyleStore {
        StyleStore {
            file: local.join(FOLDER).join(FILE),
            keys,
        }
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn key(&self, create: bool) -> Result<Option<Key>, StyleError> {
        let stored = self.keys.get(KEY_TARGET).map_err(|_| StyleError::Unavailable)?;
        if let Some(secret) = stored {
            return unhex(secret.expose()).map(Some).ok_or(StyleError::Unreadable);
        }
        if !create {
            return Ok(None);
        }
        let mut key = Zeroizing::new([0u8; 32]);
        getrandom::fill(key.as_mut()).map_err(|_| StyleError::Unavailable)?;
        let text = hex(key.as_ref());
        self.keys
            .put(KEY_TARGET, &Secret::new(text.as_str()))
            .map_err(|_| StyleError::Unavailable)?;
        Ok(Some(key))
    }

    /// The stored document, or None when there is none yet.
    pub fn load(&self) -> Result<Option<Zeroizing<Vec<u8>>>, StyleError> {
        let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let sealed = match fs::read(&self.file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(StyleError::Unavailable),
        };
        let Some(key) = self.key(false)? else {
            // A file with no key can never be read again.
            return Err(StyleError::Unreadable);
        };
        open(&key, &sealed).map(Some)
    }

    /// Encrypts and writes the document, replacing the file in one step.
    pub fn save(&self, plain: &[u8]) -> Result<(), StyleError> {
        let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        let key = self.key(true)?.ok_or(StyleError::Unavailable)?;
        let sealed = seal(&key, plain)?;
        let dir = self.file.parent().ok_or(StyleError::Unavailable)?;
        fs::create_dir_all(dir).map_err(|_| StyleError::Unavailable)?;
        let temp = dir.join(format!("{FILE}.tmp"));
        let mut out = fs::File::create(&temp).map_err(|_| StyleError::Unavailable)?;
        out.write_all(&sealed).map_err(|_| StyleError::Unavailable)?;
        out.sync_all().map_err(|_| StyleError::Unavailable)?;
        drop(out);
        fs::rename(&temp, &self.file).map_err(|_| StyleError::Unavailable)
    }

    /// Deletes the style and its key, so nothing of it can be read again.
    pub fn delete(&self) -> Result<(), StyleError> {
        let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(dir) = self.file.parent() {
            match fs::remove_dir_all(dir) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(StyleError::Unavailable),
            }
        }
        self.keys.delete(KEY_TARGET).map_err(|_| StyleError::Unavailable)
    }
}

fn store(app: &AppHandle) -> StyleStore {
    StyleStore::new(&app.state::<Paths>().local, platform_store())
}

fn failed(error: StyleError) -> IpcError {
    // The code only: never the style, a path, or the reason a system call gave.
    let code = match error {
        StyleError::Unreadable => "unreadable",
        StyleError::Unavailable => "unavailable",
        StyleError::TooBig => "tooBig",
    };
    IpcError::new(code, "the handwriting style could not be used".to_owned())
}

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    let store = store(app);
    match name {
        "handstyle.load" => match store.load() {
            Ok(None) => Ok(json!({ "state": "none" })),
            Ok(Some(plain)) => match serde_json::from_slice::<Value>(&plain) {
                Ok(doc) => Ok(json!({ "state": "ok", "doc": doc })),
                Err(_) => Ok(json!({ "state": "unreadable" })),
            },
            Err(StyleError::Unreadable) => Ok(json!({ "state": "unreadable" })),
            Err(error) => Err(failed(error)),
        },
        "handstyle.save" => {
            let doc: Value = arg(args, "doc")?;
            let plain = Zeroizing::new(serde_json::to_vec(&doc).map_err(|_| failed(StyleError::Unavailable))?);
            store.save(&plain).map_err(failed)?;
            ok()
        }
        "handstyle.delete" => {
            store.delete().map_err(failed)?;
            ok()
        }
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a shell call"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::MemoryStore;

    const STYLE: &[u8] = br#"{"version":1,"style":{"glyphs":{"a":[{"strokes":[[0.1,0.2,0.5,0]]}]}}}"#;

    #[test]
    fn a_style_seals_and_opens_with_its_key() {
        let key = [7u8; 32];
        let sealed = seal(&key, STYLE).expect("sealed");
        assert!(sealed.starts_with(MAGIC));
        assert_eq!(&open(&key, &sealed).expect("opened")[..], STYLE);
        // A fresh nonce each time, so the same style never seals to the same bytes.
        assert_ne!(seal(&key, STYLE).expect("sealed"), sealed);
    }

    #[test]
    fn a_wrong_key_and_damage_both_fail_the_same_way() {
        let sealed = seal(&[1u8; 32], STYLE).expect("sealed");
        assert_eq!(open(&[2u8; 32], &sealed).unwrap_err(), StyleError::Unreadable);
        for at in [0, MAGIC.len(), HEADER, sealed.len() - 1] {
            let mut damaged = sealed.clone();
            damaged[at] ^= 1;
            assert_eq!(open(&[1u8; 32], &damaged).unwrap_err(), StyleError::Unreadable);
        }
        assert_eq!(open(&[1u8; 32], &sealed[..HEADER]).unwrap_err(), StyleError::Unreadable);
        assert_eq!(open(&[1u8; 32], b"").unwrap_err(), StyleError::Unreadable);
    }

    #[test]
    fn the_file_on_disk_holds_none_of_the_style() {
        let dir = tempfile::tempdir().expect("temp");
        let store = StyleStore::new(dir.path(), Arc::new(MemoryStore::default()));
        store.save(STYLE).expect("saved");
        let bytes = fs::read(store.file()).expect("file");
        assert!(bytes.starts_with(MAGIC));
        for needle in [&b"glyphs"[..], b"strokes", b"version", b"0.5"] {
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "plain text in the file"
            );
        }
        assert_eq!(&store.load().expect("loaded").expect("some")[..], STYLE);
        // The file is under the local folder, never beside the notes or the roaming settings.
        assert!(store.file().starts_with(dir.path().join(FOLDER)));
    }

    #[test]
    fn a_file_without_its_key_or_a_different_key_cannot_be_read() {
        let dir = tempfile::tempdir().expect("temp");
        let keys = Arc::new(MemoryStore::default());
        let store = StyleStore::new(dir.path(), keys.clone());
        store.save(STYLE).expect("saved");
        keys.delete(KEY_TARGET).expect("deleted");
        assert_eq!(store.load().unwrap_err(), StyleError::Unreadable);
        keys.put(KEY_TARGET, &Secret::new("00".repeat(32))).expect("put");
        assert_eq!(store.load().unwrap_err(), StyleError::Unreadable);
        keys.put(KEY_TARGET, &Secret::new("not hex")).expect("put");
        assert_eq!(store.load().unwrap_err(), StyleError::Unreadable);
    }

    #[test]
    fn delete_removes_the_file_and_the_key() {
        let dir = tempfile::tempdir().expect("temp");
        let keys = Arc::new(MemoryStore::default());
        let store = StyleStore::new(dir.path(), keys.clone());
        assert!(store.load().expect("nothing yet").is_none());
        store.save(STYLE).expect("saved");
        store.delete().expect("deleted");
        assert!(!store.file().exists());
        assert!(keys.get(KEY_TARGET).expect("read").is_none());
        assert!(store.load().expect("nothing").is_none());
        store.delete().expect("deleting twice is fine");
    }

    #[test]
    fn errors_name_no_part_of_the_style() {
        let error = failed(StyleError::Unreadable);
        let text = format!("{error:?}");
        assert!(!text.contains("glyph"));
        assert!(text.contains("unreadable"));
    }

    #[test]
    fn keys_round_trip_through_hex() {
        let key = [0xabu8; 32];
        assert_eq!(*unhex(&hex(&key)).expect("key"), key);
        assert!(unhex("abc").is_none());
    }
}
