//! The Installed apps entry against a fake registry root, and the removal of the app's folder.

use super::*;

fn entry(registry: &MemoryRegistry, name: &str) -> Option<RegValue> {
    registry.read(&entry_key(), name)
}

#[test]
fn writes_every_value_installed_apps_shows() {
    let dir = tempfile::tempdir().expect("a temp folder");
    fs::write(dir.path().join(INSTALLED_EXE_NAME), vec![0u8; 4096]).expect("an exe");
    let registry = MemoryRegistry::default();
    write_entry(&registry, dir.path(), "0.1.0-beta.5").expect("written");

    let text = |value: &str| Some(RegValue::Text(value.to_owned()));
    let exe = dir.path().join(INSTALLED_EXE_NAME);
    assert_eq!(entry(&registry, "DisplayName"), text("OpenNote"));
    assert_eq!(entry(&registry, "DisplayVersion"), text("0.1.0-beta.5"));
    assert_eq!(entry(&registry, "Publisher"), text(PUBLISHER));
    assert_eq!(
        entry(&registry, "InstallLocation"),
        text(&dir.path().display().to_string())
    );
    assert_eq!(
        entry(&registry, "UninstallString"),
        text(&format!("\"{}\" --uninstall", exe.display()))
    );
    assert_eq!(entry(&registry, "EstimatedSize"), Some(RegValue::Number(4)));
    assert_eq!(entry(&registry, "NoModify"), Some(RegValue::Number(1)));
    assert_eq!(
        entry_key(),
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenNote"
    );
}

#[test]
fn a_refresh_after_an_update_keeps_the_install_date_and_changes_the_version() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let registry = MemoryRegistry::default();
    registry
        .write(&entry_key(), &[("InstallDate", RegValue::Text("20260102".into()))])
        .expect("an old entry");
    write_entry(&registry, dir.path(), "0.1.0-beta.6").expect("written");
    assert_eq!(entry(&registry, "InstallDate"), Some(RegValue::Text("20260102".into())));
    assert_eq!(
        entry(&registry, "DisplayVersion"),
        Some(RegValue::Text("0.1.0-beta.6".into()))
    );
}

#[test]
fn removing_the_entry_removes_the_key_and_nothing_beside_it() {
    let registry = MemoryRegistry::default();
    let other = format!(r"{UNINSTALL_ROOT}\SomethingElse");
    registry
        .write(&other, &[("DisplayName", RegValue::Text("Else".into()))])
        .expect("other");
    write_entry(&registry, Path::new(r"C:\nowhere"), "1.0.0").expect("written");
    remove_entry(&registry).expect("removed");
    assert!(!registry.has_key(&entry_key()));
    assert!(registry.has_key(&other));
    remove_entry(&registry).expect("removing twice is fine");
}

#[test]
fn reads_the_uninstall_arguments() {
    let args = |items: &[&str]| items.iter().map(|item| (*item).to_owned()).collect::<Vec<_>>();
    assert_eq!(request_from(&args(&[])), Request::None);
    assert_eq!(request_from(&args(&["opennote://page/x"])), Request::None);
    assert_eq!(request_from(&args(&["--uninstall"])), Request::Uninstall);
    assert_eq!(
        request_from(&args(&["--uninstall-finish", "--wait-pid", "42"])),
        Request::Finish { wait_pid: Some(42) }
    );
}

fn installed(root: &Path) -> Plan {
    let app_dir = root.join("Programs").join("OpenNote");
    fs::create_dir_all(app_dir.join("bin")).expect("folders");
    fs::write(app_dir.join(INSTALLED_EXE_NAME), b"exe").expect("exe");
    fs::write(app_dir.join("bin").join("opennote.exe"), b"cli").expect("cli");
    Plan {
        app_dir,
        shortcut: root.join("OpenNote.lnk"),
        notes_folder: Some(root.join("Documents").join("OpenNote")),
    }
}

#[test]
fn removes_the_app_folder_and_never_the_notes_folder() {
    let root = tempfile::tempdir().expect("a temp folder");
    let plan = installed(root.path());
    let notes = plan.notes_folder.clone().expect("notes");
    fs::create_dir_all(&notes).expect("notes folder");
    fs::write(notes.join("notebook.json"), b"{}").expect("a notebook");
    fs::write(&plan.shortcut, b"lnk").expect("shortcut");
    let registry = MemoryRegistry::default();
    write_entry(&registry, &plan.app_dir, "1.0.0").expect("entry");

    remove_links(&plan, &registry).expect("links");
    assert_eq!(remove_app_dir(&plan).expect("removed"), 2);
    assert!(!plan.app_dir.exists());
    assert!(!plan.shortcut.exists());
    assert!(!registry.has_key(&entry_key()));
    assert!(notes.join("notebook.json").is_file());
}

#[test]
fn a_notes_folder_inside_the_app_folder_survives() {
    let root = tempfile::tempdir().expect("a temp folder");
    let mut plan = installed(root.path());
    let notes = plan.app_dir.join("My notes");
    fs::create_dir_all(notes.join("Biology")).expect("notes");
    fs::write(notes.join("Biology").join("notebook.json"), b"{}").expect("a notebook");
    plan.notes_folder = Some(notes.clone());

    remove_app_dir(&plan).expect("removed");
    assert!(!plan.app_dir.join(INSTALLED_EXE_NAME).exists());
    assert!(notes.join("Biology").join("notebook.json").is_file());
}

#[test]
fn a_folder_without_the_app_is_left_alone() {
    let root = tempfile::tempdir().expect("a temp folder");
    fs::write(root.path().join("keep.txt"), b"x").expect("a file");
    let plan = Plan {
        app_dir: root.path().to_path_buf(),
        shortcut: root.path().join("none.lnk"),
        notes_folder: None,
    };
    assert_eq!(remove_app_dir(&plan).expect("nothing to do"), 0);
    assert!(root.path().join("keep.txt").is_file());
}

#[test]
fn the_plan_reads_the_notes_folder_from_settings_without_changing_them() {
    let root = tempfile::tempdir().expect("a temp folder");
    let paths = Paths::under_profile(root.path());
    fs::create_dir_all(paths.settings_file.parent().expect("a folder")).expect("folders");
    let settings = r#"{ "storage": { "notesFolder": "D:\\Notes" } }"#;
    fs::write(&paths.settings_file, settings).expect("settings");
    let plan = plan(&paths);
    assert_eq!(plan.notes_folder, Some(PathBuf::from(r"D:\Notes")));
    assert_eq!(plan.app_dir, programs_dir(&paths));
    assert_eq!(fs::read_to_string(&paths.settings_file).expect("settings"), settings);
}

#[test]
fn dates_are_calendar_dates() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(civil_from_days(20_454), (2026, 1, 1));
    assert_eq!(today().len(), 8);
}
