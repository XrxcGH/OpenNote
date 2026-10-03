//! Real swaps on Windows (ARCHITECTURE.md section 18.14). examples/fake_app.rs links the updater. Each test makes
//! copies of it with a version trailer and signs the new one in memory. A server on 127.0.0.1 serves the manifest
//! and the exe. The tests then run real `self_replace` swaps: update and restart, and rollback after two failed
//! starts. They also cover a second launch during a pending update, a damaged previous copy, and skipping. The
//! last ones are going back, and a swap that fails halfway.
#![cfg(windows)]

#[path = "support/server.rs"]
mod server;

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use opennote_updater::{verify::sha256_of, PlatformKey};
use serde_json::{json, Value};
use server::{Route, Server};
use tempfile::TempDir;

/// The fake app, built by `cargo test` with the other examples, or here when a single test runs.
fn fake_app() -> &'static [u8] {
    static BYTES: OnceLock<Vec<u8>> = OnceLock::new();
    BYTES.get_or_init(|| {
        let test_exe = std::env::current_exe().expect("the test exe");
        let profile = test_exe
            .parent()
            .and_then(Path::parent)
            .expect("the target profile folder");
        let exe = profile.join("examples").join("fake_app.exe");
        if !exe.exists() {
            let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
            let status = Command::new(cargo)
                .args(["build", "-p", "opennote-updater", "--example", "fake_app"])
                .status()
                .expect("cargo runs");
            assert!(status.success(), "the fake app builds");
        }
        fs::read(exe).expect("the fake app")
    })
}

fn with_version(version: &str) -> Vec<u8> {
    let mut bytes = fake_app().to_vec();
    bytes.extend_from_slice(format!("#fake-app-version:{version}\n").as_bytes());
    bytes
}

struct World {
    dir: TempDir,
    server: Server,
    pair: minisign::KeyPair,
}

impl World {
    /// Version 1.0.0 installed at app\OpenNote.exe.
    fn new() -> World {
        let dir = tempfile::tempdir().expect("a folder");
        fs::create_dir_all(dir.path().join("app")).expect("the app folder");
        let world = World {
            dir,
            server: Server::start(),
            pair: minisign::KeyPair::generate_unencrypted_keypair().expect("a key pair"),
        };
        fs::write(world.exe(), with_version("1.0.0")).expect("installs 1.0.0");
        world
    }

    fn exe(&self) -> PathBuf {
        self.dir.path().join("app").join("OpenNote.exe")
    }

    fn manifest_url(&self) -> String {
        self.server.url("/latest.json")
    }

    /// Serves a signed copy of `version` and a manifest offering it.
    fn publish(&self, version: &str) {
        let bytes = with_version(version);
        let file = PlatformKey::current().expect("a Windows build").file();
        let comment = format!("timestamp:1790757747\tfile:{file}\tversion:{version}");
        let signature = minisign::sign(Some(&self.pair.pk), &self.pair.sk, &bytes[..], Some(&comment), None)
            .expect("signs")
            .to_string();
        let entry = json!({
            "url": self.server.url("/OpenNote.exe"),
            "signature": STANDARD.encode(signature),
            "size": bytes.len(),
            "sha256": sha256_of(&bytes[..]).expect("hashes"),
        });
        let key = PlatformKey::current().expect("a Windows build").key();
        let manifest = json!({ "version": version, "notes": "", "platforms": { key: entry } });
        self.server.route("/latest.json", Route::ok(manifest.to_string()));
        self.server.route("/OpenNote.exe", Route::ok(bytes));
    }

    fn command(&self, args: &[&str], env: &[(&str, &str)]) -> Command {
        let public = self.pair.pk.to_box().expect("a key box").into_string();
        let mut command = Command::new(self.exe());
        command
            .args(args)
            .env("FAKE_APP_DIR", self.dir.path())
            .env("FAKE_APP_PUBKEY", public)
            .envs(env.iter().copied());
        command
    }

    /// Waits until no copy of the app holds the instance lock, so the next launch isn't forwarded.
    fn wait_until_idle(&self) {
        let deadline = Instant::now() + Duration::from_secs(30);
        let lock = self.dir.path().join("instance.lock");
        loop {
            let mut options = fs::OpenOptions::new();
            options.write(true).create(true).truncate(false);
            std::os::windows::fs::OpenOptionsExt::share_mode(&mut options, 0);
            if options.open(&lock).is_ok() {
                return;
            }
            assert!(Instant::now() < deadline, "the app never let go of its instance lock");
            thread::sleep(Duration::from_millis(50));
        }
    }

    /// Runs the installed exe once no other copy runs, and waits for it, not for any relaunch it starts.
    fn run(&self, args: &[&str], env: &[(&str, &str)]) {
        self.wait_until_idle();
        self.command(args, env).status().expect("the app runs");
    }

    fn start(&self, args: &[&str], env: &[(&str, &str)]) -> Child {
        self.wait_until_idle();
        self.command(args, env).spawn().expect("the app starts")
    }

    fn events(&self) -> Vec<String> {
        let text = fs::read_to_string(self.dir.path().join("events.log")).unwrap_or_default();
        text.lines().map(str::to_owned).collect()
    }

    /// Forgets the events so far, so the next wait only sees new ones.
    fn clear_events(&self) {
        self.wait_until_idle();
        let _ = fs::remove_file(self.dir.path().join("events.log"));
    }

