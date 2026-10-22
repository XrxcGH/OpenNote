//! The optional full dictionary and thesaurus (Study tools). The app comes with a short starter list. If the person
//! says so, this downloads Open English WordNet (meanings, CC BY 4.0) and Moby Thesaurus II (related words, public
//! domain) from their official hosts. Each file's size and SHA-256 must match the values pinned here. Then it builds
//! a compact index on this device and deletes the downloads, and look-ups work offline.
//!
//! A download never starts by itself, never runs while Work offline or safe mode is on, and the data can be removed
//! at any time.

mod index;
#[cfg(test)]
mod tests;

use std::{
    fs, io,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, MutexGuard, PoisonError,
    },
    thread,
    time::Duration,
};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::intel::models::{download, Digest, DownloadError, HttpSource, ModelSpec, Part, Source};
use crate::ipc::{codes, IpcError, IpcResult};
use crate::paths::Paths;

/// Open English WordNet 2025, as the project's own release publishes it (the digest is GitHub's, and matches the
/// file's SHA-256). CC BY 4.0.
const OEWN: Part = Part {
    file: "oewn-2025.xml.gz",
    size: 11_363_503,
    digest: Digest::Sha256("9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe"),
    url: "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz",
};

/// Moby Thesaurus II from Project Gutenberg (ebook 3202), public domain. Gutenberg publishes no digest, so this one
/// was computed once from the file as served on 2026-10-21.
const MOBY: Part = Part {
    file: "mthesaur.txt",
    size: 24_853_275,
    digest: Digest::Sha256("7c9742b1ed94435a893c0719b426725edb8a5242f8c526a75461bd6cee2dfd32"),
    url: "https://www.gutenberg.org/files/3202/files/mthesaur.txt",
};

pub const SPEC: ModelSpec = ModelSpec {
    id: "dictionary",
    kind: "dictionary",
    name: "Full dictionary and thesaurus",
    detail: "Open English WordNet and Moby Thesaurus II",
    parts: &[OEWN, MOBY],
};

/// The only addresses a dictionary download may open.
const ALLOWED: &[&str] = &[
    "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/",
    "https://www.gutenberg.org/files/3202/files/",
];

/// Bumped when the index format changes, so an older index reads as not installed.
const INDEX_VERSION: u64 = 1;

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Downloading,
    Building,
}

struct Job {
    running: bool,
    phase: Phase,
    cancel: Arc<AtomicBool>,
    bytes: Arc<AtomicU64>,
    error: Option<&'static str>,
}

struct Inner {
    dir: PathBuf,
    source: Arc<dyn Source>,
    spec: &'static ModelSpec,
    job: Mutex<Option<Job>>,
}

/// The dictionary data of this device.
#[derive(Clone)]
pub struct Dictionary(Arc<Inner>);

impl Dictionary {
    pub fn new(paths: &Paths) -> Dictionary {
        Dictionary::with(
            paths.local.join("dictionary"),
            Arc::new(HttpSource::allowing(ALLOWED)),
            &SPEC,
        )
    }

    pub fn with(dir: PathBuf, source: Arc<dyn Source>, spec: &'static ModelSpec) -> Dictionary {
        Dictionary(Arc::new(Inner {
            dir,
            source,
            spec,
            job: Mutex::new(None),
        }))
    }

    fn job(&self) -> MutexGuard<'_, Option<Job>> {
        self.0.job.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn downloads(&self) -> PathBuf {
        self.0.dir.join("download")
    }

    fn index_dir(&self) -> PathBuf {
        self.0.dir.join("index")
    }

    /// The counts in the ready marker, when a complete index of this format is on disk.
    fn ready(&self) -> Option<(u64, u64)> {
        let text = fs::read_to_string(self.index_dir().join("ready.json")).ok()?;
        let marker: Value = serde_json::from_str(&text).ok()?;
        (marker["version"].as_u64()? == INDEX_VERSION).then(|| {
            (
                marker["words"].as_u64().unwrap_or(0),
                marker["related"].as_u64().unwrap_or(0),
            )
        })
    }

