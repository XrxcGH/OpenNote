use serde_json::json;

use super::*;

#[test]
fn serializes_folder_checks_by_kind() {
    let check = FolderCheck::HasLibrary { notebook_count: 3 };
    assert_eq!(
        serde_json::to_value(check).expect("serializes"),
        json!({ "kind": "hasLibrary", "notebookCount": 3 })
    );
    assert_eq!(
        serde_json::to_value(FolderCheck::WillCreate).expect("serializes"),
        json!({ "kind": "willCreate" })
    );
}

#[test]
fn a_relative_folder_is_never_accepted() {
    assert_eq!(check_folder_with(Path::new("notes"), &[]), FolderCheck::NotAbsolute);
}

#[test]
fn finds_programs_and_the_shortcut_inside_a_test_profile() {
    let paths = Paths::under_profile(Path::new("C:\\profile"));
    assert_eq!(programs_dir(&paths), Path::new("C:\\profile\\Programs\\OpenNote"));
    assert_eq!(
        shortcut_path(&paths),
        Path::new("C:\\profile\\Microsoft\\Windows\\Start Menu\\Programs\\OpenNote.lnk")
    );
}

#[test]
fn compares_folders_the_way_windows_does() {
    assert!(same_folder(Path::new("C:\\Users\\Ada\\"), Path::new("c:\\users\\ada")));
    assert!(!same_folder(Path::new("C:\\Users\\Ada"), Path::new("C:\\Users\\Adam")));
    assert!(is_inside(
        Path::new("C:\\Apps\\OpenNote\\notes"),
        Path::new("c:\\apps\\opennote")
    ));
    assert!(!is_inside(
        Path::new("C:\\Apps\\OpenNotes"),
        Path::new("C:\\Apps\\OpenNote")
    ));
}

#[test]
fn checks_each_kind_of_notes_folder() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let root = dir.path();
    assert_eq!(check_folder_with(root, &[]), FolderCheck::Ok);
    assert_eq!(
        check_folder_with(&root.join("new").join("deeper"), &[]),
        FolderCheck::WillCreate
    );
    assert_eq!(
        check_folder_with(&root.join("inside"), &[root]),
        FolderCheck::InsideAppFolder
    );

    let file = root.join("a-file");
    fs::write(&file, "x").expect("a file");
    assert_eq!(check_folder_with(&file, &[]), FolderCheck::NotWritable);
    assert_eq!(check_folder_with(&file.join("sub"), &[]), FolderCheck::NotWritable);

    for name in ["Work", "Home"] {
        let notebook = root.join(name);
        fs::create_dir(&notebook).expect("a folder");
        fs::write(notebook.join(NOTEBOOK_MARKER), "{}").expect("a marker");
    }
    fs::create_dir(root.join("Not a notebook")).expect("a folder");
    assert_eq!(
        check_folder_with(root, &[]),
        FolderCheck::HasLibrary { notebook_count: 2 }
    );
}

#[test]
fn reports_a_folder_you_can_write_to() {
    let dir = tempfile::tempdir().expect("a temp folder");
    assert!(folder_writable(dir.path()));
    assert!(!folder_writable(&dir.path().join("missing")));
    assert_eq!(
        fs::read_dir(dir.path()).expect("a folder").count(),
        0,
        "the probe is removed"
    );
}

#[test]
fn copies_the_exe_under_its_installed_name_and_checks_it() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let source = dir.path().join("OpenNote_Windows64.exe");
    fs::write(&source, vec![7u8; 100_000]).expect("an exe");
    let target = copy_exe(&source, &dir.path().join("Programs").join("OpenNote")).expect("copies");
    assert_eq!(
        target.file_name().and_then(|name| name.to_str()),
        Some(INSTALLED_EXE_NAME)
    );
    assert_eq!(fs::read(&target).expect("reads"), fs::read(&source).expect("reads"));
    assert!(!target.with_extension("exe.tmp").exists());
    // Copying again replaces the file in place.
    assert!(copy_exe(&source, target.parent().expect("a folder")).is_ok());
}

#[cfg(windows)]
#[test]
fn the_copy_keeps_the_mark_of_the_web() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let source = dir.path().join("OpenNote_Windows64.exe");
    fs::write(&source, b"exe").expect("an exe");
    let mark = "[ZoneTransfer]\r\nZoneId=3\r\n";
    fs::write(format!("{}:Zone.Identifier", source.display()), mark).expect("a stream");
    let target = copy_exe(&source, &dir.path().join("Programs")).expect("copies");
    let copied = fs::read_to_string(format!("{}:Zone.Identifier", target.display())).expect("the stream came along");
    assert_eq!(copied, mark);
}

#[cfg(windows)]
#[test]
fn the_shortcut_is_created_with_its_app_user_model_id() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let target = dir.path().join("OpenNote.exe");
    fs::write(&target, b"exe").expect("an exe");
    let shortcut = dir.path().join("Start Menu").join("OpenNote.lnk");
    create_shortcut(&shortcut, &target).expect("creates the shortcut");
    assert!(shortcut.is_file());
    // The identifier is stored as UTF-16 inside the link's property store.
    let bytes = fs::read(&shortcut).expect("reads");
    let id: Vec<u8> = APP_USER_MODEL_ID.encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert!(bytes.windows(id.len()).any(|window| window == id.as_slice()));
}

#[test]
fn leaves_anything_but_an_opennote_exe_alone() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let other = dir.path().join("important.exe");
    fs::write(&other, b"x").expect("a file");
    delete_moved_from(other.clone());
    thread::sleep(Duration::from_millis(300));
    assert!(other.exists());
}

#[test]
fn removes_the_old_copy_after_a_move() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let old = dir.path().join("OpenNote_Windows64.exe");
    fs::write(&old, b"x").expect("a file");
    delete_moved_from(old.clone());
    let deadline = Instant::now() + Duration::from_secs(5);
    while old.exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(!old.exists());
}
