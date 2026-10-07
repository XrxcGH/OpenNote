//! Staged files in `updates\` (ARCHITECTURE.md sections 18.5 and 18.6). A download streams to a `.partial` file,
//! hashing as it goes, and stops as soon as it passes the manifest's size. Only a verified file is renamed to its
//! staged name. Only one staged update is kept. A staged file is verified again at each start and before a swap.
//!
//! With `updates.resume` on, a download streams to `<file>.part` instead, beside a small `<file>.part.json` that
//! names the offer and the server's `ETag`. A connection that drops leaves both, and the next download of the same
//! offer asks for the rest with `Range` and `If-Range`. A server that ignores the range, or a file whose `ETag`
//! changed, starts the file again from its first byte. Either way the whole file is hashed and its signature
//! checked before it is staged, and a file that fails is deleted.

use std::{
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    config::Config,
    fetch::{Fetch, FetchError, RangeSink, RangeStart},
    platform::PlatformKey,
    policy,
    state::StagedRecord,
    verify::{self, Expected},
    Offer, UpdateError,
};

/// The name of a copy of one version for one platform: `OpenNote-<version>-<platform>.exe`. Staged updates in
/// `updates\` and the previous copy in `previous\` both use it.
pub fn copy_name(version: &Version, platform: PlatformKey) -> String {
    format!("OpenNote-{version}-{}.exe", platform.key())
}

/// The name a download streams to before it's verified.
pub fn partial_name(version: &Version, platform: PlatformKey) -> String {
    format!("{}.partial", copy_name(version, platform))
}

/// The name a resumable download streams to before it's verified.
pub fn part_name(version: &Version, platform: PlatformKey) -> String {
    format!("{}.part", copy_name(version, platform))
}

/// What a `.part` file holds: the offer it belongs to and the server's validator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartRecord {
    pub url: String,
    pub size: u64,
    pub sha256: String,
    #[serde(default)]
    pub etag: Option<String>,
}

impl PartRecord {
    fn for_offer(offer: &Offer) -> PartRecord {
        PartRecord {
            url: offer.url.as_str().to_owned(),
            size: offer.size,
            sha256: offer.sha256.clone(),
            etag: None,
        }
    }

    fn same_offer(&self, other: &PartRecord) -> bool {
        self.url == other.url && self.size == other.size && self.sha256 == other.sha256
    }
}

fn record_path(part: &Path) -> PathBuf {
    let mut name = part.as_os_str().to_owned();
    name.push(".json");
    PathBuf::from(name)
}

fn read_record(part: &Path) -> Option<PartRecord> {
    let bytes = fs::read(record_path(part)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_record(part: &Path, record: &PartRecord) -> io::Result<()> {
    let json = serde_json::to_vec(record).map_err(io::Error::other)?;
    fs::write(record_path(part), json)
}

fn remove_part(part: &Path) {
    let _ = fs::remove_file(part);
    let _ = fs::remove_file(record_path(part));
}

/// Writes a download to its file, hashing it and counting bytes as they arrive, and reporting progress.
struct Download<'a> {
    file: File,
    hasher: Sha256,
    received: u64,
    total: u64,
    progress: &'a dyn Fn(u64, u64),
}

impl Write for Download<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.received + buffer.len() as u64 > self.total {
            let message = "the download is larger than the manifest says";
            return Err(io::Error::new(io::ErrorKind::InvalidData, message));
        }
        self.file.write_all(buffer)?;
        self.hasher.update(buffer);
        self.received += buffer.len() as u64;
        (self.progress)(self.received, self.total);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// Downloads an offer to `updates\`, verifies it, and renames it to its staged name. Every other copy in the
/// folder is deleted first. On any failure the partial file is deleted, and the next check tries again.
pub fn download<F: Fetch>(
    fetch: &F,
    config: &Config,
    offer: &Offer,
    progress: &dyn Fn(u64, u64),
) -> Result<StagedRecord, UpdateError> {
    let updates = &config.dirs.updates;
    fs::create_dir_all(updates)?;
    remove_copies(updates);
    let partial = updates.join(partial_name(&offer.version, config.platform));
    let result = download_to(fetch, config, offer, &partial, progress);
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result?;
    let staged = updates.join(copy_name(&offer.version, config.platform));
    fs::rename(&partial, &staged)?;
    Ok(StagedRecord {
        version: offer.version.to_string(),
        platform: config.platform.key().to_owned(),
        file: config.platform.file().to_owned(),
        path: staged.display().to_string(),
        sha256: offer.sha256.clone(),
        size: offer.size,
        signature: offer.signature.clone(),
        notes: offer.notes.clone(),
        unknown: Default::default(),
    })
}

fn download_to<F: Fetch>(
    fetch: &F,
    config: &Config,
    offer: &Offer,
    partial: &Path,
    progress: &dyn Fn(u64, u64),
) -> Result<(), UpdateError> {
    let mut sink = Download {
        file: File::create(partial)?,
        hasher: Sha256::new(),
        received: 0,
        total: offer.size,
        progress,
    };
    let limit = offer.size.min(config.limits.exe_bytes);
    match fetch.get(&offer.url, limit, &mut sink) {
        Err(FetchError::TooLarge { limit }) => {
            return Err(UpdateError::Verify(format!(
                "the download is larger than {limit} bytes"
            )));
        }
        result => result?,
    };
    sink.file.sync_all()?;
    if verify::hex(&sink.hasher.finalize()) != offer.sha256 {
        return Err(UpdateError::Verify("the download's SHA-256 doesn't match".into()));
    }
    drop(sink.file);
    verify::verify_file(partial, &expected(offer, config.platform), &config.trusted_keys)
}

/// A resumable download: the bytes already in the `.part` file count, and [`RangeSink::begin`] drops them when
/// the response starts the file again.
struct Resume<'a> {
    download: Download<'a>,
    part: PathBuf,
    record: PartRecord,
    /// How many bytes the file held before this response.
    kept: u64,
}

