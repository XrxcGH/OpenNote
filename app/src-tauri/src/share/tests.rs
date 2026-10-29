use std::time::{Duration, SystemTime};

use super::*;

fn file(name: &str, mime: &str, bytes: &[u8]) -> SharedFile {
    SharedFile {
        name: name.into(),
        mime: mime.into(),
        bytes: bytes.to_vec(),
    }
}

#[test]
fn text_becomes_a_page_titled_by_its_first_line() {
    let blocks = to_blocks(Shared {
        text: Some("\n  Shopping list\nEggs\nMilk\u{0007}".into()),
        ..Shared::default()
    });
    assert_eq!(blocks.title, "Shopping list");
    assert_eq!(blocks.markdown, "Shopping list\nEggs\nMilk");
    assert_eq!(blocks.link, None);
    assert!(blocks.files.is_empty());
}

#[test]
fn a_link_goes_first_and_titles_the_page_when_there_is_no_text() {
    let blocks = to_blocks(Shared {
        uri: Some("https://example.org/rivers/".into()),
        ..Shared::default()
    });
    assert_eq!(blocks.title, "example.org/rivers");
    assert_eq!(blocks.markdown, "<https://example.org/rivers/>");
    let both = to_blocks(Shared {
        text: Some("Read this".into()),
        uri: Some("https://example.org/a".into()),
        ..Shared::default()
    });
    assert_eq!(both.markdown, "<https://example.org/a>\n\nRead this");
    // A browser shares the address as the text too; it isn't added twice.
    let same = to_blocks(Shared {
        text: Some("https://example.org/a".into()),
        uri: Some("https://example.org/a".into()),
        ..Shared::default()
    });
    assert_eq!(same.markdown, "<https://example.org/a>");
}

#[test]
fn only_web_and_mail_links_are_kept() {
    for bad in [
        "javascript:alert(1)",
        "file:///C:/Windows/win.ini",
        "ms-settings:privacy",
        "https://a b",
        "data:text/html,x",
    ] {
        assert_eq!(safe_link(bad), None, "{bad}");
        let blocks = to_blocks(Shared {
            uri: Some(bad.into()),
            ..Shared::default()
        });
        assert_eq!(blocks.link, None);
        assert!(!blocks.markdown.contains(':'), "{bad}: {}", blocks.markdown);
    }
    assert_eq!(
        safe_link("mailto:a@example.org").as_deref(),
        Some("mailto:a@example.org")
    );
}

#[test]
fn pictures_and_files_keep_safe_names_and_a_trusted_type() {
    let blocks = to_blocks(Shared {
        files: vec![
            file("Shared picture.png", "image/png", b"png"),
            file("..\\..\\evil.exe", "application/x-msdownload", b"MZ"),
            file("notes.pdf", "", b"%PDF"),
            file("odd.docx", "<script>", b"PK"),
        ],
        ..Shared::default()
    });
    assert_eq!(blocks.title, "Shared picture.png");
    let names: Vec<&str> = blocks.files.iter().map(|file| file.name.as_str()).collect();
    assert_eq!(names, ["Shared picture.png", "evil.exe", "notes.pdf", "odd.docx"]);
    let types: Vec<&str> = blocks.files.iter().map(|file| file.mime.as_str()).collect();
    assert_eq!(
        types,
        [
            "image/png",
            "application/x-msdownload",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ]
    );
    assert_eq!(blocks.files[0].data, "cG5n");
}

#[test]
fn an_empty_share_still_has_a_title() {
    assert_eq!(to_blocks(Shared::default()).title, "Shared item");
}

#[test]
fn text_is_cut_at_the_limit_on_a_character_boundary() {
    let long = "é".repeat(MAX_TEXT);
    let clean = clean_text(&long);
    assert!(clean.len() <= MAX_TEXT);
    assert!(clean.len() > MAX_TEXT - 4);
}

#[test]
fn the_inbox_keeps_a_share_until_it_is_taken_once() {
    let dir = tempfile::tempdir().expect("a folder");
    let inbox = dir.path().join("inbox");
    let id = save(
        &inbox,
        Shared {
            text: Some("Hello".into()),
            files: vec![file("a.png", "image/png", b"one"), file("b.txt", "text/plain", b"two")],
            ..Shared::default()
        },
    )
    .expect("saved");
    assert!(inbox.join(&id).join("0.bin").exists());
    assert!(
        !inbox.join(&id).join("a.png").exists(),
        "files never keep their own names on disk"
    );
    let taken = take_all(&inbox, SystemTime::now());
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0].title, "Hello");
    assert_eq!(taken[0].files.len(), 2);
    assert_eq!(taken[0].files[1].data, "dHdv");
    assert!(take_all(&inbox, SystemTime::now()).is_empty(), "a share is added once");
}

#[test]
fn too_many_or_too_large_files_are_named_not_kept() {
    let dir = tempfile::tempdir().expect("a folder");
    let mut files: Vec<SharedFile> = (0..MAX_FILES + 2)
        .map(|at| file(&format!("{at}.txt"), "text/plain", b"x"))
        .collect();
    files.insert(
        0,
        file("huge.bin", "", &vec![0u8; usize::try_from(MAX_FILE).expect("fits") + 1]),
    );
    save(
        dir.path(),
        Shared {
            files,
            ..Shared::default()
        },
    )
    .expect("saved");
    let taken = take_all(dir.path(), SystemTime::now());
    assert_eq!(taken[0].files.len(), MAX_FILES);
    assert_eq!(taken[0].skipped, ["huge.bin", "10.txt", "11.txt"]);
}

#[test]
fn stale_and_half_written_shares_are_never_added() {
    let dir = tempfile::tempdir().expect("a folder");
    save(
        dir.path(),
        Shared {
            text: Some("Old".into()),
            ..Shared::default()
        },
    )
    .expect("saved");
    std::fs::create_dir_all(dir.path().join("0000000000000-half")).expect("a folder");
    let later = SystemTime::now() + STALE + Duration::from_secs(60);
    assert!(take_all(dir.path(), later).is_empty());
    assert!(
        !dir.path().join("0000000000000-half").exists(),
        "an old half-written share is cleared"
    );
    assert_eq!(std::fs::read_dir(dir.path()).expect("the inbox").count(), 0);
}

#[test]
fn a_missing_inbox_is_simply_empty() {
    let dir = tempfile::tempdir().expect("a folder");
    assert!(take_all(&dir.path().join("none"), SystemTime::now()).is_empty());
}
