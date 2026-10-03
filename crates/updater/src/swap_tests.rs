//! Tests of swapping, the start guard, rollback, and going back, with a fake replacer in temporary folders. The
//! real `self_replace` swaps run in tests/swap.rs.

use std::{fs, path::PathBuf};

use semver::Version;
use tempfile::TempDir;

use crate::{
    config::Channel,
    fetch::Url,
    guard::{self, guard_on_start, GuardDecision, Step},
    state::{PendingRecord, PreviousRecord, UpdaterState},
    test_support::{comment, config, sign, Failure, FixedClock, FolderReplacer, MemoryFetch, Signer},
    verify::sha256_of,
    Offer, Relaunch, UpdateError, Updater,
};

const EXE_URL: &str = "https://updates.test/OpenNote_Windows64.exe";

fn exe_bytes(version: &str) -> Vec<u8> {
    format!("MZ OpenNote {version} ").repeat(2000).into_bytes()
}

struct Setup {
    dir: TempDir,
    signer: Signer,
}

impl Setup {
    fn new() -> Setup {
        let dir = tempfile::tempdir().expect("a folder");
        fs::create_dir_all(dir.path().join("app")).expect("an app folder");
        fs::write(dir.path().join("app/OpenNote.exe"), exe_bytes("0.4.0")).expect("an exe");
        Setup {
            dir,
            signer: Signer::new(),
        }
    }

    fn exe(&self) -> PathBuf {
        self.dir.path().join("app/OpenNote.exe")
    }

    fn updater(&self, current: &str) -> Updater<MemoryFetch, FolderReplacer, FixedClock> {
        let config = config(self.dir.path(), current, Channel::Stable, vec![self.signer.public()]);
        Updater::new(
            config,
            MemoryFetch::default(),
            FolderReplacer::new(self.exe()),
            FixedClock::default(),
        )
    }

    fn state(&self) -> UpdaterState {
        UpdaterState::load(&self.dir.path().join("updates"))
    }

    fn dirs(&self) -> crate::config::UpdaterDirs {
        config(self.dir.path(), "0.0.0", Channel::Stable, Vec::new()).dirs
    }

    /// 0.4.0 downloads and stages 0.5.0.
    fn staged_updater(&self) -> Updater<MemoryFetch, FolderReplacer, FixedClock> {
        let updater = self.updater("0.4.0");
        let data = exe_bytes("0.5.0");
        updater.fetch.serve(EXE_URL, data.clone());
        let offer = Offer {
            version: Version::new(0, 5, 0),
            notes: String::new(),
            url: Url::parse(EXE_URL).expect("https"),
            size: data.len() as u64,
            sha256: sha256_of(&data[..]).expect("hashes"),
            signature: sign(&self.signer, &data, &comment("0.5.0", "OpenNote_Windows64.exe")),
        };
        updater.download(&offer, &|_, _| {}).expect("stages");
        updater
    }

    /// 0.4.0 installs 0.5.0, so 0.5.0 is pending with a checked copy of 0.4.0 in previous\.
    fn applied(&self) {
        self.staged_updater().apply(Relaunch::Now).expect("applies");
    }

    fn start(&self, current: &str) -> GuardDecision {
        let replacer = FolderReplacer::new(self.exe());
        guard_on_start(&self.dirs(), &Version::parse(current).expect("valid"), &replacer)
    }
}

#[test]
fn apply_keeps_a_checked_previous_copy_and_swaps_in_the_update() {
    let setup = Setup::new();
    let applied = setup.staged_updater().apply(Relaunch::Now).expect("applies");
    assert_eq!(
        (applied.from.to_string(), applied.to.to_string()),
        ("0.4.0".into(), "0.5.0".into())
    );
    assert_eq!(applied.exe, setup.exe());
    assert_eq!(fs::read(setup.exe()).expect("reads"), exe_bytes("0.5.0"));
    let previous = setup.dir.path().join("previous/OpenNote-0.4.0-windows-x86_64.exe");
    assert_eq!(fs::read(&previous).expect("kept"), exe_bytes("0.4.0"));
    let state = setup.state();
    assert_eq!(
        state.pending.map(|p| (p.version, p.from, p.attempts)),
        Some(("0.5.0".into(), "0.4.0".into(), 0))
    );
    assert_eq!(state.previous.map(|p| p.version), Some("0.4.0".into()));
    assert_eq!(state.staged, None);
    assert!(!PathBuf::from(format!("{}.new", setup.exe().display())).exists());
}

#[test]
fn a_failed_swap_leaves_a_working_exe_and_nothing_pending() {
    for failure in [Failure::BeforeRename, Failure::AfterRename] {
        let setup = Setup::new();
        let updater = setup.staged_updater();
        updater.replacer.fail(Some(failure));
        assert!(
            matches!(updater.apply(Relaunch::Now), Err(UpdateError::Swap(_))),
            "{failure:?}"
        );
        assert_eq!(
            fs::read(setup.exe()).expect("an exe"),
            exe_bytes("0.4.0"),
            "{failure:?}"
        );
        assert_eq!(setup.state().pending, None, "{failure:?}");
    }
}

#[test]
fn apply_checks_the_staged_file_again_first() {
    let setup = Setup::new();
    let updater = setup.staged_updater();
    let staged = setup.dir.path().join("updates/OpenNote-0.5.0-windows-x86_64.exe");
    let mut bytes = fs::read(&staged).expect("reads");
    bytes[5] ^= 1;
    fs::write(&staged, bytes).expect("writes");
    assert!(matches!(
        updater.apply(Relaunch::NextLaunch),
        Err(UpdateError::Verify(_))
    ));
    assert_eq!(fs::read(setup.exe()).expect("an exe"), exe_bytes("0.4.0"));
    assert_eq!((setup.state().staged, setup.state().pending), (None, None));
}

