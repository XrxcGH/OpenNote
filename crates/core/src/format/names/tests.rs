#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::cell::RefCell;
use std::collections::HashSet;

use proptest::prelude::*;

use super::*;

fn free(title: &str) -> String {
    safe_folder_name(title, &|_| false)
}

fn asset_id() -> AssetId {
    AssetId::parse("01m3sa43z1tp9rdr5e8df2jbxy").unwrap()
}

#[test]
fn keeps_ordinary_titles() {
    assert_eq!(free("Biology"), "Biology");
    assert_eq!(free("Semester 1 – Lab reports"), "Semester 1 – Lab reports");
    assert_eq!(free("日本語のノート"), "日本語のノート");
}

#[test]
fn replaces_and_removes_unsafe_characters() {
    assert_eq!(free("a/b\\c|d:e"), "a-b-c-d-e");
    assert_eq!(free("What? <Really> \"yes\"*"), "What Really yes");
    assert_eq!(free("tab\there\nnew"), "tab here new");
    assert_eq!(free("zero\u{200b}width\u{feff}"), "zerowidth");
    assert_eq!(free("  lots   of \u{a0} space  "), "lots of space");
}

#[test]
fn trims_dots_tildes_and_spaces() {
    assert_eq!(free("...hidden"), "hidden");
    assert_eq!(free("~$lock"), "$lock");
    assert_eq!(free("notes. . ."), "notes");
    assert_eq!(free(". ~ . name . ."), "name");
    assert_eq!(free("...."), "Untitled");
    assert_eq!(free(""), "Untitled");
    assert_eq!(free("<>?*"), "Untitled");
}

#[test]
fn normalizes_to_nfc() {
    assert_eq!(free("Cafe\u{301}"), "Caf\u{e9}");
}

#[test]
fn avoids_reserved_names() {
    assert_eq!(free("CON"), "CON_");
    assert_eq!(free("con.txt"), "con_.txt");
    assert_eq!(free("Com1.notes.md"), "Com1_.notes.md");
    assert_eq!(free("LPT\u{b9}"), "LPT\u{b9}_");
    assert_eq!(free("CONOUT$"), "CONOUT$_");
    assert_eq!(free("desktop.ini"), "desktop.ini_");
    assert_eq!(free("my_vti_folder"), "my_vti-folder");
    assert_eq!(free("x_VTI_vti_y"), "x_VTI-vti_y");
    assert_eq!(free("a<\u{301}b"), "\u{e1}b");
    assert_eq!(free("Console"), "Console");
    assert_eq!(free("COM10"), "COM10");
}

#[test]
fn truncates_to_64_utf16_units() {
    let long = "a".repeat(100);
    assert_eq!(free(&long), "a".repeat(64));
    let emoji = "😀".repeat(40);
    let name = free(&emoji);
    assert_eq!(name.encode_utf16().count(), 64);
    let ends_with_dot = format!("{}.b", "a".repeat(63));
    assert_eq!(free(&ends_with_dot), "a".repeat(63));
    let reserved_long = format!("CON.{}", "x".repeat(60));
    let name = free(&reserved_long);
    assert!(name.starts_with("CON_.") && name.encode_utf16().count() == 64, "{name}");
}

#[test]
fn numbers_clashes_within_the_limit() {
    let taken: HashSet<String> = ["biology", "biology (2)"].iter().map(|s| fold_name(s)).collect();
    let name = safe_folder_name("Biology", &|n| taken.contains(&fold_name(n)));
    assert_eq!(name, "Biology (3)");
    let long = "b".repeat(64);
    let name = safe_folder_name(&long, &|n| n == long);
    assert_eq!(name, format!("{} (2)", "b".repeat(60)));
    assert_eq!(fold_name("Cafe\u{301}"), "caf\u{e9}");
}

