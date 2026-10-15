//! Model downloads (Phase 12): the speech models, the language models for Ask and the writing tools, the meaning
//! model, and the translation packs. A download starts only when the person chose it after seeing the size. It
//! resumes where it stopped, checks each file against a published checksum and size before it keeps it, and never
//! runs while Work offline or safe mode is on. Files go in this device's folder, so a portable install keeps them
//! beside its profile. The crate behind the other commands holds no network code, so this is the one place a model
//! can come from, and only from the pinned addresses in the catalog.

use std::collections::HashMap;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use sha1::Sha1;
use sha2::{Digest as _, Sha256};

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
        }
    }
}

impl From<io::Error> for DownloadError {
    fn from(error: io::Error) -> Self {
        DownloadError::Disk(error.to_string())
    }
}

/// What a server answered to a request for a file from some byte on.
pub struct Opened {
    /// True when the answer starts at the byte asked for, and false when the server sent the file from the start.
    pub resumed: bool,
    pub reader: Box<dyn Read + Send>,
}

/// Where model bytes come from. The app uses [`HttpSource`], and tests use a stand-in.
pub trait Source: Send + Sync {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String>;
}

/// Downloads over HTTPS with Windows' TLS stack, as the updater does. No cookies and no proxy settings are read.
pub struct HttpSource;

