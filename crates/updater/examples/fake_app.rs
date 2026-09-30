//! A tiny app that updates itself with this crate, for the real-swap integration tests in tests/swap.rs
//! (ARCHITECTURE.md section 18.14). It starts the way OpenNote does: the instance lock, then the start guard,
//! then a healthy start. Then it runs one command.
//!
//! Its version is a trailer that the tests append to a copy of this exe, `#fake-app-version:<version>`, read at
//! start. These variables set it up:
//!
//! - `FAKE_APP_DIR` holds its `updates\` and `previous\` folders, its instance lock, and its event log.
//! - `FAKE_APP_PUBKEY` is the only minisign public key it trusts.
//! - `FAKE_APP_FAIL_BEFORE_READY=<version>` makes that version exit before its start is healthy.
//! - `FAKE_APP_FAIL_SWAP=after-rename` makes swaps fail after renaming the exe aside.
//!
//! Commands: `update <manifest-url>`, `check <manifest-url> [<skipped-version>]`, `go-back`, and
//! `hold <milliseconds>`, which keeps the instance lock before the start is healthy.

use std::{
    collections::HashMap,
    env,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

use minisign_verify::PublicKey;
use opennote_updater::{
    fetch::UreqFetch, guard_on_start, schedule::SystemClock, swap::SelfReplace, Channel, ChannelUrls, Config,
    GuardDecision, Limits, PlatformKey, Relaunch, Replacer, Updater, UpdaterDirs, Url,
};
use semver::Version;

const TRAILER: &[u8] = b"#fake-app-version:";

/// `self_replace`, or a swap that fails after renaming the exe aside, as antivirus might make it.
struct FakeReplacer {
    fail_after_rename: bool,
}

impl Replacer for FakeReplacer {
    fn current_exe(&self) -> io::Result<PathBuf> {
        SelfReplace.current_exe()
    }

    fn replace_running_exe(&self, staged_next_to_exe: &Path) -> io::Result<()> {
        if !self.fail_after_rename {
            return SelfReplace.replace_running_exe(staged_next_to_exe);
        }
        let exe = self.current_exe()?;
        fs::rename(&exe, exe.with_extension("renamed-aside.exe"))?;
        Err(io::Error::other("the new copy was taken away"))
    }
}

fn own_version() -> Version {
    let bytes = fs::read(env::current_exe().expect("the exe path")).expect("the exe");
    let at = bytes
        .windows(TRAILER.len())
        .rposition(|window| window == TRAILER)
        .expect("a version trailer");
    let text = String::from_utf8_lossy(&bytes[at + TRAILER.len()..]);
    Version::parse(text.trim()).expect("a semver trailer")
}

fn log_event(dir: &Path, event: &str) {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("events.log"))
        .expect("the event log");
    writeln!(file, "{event}").expect("writes");
}

/// The instance lock: a file no other process may open. A relaunch waits up to 10 s for the old process to exit.
fn lock(dir: &Path, wait: bool) -> Option<File> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(false);
        #[cfg(windows)]
        std::os::windows::fs::OpenOptionsExt::share_mode(&mut options, 0);
        match options.open(dir.join("instance.lock")) {
            Ok(file) => return Some(file),
            Err(_) if wait && Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
}

fn config(dir: &Path, version: &Version, manifest: Option<&str>) -> Config {
    let url = Url::parse(manifest.unwrap_or("https://updates.invalid/latest.json")).expect("an allowed URL");
    let key = env::var("FAKE_APP_PUBKEY").expect("FAKE_APP_PUBKEY");
    let exe = env::current_exe().expect("the exe path");
    Config {
        current: version.clone(),
        platform: PlatformKey::current().expect("a Windows build"),
        channel: Channel::Stable,
        urls: ChannelUrls {
            stable: url.clone(),
            beta: url,
        },
        trusted_keys: vec![PublicKey::decode(&key).expect("a public key")],
        dirs: dirs(dir, &exe),
        limits: Limits::default(),
    }
}

fn dirs(dir: &Path, exe: &Path) -> UpdaterDirs {
    UpdaterDirs {
        updates: dir.join("updates"),
        previous: dir.join("previous"),
        exe_dir: exe.parent().expect("a folder").to_path_buf(),
    }
}