/// Step 9: a clash that only the file system finds, such as a name that differs in normalization, is marked
/// taken, and the next call picks the next number.
#[test]
fn retries_after_a_clash_only_the_file_system_finds() {
    let on_disk = RefCell::new(vec!["BIOLOGY".to_owned()]);
    let mut taken: HashSet<String> = HashSet::new();
    let create = |name: &str| !on_disk.borrow().iter().any(|n| n.eq_ignore_ascii_case(name));
    let mut name = safe_folder_name("Biology", &|n| taken.contains(&fold_name(n)));
    while !create(&name) {
        taken.insert(fold_name(&name));
        name = safe_folder_name("Biology", &|n| taken.contains(&fold_name(n)));
    }
    assert_eq!(name, "Biology (2)");
    on_disk.borrow_mut().push(name);
}

#[test]
fn makes_asset_names() {
    let id = asset_id();
    assert_eq!(
        asset_file_name(id, "Leaf section.png", "image/png"),
        "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png"
    );
    assert_eq!(
        asset_file_name(id, "Photo.JPEG", "image/jpeg"),
        "01m3sa43z1tp9rdr5e8df2jbxy-photo.jpeg"
    );
    assert_eq!(
        asset_file_name(id, "scan", "application/pdf"),
        "01m3sa43z1tp9rdr5e8df2jbxy-scan.pdf"
    );
    assert_eq!(
        asset_file_name(id, "---.png", "image/png"),
        "01m3sa43z1tp9rdr5e8df2jbxy.png"
    );
    assert_eq!(
        asset_file_name(id, "notes.verylongext", "x/unknown"),
        "01m3sa43z1tp9rdr5e8df2jbxy-notes.bin"
    );
    assert_eq!(
        asset_file_name(id, ".bashrc", "text/plain"),
        "01m3sa43z1tp9rdr5e8df2jbxy-bashrc.txt"
    );
    assert_eq!(
        asset_file_name(id, "Ünïcödé Café.PNG", "image/png"),
        "01m3sa43z1tp9rdr5e8df2jbxy-ünïcödé-café.png"
    );
    let long = asset_file_name(id, &format!("{}.png", "abc-".repeat(20)), "image/png");
    assert_eq!(long, "01m3sa43z1tp9rdr5e8df2jbxy-abc-abc-abc-abc-abc-abc.png");
}

#[test]
fn lowercases_before_filtering_so_stems_stay_letters() {
    // U+0130 lowercases to "i" and a combining dot, which is not a letter.
    let name = asset_file_name(asset_id(), "\u{130}stanbul.jpg", "image/jpeg");
    assert!(check_asset_file_name(asset_id(), &name), "{name}");
}

#[test]
fn checks_asset_names() {
    let id = asset_id();
    for good in [
        "01m3sa43z1tp9rdr5e8df2jbxy.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-leaf-section.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-日本.pdf",
    ] {
        assert!(check_asset_file_name(id, good), "{good}");
    }
    let bad = [
        "01m3sa43z1tp9rdr5e8df2jbxy",
        "01m3sa43z1tp9rdr5e8df2jbxy.",
        "01m3sa43z1tp9rdr5e8df2jbxy-.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-a.b.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-../x.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-a b.png",
        "01m3sa43z1tp9rdr5e8df2jbxy.PNG",
        "01m3sa43z1tp9rdr5e8df2jbxy.toolongext",
        "01M3SA43Z1TP9RDR5E8DF2JBXY.png",
        "01m3sa43z1tp9rdr5e8df2jbxz.png",
        "../01m3sa43z1tp9rdr5e8df2jbxy.png",
        "01m3sa43z1tp9rdr5e8df2jbxy-a\\b.png",
    ];
    for name in bad {
        assert!(!check_asset_file_name(id, name), "{name}");
    }
}