    /// What the interface shows: `notInstalled`, `partial`, `downloading`, `building`, `installed`, or `failed`.
    pub fn status(&self, offline: bool) -> Value {
        let total = self.0.spec.size();
        let job = self.job();
        let on_disk = || -> u64 {
            self.0
                .spec
                .parts
                .iter()
                .map(|part| {
                    let whole = self.downloads().join(part.file);
                    let mut partial = whole.clone().into_os_string();
                    partial.push(".part");
                    [whole, PathBuf::from(partial)]
                        .iter()
                        .find_map(|path| fs::metadata(path).ok().map(|meta| meta.len()))
                        .unwrap_or(0)
                })
                .sum()
        };
        let (state, bytes, error) = match job.as_ref() {
            Some(job) if job.running && job.phase == Phase::Building => ("building", total, None),
            Some(job) if job.running => ("downloading", job.bytes.load(Ordering::Relaxed), None),
            _ if self.ready().is_some() => ("installed", 0, None),
            Some(Job { error: Some(code), .. }) if *code != "canceled" => ("failed", on_disk(), Some(*code)),
            _ => match on_disk() {
                0 => ("notInstalled", 0, None),
                bytes => ("partial", bytes, None),
            },
        };
        let (words, related) = self.ready().unwrap_or((0, 0));
        json!({
            "state": state,
            "bytes": bytes,
            "totalBytes": total,
            "error": error,
            "words": words,
            "related": related,
            "offline": offline,
        })
    }

    /// Starts or resumes the download on a thread of its own. `blocked` says why none may run now.
    pub fn start(&self, blocked: Option<DownloadError>) -> Result<(), DownloadError> {
        if let Some(reason) = blocked {
            return Err(reason);
        }
        let (cancel, bytes) = {
            let mut job = self.job();
            if job.as_ref().is_some_and(|job| job.running) {
                return Ok(());
            }
            let cancel = Arc::new(AtomicBool::new(false));
            let bytes = Arc::new(AtomicU64::new(0));
            *job = Some(Job {
                running: true,
                phase: Phase::Downloading,
                cancel: cancel.clone(),
                bytes: bytes.clone(),
                error: None,
            });
            (cancel, bytes)
        };
        let this = self.clone();
        thread::Builder::new()
            .name("dictionary-download".to_owned())
            .spawn(move || {
                let result = this.run(&cancel, &bytes);
                if let Some(job) = this.job().as_mut() {
                    job.running = false;
                    job.error = result.err();
                }
            })
            .map_err(|error| DownloadError::Disk(error.to_string()))?;
        Ok(())
    }