impl Source for HttpSource {
    fn open(&self, url: &str, from: u64) -> Result<Opened, String> {
        use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
        // Only the catalog's own addresses are ever opened.
        if !url.starts_with("https://huggingface.co/") {
            return Err("That address is not one OpenNote downloads from.".to_owned());
        }
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .root_certs(RootCerts::PlatformVerifier)
            .build();
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .tls_config(tls)
            .max_redirects(5)
            .http_status_as_error(false)
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .user_agent(concat!("OpenNote/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let mut request = agent.get(url);
        if from > 0 {
            request = request.header("Range", format!("bytes={from}-"));
        }
        let response = request.call().map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        let resumed = match status {
            200 => false,
            206 => true,
            other => return Err(format!("The server answered with status {other}.")),
        };
        Ok(Opened {
            resumed,
            reader: Box::new(response.into_body().into_reader()),
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Whether the file at `path` matches `digest` and `size`.
fn matches(path: &Path, size: u64, digest: Digest) -> io::Result<bool> {
    let mut file = File::open(path)?;
    let mut buffer = vec![0u8; 1 << 16];
    let found = match digest {
        Digest::Sha256(_) => {
            let mut hasher = Sha256::new();
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        }
        Digest::GitBlob(_) => {
            let mut hasher = Sha1::new();
            hasher.update(format!("blob {size}\0").as_bytes());
            loop {
                let read = file.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            hex(&hasher.finalize())
        }
    };
    Ok(found == digest.hex())
}

fn part_path(dir: &Path, part: &Part) -> PathBuf {
    let mut name = dir.join(part.file).into_os_string();
    name.push(".part");
    PathBuf::from(name)
}

fn size_of(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|meta| meta.len())
}

/// Whether every file of the model is on disk at its published size.
pub fn is_installed(dir: &Path, spec: &ModelSpec) -> bool {
    spec.parts
        .iter()
        .all(|part| size_of(&dir.join(part.file)) == Some(part.size))
}

/// Downloads one file into `dir`, resuming a `.part` file left by an earlier try. The file is kept only when its
/// size and checksum match the catalog. Cancel leaves the `.part` file so the next try resumes. `progress` holds
/// the bytes of the whole model: `base` is what the earlier files took.
fn download_part(
    source: &dyn Source,
    part: &Part,
    dir: &Path,
    cancel: &AtomicBool,
    progress: &AtomicU64,
    base: u64,
) -> Result<(), DownloadError> {
    let target = dir.join(part.file);
    if size_of(&target) == Some(part.size) {
        progress.store(base + part.size, Ordering::Relaxed);
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = part_path(dir, part);
    let mut have = size_of(&partial).unwrap_or(0);
    if have > part.size {
        fs::remove_file(&partial)?;
        have = 0;
    }
    if have < part.size {
        let opened = source.open(part.url, have).map_err(DownloadError::Network)?;
        let mut file = if opened.resumed && have > 0 {
            OpenOptions::new().append(true).open(&partial)?
        } else {
            have = 0;
            File::create(&partial)?
        };
        progress.store(base + have, Ordering::Relaxed);
        // Never read past the published size, whatever the server sends.
        let mut reader = opened.reader.take(part.size - have + 1);
        let mut buffer = vec![0u8; 1 << 16];
        while have <= part.size {
            if cancel.load(Ordering::Relaxed) {
                file.flush()?;
                return Err(DownloadError::Canceled);
            }
            let read = reader
                .read(&mut buffer)
                .map_err(|error| DownloadError::Network(error.to_string()))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])?;
            have += read as u64;
            progress.store(base + have.min(part.size), Ordering::Relaxed);
        }
        file.flush()?;
        drop(file);
        if have != part.size {
            return if have > part.size {
                fs::remove_file(&partial)?;
                Err(DownloadError::Checksum)
            } else {
                Err(DownloadError::Network("The connection ended early.".to_owned()))
            };
        }
    }
    if !matches(&partial, part.size, part.digest)? {
        fs::remove_file(&partial)?;
        return Err(DownloadError::Checksum);
    }
    fs::rename(&partial, &target)?;
    Ok(())
}

/// Downloads every file of a model, one after another.
pub fn download(
    source: &dyn Source,
    spec: &ModelSpec,
    dir: &Path,
    cancel: &AtomicBool,
    progress: &AtomicU64,
) -> Result<(), DownloadError> {
    fs::create_dir_all(dir)?;
    let mut base = 0;
    for part in spec.parts {
        download_part(source, part, dir, cancel, progress, base)?;
        base += part.size;
    }
    Ok(())
}

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
        let spec = spec_of(id).ok_or_else(|| DownloadError::Disk("That model isn't in the catalog.".to_owned()))?;
        self.cancel(id);
        // Wait for the thread to let go of the file.
        for _ in 0..100 {
            if !self.jobs().get(id).is_some_and(|job| job.running) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
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

#[cfg(test)]
mod tests {
    use super::*;

    const DATA: &[u8] = b"hello world";
    const HELLO_SHA: &str = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    /// `printf 'blob 11\0hello world' | sha1sum`
    const HELLO_BLOB: &str = "95d09f2b10159347eece71399a7e2e907ea3df4f";

    const SPEC: ModelSpec = ModelSpec {
        id: "test",
        kind: "speech",
        name: "Test",
        detail: "",
        parts: &[Part {
            file: "test.bin",
            size: DATA.len() as u64,
            digest: Digest::Sha256(HELLO_SHA),
            url: "https://example.invalid/test.bin",
        }],
    };

    const PACK: ModelSpec = ModelSpec {
        id: "pack",
        kind: "translate",
        name: "Pack",
        detail: "",
        parts: &[
            Part {
                file: "pack/one.bin",
                size: DATA.len() as u64,
                digest: Digest::Sha256(HELLO_SHA),
                url: "https://example.invalid/one",
            },
            Part {
                file: "pack/two.json",
                size: DATA.len() as u64,
                digest: Digest::GitBlob(HELLO_BLOB),
                url: "https://example.invalid/two",
            },
        ],
    };

    /// Serves `data`, honoring a start offset unless `ignore_range` is set, and asks `after` to run first.
    struct Memory {
        data: Vec<u8>,
        ignore_range: bool,
        asked: Mutex<Vec<u64>>,
    }

    impl Source for Memory {
        fn open(&self, _url: &str, from: u64) -> Result<Opened, String> {
            self.asked.lock().unwrap().push(from);
            let start = if self.ignore_range { 0 } else { from as usize };
            Ok(Opened {
                resumed: !self.ignore_range && from > 0,
                reader: Box::new(io::Cursor::new(self.data[start..].to_vec())),
            })
        }
    }

    fn memory(data: &[u8], ignore_range: bool) -> Memory {
        Memory {
            data: data.to_vec(),
            ignore_range,
            asked: Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn the_catalog_lists_checksums_sizes_and_pinned_https_addresses() {
        for spec in catalog() {
            assert!(!spec.parts.is_empty(), "{}", spec.id);
            assert!(spec.size() <= MAX_MODEL_BYTES, "{}", spec.id);
            for part in spec.parts {
                let expected = match part.digest {
                    Digest::Sha256(_) => 64,
                    Digest::GitBlob(_) => 40,
                };
                assert_eq!(part.digest.hex().len(), expected, "{}", part.file);
                assert!(
                    part.digest.hex().bytes().all(|b| b.is_ascii_hexdigit()),
                    "{}",
                    part.file
                );
                assert!(part.url.starts_with("https://huggingface.co/"), "{}", part.file);
                assert!(part.url.ends_with(part.file.rsplit('/').next().unwrap()) || spec.kind != "speech");
                assert!(part.size > 0 && part.size <= MAX_MODEL_BYTES, "{}", part.file);
                assert!(
                    !part.file.contains("..") && !part.file.starts_with('/'),
                    "{}",
                    part.file
                );
                if spec.kind == "speech" {
                    assert!(part.url.starts_with(SPEECH_HOST), "{}", spec.id);
                } else {
                    // Everything else is pinned to a commit, not to a branch that can change under the checksum.
                    let revision = part
                        .url
                        .split("/resolve/")
                        .nth(1)
                        .and_then(|rest| rest.split('/').next());
                    let revision = revision.expect("a resolve address");
                    assert_eq!(revision.len(), 40, "{}", part.url);
                    assert!(revision.bytes().all(|b| b.is_ascii_hexdigit()), "{}", part.url);
                }
            }
        }
        let mut ids: Vec<_> = catalog().map(|spec| spec.id).collect();
        ids.sort_unstable();
        let total = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), total);
        for kind in ["speech", "language", "meaning", "translate"] {
            assert!(catalog().any(|spec| spec.kind == kind), "{kind}");
        }
        // No two models write the same file.
        let mut files: Vec<_> = catalog()
            .flat_map(|spec| spec.parts.iter().map(|part| part.file))
            .collect();
        files.sort_unstable();
        let total = files.len();
        files.dedup();
        assert_eq!(files.len(), total);
    }

    #[test]
    fn the_web_previews_pack_list_matches_the_catalog() {
        // Each row of the preview's list reads `['en', 'es', 119006287],`.
        let listed = include_str!("../../../src/services/intel/packs.ts");
        let mut in_preview: Vec<(String, u64)> = listed
            .lines()
            .filter_map(|line| {
                let row = line.trim().strip_prefix('[')?.strip_suffix("],")?;
                let mut cells = row.split(',').map(|cell| cell.trim().trim_matches('\''));
                let (from, to, size) = (cells.next()?, cells.next()?, cells.next()?);
                Some((format!("translate-{from}-{to}"), size.parse().ok()?))
            })
            .collect();
        let mut in_catalog: Vec<(String, u64)> = catalog()
            .filter(|spec| spec.kind == "translate")
            .map(|spec| (spec.id.to_owned(), spec.size()))
            .collect();
        in_preview.sort();
        in_catalog.sort();
        assert_eq!(in_preview, in_catalog);
    }

    #[test]
    fn a_download_is_kept_after_its_checksum_matches() {
        let dir = tempfile::tempdir().unwrap();
        let progress = AtomicU64::new(0);
        download(
            &memory(DATA, false),
            &SPEC,
            dir.path(),
            &AtomicBool::new(false),
            &progress,
        )
        .unwrap();
        assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
        assert!(!dir.path().join("test.bin.part").exists());
        assert_eq!(progress.load(Ordering::Relaxed), DATA.len() as u64);
    }

    #[test]
    fn a_pack_downloads_every_file_and_checks_each_kind_of_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let progress = AtomicU64::new(0);
        download(
            &memory(DATA, false),
            &PACK,
            dir.path(),
            &AtomicBool::new(false),
            &progress,
        )
        .unwrap();
        assert_eq!(fs::read(dir.path().join("pack/one.bin")).unwrap(), DATA);
        assert_eq!(fs::read(dir.path().join("pack/two.json")).unwrap(), DATA);
        assert_eq!(progress.load(Ordering::Relaxed), PACK.size());
        assert!(is_installed(dir.path(), &PACK));
    }

    #[test]
    fn a_wrong_git_hash_deletes_the_file() {
        const BAD: ModelSpec = ModelSpec {
            id: "bad",
            kind: "translate",
            name: "Bad",
            detail: "",
            parts: &[Part {
                file: "bad/two.json",
                size: DATA.len() as u64,
                digest: Digest::GitBlob("0000000000000000000000000000000000000000"),
                url: "https://example.invalid/two",
            }],
        };
        let dir = tempfile::tempdir().unwrap();
        let result = download(
            &memory(DATA, false),
            &BAD,
            dir.path(),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
        );
        assert_eq!(result, Err(DownloadError::Checksum));
        assert!(!dir.path().join("bad/two.json").exists());
        assert!(!dir.path().join("bad/two.json.part").exists());
    }

    #[test]
    fn a_server_that_sends_more_than_the_published_size_is_cut_off() {
        let dir = tempfile::tempdir().unwrap();
        let mut long = DATA.to_vec();
        long.extend(std::iter::repeat_n(b'x', 1000));
        let result = download(
            &memory(&long, false),
            &SPEC,
            dir.path(),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
        );
        assert_eq!(result, Err(DownloadError::Checksum));
        assert!(!dir.path().join("test.bin").exists());
        assert!(!dir.path().join("test.bin.part").exists());
    }

    #[test]
    fn a_stopped_download_resumes_from_its_part() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("test.bin.part"), &DATA[..5]).unwrap();
        let source = memory(DATA, false);
        download(&source, &SPEC, dir.path(), &AtomicBool::new(false), &AtomicU64::new(0)).unwrap();
        assert_eq!(*source.asked.lock().unwrap(), vec![5]);
        assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
    }

    #[test]
    fn a_server_that_ignores_the_range_restarts_the_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("test.bin.part"), &DATA[..5]).unwrap();
        download(
            &memory(DATA, true),
            &SPEC,
            dir.path(),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
        )
        .unwrap();
        assert_eq!(fs::read(dir.path().join("test.bin")).unwrap(), DATA);
    }

    #[test]
    fn a_wrong_checksum_deletes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let result = download(
            &memory(b"HELLO WORLD", false),
            &SPEC,
            dir.path(),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
        );
        assert_eq!(result, Err(DownloadError::Checksum));
        assert!(!dir.path().join("test.bin").exists());
        assert!(!dir.path().join("test.bin.part").exists());
    }

