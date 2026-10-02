//! Tests of `Updater::check`: which manifest each channel reads, and which versions it offers.

use serde_json::json;
use tempfile::TempDir;

use crate::{
    config::Channel,
    state::UpdaterState,
    test_support::{config, FixedClock, FolderReplacer, MemoryFetch, BETA_URL, STABLE_URL},
    time, CheckOutcome, UpdateError, Updater,
};

const HASH: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

fn manifest(version: &str) -> Vec<u8> {
    let entry = json!({ "url": format!("https://github.com/XrxcGH/OpenNote/releases/download/v{version}/OpenNote.exe"), "signature": "c2ln", "size": 3, "sha256": HASH });
    json!({ "version": version, "notes": format!("Notes for {version}"), "platforms": { "windows-x86_64": entry } })
        .to_string()
        .into_bytes()
}

struct Setup {
    dir: TempDir,
    updater: Updater<MemoryFetch, FolderReplacer, FixedClock>,
}

fn setup(current: &str, channel: Channel, serve: &[(&str, &str)]) -> Setup {
    let dir = tempfile::tempdir().expect("a folder");
    let fetch = MemoryFetch::default();
    for (url, version) in serve {
        fetch.serve(url, manifest(version));
    }
    let config = config(dir.path(), current, channel, Vec::new());
    let replacer = FolderReplacer::new(dir.path().join("app").join("OpenNote.exe"));
    let updater = Updater::new(config, fetch, replacer, FixedClock::default());
    Setup { dir, updater }
}

fn offered(outcome: CheckOutcome) -> Option<String> {
    match outcome {
        CheckOutcome::Available(offer) => Some(offer.version.to_string()),
        _ => None,
    }
}

#[test]
fn offers_a_newer_stable_version_and_records_the_check() {
    let Setup { dir, updater } = setup("0.4.0", Channel::Stable, &[(STABLE_URL, "0.5.0")]);
    let outcome = updater.check(None).expect("checks");
    let CheckOutcome::Available(offer) = outcome else {
        panic!("expected an offer, got {outcome:?}");
    };
    assert_eq!(
        (offer.version.to_string(), offer.notes.as_str()),
        ("0.5.0".into(), "Notes for 0.5.0")
    );
    let state = UpdaterState::load(&dir.path().join("updates"));
    assert_eq!(
        state.last_check.as_deref(),
        Some(time::format(FixedClock::default().0).as_str())
    );
}

#[test]
fn refuses_the_same_older_skipped_and_blocked_versions() {
    for (current, served) in [("0.5.0", "0.5.0"), ("0.5.0", "0.4.0")] {
        let Setup { updater, .. } = setup(current, Channel::Stable, &[(STABLE_URL, served)]);
        assert_eq!(
            updater.check(None).expect("checks"),
            CheckOutcome::UpToDate,
            "{current} {served}"
        );
    }
    let Setup { updater, .. } = setup("0.4.0", Channel::Stable, &[(STABLE_URL, "0.5.0")]);
    let skipped = semver::Version::new(0, 5, 0);
    assert_eq!(updater.check(Some(&skipped)).expect("checks"), CheckOutcome::UpToDate);
    updater
        .change_state(|state| state.blocked_versions.push("0.5.0".into()))
        .expect("saves");
    assert_eq!(updater.check(None).expect("checks"), CheckOutcome::UpToDate);
}

#[test]
fn a_manifest_without_this_platform_is_no_update_for_this_device() {
    let Setup { updater, .. } = setup("0.4.0", Channel::Stable, &[]);
    let other = json!({ "version": "0.5.0", "platforms": {} }).to_string();
    updater.fetch.serve(STABLE_URL, other);
    assert_eq!(updater.check(None).expect("checks"), CheckOutcome::NoUpdateForPlatform);
}

#[test]
fn an_unreachable_or_broken_manifest_is_an_error_and_not_a_check() {
    let Setup { dir, updater } = setup("0.4.0", Channel::Stable, &[]);
    assert!(matches!(updater.check(None), Err(UpdateError::Fetch(_))));
    updater.fetch.serve(STABLE_URL, "{");
    assert!(matches!(updater.check(None), Err(UpdateError::Manifest(_))));
    assert_eq!(UpdaterState::load(&dir.path().join("updates")).last_check, None);
}

#[test]
fn the_stable_channel_never_offers_a_prerelease() {
    let Setup { updater, .. } = setup("0.4.0", Channel::Stable, &[(STABLE_URL, "0.5.0-beta.1")]);
    assert_eq!(updater.check(None).expect("checks"), CheckOutcome::UpToDate);
}

#[test]
fn the_beta_channel_takes_the_higher_of_beta_and_stable() {
    let both = [(BETA_URL, "0.5.0-beta.2"), (STABLE_URL, "0.4.1")];
    let Setup { updater, .. } = setup("0.4.0", Channel::Beta, &both);
    assert_eq!(
        offered(updater.check(None).expect("checks")).as_deref(),
        Some("0.5.0-beta.2")
    );
    let newer_stable = [(BETA_URL, "0.5.0-beta.2"), (STABLE_URL, "0.5.0")];
    let Setup { updater, .. } = setup("0.4.0", Channel::Beta, &newer_stable);
    assert_eq!(offered(updater.check(None).expect("checks")).as_deref(), Some("0.5.0"));
}

#[test]
fn the_beta_channel_still_reads_stable_when_beta_json_is_missing() {
    let Setup { updater, .. } = setup("0.4.0", Channel::Beta, &[(STABLE_URL, "0.4.1")]);
    assert_eq!(offered(updater.check(None).expect("checks")).as_deref(), Some("0.4.1"));
    let Setup { updater, .. } = setup("0.4.0", Channel::Beta, &[(BETA_URL, "0.5.0-beta.1")]);
    assert_eq!(
        offered(updater.check(None).expect("checks")).as_deref(),
        Some("0.5.0-beta.1")
    );
}