impl Write for Resume<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.download.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.download.flush()
    }
}

impl RangeSink for Resume<'_> {
    fn begin(&mut self, resumed: bool, etag: Option<&str>) -> io::Result<()> {
        let changed = matches!((&self.record.etag, etag), (Some(before), Some(now)) if before != now);
        if resumed && changed {
            return Err(io::Error::new(io::ErrorKind::InvalidData, ETAG_CHANGED));
        }
        if !resumed && self.kept > 0 {
            // The server sends the whole file: start again from its first byte.
            self.download.file.set_len(0)?;
            self.download.file.seek(SeekFrom::Start(0))?;
            self.download.hasher = Sha256::new();
            self.download.received = 0;
            self.kept = 0;
        }
        self.record.etag = etag.map(str::to_owned);
        write_record(&self.part, &self.record)
    }
}

const ETAG_CHANGED: &str = "the file on the server changed since the download started";

fn etag_changed(error: &UpdateError) -> bool {
    matches!(error, UpdateError::Fetch(FetchError::Io(error)) if error.to_string() == ETAG_CHANGED)
}

/// Downloads an offer like [`download`], continuing an earlier `.part` file of the same offer.
pub fn download_resumable<F: Fetch>(
    fetch: &F,
    config: &Config,
    offer: &Offer,
    progress: &dyn Fn(u64, u64),
) -> Result<StagedRecord, UpdateError> {
    let updates = &config.dirs.updates;
    fs::create_dir_all(updates)?;
    let part = updates.join(part_name(&offer.version, config.platform));
    remove_copies_except(updates, Some(&part));
    let wanted = PartRecord::for_offer(offer);
    let earlier = read_record(&part).filter(|record| record.same_offer(&wanted));
    if earlier.is_none() {
        remove_part(&part);
    }
    let first = earlier.unwrap_or_else(|| wanted.clone());
    let mut result = resume_to(fetch, config, offer, &part, first, progress);
    if result.as_ref().is_err_and(etag_changed) {
        // The file changed under the download: drop what came before and fetch it whole, once.
        remove_part(&part);
        result = resume_to(fetch, config, offer, &part, wanted, progress);
    }
    if let Err(error) = result {
        // A dropped connection keeps the part for next time; anything else means its bytes can't be trusted.
        if !matches!(
            error,
            UpdateError::Fetch(FetchError::Offline | FetchError::Unreachable(_))
        ) {
            remove_part(&part);
        }
        return Err(error);
    }
    let staged = updates.join(copy_name(&offer.version, config.platform));
    fs::rename(&part, &staged)?;
    let _ = fs::remove_file(record_path(&part));
    Ok(StagedRecord {
        version: offer.version.to_string(),
        platform: config.platform.key().to_owned(),
        file: config.platform.file().to_owned(),
        path: staged.display().to_string(),
        sha256: offer.sha256.clone(),
        size: offer.size,
        signature: offer.signature.clone(),
        notes: offer.notes.clone(),
        unknown: Default::default(),
    })
}