    #[test]
    fn cancel_keeps_the_part_for_the_next_try() {
        let dir = tempfile::tempdir().unwrap();
        let result = download(
            &memory(DATA, false),
            &SPEC,
            dir.path(),
            &AtomicBool::new(true),
            &AtomicU64::new(0),
        );
        assert_eq!(result, Err(DownloadError::Canceled));
        assert!(dir.path().join("test.bin.part").exists());
        assert!(!dir.path().join("test.bin").exists());
    }

    #[test]
    fn a_short_answer_is_an_error_that_can_resume() {
        let dir = tempfile::tempdir().unwrap();
        let result = download(
            &memory(&DATA[..4], false),
            &SPEC,
            dir.path(),
            &AtomicBool::new(false),
            &AtomicU64::new(0),
        );
        assert!(matches!(result, Err(DownloadError::Network(_))));
        assert_eq!(size_of(&dir.path().join("test.bin.part")), Some(4));
    }

    #[test]
    fn a_blocked_start_does_not_run_and_the_list_shows_what_is_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let models = Models::with_source(dir.path().to_path_buf(), Arc::new(memory(DATA, false)));
        assert_eq!(
            models.start("speech-base-en", Some(DownloadError::Offline)),
            Err(DownloadError::Offline)
        );
        let first = &models.list().models[0];
        assert_eq!((first.state, first.bytes), ("notInstalled", 0));
        let spec = catalog().next().unwrap();
        fs::write(dir.path().join(format!("{}.part", spec.main().file)), b"abc").unwrap();
        let listed = models.list();
        assert_eq!((listed.models[0].state, listed.models[0].bytes), ("partial", 3));
        models.remove(spec.id).unwrap();
        assert_eq!(models.list().models[0].state, "notInstalled");
    }

    #[test]
    fn a_pack_is_installed_only_when_every_file_is_there_and_remove_takes_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let models = Models::with_source(dir.path().to_path_buf(), Arc::new(memory(DATA, false)));
        let spec = spec_of("translate-en-es").unwrap();
        assert!(models.installed_path(spec.id).is_none());
        for part in spec.parts {
            let path = dir.path().join(part.file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            File::create(&path).unwrap().set_len(part.size).unwrap();
        }
        assert!(models.installed_path(spec.id).is_some());
        let one = dir.path().join(spec.parts[1].file);
        fs::remove_file(&one).unwrap();
        assert!(models.installed_path(spec.id).is_none());
        models.remove(spec.id).unwrap();
        assert!(!dir.path().join("translate-en-es").exists());
    }
}