    /// Downloads, builds, and cleans up. The error is the code the interface shows.
    fn run(&self, cancel: &AtomicBool, bytes: &AtomicU64) -> Result<(), &'static str> {
        let downloads = self.downloads();
        download(self.0.source.as_ref(), self.0.spec, &downloads, cancel, bytes).map_err(|error| error.code())?;
        if let Some(job) = self.job().as_mut() {
            job.phase = Phase::Building;
        }
        let building = self.0.dir.join("index.building");
        let _ = fs::remove_dir_all(&building);
        let built = index::build(
            &downloads.join(self.0.spec.parts[0].file),
            &downloads.join(self.0.spec.parts[1].file),
            &building,
        );
        let built = match built {
            Ok(built) => built,
            Err(error) => {
                let _ = fs::remove_dir_all(&building);
                // The files matched their checksums, so they are not worth keeping: the next try starts over.
                let _ = fs::remove_dir_all(&downloads);
                return Err(match error {
                    index::BuildError::Disk => "disk",
                    index::BuildError::Unreadable => "unreadable",
                });
            }
        };
        let marker = json!({ "version": INDEX_VERSION, "words": built.words, "related": built.related });
        fs::write(building.join("ready.json"), marker.to_string()).map_err(|_| "disk")?;
        let _ = fs::remove_dir_all(self.index_dir());
        fs::rename(&building, self.index_dir()).map_err(|_| "disk")?;
        let _ = fs::remove_dir_all(&downloads);
        Ok(())
    }

    /// Stops a running download and keeps the part that arrived, so the next start resumes.
    pub fn cancel(&self) {
        if let Some(job) = self.job().as_ref() {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Deletes the index and any download, after stopping a running one.
    pub fn remove(&self) -> Result<(), DownloadError> {
        self.cancel();
        for _ in 0..3100 {
            if !self.job().as_ref().is_some_and(|job| job.running) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if self.job().as_ref().is_some_and(|job| job.running) {
            return Err(DownloadError::Stopping);
        }
        match fs::remove_dir_all(&self.0.dir) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        *self.job() = None;
        Ok(())
    }

    /// One chunk of the index: its JSON text, or none when nothing is installed or the letter has no words.
    pub fn chunk(&self, set: &str, key: &str) -> io::Result<Option<String>> {
        let mut letters = key.chars();
        let (Some(letter), None) = (letters.next(), letters.next()) else {
            return Ok(None);
        };
        if !matches!(set, "en" | "thesaurus")
            || !(letter.is_ascii_lowercase() || letter == '_')
            || self.ready().is_none()
        {
            return Ok(None);
        }
        index::read_chunk(&self.index_dir(), set, letter)
    }
}

/// A call from the interface: the method and its arguments.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

fn download_error(error: &DownloadError) -> IpcError {
    let message = match error {
        DownloadError::Offline => "Work offline is on.",
        DownloadError::SafeMode => "Safe mode is on.",
        DownloadError::Stopping => "The download is still stopping.",
        _ => "The dictionary could not be downloaded.",
    };
    IpcError::new(error.code(), message)
}

impl Dictionary {
    /// Runs one method. `offline` and `safe_mode` come from the app, so tests can set them.
    pub fn call(&self, request: &Request, offline: bool, safe_mode: bool) -> Result<Value, IpcError> {
        match request.method.as_str() {
            "status" => Ok(self.status(offline)),
            "start" => {
                let blocked = if safe_mode {
                    Some(DownloadError::SafeMode)
                } else if offline {
                    Some(DownloadError::Offline)
                } else {
                    None
                };
                self.start(blocked).map_err(|error| download_error(&error))?;
                Ok(self.status(offline))
            }
            "cancel" => {
                self.cancel();
                Ok(self.status(offline))
            }
            "remove" => {
                self.remove().map_err(|error| download_error(&error))?;
                Ok(self.status(offline))
            }
            "chunk" => {
                let text = |key: &str| {
                    request.params.get(key).and_then(Value::as_str).ok_or_else(|| IpcError {
                        code: codes::INVALID.to_owned(),
                        message: "A text argument is missing.".to_owned(),
                        field: Some(key.to_owned()),
                    })
                };
                let chunk = self
                    .chunk(text("set")?, text("key")?)
                    .map_err(|error| IpcError::new(codes::IO, error.to_string()))?;
                Ok(json!(chunk))
            }
            _ => Err(IpcError::new(
                codes::NOT_IMPLEMENTED,
                "That dictionary call is not known.",
            )),
        }
    }
}

/// The dictionary data, as the app manages it.
pub struct DictionaryState(Dictionary);

impl DictionaryState {
    pub fn new(paths: &Paths) -> DictionaryState {
        DictionaryState(Dictionary::new(paths))
    }
}

/// The optional dictionary download and its index (see this module). One command, so a new method adds no permission.
#[tauri::command]
pub async fn dictionary_call(state: State<'_, DictionaryState>, request: Request) -> IpcResult<Value> {
    let dictionary = state.0.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        dictionary.call(&request, crate::hardening::offline(), crate::hardening::safe_mode())
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(IpcError::new(codes::INTERNAL, error.to_string())),
    }
}
