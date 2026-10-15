//! Check notebook's repairs (A2-2): a damaged page comes back from its history, a damaged file from the newest
//! backup, and a `page.md` that doesn't match is written again. Undo puts back what each repair replaced.

mod real_core;

use std::path::{Path, PathBuf};

use opennote_core::id::{BlockId, Id};
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::session::core::Core;
use opennote_core::store::backup::BackupPolicy;
use opennote_core::store::repair::Repair;
use real_core::Real;
use serde_json::json;

fn table(n: u128, cell: &str) -> Edit {
    let column = "01m3sabc31y0rfa24eeh6j4ky4";
    let data = json!({
        "header": true,
        "columns": [{"id": column, "width": 200}],
        "rows": [{"id": "01m3sabc336ewa9gjr9z4z3dpv", "cells": {column: {"markdown": cell}}}]
    });
    Edit::InsertBlock {
        block: NewBlock {
            id: BlockId(Id::from_parts(1_800_000_000_000, n)),
            type_name: "table".into(),
            frame: None,
            data: data.as_object().cloned().unwrap(),
            fallback: None,
        },
        after: None,
        before: None,
    }
}

fn problems(core: &Core, root: &Path) -> Vec<(String, String)> {
    let open = core.find_open(root).expect("the notebook is open");
    let report = open.verify().unwrap();
    report
        .problems
        .iter()
        .map(|(_, w)| (w.code.to_owned(), w.detail.clone()))
        .collect()
}

fn has(problems: &[(String, String)], code: &str) -> bool {
    problems.iter().any(|(c, _)| c == code)
}

/// A notebook with one saved, named version of its page. Returns the notebook folder and the page folder.
fn saved(real: &mut Real) -> (PathBuf, PathBuf) {
    let handle = real.open();
    handle.apply(real.request(vec![table(5, "Kept")])).unwrap();
    let saved = handle.save_now().unwrap();
    handle
        .name_version(saved.revision, Some("Before".into()), false)
        .unwrap();
    handle.close(&real.client).unwrap();
    let root = real.notebook.path().to_path_buf();
    let page = root.join(real.section.to_string()).join(real.page.to_string());
    (root, page)
}

#[test]
fn a_damaged_page_comes_back_from_its_history_and_undo_puts_back_what_was_there() {
    let mut real = Real::new();
    let (root, page) = saved(&mut real);
    let page_json = page.join("page.json");
    std::fs::write(&page_json, b"{ damaged").unwrap();
    assert!(has(&problems(&real.core, &root), "page.invalid"));

    let undo = real
        .core
        .repair(&root, &Repair::PageFromHistory { page: page.clone() })
        .unwrap();
    assert!(!has(&problems(&real.core, &root), "page.invalid"));
    assert!(std::fs::read_to_string(&page_json).unwrap().contains("Kept"));

    real.core.undo_repair(&root, &undo).unwrap();
    assert_eq!(std::fs::read(&page_json).unwrap(), b"{ damaged");
}

#[test]
fn a_damaged_file_comes_back_from_the_newest_backup() {
    let mut real = Real::new();
    let (root, page) = saved(&mut real);
    let backups = real.dir.path().join("Backups");
    real.notebook.backup_to(&backups, &BackupPolicy::default(), 0).unwrap();
    let page_json = page.join("page.json");
    let good = std::fs::read(&page_json).unwrap();
    std::fs::write(&page_json, b"nonsense").unwrap();

    let repair = Repair::FromBackup {
        file: page_json.clone(),
        backups: backups.clone(),
    };
    let undo = real.core.repair(&root, &repair).unwrap();
    assert_eq!(std::fs::read(&page_json).unwrap(), good);
    real.core.undo_repair(&root, &undo).unwrap();
    assert_eq!(std::fs::read(&page_json).unwrap(), b"nonsense");

    let outside = Repair::FromBackup {
        file: root.join("..").join("elsewhere.txt"),
        backups,
    };
    assert!(
        real.core.repair(&root, &outside).is_err(),
        "only files inside the notebook"
    );
}

#[test]
fn a_page_md_that_does_not_match_is_written_again_and_the_edited_copy_is_kept() {
    let mut real = Real::new();
    let (root, page) = saved(&mut real);
    let md = page.join("page.md");
    std::fs::write(&md, b"# Typed elsewhere\n").unwrap();
    assert!(problems(&real.core, &root)
        .iter()
        .any(|(c, d)| c == "page.mdMismatch" && d == "edited"));

    let undo = real.core.repair(&root, &Repair::PageMd { page: page.clone() }).unwrap();
    assert!(!has(&problems(&real.core, &root), "page.mdMismatch"));
    assert!(std::fs::read_to_string(&md).unwrap().contains("Kept"));
    let kept = std::fs::read_dir(page.join(".conflicts"))
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().ends_with(".edited"));
    assert!(kept, "the edited copy is kept aside");

    real.core.undo_repair(&root, &undo).unwrap();
    assert_eq!(std::fs::read(&md).unwrap(), b"# Typed elsewhere\n");
}
