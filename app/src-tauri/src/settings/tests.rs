use std::{fs, path::Path};

use serde_json::json;

use super::*;
use schema::ThemePreference;

fn profile() -> (tempfile::TempDir, Paths) {
    let folder = tempfile::tempdir().expect("a folder");
    let paths = Paths::under_profile(folder.path());
    (folder, paths)
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().expect("a parent")).expect("a folder");
    fs::write(path, text).expect("writes");
}

fn on_disk(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("reads")).expect("JSON")
}

#[test]
fn applies_a_patch_and_returns_the_new_settings() {
    let store = SettingsStore::in_memory(&Settings::default());
    let settings = store
        .update(json!({ "appearance": { "theme": "dark" } }), "main")
        .expect("valid");
    assert_eq!(settings.appearance.theme, ThemePreference::Dark);
    assert_eq!(store.get(), settings);
}

#[test]
fn an_invalid_patch_changes_nothing() {
    let store = SettingsStore::in_memory(&Settings::default());
    assert!(store
        .update(json!({ "appearance": { "theme": "purple" } }), "main")
        .is_err());
    let error = store
        .update(json!({ "appearance": { "textSize": 120 } }), "main")
        .expect_err("invalid");
    assert_eq!(error.field.as_deref(), Some("appearance.textSize"));
    let error = store
        .update(json!({ "shortcuts": { "theme.toggle": ["Tab"] } }), "main")
        .expect_err("a reserved key");
    assert_eq!(error.field.as_deref(), Some("shortcuts.theme.toggle"));
    let error = store
        .update(json!({ "schemaVersion": 7 }), "main")
        .expect_err("versions");
    assert_eq!(error.field.as_deref(), Some("schemaVersion"));
    assert_eq!(store.get(), Settings::default());
}

#[test]
fn keeps_keys_it_doesnt_know() {
    let store = SettingsStore::in_memory(&Settings::default());
    store.update(json!({ "future": { "a": 1 } }), "main").expect("valid");
    store
        .update(json!({ "startup": { "openLastPage": false } }), "main")
        .expect("valid");
    assert_eq!(store.raw()["future"], json!({ "a": 1 }));
}

#[test]
fn resets_one_section() {
    let store = SettingsStore::in_memory(&Settings::default());
    let patch = json!({ "appearance": { "theme": "light", "extra": 1 }, "startup": { "openLastPage": false } });
    store.update(patch, "main").expect("valid");
    let settings = store.reset(SettingsSectionKey::Appearance, "main").expect("resets");
    assert_eq!(settings.appearance, schema::Appearance::default());
    assert!(!settings.startup.open_last_page);
    assert_eq!(store.raw()["appearance"].get("extra"), None);
}

#[test]
fn a_first_run_starts_from_the_defaults_and_saves_after_a_change() {
    let (_folder, paths) = profile();
    let loaded = SettingsStore::load(&paths);
    assert!(loaded.first_run && loaded.notices.is_empty());
    assert!(
        !paths.settings_file.exists(),
        "nothing is written until something changes"
    );
    let store = loaded.store;
    store
        .update(json!({ "startup": { "openLastPage": false } }), "main")
        .expect("valid");
    store.flush().expect("saves");
    assert_eq!(
        on_disk(&paths.settings_file)["startup"],
        json!({ "openLastPage": false })
    );
}

#[test]
fn a_theme_change_is_saved_at_once() {
    let (_folder, paths) = profile();
    let store = SettingsStore::load(&paths).store;
    store
        .update(json!({ "appearance": { "theme": "dark" } }), "main")
        .expect("valid");
    assert_eq!(on_disk(&paths.settings_file)["appearance"]["theme"], json!("dark"));
}

