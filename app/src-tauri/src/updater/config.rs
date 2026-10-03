//! What this copy of the app updates with (ARCHITECTURE.md sections 18.4 and 18.12). It holds the version, the
//! trusted keys, the manifest URLs, the folders, and whether this copy may update itself at all.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use opennote_updater::{
    verify::decode_public_key, Channel, ChannelUrls, Config, Limits, PlatformKey, PublicKey, UpdaterDirs,
};
use semver::Version;

use super::{DisabledReason, TEST_UPDATE_PUBLIC_KEY, UPDATE_PUBLIC_KEYS};
use crate::{
    paths::Paths,
    settings::schema::{InstallPolicy, UpdateChannel},
};

/// The environment variable that points `test-endpoints` builds at a local manifest.
#[cfg(any(test, feature = "test-endpoints"))]
pub const TEST_URL_VAR: &str = "OPENNOTE_UPDATE_URL";

/// The version of this build, from the three version files the release workflow keeps in step.
pub fn current_version() -> Version {
    Version::parse(env!("CARGO_PKG_VERSION")).expect("the package version is semver")
}

/// A development build, such as `npm start`, never updates itself. Builds with `test-endpoints` do, so a debug
/// build can still be tested against a local server.
pub fn is_dev_build() -> bool {
    cfg!(debug_assertions) && !cfg!(feature = "test-endpoints")
}

/// The keys an update signature may verify against: every built-in key, and the test key in `test-endpoints`
/// builds.
pub fn trusted_keys() -> Vec<PublicKey> {
    let test_key = TEST_UPDATE_PUBLIC_KEY.and_then(|text| {
        let key = decode_public_key(text);
        if key.is_none() {
            log::error!("Ignored OPENNOTE_TEST_UPDATE_PUBKEY, which isn't a minisign public key.");
        }
        key
    });
    UPDATE_PUBLIC_KEYS
        .iter()
        .filter_map(|text| decode_public_key(text))
        .chain(test_key)
        .collect()
}

/// The manifest URLs. Release builds always read GitHub; `test-endpoints` builds read `OPENNOTE_UPDATE_URL` for
/// both channels when it's set, which may be `http://127.0.0.1`.
pub fn manifest_urls() -> ChannelUrls {
    #[cfg(feature = "test-endpoints")]
    if let Some(url) = std::env::var(TEST_URL_VAR)
        .ok()
        .and_then(|text| opennote_updater::Url::parse(&text).ok())
    {
        return ChannelUrls {
            stable: url.clone(),
            beta: url,
        };
    }
    ChannelUrls::production()
}

/// The folder of the running exe.
pub fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

/// The updater's folders under the app's local folder, and the exe's own folder.
pub fn dirs(paths: &Paths) -> Option<UpdaterDirs> {
    Some(UpdaterDirs {
        updates: paths.updates.clone(),
        previous: paths.previous.clone(),
        exe_dir: exe_dir()?,
    })
}

/// The updater's channel for the settings' channel.
pub fn channel(setting: UpdateChannel) -> Channel {
    match setting {
        UpdateChannel::Stable => Channel::Stable,
        UpdateChannel::Beta => Channel::Beta,
    }
}

/// The configuration for one channel, or `None` on a platform OpenNote doesn't update on.
pub fn updater_config(paths: &Paths, channel: UpdateChannel, keys: Vec<PublicKey>) -> Option<Config> {
    Some(Config {
        current: current_version(),
        platform: PlatformKey::current()?,
        channel: self::channel(channel),
        urls: manifest_urls(),
        trusted_keys: keys,
        dirs: dirs(paths)?,
        limits: Limits::default(),
    })
}

/// Whether the exe's folder can take the new exe, checked once per start with a file that's deleted at once.
pub fn exe_folder_writable() -> bool {
    static WRITABLE: OnceLock<bool> = OnceLock::new();
    *WRITABLE.get_or_init(|| exe_dir().is_some_and(|dir| folder_writable(&dir)))
}

fn folder_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".opennote-update-check-{}", std::process::id()));
    let created = fs::OpenOptions::new().write(true).create_new(true).open(&probe);
    let writable = created.is_ok();
    drop(created);
    if writable {
        let _ = fs::remove_file(&probe);
    }
    writable
}

