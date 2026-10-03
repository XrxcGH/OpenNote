//! Model downloads (Phase 12): the speech models and, later, the packs other on-device features use. A download
//! starts only when the person chose it after seeing the size. It resumes where it stopped, checks the file against
//! a published SHA-256 before it keeps it, and never runs while Work offline or safe mode is on. Files go in this
//! device's folder, so a portable install keeps them beside its profile. The crate behind the other commands holds
//! no network code, so this is the one place a model can come from.

use std::{
    collections::HashMap,
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
use sha2::{Digest, Sha256};

/// One model the person can download.
pub struct ModelSpec {
    pub id: &'static str,
    /// What it is for, such as `speech`.
    pub kind: &'static str,
    pub name: &'static str,
    pub detail: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub file: &'static str,
    pub url: &'static str,
}

#[cfg(test)]
const SPEECH_HOST: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// The models, with the sizes and checksums Hugging Face publishes for each file.
pub const CATALOG: &[ModelSpec] = &[
    ModelSpec {
        id: "speech-tiny-en",
        kind: "speech",
        name: "Speech, smallest (English)",
        detail: "Fastest. Good for clear voices.",
        size: 77_704_715,
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
        file: "ggml-tiny.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    },
    ModelSpec {
        id: "speech-base-en",
        kind: "speech",
        name: "Speech, balanced (English)",
        detail: "A good mix of speed and accuracy. Recommended.",
        size: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        file: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    },
    ModelSpec {
        id: "speech-small-en",
        kind: "speech",
        name: "Speech, accurate (English)",
        detail: "Most accurate for English, and slower.",
        size: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
        file: "ggml-small.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    },
    ModelSpec {
        id: "speech-base",
        kind: "speech",
        name: "Speech, balanced (many languages)",
        detail: "Understands many languages, and detects which one is spoken.",
        size: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        file: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    },
    ModelSpec {
        id: "speech-small",
        kind: "speech",
        name: "Speech, accurate (many languages)",
        detail: "Most accurate across languages, and slower.",
        size: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        file: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    },
];

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

fn hex_of_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn part_path(dir: &Path, spec: &ModelSpec) -> PathBuf {
    dir.join(format!("{}.part", spec.file))
}

fn size_of(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|meta| meta.len())
}

/// Downloads one model into `dir`, resuming a `.part` file left by an earlier try. The file is kept only when its
/// size and checksum match the catalog. Cancel leaves the `.part` file so the next try resumes.
pub fn download(
    source: &dyn Source,
    spec: &ModelSpec,
    dir: &Path,
    cancel: &AtomicBool,
    progress: &AtomicU64,
) -> Result<(), DownloadError> {
    fs::create_dir_all(dir)?;
    let part = part_path(dir, spec);
    let mut have = size_of(&part).unwrap_or(0);
    if have > spec.size {
        fs::remove_file(&part)?;
        have = 0;
    }
    if have < spec.size {
        let opened = source.open(spec.url, have).map_err(DownloadError::Network)?;
        let mut file = if opened.resumed && have > 0 {
            OpenOptions::new().append(true).open(&part)?
        } else {
            have = 0;
            File::create(&part)?
        };
        progress.store(have, Ordering::Relaxed);
        let mut reader = opened.reader;
        let mut buffer = vec![0u8; 1 << 16];
        while have < spec.size {
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
            progress.store(have, Ordering::Relaxed);
        }
        file.flush()?;
        drop(file);
        if have != spec.size {
            return if have > spec.size {
                fs::remove_file(&part)?;
                Err(DownloadError::Checksum)
            } else {
                Err(DownloadError::Network("The connection ended early.".to_owned()))
            };
        }
    }
    if hex_of_file(&part)? != spec.sha256 {
        fs::remove_file(&part)?;
        return Err(DownloadError::Checksum);
    }
    fs::rename(&part, dir.join(spec.file))?;
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

fn spec_of(id: &str) -> Option<&'static ModelSpec> {
    CATALOG.iter().find(|spec| spec.id == id)
}

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

    pub fn list(&self) -> ModelList {
        let jobs = self.jobs();
        let models = CATALOG
            .iter()
            .map(|spec| {
                let installed = size_of(&self.0.dir.join(spec.file)) == Some(spec.size);
                let job = jobs.get(spec.id);
                let on_disk = size_of(&part_path(&self.0.dir, spec)).unwrap_or(0);
                let (state, bytes, error) = match job {
                    _ if installed => ("installed", spec.size, None),
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
                    size_bytes: spec.size,
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
        for path in [self.0.dir.join(spec.file), part_path(&self.0.dir, spec)] {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
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

    const SPEC: ModelSpec = ModelSpec {
        id: "test",
        kind: "speech",
        name: "Test",
        detail: "",
        size: DATA.len() as u64,
        sha256: HELLO_SHA,
        file: "test.bin",
        url: "https://example.invalid/test.bin",
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
    fn the_catalog_lists_checksums_and_https_addresses() {
        for spec in CATALOG {
            assert_eq!(spec.sha256.len(), 64, "{}", spec.id);
            assert!(spec.url.starts_with("https://"), "{}", spec.id);
            assert!(spec.url.ends_with(spec.file), "{}", spec.id);
            assert!(spec.url.starts_with(SPEECH_HOST), "{}", spec.id);
        }
        let mut ids: Vec<_> = CATALOG.iter().map(|spec| spec.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
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
        let spec = &CATALOG[0];
        fs::write(dir.path().join(format!("{}.part", spec.file)), b"abc").unwrap();
        let listed = models.list();
        assert_eq!((listed.models[0].state, listed.models[0].bytes), ("partial", 3));
        models.remove(spec.id).unwrap();
        assert_eq!(models.list().models[0].state, "notInstalled");
    }
}