    /// Waits up to 30 s for an event, which relaunched processes write.
    fn wait_for(&self, event: &str) {
        let deadline = Instant::now() + Duration::from_secs(30);
        while !self.events().iter().any(|line| line == event) {
            assert!(Instant::now() < deadline, "no \"{event}\" in {:#?}", self.events());
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn installed(&self) -> String {
        let bytes = fs::read(self.exe()).expect("an exe at the path");
        let text = String::from_utf8_lossy(&bytes[bytes.len() - 40..]).into_owned();
        text.rsplit("#fake-app-version:")
            .next()
            .unwrap_or_default()
            .trim()
            .to_owned()
    }

    fn state(&self) -> Value {
        let path = self.dir.path().join("updates").join("state.json");
        serde_json::from_slice(&fs::read(path).expect("the state file")).expect("json")
    }

    /// 1.0.0 updates to 2.0.0, which starts healthy.
    fn update_to_2(&self, env: &[(&str, &str)]) {
        self.publish("2.0.0");
        self.run(&["update", &self.manifest_url()], env);
        self.wait_for("applied 1.0.0 2.0.0");
    }
}

#[test]
fn updates_restarts_and_starts_healthy() {
    let world = World::new();
    world.update_to_2(&[]);
    world.wait_for("healthy 2.0.0");
    assert_eq!(world.installed(), "2.0.0");
    assert_eq!(world.state()["pending"], Value::Null);
    assert_eq!(world.state()["previous"]["version"], "1.0.0");
    assert!(world
        .events()
        .iter()
        .any(|line| line.contains("start 2.0.0 Continue { counted_attempt: Some(1) }")));
    let previous = world.dir.path().join("previous");
    assert_eq!(fs::read_dir(previous).expect("a previous folder").count(), 1);
}

#[test]
fn two_failed_starts_roll_back_on_the_third() {
    let world = World::new();
    let failing = [("FAKE_APP_FAIL_BEFORE_READY", "2.0.0")];
    world.update_to_2(&failing);
    world.wait_for("crashed 2.0.0");
    world.run(&[], &failing);
    assert_eq!(world.state()["pending"]["attempts"], 2);
    world.clear_events();
    world.run(&[], &failing);
    world.wait_for("healthy 1.0.0");
    assert!(
        world.events().iter().any(|line| line.contains("from Some(\"2.0.0\")")),
        "{:#?}",
        world.events()
    );
    assert_eq!(world.installed(), "1.0.0");
    let state = world.state();
    assert_eq!(state["blockedVersions"], json!(["2.0.0"]));
    assert_eq!(
        (&state["rolledBack"]["from"], &state["rolledBack"]["to"]),
        (&json!("2.0.0"), &json!("1.0.0"))
    );
    world.run(&["check", &world.manifest_url()], &[]);
    world.wait_for("checked UpToDate");
}

#[test]
fn a_second_launch_during_a_pending_update_doesnt_count() {
    let world = World::new();
    let failing = [("FAKE_APP_FAIL_BEFORE_READY", "2.0.0")];
    world.update_to_2(&failing);
    world.wait_for("crashed 2.0.0");
    let mut first = world.start(&["hold", "3000"], &[]);
    let deadline = Instant::now() + Duration::from_secs(20);
    while world.state()["pending"]["attempts"] != 2 {
        assert!(Instant::now() < deadline, "the first launch never counted");
        thread::sleep(Duration::from_millis(50));
    }
    world.command(&[], &[]).status().expect("the second launch runs");
    world.wait_for("forwarded 2.0.0");
    assert_eq!(
        world.state()["pending"]["attempts"],
        2,
        "the second launch didn't count"
    );
    first.wait().expect("the first launch ends");
    world.wait_for("healthy 2.0.0");
    assert_eq!(world.state()["pending"], Value::Null);
}

#[test]
fn a_damaged_previous_copy_keeps_the_new_version() {
    let world = World::new();
    let failing = [("FAKE_APP_FAIL_BEFORE_READY", "2.0.0")];
    world.update_to_2(&failing);
    world.wait_for("crashed 2.0.0");
    world.run(&[], &failing);
    let previous = world.state()["previous"]["path"].as_str().expect("a path").to_owned();
    fs::write(previous, b"damaged").expect("writes");
    world.run(&[], &[]);
    world.wait_for("healthy 2.0.0");
    assert!(world.events().iter().any(|line| line.contains("RollbackUnavailable")));
    assert_eq!(world.installed(), "2.0.0");
}

#[test]
fn a_skipped_version_isnt_offered() {
    let world = World::new();
    world.publish("2.0.0");
    world.run(&["check", &world.manifest_url(), "2.0.0"], &[]);
    world.wait_for("checked UpToDate");
    world.run(&["check", &world.manifest_url()], &[]);
    world.wait_for("checked available 2.0.0");
}

#[test]
fn go_back_restores_the_previous_version() {
    let world = World::new();
    world.update_to_2(&[]);
    world.wait_for("healthy 2.0.0");
    world.clear_events();
    world.run(&["go-back"], &[]);
    world.wait_for("went back 2.0.0 1.0.0");
    world.wait_for("healthy 1.0.0");
    assert_eq!(world.installed(), "1.0.0");
    assert_eq!(world.state()["previous"], Value::Null);
    assert_eq!(
        fs::read_dir(world.dir.path().join("previous"))
            .expect("a folder")
            .count(),
        0
    );
}

#[test]
fn a_failed_swap_after_the_rename_leaves_a_working_exe() {
    let world = World::new();
    world.publish("2.0.0");
    world.run(
        &["update", &world.manifest_url()],
        &[("FAKE_APP_FAIL_SWAP", "after-rename")],
    );
    world.wait_for("update failed swapFailed");
    assert_eq!(world.installed(), "1.0.0");
    assert_eq!(world.state()["pending"], Value::Null);
    world.clear_events();
    world.run(&[], &[]);
    world.wait_for("healthy 1.0.0");
}