#[test]
fn the_guard_decides_by_the_table() {
    let v = |text: &str| Version::parse(text).expect("valid");
    let pending = |version: &str, attempts| PendingRecord {
        version: version.into(),
        from: "0.4.0".into(),
        attempts,
        unknown: Default::default(),
    };
    assert_eq!(guard::step(None, &v("0.5.0")), Step::Normal);
    assert_eq!(guard::step(Some(&pending("0.5.1", 0)), &v("0.5.0")), Step::Forget);
    assert_eq!(guard::step(Some(&pending("0.5.0", 0)), &v("0.5.0")), Step::Count(1));
    assert_eq!(guard::step(Some(&pending("0.5.0", 1)), &v("0.5.0")), Step::Count(2));
    assert_eq!(guard::step(Some(&pending("0.5.0", 2)), &v("0.5.0")), Step::RollBack);
    assert_eq!(guard::step(Some(&pending("0.5.0", 9)), &v("0.5.0")), Step::RollBack);
}

#[test]
fn two_starts_that_never_become_healthy_roll_back_on_the_third() {
    let setup = Setup::new();
    setup.applied();
    assert_eq!(
        setup.start("0.5.0"),
        GuardDecision::Continue {
            counted_attempt: Some(1)
        }
    );
    assert_eq!(
        setup.start("0.5.0"),
        GuardDecision::Continue {
            counted_attempt: Some(2)
        }
    );
    let decision = setup.start("0.5.0");
    assert_eq!(
        decision,
        GuardDecision::RolledBack {
            from: Version::new(0, 5, 0),
            to: Version::new(0, 4, 0),
            relaunch: setup.exe(),
        }
    );
    assert_eq!(fs::read(setup.exe()).expect("an exe"), exe_bytes("0.4.0"));
    let state = setup.state();
    assert_eq!(
        (state.pending, state.blocked_versions),
        (None, vec!["0.5.0".to_owned()])
    );
    assert_eq!(
        state.rolled_back.map(|r| (r.from, r.to)),
        Some(("0.5.0".into(), "0.4.0".into()))
    );
    assert_eq!(setup.start("0.4.0"), GuardDecision::Continue { counted_attempt: None });
}

#[test]
fn a_healthy_start_clears_pending() {
    let setup = Setup::new();
    setup.applied();
    assert_eq!(
        setup.start("0.5.0"),
        GuardDecision::Continue {
            counted_attempt: Some(1)
        }
    );
    setup.updater("0.5.0").mark_healthy().expect("marks");
    assert_eq!(setup.state().pending, None);
    assert_eq!(setup.start("0.5.0"), GuardDecision::Continue { counted_attempt: None });
    setup.updater("0.4.0").mark_healthy().expect("does nothing");
}

#[test]
fn a_pending_record_for_another_version_is_forgotten() {
    let setup = Setup::new();
    setup.applied();
    assert_eq!(setup.start("0.4.0"), GuardDecision::Continue { counted_attempt: None });
    assert_eq!(setup.state().pending, None);
}

#[test]
fn a_missing_or_damaged_previous_copy_means_no_rollback() {
    let setup = Setup::new();
    setup.applied();
    let previous = setup.dir.path().join("previous/OpenNote-0.4.0-windows-x86_64.exe");
    fs::write(&previous, b"damaged").expect("writes");
    setup.start("0.5.0");
    setup.start("0.5.0");
    let unavailable = GuardDecision::RollbackUnavailable {
        from: Version::new(0, 5, 0),
        previous: Some(Version::new(0, 4, 0)),
    };
    assert_eq!(setup.start("0.5.0"), unavailable);
    assert_eq!(fs::read(setup.exe()).expect("an exe"), exe_bytes("0.5.0"));
    assert_eq!(setup.state().pending, None);
}

#[test]
fn a_previous_record_pointing_outside_previous_is_not_used() {
    let setup = Setup::new();
    setup.applied();
    let outside = setup.dir.path().join("OpenNote-0.4.0-windows-x86_64.exe");
    fs::write(&outside, exe_bytes("evil")).expect("writes");
    let sha256 = sha256_of(&exe_bytes("evil")[..]).expect("hashes");
    let record = PreviousRecord {
        version: "0.4.0".into(),
        path: outside.display().to_string(),
        sha256,
        unknown: Default::default(),
    };
    setup
        .updater("0.5.0")
        .change_state(|state| state.previous = Some(record))
        .expect("saves");
    assert!(setup.updater("0.5.0").previous().is_none());
}

#[test]
fn go_back_restores_the_previous_copy_and_removes_it() {
    let setup = Setup::new();
    setup.applied();
    let updater = setup.updater("0.5.0");
    assert_eq!(updater.previous().map(|p| p.version), Some(Version::new(0, 4, 0)));
    let applied = updater.go_back().expect("goes back");
    assert_eq!(
        (applied.from, applied.to),
        (Version::new(0, 5, 0), Version::new(0, 4, 0))
    );
    assert_eq!(fs::read(setup.exe()).expect("an exe"), exe_bytes("0.4.0"));
    assert!(!setup
        .dir
        .path()
        .join("previous/OpenNote-0.4.0-windows-x86_64.exe")
        .exists());
    assert_eq!((setup.state().previous, setup.state().pending), (None, None));
    assert!(
        matches!(updater.go_back(), Err(UpdateError::Swap(_))),
        "there is no going back twice"
    );
}

#[test]
fn the_running_version_is_never_offered_as_the_previous_one() {
    let setup = Setup::new();
    setup.applied();
    assert!(setup.updater("0.4.0").previous().is_none());
    assert_eq!(
        setup.updater("0.5.0").previous_version_unchecked(),
        Some(Version::new(0, 4, 0))
    );
}
