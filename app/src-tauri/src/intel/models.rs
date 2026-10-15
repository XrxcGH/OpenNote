//! Model downloads (Phase 12): the speech models, the language models for Ask and the writing tools, the meaning
//! model, and the translation packs. A download starts only when the person chose it after seeing the size. It
//! resumes where it stopped, checks each file against a published checksum and size before it keeps it, and never
//! runs while Work offline or safe mode is on. Files go in this device's folder, so a portable install keeps them
//! beside its profile. The crate behind the other commands holds no network code, so this is the one place a model
//! can come from, and only from the pinned addresses in the catalog.

use std::collections::HashMap;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use super::catalog;

/// How a downloaded file is checked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Digest {
    /// The SHA-256 of the file, in hex.
    Sha256(&'static str),
    /// The git blob hash of the file, in hex: SHA-1 over `blob <size>`, a zero byte, and the bytes. Hugging Face
    /// publishes only this for a small file it keeps outside its large-file storage.
    GitBlob(&'static str),
}

impl Digest {
    fn hex(self) -> &'static str {
        match self {
            Digest::Sha256(hex) | Digest::GitBlob(hex) => hex,
        }
    }
}

/// One file of a model.
#[derive(Debug)]
pub struct Part {
    /// The path under the models folder.
    pub file: &'static str,
    /// The exact size. A server that sends more is cut off, so this is also the cap.
    pub size: u64,
    pub digest: Digest,
    pub url: &'static str,
}

/// One model the person can download.
#[derive(Debug)]
pub struct ModelSpec {
    pub id: &'static str,
    /// What it is for: `speech`, `language`, `meaning`, or `translate`.
    pub kind: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub parts: &'static [Part],
}

impl ModelSpec {
    /// All the bytes the model takes.
    pub fn size(&self) -> u64 {
        self.parts.iter().map(|part| part.size).sum()
    }

    /// The model's first file, the one a runtime opens.
    pub fn main(&self) -> &'static Part {
        &self.parts[0]
    }
}

/// The largest model the catalog may hold, as a guard against a typo in a size.
#[cfg(test)]
pub const MAX_MODEL_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[cfg(test)]
const SPEECH_HOST: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

macro_rules! speech {
    ($id:literal, $name:literal, $detail:literal, $size:literal, $sha:literal, $file:literal) => {
        ModelSpec {
            id: $id,
            kind: "speech",
            name: $name,
            detail: $detail,
            parts: &[Part {
                file: $file,
                size: $size,
                digest: Digest::Sha256($sha),
                url: concat!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/", $file),
            }],
        }
    };
}

/// The speech models, with the sizes and checksums Hugging Face publishes for each file.
const SPEECH: &[ModelSpec] = &[
    speech!(
        "speech-tiny-en",
        "Speech, smallest (English)",
        "Fastest. Good for clear voices.",
        77_704_715,
        "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        "ggml-tiny.en.bin"
    ),
    speech!(
        "speech-base-en",
        "Speech, balanced (English)",
        "A good mix of speed and accuracy. Recommended.",
        147_964_211,
        "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        "ggml-base.en.bin"
    ),
    speech!(
        "speech-small-en",
        "Speech, accurate (English)",
        "Most accurate for English, and slower.",
        487_614_201,
        "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        "ggml-small.en.bin"
    ),
    speech!(
        "speech-base",
        "Speech, balanced (many languages)",
        "Understands many languages, and detects which one is spoken.",
        147_951_465,
        "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        "ggml-base.bin"
    ),
    speech!(
        "speech-small",
        "Speech, accurate (many languages)",
        "Most accurate across languages, and slower.",
        487_601_967,
        "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        "ggml-small.bin"
    ),
];

/// Every model, speech first.
pub fn catalog() -> impl Iterator<Item = &'static ModelSpec> {
    SPEECH
        .iter()
        .chain(catalog::LANGUAGE)
        .chain(catalog::MEANING)
        .chain(catalog::TRANSLATE)
}

