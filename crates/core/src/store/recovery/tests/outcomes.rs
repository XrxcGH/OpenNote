//! Every row of spec 17.8 and every outcome of spec 20.10.

use super::*;
use crate::format::gzip::gzip;
use crate::model::{Access, ReadOnlyReason};
use crate::seams::Codec;
use crate::store::fs::Fs;
use crate::store::journal::format::{encode_header, HeaderMeta};
use crate::store::journal::reader::JournalHeader;
use crate::store::layout::journal_file_name;

fn fast() -> Timings {
    Timings {
        group_commit: Duration::from_millis(10),
        ..Timings::default()
    }
}

fn slow() -> Timings {
    Timings {
        group_commit: Duration::from_secs(3_600),
        ..Timings::default()
    }
}

#[test]
fn an_app_crash_keeps_records_that_reached_the_operating_system() {
    let mut sim = Sim::new(slow());
    sim.retitle("One");
    sim.draw(1);
    sim.thread.open_tree(&key(&sim.fs), meta(&sim.fs)).unwrap();
    let (fs, codec, oracle) = sim.crash(MemCrash::App);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 2, strokes: 0 }
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(2));
    assert_eq!(journal_files(&fs), 0, "a confirmed save deletes the generations");
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Nothing,
        "running it again changes nothing"
    );
}

#[test]
fn a_power_cut_loses_only_what_was_not_flushed() {
    let mut sim = Sim::new(slow());
    sim.retitle("One");
    sim.flush();
    sim.retitle("Two");
    sim.thread.open_tree(&key(&sim.fs), meta(&sim.fs)).unwrap();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 1, strokes: 0 }
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}

#[test]
fn a_crash_after_save_begin_and_before_the_replace_replays_from_the_old_base() {
    let mut sim = Sim::new(fast());
    sim.retitle("One");
    sim.draw(1);
    let revision = crate::id::RevisionId(Id::from_parts(1_790_777_999_000, 1));
    sim.handle
        .as_ref()
        .unwrap()
        .save_begin(revision, sim.seq, WAIT)
        .unwrap();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 2, strokes: 0 }
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(2));
}

#[test]
fn a_crash_after_the_replace_replays_only_later_records() {
    let mut sim = Sim::new(fast());
    sim.retitle("One");
    sim.save();
    sim.draw(1);
    sim.flush();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 1, strokes: 0 }
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(2));
}

#[test]
fn a_crash_after_a_save_with_nothing_later_keeps_or_deletes_by_boot() {
    let mut sim = Sim::new(fast());
    sim.retitle("One");
    sim.save();
    sim.flush();
    let (fs, codec, _) = sim.crash(MemCrash::App);
    assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::Nothing);
    assert!(
        journal_files(&fs) > 0,
        "the same boot: the save may still be only in the cache"
    );
    let rebooted = fs.crash(MemCrash::PowerCut);
    assert_eq!(recover(&rebooted, &codec, Some(page_dir())), RecoveryOutcome::Nothing);
    assert_eq!(
        journal_files(&rebooted),
        0,
        "after a reboot, whatever page.json holds is on disk"
    );
}

#[test]
fn rotation_leaves_two_generations_that_replay_without_duplicates() {
    let mut sim = Sim::new(Timings {
        rotate_bytes: 1,
        ..fast()
    });
    sim.retitle("One");
    sim.save();
    sim.retitle("Two");
    sim.save();
    sim.draw(3);
    sim.flush();
    assert!(journal_files(&sim.fs) >= 2);
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 1, strokes: 0 }
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(3));
}

#[test]
fn a_parked_journal_after_an_unconfirmed_save_goes_after_a_reboot() {
    let mut sim = Sim::new(fast());
    sim.fs.set_confirmed(false);
    sim.retitle("One");
    let outcome = sim.save();
    assert_eq!(outcome.durability, Durability::Unconfirmed);
    sim.handle
        .take()
        .unwrap()
        .close(Some((outcome.revision.id, Durability::Unconfirmed)));
    sim.flush();
    let (fs, codec, _) = sim.crash(MemCrash::PowerCut);
    assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::Nothing);
    assert_eq!(journal_files(&fs), 0);
}

