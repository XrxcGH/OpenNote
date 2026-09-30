//! Fakes for the unit tests. Keys are made in memory for each test, and signatures use the same mode and trusted
//! comment layout as `tauri signer sign`. A fetcher serves from memory, and a clock stands still. No private key
//! is ever written to disk or the repository.

use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::PublicKey;
use semver::Version;

use crate::{
    config::{Channel, ChannelUrls, Config, Limits, UpdaterDirs},
    fetch::{Fetch, FetchError, FetchOutcome, Url},
    platform::PlatformKey,
    schedule::Clock,
    swap::Replacer,
};

pub struct Signer {
    pair: minisign::KeyPair,
}

impl Signer {
    pub fn new() -> Self {
        Self {
            pair: minisign::KeyPair::generate_unencrypted_keypair().expect("a key pair"),
        }
    }

    /// The public key as minisign text: an untrusted comment line, then the key.
    pub fn public_text(&self) -> String {
        self.pair.pk.to_box().expect("a public key box").into_string()
    }

    pub fn public(&self) -> PublicKey {
        PublicKey::decode(&self.public_text()).expect("a public key")
    }
}

/// A prehashed signature of `data` with the trusted comment `comment`, as the base64 `.sig` text the manifest holds.
pub fn sign(signer: &Signer, data: &[u8], comment: &str) -> String {
    let signature = minisign::sign(
        Some(&signer.pair.pk),
        &signer.pair.sk,
        data,
        Some(comment),
        Some("signature from tauri secret key"),
    )
    .expect("signs");
    STANDARD.encode(signature.to_string())
}

/// The trusted comment `tauri signer sign --app-version <version>` writes for `file`.
pub fn comment(version: &str, file: &str) -> String {
    format!("timestamp:1790757747\tfile:{file}\tversion:{version}")
}

/// Serves files from memory by URL. A URL it doesn't have fails as unreachable.
#[derive(Default)]
pub struct MemoryFetch {
    files: Mutex<HashMap<String, Vec<u8>>>,
}

impl MemoryFetch {
    pub fn serve(&self, url: &str, bytes: impl Into<Vec<u8>>) {
        self.files.lock().expect("lock").insert(url.to_owned(), bytes.into());
    }
}

impl Fetch for MemoryFetch {
    fn get(&self, url: &Url, max_bytes: u64, sink: &mut dyn Write) -> Result<FetchOutcome, FetchError> {
        let files = self.files.lock().expect("lock");
        let bytes = files
            .get(url.as_str())
            .ok_or_else(|| FetchError::Unreachable(format!("no file at {url}")))?;
        if bytes.len() as u64 > max_bytes {
            return Err(FetchError::TooLarge { limit: max_bytes });
        }
        sink.write_all(bytes)?;
        Ok(FetchOutcome {
            bytes: bytes.len() as u64,
        })
    }
}

/// A clock stopped at 2026-10-14 18:05:00 UTC.
pub struct FixedClock(pub SystemTime);

impl Default for FixedClock {
    fn default() -> Self {
        Self(UNIX_EPOCH + Duration::from_secs(1_792_001_100))
    }
}

impl Clock for FixedClock {
    fn now(&self) -> SystemTime {
        self.0
    }
}

/// How a [`FolderReplacer`] swap fails, when it does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// Nothing changed: the exe couldn't be renamed aside.
    BeforeRename,
    /// The exe was renamed aside, and the new copy never arrived, so the exe path is empty.
    AfterRename,
}

/// Swaps an exe in a temporary folder the way `self_replace` does on Windows: the exe is renamed aside, then the
/// new copy is put at its path. It can fail at either step.
pub struct FolderReplacer {
    pub exe: PathBuf,
    pub failure: Mutex<Option<Failure>>,
}

impl FolderReplacer {
    pub fn new(exe: PathBuf) -> Self {
        Self {
            exe,
            failure: Mutex::new(None),
        }
    }
}

impl Replacer for FolderReplacer {
    fn current_exe(&self) -> io::Result<PathBuf> {
        Ok(self.exe.clone())
    }

    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()> {
        let failure = *self.failure.lock().expect("lock");
        if failure == Some(Failure::BeforeRename) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "the exe is locked"));
        }
        fs::rename(&self.exe, self.exe.with_extension("relocated.exe"))?;
        if failure == Some(Failure::AfterRename) {
            return Err(io::Error::other("antivirus took the new copy"));
        }
        fs::copy(staged_next_to_exe, &self.exe).map(|_| ())
    }
}

pub const STABLE_URL: &str = "https://updates.test/latest.json";
pub const BETA_URL: &str = "https://updates.test/beta.json";

/// A configuration for a copy running `current` on x64, with its folders under `root`.
pub fn config(root: &Path, current: &str, channel: Channel, keys: Vec<PublicKey>) -> Config {
    Config {
        current: Version::parse(current).expect("a version"),
        platform: PlatformKey::WindowsX86_64,
        channel,
        urls: ChannelUrls {
            stable: Url::parse(STABLE_URL).expect("https"),
            beta: Url::parse(BETA_URL).expect("https"),
        },
        trusted_keys: keys,
        dirs: UpdaterDirs {
            updates: root.join("updates"),
            previous: root.join("previous"),
            exe_dir: root.join("app"),
        },
        limits: Limits::default(),
    }
}