/// The model with this ID.
pub fn spec_of(id: &str) -> Option<&'static ModelSpec> {
    catalog().find(|spec| spec.id == id)
}

/// Why a download did not finish. The interface picks its own words from the code.
#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
    Canceled,
    Offline,
    SafeMode,
    Network(String),
    Disk(String),
    Checksum,
    /// A download is still winding down, so the model can't be removed yet.
    Stopping,
}

impl DownloadError {
    pub fn code(&self) -> &'static str {
        match self {
            DownloadError::Canceled => "canceled",
            DownloadError::Offline => "offline",
            DownloadError::SafeMode => "safeMode",
            DownloadError::Network(_) => "network",
            DownloadError::Disk(_) => "disk",
            DownloadError::Checksum => "checksum",
            DownloadError::Stopping => "stopping",
        }
    }
}

impl From<io::Error> for DownloadError {
    fn from(error: io::Error) -> Self {
        DownloadError::Disk(error.to_string())
    }
}

/// How many 20 ms steps `remove` waits for a download to stop: a little over the 60 s read timeout.
const REMOVE_WAIT_STEPS: u32 = 3100;

mod download;
mod source;
#[cfg(test)]
mod tests;

pub use self::download::{download, is_installed};
use self::download::{part_path, size_of};
#[cfg(test)]
use self::source::Opened;
pub use self::source::{HttpSource, Source};

/// How one model looks to the interface.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
    pub id: &'static str,
    pub kind: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub size_bytes: u64,
    /// `notInstalled`, `partial`, `downloading`, `installed`, or `failed`.
    pub state: &'static str,
    /// Bytes on disk or downloaded so far.
    pub bytes: u64,
    /// The code of the last failure, for `failed`.
    pub error: Option<&'static str>,
}

/// The list the interface shows, with when a download last ran.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelList {
    pub models: Vec<ModelView>,
    /// Seconds since 1970 when a download last started, or none.
    pub last_ran_unix: Option<u64>,
}

struct Job {
    cancel: Arc<AtomicBool>,
    bytes: Arc<AtomicU64>,
    running: bool,
    error: Option<&'static str>,
}

struct Inner {
    dir: PathBuf,
    source: Arc<dyn Source>,
    jobs: Mutex<HashMap<&'static str, Job>>,
}

/// The downloads of this device, one at a time for each model.
#[derive(Clone)]
pub struct Models(Arc<Inner>);

impl Models {
    pub fn new(dir: PathBuf) -> Models {
        Models::with_source(dir, Arc::new(HttpSource))
    }

    pub fn with_source(dir: PathBuf, source: Arc<dyn Source>) -> Models {
        Models(Arc::new(Inner {
            dir,
            source,
            jobs: Mutex::new(HashMap::new()),
        }))
    }