#[test]
fn recognizes_conflict_copies() {
    let cases = [
        (
            "page (Sam's conflicted copy 2026-09-30).json",
            Some(ConflictCopyOf::Page),
        ),
        ("page-LAPTOP.json", Some(ConflictCopyOf::Page)),
        (
            "page.sync-conflict-20260930-140312-ABCDEFG.json",
            Some(ConflictCopyOf::Page),
        ),
        (
            "page (conflicted copy 2026-09-30 140312).json",
            Some(ConflictCopyOf::Page),
        ),
        ("page 2.json", Some(ConflictCopyOf::Page)),
        ("Page (1).json", Some(ConflictCopyOf::Page)),
        ("section-DESKTOP.json", Some(ConflictCopyOf::Section)),
        ("notebook (1).json", Some(ConflictCopyOf::Notebook)),
        ("versions 2.json", Some(ConflictCopyOf::Versions)),
        ("item-LAPTOP.json", Some(ConflictCopyOf::TrashItem)),
        ("page.json", None),
        ("section.json", None),
        ("page.md", None),
        ("~page.json.0a1b2c3d.tmp", None),
        ("other.json", None),
    ];
    for (name, expected) in cases {
        assert_eq!(conflict_copy_kind(name), expected, "{name}");
    }
}

/// Checks every rule of spec 3.4 on a result of `safe_folder_name`.
fn assert_valid_folder_name(name: &str) -> Result<(), TestCaseError> {
    prop_assert!(!name.is_empty());
    prop_assert!(name.encode_utf16().count() <= MAX_FOLDER_NAME_UNITS);
    prop_assert!(!name
        .chars()
        .any(|c| c.is_control() || "/\\|:<>\"?*".contains(c) || is_invisible(c)));
    prop_assert!(!name.starts_with(['.', '~', ' ']) && !name.ends_with(['.', ' ']));
    prop_assert!(!name.contains("  "));
    let stem = name.split('.').next().unwrap_or("").trim_end();
    prop_assert!(!is_reserved_stem(stem), "reserved: {}", name);
    prop_assert!(!name.eq_ignore_ascii_case("desktop.ini"));
    prop_assert!(!name.to_ascii_lowercase().contains("_vti_"));
    prop_assert_eq!(name.nfc().collect::<String>(), name);
    Ok(())
}

fn arb_title() -> impl Strategy<Value = String> {
    prop_oneof![
        any::<String>(),
        "[ .~a-zA-Z0-9_/\\\\:<>?*|\"\u{200b}\u{feff}\u{301}\u{b9}$-]{0,80}",
        "(CON|con|Com1|LPT\u{b3}|desktop|NUL|_vti_)(\\.[a-z .]{0,6})?",
    ]
}

proptest! {
    /// P8: folder names are valid by every rule, never empty, within their limits, and stable.
    #[test]
    fn folder_names_are_valid_and_stable(title in arb_title()) {
        let name = free(&title);
        assert_valid_folder_name(&name)?;
        prop_assert_eq!(free(&name), name);
    }

    /// P8: numbered names stay valid and within the limit.
    #[test]
    fn numbered_names_are_valid(title in arb_title(), n in 2u32..100_000) {
        let name = numbered(&free(&title), n);
        prop_assert!(name.encode_utf16().count() <= MAX_FOLDER_NAME_UNITS);
        prop_assert!(!name.starts_with(['.', '~', ' ']));
    }

    /// P8: asset names pass the reader's check, keep their stem short, and are stable.
    #[test]
    fn asset_names_are_valid_and_stable(original in any::<String>(), mime in "(image/png|application/pdf|x/y)") {
        let id = asset_id();
        let name = asset_file_name(id, &original, &mime);
        prop_assert!(check_asset_file_name(id, &name), "{}", name);
        let rest = &name[26..];
        let stem = rest.strip_prefix('-').and_then(|r| r.rsplit_once('.')).map_or("", |(stem, _)| stem);
        prop_assert!(stem.encode_utf16().count() <= MAX_STEM_UNITS);
        if !stem.is_empty() {
            let again = asset_file_name(id, rest.trim_start_matches('-'), &mime);
            prop_assert_eq!(again, name);
        }
    }
}
