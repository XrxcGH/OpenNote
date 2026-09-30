//! Staged files in `updates\` (ARCHITECTURE.md sections 18.5 and 18.6). A download streams to a `.partial` file,
//! hashing as it goes, and stops as soon as it passes the manifest's size. Only a verified file is renamed to its
//! staged name. Only one staged update is kept. A staged file is verified again at each start and before a swap.

use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use semver::Version;
use sha2::{Digest, Sha256};

use crate::{
    config::Config,
    fetch::{Fetch, FetchError},
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
    let Ok(entries) = fs::read_dir(updates) else {
        return;
    };
    for path in entries.filter_map(|entry| entry.ok().map(|entry| entry.path())) {
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or_default();
        if name.starts_with("OpenNote-") && (name.ends_with(".exe") || name.ends_with(".exe.partial")) {
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