/// Why this copy of the app never updates itself, if it doesn't: a development build, a build without a key, or a
/// folder it can't write to.
pub fn blocked_reason(dev_build: bool, has_keys: bool, writable: impl FnOnce() -> bool) -> Option<DisabledReason> {
    if dev_build || PlatformKey::current().is_none() {
        Some(DisabledReason::DevBuild)
    } else if !has_keys {
        Some(DisabledReason::NoKey)
    } else if !writable() {
        Some(DisabledReason::NotWritable)
    } else {
        None
    }
}

/// The reason for this build, computed once.
pub fn this_build_blocked() -> Option<DisabledReason> {
    static BLOCKED: OnceLock<Option<DisabledReason>> = OnceLock::new();
    *BLOCKED.get_or_init(|| blocked_reason(is_dev_build(), !trusted_keys().is_empty(), exe_folder_writable))
}

/// In `test-endpoints` builds, `OPENNOTE_TEST_FAIL_BEFORE_READY=1` makes a counted start of a new version exit
/// before its window, so the nightly test can prove the rollback. Starts of a healthy version aren't affected.
pub fn fail_before_ready_for_tests(counted_attempt: Option<u8>) {
    #[cfg(feature = "test-endpoints")]
    if counted_attempt.is_some() && std::env::var("OPENNOTE_TEST_FAIL_BEFORE_READY").is_ok_and(|value| value == "1") {
        log::error!("OPENNOTE_TEST_FAIL_BEFORE_READY: exiting before this start is ready.");
        std::process::exit(3);
    }
    let _ = counted_attempt;
}

/// The phase when nothing is happening: off for a reason, only on request, or waiting for the next check.
pub fn resting_phase(blocked: Option<DisabledReason>, policy: InstallPolicy) -> super::UpdaterPhase {
    match (blocked, policy) {
        (Some(reason), _) => super::UpdaterPhase::Disabled { reason },
        (None, InstallPolicy::Manual) => super::UpdaterPhase::Disabled {
            reason: DisabledReason::ManualMode,
        },
        (None, _) => super::UpdaterPhase::Idle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::updater::UpdaterPhase;

    #[test]
    fn blocks_development_builds_then_keyless_builds_then_locked_folders() {
        let never = || panic!("the folder isn't checked");
        assert_eq!(blocked_reason(true, true, never), Some(DisabledReason::DevBuild));
        assert_eq!(blocked_reason(false, false, never), Some(DisabledReason::NoKey));
        assert_eq!(blocked_reason(false, true, || false), Some(DisabledReason::NotWritable));
        assert_eq!(blocked_reason(false, true, || true), None);
    }

    #[test]
    fn rests_as_off_manual_or_idle() {
        let off = resting_phase(Some(DisabledReason::NoKey), InstallPolicy::Auto);
        assert_eq!(
            off,
            UpdaterPhase::Disabled {
                reason: DisabledReason::NoKey
            }
        );
        assert_eq!(
            resting_phase(None, InstallPolicy::Manual),
            UpdaterPhase::Disabled {
                reason: DisabledReason::ManualMode
            }
        );
        assert_eq!(resting_phase(None, InstallPolicy::Ask), UpdaterPhase::Idle);
    }

    #[test]
    fn checks_whether_a_folder_takes_new_files() {
        let dir = tempfile::tempdir().expect("a folder");
        assert!(folder_writable(dir.path()));
        assert_eq!(fs::read_dir(dir.path()).expect("lists").count(), 0, "the probe is gone");
        assert!(!folder_writable(&dir.path().join("missing")));
    }

    #[test]
    fn this_build_has_no_key_unless_one_is_committed() {
        let keys = trusted_keys();
        assert_eq!(
            keys.len(),
            UPDATE_PUBLIC_KEYS.len() + usize::from(TEST_UPDATE_PUBLIC_KEY.is_some())
        );
        assert_eq!(current_version().to_string(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn reads_the_production_manifests_without_an_override() {
        if std::env::var_os(TEST_URL_VAR).is_none() {
            assert_eq!(manifest_urls(), ChannelUrls::production());
        }
    }
}