#[test]
fn strokes_still_being_drawn_become_strokes() {
    let mut sim = Sim::new(fast());
    sim.draw(1);
    let handle = sim.handle.as_ref().unwrap();
    handle.append_ink_progress(&stroke(2));
    handle.append_ink_progress(&stroke(3));
    let seq = handle.append_ink_progress(&stroke(3));
    sim.seq = seq;
    sim.draw(3);
    sim.flush();
    let (fs, codec, _) = sim.crash(MemCrash::PowerCut);
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 2, strokes: 1 }
    );
    let page = on_disk(&fs, &codec, &page_dir());
    for n in 1..=3 {
        assert!(page.ink.stroke(stroke(n).id).is_some(), "stroke {n}");
    }
}

/// A saved page with one unsaved edit in its journal, crashed, and `change` done to the files afterward.
fn crashed_with(change: impl FnOnce(&MemFs, &RegistryCodec, &Page)) -> (MemFs, RegistryCodec, Vec<Page>) {
    let mut sim = Sim::new(fast());
    sim.retitle("Mine");
    sim.flush();
    let page = sim.page.clone();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    change(&fs, &codec, &page);
    (fs, codec, oracle)
}

#[test]
fn another_version_on_disk_is_kept_as_a_conflict() {
    let (fs, codec, oracle) = crashed_with(|fs, codec, page| {
        let mut theirs = page.clone();
        theirs.title = "Theirs".into();
        theirs.revision.id = crate::id::RevisionId(Id::from_parts(1_790_777_999_000, 9));
        fs.put(&NotebookLayout::page_json(&page_dir()), &codec.write_page(&theirs));
    });
    let outcome = recover(&fs, &codec, Some(page_dir()));
    let conflict = crate::id::RevisionId(Id::from_parts(1_790_777_999_000, 9));
    assert_eq!(outcome, RecoveryOutcome::KeptBoth { conflict });
    assert!(fs.exists(&NotebookLayout::conflict_path(&page_dir(), conflict)));
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}

#[test]
fn an_older_version_on_disk_is_fast_forwarded() {
    let (fs, codec, oracle) = crashed_with(|fs, codec, page| {
        let mut older = page.clone();
        older.revision.id = page.revision.ancestors[0];
        fs.put(&NotebookLayout::page_json(&page_dir()), &codec.write_page(&older));
    });
    assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::FastForward);
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}

#[test]
fn a_damaged_page_is_moved_aside_and_replaced() {
    let (fs, codec, oracle) = crashed_with(|fs, _, _| {
        fs.put(&NotebookLayout::page_json(&page_dir()), b"\0\0\0");
    });
    assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::ReplacedDamaged);
    assert!(fs.files().iter().any(|p| p.to_string_lossy().contains(".damaged")));
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}

#[test]
fn a_page_found_elsewhere_is_recovered_there() {
    let other = NotebookLayout::new(ROOT).page_dir(SectionId(Id::from_parts(5, 5)), sample_page().id);
    let (fs, codec, oracle) = crashed_with(|fs, _, _| {
        fs.mkdir_all(other.parent().unwrap());
        fs.rename_dir(&page_dir(), &other).unwrap();
    });
    assert_eq!(recover(&fs, &codec, Some(other.clone())), RecoveryOutcome::Relocated);
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &other), 0), Some(1));
}

#[test]
fn a_page_missing_everywhere_is_created_again_where_its_journal_says() {
    let mut sim = Sim::new(fast());
    sim.draw(1);
    sim.save();
    sim.retitle("Lost");
    sim.flush();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    fs.remove_dir_all(&page_dir()).unwrap();
    assert_eq!(recover(&fs, &codec, None), RecoveryOutcome::Recreated);
    let page = on_disk(&fs, &codec, &page_dir());
    assert_eq!(page.title, "Lost");
    assert!(page.assets.is_empty(), "the lost image can't come back");
    assert!(
        page.ink.stroke(sample_stroke().id).is_none(),
        "the ink of the lost folder is gone"
    );
    assert!(page.ink.stroke(stroke(1).id).is_some(), "the journal's ink comes back");
    assert!(step_of(&oracle, &page, 0).is_none(), "the page is what could be saved");
}

