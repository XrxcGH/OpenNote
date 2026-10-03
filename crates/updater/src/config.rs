//! Everything the updater knows about this copy of the app, fixed at start-up: its version, platform, channel,
//! manifest URLs, trusted keys, folders, and limits.

use std::path::PathBuf;

use semver::Version;

use crate::{fetch::Url, platform::PlatformKey};

/// True in builds with the `test-endpoints` feature, which accept manifests from `http://127.0.0.1` and one
/// test key (ARCHITECTURE.md section 18.12). Release builds never have it.
pub const TEST_ENDPOINTS: bool = cfg!(feature = "test-endpoints");

/// Where the stable channel's manifest lives. GitHub's "latest" is the newest release that isn't a prerelease.
pub const STABLE_MANIFEST_URL: &str = "https://github.com/XrxcGH/OpenNote/releases/latest/download/latest.json";

/// Where the beta channel's manifest lives, in the fixed `channel-manifests` prerelease (section 18.3).
pub const BETA_MANIFEST_URL: &str = "https://github.com/XrxcGH/OpenNote/releases/download/channel-manifests/beta.json";

/// The largest manifest the updater reads: 64 KB.
pub const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

/// The largest exe the updater downloads: 200 MB.
pub const MAX_EXE_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Config {
    pub current: Version,
    pub platform: PlatformKey,
    pub channel: Channel,
    pub urls: ChannelUrls,
    pub trusted_keys: Vec<minisign_verify::PublicKey>,
    pub dirs: UpdaterDirs,
    pub limits: Limits,
}

/// The update channel from `settings.updates.channel`. Beta also takes newer stable releases.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Channel {
    #[default]
    Stable,
    Beta,
}

/// The manifest URL for each channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelUrls {
    pub stable: Url,
    pub beta: Url,
}

impl ChannelUrls {
    /// The GitHub URLs every released build reads.
    pub fn production() -> Self {
        Self {
            stable: Url::from_static(STABLE_MANIFEST_URL),
            beta: Url::from_static(BETA_MANIFEST_URL),
        }
    }
}

/// The updater's folders: `updates\` and `previous\` under the local app data folder, and the exe's own folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdaterDirs {
    pub updates: PathBuf,
    pub previous: PathBuf,
    pub exe_dir: PathBuf,
}

/// Size limits for downloads, in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub manifest_bytes: u64,
    pub exe_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            manifest_bytes: MAX_MANIFEST_BYTES,
            exe_bytes: MAX_EXE_BYTES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_urls_are_valid_update_urls() {
        let urls = ChannelUrls::production();
        assert_eq!(Url::parse(urls.stable.as_str()).ok(), Some(urls.stable.clone()));
        assert_eq!(Url::parse(urls.beta.as_str()).ok(), Some(urls.beta.clone()));
    }

    #[test]
    fn default_limits_match_the_architecture() {
        let limits = Limits::default();
        assert_eq!(limits.manifest_bytes, 65_536);
        assert_eq!(limits.exe_bytes, 209_715_200);
    }
}
