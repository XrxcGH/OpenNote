//! Tests of downloading and staging: only a file that passes every check is staged, and a staged file is
//! verified again before it's used.

use std::{
    fs,
    sync::{Arc, Mutex},
};

use semver::Version;
use tempfile::TempDir;

use crate::{
    config::Channel,
    fetch::Url,
    test_support::{comment, config, sign, FixedClock, FolderReplacer, MemoryFetch, Signer},
    verify::sha256_of,
    Offer, UpdateError, Updater,
};

const EXE_URL: &str = "https://updates.test/OpenNote_Windows64.exe";

struct Setup {
    dir: TempDir,
    signer: Signer,
    updater: Updater<MemoryFetch, FolderReplacer, FixedClock>,
}

fn setup() -> Setup {
    let dir = tempfile::tempdir().expect("a folder");
    let signer = Signer::new();
    let config = config(dir.path(), "0.4.0", Channel::Stable, vec![signer.public()]);
    let replacer = FolderReplacer::new(dir.path().join("app").join("OpenNote.exe"));
    let updater = Updater::new(config, MemoryFetch::default(), replacer, FixedClock::default());
    Setup { dir, signer, updater }
}

/// An offer for `version`, whose file the fetcher serves as `served`, signed with `comment`.
fn offer(setup: &Setup, version: &str, data: &[u8], signed_comment: &str, served: &[u8]) -> Offer {
    setup.updater.fetch.serve(EXE_URL, served.to_vec());
    Offer {
        version: Version::parse(version).expect("valid"),
        notes: String::new(),
        url: Url::parse(EXE_URL).expect("https"),
        size: data.len() as u64,
        sha256: sha256_of(data).expect("hashes"),
        signature: sign(&setup.signer, data, signed_comment),
    }
}

fn good_offer(setup: &Setup, version: &str) -> Offer {
    let data = format!("MZ OpenNote {version}").repeat(5000).into_bytes();
    offer(
        setup,
        version,
        &data,
        &comment(version, "OpenNote_Windows64.exe"),
        &data,
    )
}

fn files(setup: &Setup) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(setup.dir.path().join("updates"))
        .map(|entries| entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn stages_a_verified_download_and_reports_progress() {
    let setup = setup();
    let offer = good_offer(&setup, "0.5.0");
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    let staged = setup
        .updater
        .download(&offer, &move |received, total| {
            log.lock().expect("lock").push((received, total))
        })
        .expect("stages");
    assert_eq!(
        staged.path,
        setup.dir.path().join("updates/OpenNote-0.5.0-windows-x86_64.exe")
    );
    assert_eq!(files(&setup), ["OpenNote-0.5.0-windows-x86_64.exe", "state.json"]);
    assert_eq!(seen.lock().expect("lock").last(), Some(&(offer.size, offer.size)));
    let record = setup.updater.state().staged.expect("recorded");
    assert_eq!(
        (record.size, record.signature.as_str()),
        (offer.size, offer.signature.as_str())
    );
    assert_eq!(setup.updater.staged(None).map(|s| s.version), Some(offer.version));
}

#[test]
fn never_stages_a_file_that_fails_a_check() {
    let setup = setup();
    let data = b"MZ OpenNote 0.5.0".repeat(5000);
    let good = comment("0.5.0", "OpenNote_Windows64.exe");
    let mut tampered = data.clone();
    tampered[9] ^= 1;
    let mut longer = data.clone();
    longer.extend_from_slice(b"more");
    let cases = [
        ("one byte changed", good.clone(), tampered),
        (
            "wrong version comment",
            comment("0.4.9", "OpenNote_Windows64.exe"),
            data.clone(),
        ),
        (
            "wrong file comment",
            comment("0.5.0", "OpenNote_WindowsARM64.exe"),
            data.clone(),
        ),
        ("truncated", good.clone(), data[..data.len() - 1].to_vec()),
        ("oversized", good.clone(), longer),
    ];
    for (case, signed, served) in cases {
        let offer = offer(&setup, "0.5.0", &data, &signed, &served);
        let result = setup.updater.download(&offer, &|_, _| {});
        assert!(matches!(result, Err(UpdateError::Verify(_))), "{case}: {result:?}");
        assert_eq!(files(&setup), Vec::<String>::new(), "{case}");
        assert_eq!(setup.updater.state().staged, None, "{case}");
    }
}

#[test]
fn never_stages_a_file_signed_with_another_key() {
    let setup = setup();
    let data = b"MZ OpenNote 0.5.0".repeat(100);
    let mut offer = offer(&setup, "0.5.0", &data, "unused", &data);
    offer.signature = sign(&Signer::new(), &data, &comment("0.5.0", "OpenNote_Windows64.exe"));
    assert!(matches!(
        setup.updater.download(&offer, &|_, _| {}),
        Err(UpdateError::Verify(_))
    ));
    assert!(setup.updater.staged(None).is_none());
}

#[test]
fn keeps_only_the_newest_staged_update() {
    let setup = setup();
    setup
        .updater
        .download(&good_offer(&setup, "0.5.0"), &|_, _| {})
        .expect("stages");
    setup
        .updater
        .download(&good_offer(&setup, "0.5.1"), &|_, _| {})
        .expect("stages");
    assert_eq!(files(&setup), ["OpenNote-0.5.1-windows-x86_64.exe", "state.json"]);
}

#[test]
fn deletes_a_staged_file_that_no_longer_verifies_or_may_not_install() {
    let setup = setup();
    let offer = good_offer(&setup, "0.5.0");
    setup.updater.download(&offer, &|_, _| {}).expect("stages");
    assert!(
        setup.updater.staged(Some(&offer.version)).is_none(),
        "a skipped version is deleted"
    );
    assert_eq!(files(&setup), ["state.json"]);

    setup.updater.download(&offer, &|_, _| {}).expect("stages");
    let path = setup.dir.path().join("updates/OpenNote-0.5.0-windows-x86_64.exe");
    let mut bytes = fs::read(&path).expect("reads");
    bytes[0] = b'X';
    fs::write(&path, bytes).expect("writes");
    assert!(setup.updater.staged(None).is_none(), "a changed file is deleted");
    assert_eq!(setup.updater.state().staged, None);
}

#[test]
fn ignores_the_path_written_in_the_state_file() {
    let setup = setup();
    let offer = good_offer(&setup, "0.5.0");
    setup.updater.download(&offer, &|_, _| {}).expect("stages");
    let elsewhere = setup.dir.path().join("elsewhere.exe");
    fs::write(&elsewhere, b"not verified").expect("writes");
    setup
        .updater
        .change_state(|state| {
            if let Some(staged) = state.staged.as_mut() {
                staged.path = elsewhere.display().to_string();
            }
        })
        .expect("saves");
    let staged = setup.updater.staged(None).expect("still verifies");
    assert_eq!(
        staged.path,
        setup.dir.path().join("updates/OpenNote-0.5.0-windows-x86_64.exe")
    );
}