// The relaunched copy outlives this process on purpose, so nothing waits for it.
#[allow(clippy::zombie_processes)]
fn relaunch(exe: &Path, extra: &[&str]) {
    let pid = std::process::id().to_string();
    let mut args = vec!["--wait-pid", pid.as_str()];
    args.extend_from_slice(extra);
    Command::new(exe).args(args).spawn().expect("the relaunch starts");
}

fn replacer() -> FakeReplacer {
    FakeReplacer {
        fail_after_rename: env::var("FAKE_APP_FAIL_SWAP").is_ok_and(|value| value == "after-rename"),
    }
}

fn run_command(dir: &Path, version: &Version, command: &[String]) {
    let reads_manifest = matches!(command.first().map(String::as_str), Some("update" | "check"));
    let manifest = command.get(1).map(String::as_str).filter(|_| reads_manifest);
    let updater = Updater::new(
        config(dir, version, manifest),
        UreqFetch::default(),
        replacer(),
        SystemClock,
    );
    match command.first().map(String::as_str) {
        Some("update") => {
            let result = updater.check(None).and_then(|outcome| match outcome {
                opennote_updater::CheckOutcome::Available(offer) => updater.download(&offer, &|_, _| {}),
                other => Err(opennote_updater::UpdateError::Swap(format!(
                    "nothing to install: {other:?}"
                ))),
            });
            match result.and_then(|_| updater.apply(Relaunch::Now)) {
                Ok(applied) => {
                    log_event(dir, &format!("applied {} {}", applied.from, applied.to));
                    relaunch(&applied.exe, &["--after-update", &applied.from.to_string()]);
                }
                Err(error) => log_event(dir, &format!("update failed {}", error.code())),
            }
        }
        Some("check") => {
            let skipped = command.get(2).map(|text| Version::parse(text).expect("a version"));
            match updater.check(skipped.as_ref()) {
                Ok(opennote_updater::CheckOutcome::Available(offer)) => {
                    log_event(dir, &format!("checked available {}", offer.version));
                }
                Ok(outcome) => log_event(dir, &format!("checked {outcome:?}")),
                Err(error) => log_event(dir, &format!("check failed {}", error.code())),
            }
        }
        Some("go-back") => match updater.go_back() {
            Ok(applied) => {
                log_event(dir, &format!("went back {} {}", applied.from, applied.to));
                relaunch(&applied.exe, &[]);
            }
            Err(error) => log_event(dir, &format!("go back failed {}", error.code())),
        },
        _ => {}
    }
}

/// The `--name value` flags, and the other arguments in order.
fn split_args(args: &[String]) -> (HashMap<String, String>, Vec<String>) {
    let (mut flags, mut rest, mut at) = (HashMap::new(), Vec::new(), 0);
    while at < args.len() {
        if args[at].starts_with("--") {
            flags.insert(args[at].clone(), args.get(at + 1).cloned().unwrap_or_default());
            at += 2;
        } else {
            rest.push(args[at].clone());
            at += 1;
        }
    }
    (flags, rest)
}

fn main() {
    let dir = PathBuf::from(env::var_os("FAKE_APP_DIR").expect("FAKE_APP_DIR"));
    let (flags, command) = split_args(&env::args().skip(1).collect::<Vec<_>>());
    let version = own_version();
    let Some(_instance) = lock(&dir, flags.contains_key("--wait-pid")) else {
        log_event(&dir, &format!("forwarded {version}"));
        return;
    };
    let exe = env::current_exe().expect("the exe path");
    let decision = guard_on_start(&dirs(&dir, &exe), &version, &replacer());
    let from = flags.get("--rolled-back-from").or(flags.get("--after-update"));
    log_event(&dir, &format!("start {version} {decision:?} from {from:?}"));
    if let GuardDecision::RolledBack {
        from, relaunch: exe, ..
    } = decision
    {
        relaunch(&exe, &["--rolled-back-from", &from.to_string()]);
        return;
    }
    if command.first().is_some_and(|name| name == "hold") {
        thread::sleep(Duration::from_millis(command[1].parse().expect("milliseconds")));
    }
    if env::var("FAKE_APP_FAIL_BEFORE_READY").is_ok_and(|failing| failing == version.to_string()) {
        log_event(&dir, &format!("crashed {version}"));
        std::process::exit(3);
    }
    let updater = Updater::new(
        config(&dir, &version, None),
        UreqFetch::default(),
        replacer(),
        SystemClock,
    );
    updater.mark_healthy().expect("marks the start healthy");
    log_event(&dir, &format!("healthy {version}"));
    run_command(&dir, &version, &command);
}