fn resume_to<F: Fetch>(
    fetch: &F,
    config: &Config,
    offer: &Offer,
    part: &Path,
    record: PartRecord,
    progress: &dyn Fn(u64, u64),
) -> Result<(), UpdateError> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(part)?;
    let mut kept = file.metadata()?.len();
    if kept > offer.size {
        file.set_len(0)?;
        kept = 0;
    }
    // The bytes already there are hashed again, so the final hash covers the whole file.
    let mut hasher = Sha256::new();
    if kept > 0 {
        let mut buffer = vec![0u8; 64 * 1024];
        let mut left = kept;
        while left > 0 {
            let want = usize::try_from(left.min(buffer.len() as u64)).unwrap_or(buffer.len());
            file.read_exact(&mut buffer[..want])?;
            hasher.update(&buffer[..want]);
            left -= want as u64;
        }
    }
    file.seek(SeekFrom::Start(kept))?;
    write_record(part, &record)?;
    let start = RangeStart {
        from: kept,
        etag: record.etag.clone(),
    };
    let mut sink = Resume {
        download: Download {
            file,
            hasher,
            received: kept,
            total: offer.size,
            progress,
        },
        part: part.to_path_buf(),
        record,
        kept,
    };
    let limit = offer.size.min(config.limits.exe_bytes);
    if kept < offer.size {
        match fetch.get_range(&offer.url, &start, limit, &mut sink) {
            Err(FetchError::TooLarge { limit }) => {
                return Err(UpdateError::Verify(format!(
                    "the download is larger than {limit} bytes"
                )));
            }
            result => result?,
        };
    }
    let Resume { download, .. } = sink;
    download.file.sync_all()?;
    if download.received != offer.size || verify::hex(&download.hasher.finalize()) != offer.sha256 {
        return Err(UpdateError::Verify("the download's SHA-256 doesn't match".into()));
    }
    drop(download.file);
    verify::verify_file(part, &expected(offer, config.platform), &config.trusted_keys)
}

fn expected(offer: &Offer, platform: PlatformKey) -> Expected<'_> {
    Expected {
        version: &offer.version,
        file: platform.file(),
        size: offer.size,
        sha256: &offer.sha256,
        signature: &offer.signature,
    }
}

/// Deletes every staged copy and partial download in `updates\`, keeping `state.json`.
pub fn remove_copies(updates: &Path) {
    remove_copies_except(updates, None);
}

/// Deletes every staged copy and partial download in `updates`, but the `.part` file `keep` and its record.
fn remove_copies_except(updates: &Path, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(updates) else {
        return;
    };
    let kept = keep.map(|part| (part.to_path_buf(), record_path(part)));
    for path in entries.filter_map(|entry| entry.ok().map(|entry| entry.path())) {
        if kept
            .as_ref()
            .is_some_and(|(part, record)| &path == part || &path == record)
        {
            continue;
        }
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        let ours = [".exe", ".exe.partial", ".exe.part", ".exe.part.json"]
            .iter()
            .any(|end| name.ends_with(end));
        if name.starts_with("OpenNote-") && ours {
            if let Err(error) = fs::remove_file(&path) {
                log::warn!("Couldn't delete {}: {error}", path.display());
            }
        }
    }
}

/// Where a staged record's file must be. The path written in `state.json` is never used: any program can write
/// that file, so the path is rebuilt from the version and platform.
pub fn staged_path(config: &Config, record: &StagedRecord) -> Option<(Version, PathBuf)> {
    let version = Version::parse(&record.version).ok()?;
    let fits = record.platform == config.platform.key() && record.file == config.platform.file();
    fits.then(|| {
        let path = config.dirs.updates.join(copy_name(&version, config.platform));
        (version, path)
    })
}

/// Verifies a staged record again: the version may still be offered, and the file passes every check.
pub fn verify_staged(
    config: &Config,
    record: &StagedRecord,
    skipped: Option<&Version>,
    blocked: &[Version],
) -> Result<(Version, PathBuf), UpdateError> {
    let (version, path) = staged_path(config, record)
        .ok_or_else(|| UpdateError::Verify("the staged record is for another build".into()))?;
    policy::check(&version, &config.current, skipped, blocked)
        .map_err(|refusal| UpdateError::Verify(format!("{version} may not be installed: {refusal:?}")))?;
    let expected = Expected {
        version: &version,
        file: config.platform.file(),
        size: record.size,
        sha256: &record.sha256,
        signature: &record.signature,
    };
    verify::verify_file(&path, &expected, &config.trusted_keys)?;
    Ok((version, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_copies_by_version_and_platform() {
        let version = Version::parse("0.5.0-beta.1").expect("valid");
        assert_eq!(
            copy_name(&version, PlatformKey::WindowsX86_64),
            "OpenNote-0.5.0-beta.1-windows-x86_64.exe"
        );
        assert_eq!(
            partial_name(&version, PlatformKey::WindowsAarch64),
            "OpenNote-0.5.0-beta.1-windows-aarch64.exe.partial"
        );
    }
}