#[test]
fn a_good_load_keeps_a_backup_copy() {
    let (_folder, paths) = profile();
    write(&paths.settings_file, r#"{ "appearance": { "theme": "light" } }"#);
    let loaded = SettingsStore::load(&paths);
    assert!(!loaded.first_run);
    assert_eq!(loaded.store.get().appearance.theme, ThemePreference::Light);
    let backup = on_disk(&file::with_suffix(&paths.settings_file, ".bak"));
    assert_eq!(backup["appearance"]["theme"], json!("light"));
}

#[test]
fn a_corrupt_file_is_set_aside_and_the_backup_used() {
    let (_folder, paths) = profile();
    write(
        &file::with_suffix(&paths.settings_file, ".bak"),
        r#"{ "appearance": { "theme": "dark" } }"#,
    );
    write(&paths.settings_file, "{ not json");
    let loaded = SettingsStore::load(&paths);
    assert_eq!(loaded.store.get().appearance.theme, ThemePreference::Dark);
    let [Notice::SettingsReset { saved_as }] = loaded.notices.as_slice() else {
        panic!("one reset notice, not {:?}", loaded.notices);
    };
    assert!(saved_as.starts_with("settings.corrupt-") && saved_as.ends_with(".json"));
    let set_aside = paths.settings_file.with_file_name(saved_as);
    assert_eq!(fs::read_to_string(set_aside).expect("kept"), "{ not json");
    assert_eq!(on_disk(&paths.settings_file)["appearance"]["theme"], json!("dark"));
}

#[test]
fn a_corrupt_file_without_a_backup_gives_the_defaults() {
    let (_folder, paths) = profile();
    write(&paths.settings_file, "[1, 2");
    let loaded = SettingsStore::load(&paths);
    assert_eq!(loaded.store.get(), Settings::default());
    assert!(!loaded.first_run);
    assert!(matches!(loaded.notices.as_slice(), [Notice::SettingsReset { .. }]));
    assert_eq!(on_disk(&paths.settings_file)["schemaVersion"], json!(1));
}

#[test]
fn a_newer_schema_that_allows_older_writers_is_written_through() {
    let (_folder, paths) = profile();
    let newer = json!({
        "schemaVersion": 3, "minWriterSchema": 1,
        "appearance": { "theme": "sepia", "density": "touch" }, "future": [1, 2]
    });
    write(&paths.settings_file, &newer.to_string());
    let loaded = SettingsStore::load(&paths);
    assert!(!loaded.store.read_only() && loaded.notices.is_empty());
    assert_eq!(loaded.store.get().appearance.theme, ThemePreference::System);
    loaded
        .store
        .update(json!({ "appearance": { "density": "mouse" } }), "main")
        .expect("valid");
    loaded.store.flush().expect("saves");
    let saved = on_disk(&paths.settings_file);
    assert_eq!(
        (saved["schemaVersion"].clone(), saved["minWriterSchema"].clone()),
        (json!(3), json!(1))
    );
    assert_eq!(saved["appearance"], json!({ "theme": "sepia", "density": "mouse" }));
    assert_eq!(saved["future"], json!([1, 2]));
}

#[test]
fn a_newer_schema_that_forbids_older_writers_is_never_written() {
    let (_folder, paths) = profile();
    let newer = r#"{ "schemaVersion": 2, "minWriterSchema": 2, "appearance": { "theme": "dark" } }"#;
    write(&paths.settings_file, newer);
    let loaded = SettingsStore::load(&paths);
    assert!(loaded.store.read_only());
    assert_eq!(loaded.notices, [Notice::SettingsReadOnly]);
    let settings = loaded
        .store
        .update(json!({ "appearance": { "theme": "light" } }), "main")
        .expect("in memory");
    assert_eq!(settings.appearance.theme, ThemePreference::Light);
    loaded.store.flush().expect("nothing to save");
    assert_eq!(fs::read_to_string(&paths.settings_file).expect("reads"), newer);
}

#[test]
fn migrations_back_up_first_and_keep_three_backups() {
    fn rename(mut raw: Value) -> Value {
        raw["renamed"] = json!(true);
        raw
    }
    let steps = [migrate::Migration {
        from: 1,
        breaking: false,
        run: rename,
    }];
    let (_folder, paths) = profile();
    write(&paths.settings_file, r#"{ "schemaVersion": 1 }"#);
    for _ in 0..4 {
        let files = (paths.settings_file.as_path(), paths.backups.as_path());
        let raw = on_disk(&paths.settings_file);
        let migrated = load::migrate_with_backup(&raw, files, &steps, 2).expect("migrates");
        assert_eq!(
            (migrated["schemaVersion"].clone(), migrated["renamed"].clone()),
            (json!(2), json!(true))
        );
        std::thread::sleep(Duration::from_millis(15));
    }
    let backups: Vec<_> = fs::read_dir(&paths.backups)
        .expect("lists")
        .filter_map(Result::ok)
        .collect();
    assert_eq!(backups.len(), load::BACKUPS_KEPT);
    assert!(backups
        .iter()
        .all(|entry| entry.file_name().to_string_lossy().starts_with("settings-v1-")));
}

/// Writes `Settings::default()` next to the generated types, where a Vitest test compares it with the
/// interface's defaults. CI's drift check fails when the committed copy differs.
#[test]
fn exports_the_defaults_for_the_interface() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/platform/bindings/settings-default.json");
    let mut text = serde_json::to_string_pretty(&Settings::default()).expect("serializes");
    text.push('\n');
    if fs::read_to_string(&path).ok().as_deref() != Some(text.as_str()) {
        fs::write(&path, text).expect("writes");
    }
}

#[test]
fn a_saved_version_1_file_loads() {
    let (_folder, paths) = profile();
    write(
        &paths.settings_file,
        include_str!("../../tests/fixtures/settings-v1.json"),
    );
    let settings = SettingsStore::load(&paths).store.get();
    assert_eq!(settings.appearance.theme, ThemePreference::Dark);
    assert_eq!(settings.appearance.text_size.percent(), 125);
    assert_eq!(
        settings.storage.notes_folder.as_deref(),
        Some("C:\\Users\\Ada\\Documents\\OpenNote")
    );
    assert_eq!(settings.shortcuts["theme.toggle"], ["Ctrl+Alt+K"]);
    assert_eq!(settings.updates.skipped_version.as_deref(), Some("0.4.1"));
}

/// The environment variable that turns [`kill_child_writes_forever`] into the child process of the kill test.
const KILL_TEST_FILE: &str = "OPENNOTE_KILL_TEST_FILE";

fn documents() -> [Value; 2] {
    let words: Vec<String> = (0..5_000).map(|n| format!("word{n}")).collect();
    let old = json!({ "version": "old", "editing": { "spelling": { "personalWords": words } } });
    let new = json!({ "version": "new", "editing": { "spelling": { "personalWords": words } } });
    [old, new]
}

/// The child of the kill test: writes the two documents in turn until it's stopped.
#[test]
#[ignore = "runs only as the kill test's child process"]
fn kill_child_writes_forever() {
    let Some(path) = std::env::var_os(KILL_TEST_FILE) else {
        return;
    };
    let path = std::path::PathBuf::from(path);
    for document in documents().iter().cycle() {
        file::write_json(&path, document).expect("writes");
    }
}

#[test]
fn a_write_killed_at_any_moment_leaves_the_old_file_or_the_new_one() {
    let folder = tempfile::tempdir().expect("a folder");
    let path = folder.path().join("settings.json");
    let [old, new] = documents();
    file::write_json(&path, &old).expect("writes");
    let exe = std::env::current_exe().expect("the test binary");
    for run in 0..200u64 {
        let mut child = std::process::Command::new(&exe)
            .args([
                "--exact",
                "settings::tests::kill_child_writes_forever",
                "--ignored",
                "--quiet",
            ])
            .env(KILL_TEST_FILE, &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the child starts");
        std::thread::sleep(Duration::from_millis(20 + run * 7 % 40));
        child.kill().expect("stops");
        let _ = child.wait();
        let saved = on_disk(&path);
        assert!(saved == old || saved == new, "run {run} left a damaged file");
    }
}