#[test]
fn records_that_fail_their_checks_go_to_a_recovery_file() {
    let mut sim = Sim::new(fast());
    sim.retitle("One");
    let bad = txn(
        sim.clock.now(),
        vec![Op::RemoveStrokes {
            strokes: vec![stroke(99)],
        }],
    );
    sim.seq = sim.handle.as_ref().unwrap().append_txn(&bad);
    sim.flush();
    let (fs, codec, oracle) = sim.crash(MemCrash::PowerCut);
    let outcome = recover(&fs, &codec, Some(page_dir()));
    let RecoveryOutcome::PartlyApplied { recovery_file } = outcome else {
        panic!("{outcome:?}");
    };
    let text = String::from_utf8(fs.get(&recovery_file).unwrap()).unwrap();
    assert!(
        text.contains("strokeEquals") && text.contains("removeStrokes"),
        "{text}"
    );
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}

#[test]
fn recovery_waits_when_it_must() {
    let (fs, codec, _) = crashed_with(|_, _, _| {});
    let generation = list_journals(&fs, Path::new(JOURNALS)).unwrap()[0].pages[&sample_page().id][0].clone();
    let lock = fs.try_lock(&generation).unwrap();
    assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::OwnerAlive);
    drop(lock);
    let json = NotebookLayout::page_json(&page_dir());
    fs.set_placeholder(&json, true);
    let unavailable = RecoveryOutcome::Deferred {
        reason: DeferReason::PageUnavailable,
    };
    assert_eq!(recover(&fs, &codec, Some(page_dir())), unavailable);
    fs.set_placeholder(&json, false);
    let mut newer = on_disk(&fs, &codec, &page_dir());
    newer.format.access = Access::ReadOnly(ReadOnlyReason::NewerFormat);
    let good = fs.get(&json).unwrap();
    fs.put(&json, &codec.write_page(&newer));
    let newer_page = RecoveryOutcome::Deferred {
        reason: DeferReason::NewerPage,
    };
    assert_eq!(recover(&fs, &codec, Some(page_dir())), newer_page);
    fs.put(&json, &good);
    assert!(journal_files(&fs) > 0, "waiting never deletes a generation");
}

/// Writes a generation of the sample page with this header, and no records.
fn put_generation(fs: &MemFs, number: u64, change: impl FnOnce(&mut JournalHeader, &mut HeaderMeta)) {
    let mut meta_value = HeaderMeta {
        app: "test".into(),
        boot: "old".into(),
        device: sample_device().id,
        notebook_identity: hex(&fs.folder_identity(Path::new(ROOT)).unwrap().0),
        notebook_path: ROOT.into(),
        section: Some(section()),
    };
    let mut header = JournalHeader {
        version: 1,
        notebook: sample_notebook_id(),
        page: sample_page().id,
        base: Default::default(),
        generation: number,
        anchor: 0,
        created: Timestamp::EPOCH,
        page_format: 1,
        meta: serde_json::Value::Null,
    };
    change(&mut header, &mut meta_value);
    header.meta = meta_value.to_value();
    let path = Path::new(JOURNALS)
        .join(key(fs).0)
        .join(journal_file_name(Some(sample_page().id), number));
    fs.put(&path, &encode_header(&header, &gzip(b"base")));
}

#[test]
fn newer_journals_and_other_folders_journals_are_left_alone() {
    let (fs, codec, _) = crashed_with(|_, _, _| {});
    put_generation(&fs, 9, |header, _| header.version = 2);
    let newer = RecoveryOutcome::Deferred {
        reason: DeferReason::NewerJournal,
    };
    assert_eq!(recover(&fs, &codec, Some(page_dir())), newer);
    let (fs, codec, _) = crashed_with(|_, _, _| {});
    put_generation(&fs, 9, |_, meta| meta.notebook_identity = "ff".repeat(24));
    let mismatch = RecoveryOutcome::Deferred {
        reason: DeferReason::IdentityMismatch,
    };
    assert_eq!(recover(&fs, &codec, Some(page_dir())), mismatch);
}

#[test]
fn a_generation_with_a_damaged_header_moves_to_recovery() {
    let (fs, codec, oracle) = crashed_with(|_, _, _| {});
    let path = Path::new(JOURNALS)
        .join(key(&fs).0)
        .join(journal_file_name(Some(sample_page().id), 7));
    fs.put(&path, b"not a journal");
    assert_eq!(
        recover(&fs, &codec, Some(page_dir())),
        RecoveryOutcome::Replayed { txns: 1, strokes: 0 }
    );
    assert!(!fs.exists(&path));
    assert!(fs.exists(&Path::new("/data/recovery").join(path.file_name().unwrap())));
    assert_eq!(step_of(&oracle, &on_disk(&fs, &codec, &page_dir()), 0), Some(1));
}