    fn jobs(&self) -> std::sync::MutexGuard<'_, HashMap<&'static str, Job>> {
        self.0.jobs.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn last_ran_file(&self) -> PathBuf {
        self.0.dir.join("last-ran.txt")
    }

    /// The folder the models are in.
    pub fn dir(&self) -> &Path {
        &self.0.dir
    }

    /// The path of the model's first file, if the whole model is on disk.
    pub fn installed_path(&self, id: &str) -> Option<PathBuf> {
        let spec = spec_of(id)?;
        is_installed(&self.0.dir, spec).then(|| self.0.dir.join(spec.main().file))
    }

    pub fn list(&self) -> ModelList {
        let jobs = self.jobs();
        let models = catalog()
            .map(|spec| {
                let installed = is_installed(&self.0.dir, spec);
                let job = jobs.get(spec.id);
                let on_disk: u64 = spec
                    .parts
                    .iter()
                    .map(|part| {
                        size_of(&self.0.dir.join(part.file))
                            .or_else(|| size_of(&part_path(&self.0.dir, part)))
                            .unwrap_or(0)
                    })
                    .sum();
                let (state, bytes, error) = match job {
                    _ if installed => ("installed", spec.size(), None),
                    Some(job) if job.running => ("downloading", job.bytes.load(Ordering::Relaxed), None),
                    Some(Job { error: Some(code), .. }) if *code != "canceled" => ("failed", on_disk, Some(*code)),
                    _ if on_disk > 0 => ("partial", on_disk, None),
                    _ => ("notInstalled", 0, None),
                };
                ModelView {
                    id: spec.id,
                    kind: spec.kind,
                    name: spec.name,
                    detail: spec.detail,
                    size_bytes: spec.size(),
                    state,
                    bytes,
                    error,
                }
            })
            .collect();
        let last_ran_unix = fs::read_to_string(self.last_ran_file())
            .ok()
            .and_then(|text| text.trim().parse().ok());
        ModelList { models, last_ran_unix }
    }

    /// Starts or resumes a download on a thread of its own. `blocked` says why none may run now.
    pub fn start(&self, id: &str, blocked: Option<DownloadError>) -> Result<(), DownloadError> {
        let spec = spec_of(id).ok_or_else(|| DownloadError::Disk("That model isn't in the catalog.".to_owned()))?;
        if let Some(reason) = blocked {
            return Err(reason);
        }
        let (cancel, bytes) = {
            let mut jobs = self.jobs();
            if jobs.get(spec.id).is_some_and(|job| job.running) {
                return Ok(());
            }
            let cancel = Arc::new(AtomicBool::new(false));
            let bytes = Arc::new(AtomicU64::new(0));
            jobs.insert(
                spec.id,
                Job {
                    cancel: cancel.clone(),
                    bytes: bytes.clone(),
                    running: true,
                    error: None,
                },
            );
            (cancel, bytes)
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let _ = fs::create_dir_all(&self.0.dir);
        let _ = fs::write(self.last_ran_file(), now.to_string());
        let this = self.clone();
        thread::Builder::new()
            .name(format!("model-download-{}", spec.id))
            .spawn(move || {
                let result = download(this.0.source.as_ref(), spec, &this.0.dir, &cancel, &bytes);
                let mut jobs = this.jobs();
                if let Some(job) = jobs.get_mut(spec.id) {
                    job.running = false;
                    job.error = result.err().map(|error| error.code());
                }
            })
            .map_err(|error| DownloadError::Disk(error.to_string()))?;
        Ok(())
    }

    /// Stops a running download and keeps the part that arrived, so the next start resumes.
    pub fn cancel(&self, id: &str) {
        if let Some(job) = self.jobs().get(id) {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }

    /// Deletes the model and any part of it, after stopping a running download.
    pub fn remove(&self, id: &str) -> Result<(), DownloadError> {
        self.remove_waiting(id, REMOVE_WAIT_STEPS)
    }

    fn remove_waiting(&self, id: &str, wait_steps: u32) -> Result<(), DownloadError> {
        let spec = spec_of(id).ok_or_else(|| DownloadError::Disk("That model isn't in the catalog.".to_owned()))?;
        self.cancel(id);
        // Wait for the thread to let go of the file. It sees the flag between reads, and a read can last as long as
        // the connection's timeout, so the wait is longer than that. If it still runs, nothing is deleted, and the
        // job stays, so the list tells the truth and a second Start can't begin another thread on the same file.
        for _ in 0..wait_steps {
            if !self.jobs().get(id).is_some_and(|job| job.running) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if self.jobs().get(id).is_some_and(|job| job.running) {
            return Err(DownloadError::Stopping);
        }
        for part in spec.parts {
            for path in [self.0.dir.join(part.file), part_path(&self.0.dir, part)] {
                match fs::remove_file(&path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        // A pack lives in a folder of its own. Take it away once it is empty.
        if let Some(folder) = Path::new(spec.main().file)
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
        {
            let _ = fs::remove_dir(self.0.dir.join(folder));
        }
        self.jobs().remove(id);
        Ok(())
    }
}
