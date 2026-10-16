#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::path::Path;
use std::sync::Arc;

use super::*;
use crate::id::Id;
use crate::limits::Limits;
use crate::ops::{Op, Origin, PageFields};
use crate::store::journal::reader::{read_generation, JournalGen};
use crate::store::layout::journal_file_name;
use crate::testing::sample::{sample_page, sample_stroke, test_clock};
use crate::testing::{CollectingSink, MemFs, RegistryCodec};
use crate::time::Timestamp;

mod bounded;
mod failing;
mod tree_tests;

use failing::FailingFs;

pub(crate) const WAIT: Duration = Duration::from_secs(5);

pub(crate) fn key() -> NotebookKey {
    NotebookKey("01m3s9q9xbpmxwz4cz4ht6twg9-0a1b2c3d".into())
}

pub(crate) fn meta(boot: &str) -> JournalMeta {
    JournalMeta {
        notebook: "01m3s9q9xbpmxwz4cz4ht6twg9".parse().unwrap(),
        notebook_path: "/notebooks/Biology".into(),
        identity: FolderIdentity([7; 24]),
        section: Some("01m3s9v8ym7yt5c8yb61tthbwt".parse().unwrap()),
        app: "OpenNote test".into(),
        device: "01m1e34qm04rx4vfj1927vgwgm".parse().unwrap(),
        boot: boot.into(),
        page_format: 1,
    }
}

pub(crate) struct Setup {
    pub fs: FailingFs,
    pub codec: RegistryCodec,
    pub events: CollectingSink,
    pub thread: JournalThread,
}

pub(crate) fn setup(timings: Timings) -> Setup {
    let fs = FailingFs::new(MemFs::new());
    fs.inner.mkdir_all(Path::new("/data"));
    let codec = RegistryCodec::new();
    let events = CollectingSink::default();
    let thread = JournalThread::start(JournalConfig {
        fs: Arc::new(fs.clone()),
        codec: Arc::new(codec.clone()),
        root: "/data/journal".into(),
        clock: Arc::new(test_clock()),
        timings,
        events: Arc::new(events.clone()),
    })
    .unwrap();
    Setup {
        fs,
        codec,
        events,
        thread,
    }
}

/// A group commit an hour away, so only explicit flushes flush.
fn slow() -> Timings {
    Timings {
        group_commit: Duration::from_secs(3_600),
        ..Timings::default()
    }
}

pub(crate) fn fast() -> Timings {
    Timings {
        group_commit: Duration::from_millis(20),
        ..Timings::default()
    }
}

fn base(n: u64) -> BaseSnapshot {
    BaseSnapshot::of(
        RevisionId(Id::from_parts(1_790_000_000_000 + n, 1)),
        format!("page {n}").as_bytes(),
    )
}

/// A small transaction that renames the page.
pub(crate) fn txn(n: u64) -> Txn {
    Txn {
        id: crate::id::TxnId(Id::from_parts(1_790_000_000_000 + n, 2)),
        at: Timestamp::from_unix_ms(1_790_000_000_000 + n as i64),
        origin: Origin::Local,
        client: crate::id::ClientId::parse("main-1").unwrap(),
        coalesce: None,
        ui: None,
        ops: vec![Op::SetPage {
            before: PageFields {
                title: Some(format!("title {n}")),
                ..PageFields::default()
            },
            after: PageFields {
                title: Some(format!("title {}", n + 1)),
                ..PageFields::default()
            },
        }],
    }
}

fn dir() -> PathBuf {
    PathBuf::from("/data/journal").join(key().0)
}

fn generation_path(n: u64) -> PathBuf {
    dir().join(journal_file_name(Some(sample_page().id), n))
}

fn read(s: &Setup, generation: u64) -> JournalGen {
    let bytes = s.fs.inner.get(&generation_path(generation)).unwrap();
    read_generation(&bytes, &s.codec, &Limits::default()).unwrap()
}

#[test]
fn appends_create_the_generation_lazily_and_group_commit_flushes() {
    let s = setup(fast());
    let page = sample_page().id;
    let handle = s.thread.open_page(&key(), page, meta("boot-1"), base(0)).unwrap();
    assert!(!s.fs.inner.exists(&generation_path(1)), "opening writes nothing");
    let first = handle.append_txn(&txn(1));
    let second = handle.append_ink_progress(&sample_stroke());
    assert_eq!((first, second), (1, 2));
    handle.wait_durable(second, WAIT).unwrap();
    assert!(handle.durable_seq() >= 2);
    let generation = read(&s, 1);
    assert_eq!(generation.header.base, base(0).revision);
    assert_eq!(generation.header.anchor, 0);
    assert_eq!(generation.base.as_deref(), Some(&b"page 0"[..]));
    assert_eq!(generation.records.len(), 2);
    assert!(matches!(&generation.records[0], JournalRecord::Txn { seq: 1, txn: found } if *found == txn(1)));
    assert!(handle.bytes_since_save() > 0 && !handle.degraded());
    let header = crate::store::journal::format::HeaderMeta::from_value(&generation.header.meta).unwrap();
    assert_eq!(header.section, meta("").section);
    assert_eq!(header.notebook_identity, "07".repeat(24));
}

#[test]
fn save_begin_is_flushed_before_it_returns() {
    let s = setup(slow());
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    handle.append_txn(&txn(1));
    s.thread.flush_all(WAIT).unwrap();
    let seq = handle.append_txn(&txn(2));
    s.thread.open_tree(&key(), meta("boot-1")).unwrap();
    assert_eq!(
        handle.durable_seq(),
        1,
        "not flushed yet: the group commit is an hour away"
    );
    handle.save_begin(base(1).revision, seq, WAIT).unwrap();
    assert_eq!(handle.durable_seq(), 3);
    let records = read(&s, 1).records;
    assert!(matches!(
        records[2],
        JournalRecord::SaveBegin {
            seq: 3,
            through_seq: 2,
            ..
        }
    ));
}

#[test]
fn confirmed_saves_rotate_large_generations() {
    let s = setup(Timings {
        rotate_bytes: 10,
        ..fast()
    });
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    let through = handle.append_txn(&txn(1));
    handle.save_begin(base(1).revision, through, WAIT).unwrap();
    let after = handle.append_txn(&txn(2));
    handle.after_save(Durability::Unconfirmed, base(1), through);
    s.thread.flush_all(WAIT).unwrap();
    assert!(
        !s.fs.inner.exists(&generation_path(2)),
        "an unconfirmed save never rotates"
    );
    handle.after_save(Durability::Confirmed, base(1), through);
    s.thread.flush_all(WAIT).unwrap();
    let rotated = read(&s, 2);
    assert_eq!(
        (rotated.header.base, rotated.header.anchor),
        (base(1).revision, through)
    );
    let seqs: Vec<u64> = rotated.records.iter().map(JournalRecord::seq).collect();
    assert_eq!(seqs, [2, after], "SaveBegin and the later edit are copied");
    assert!(s.fs.inner.exists(&generation_path(1)), "the previous generation stays");
    let next = handle.append_txn(&txn(3));
    handle.save_begin(base(2).revision, next, WAIT).unwrap();
    handle.after_save(Durability::Confirmed, base(2), next + 1);
    s.thread.flush_all(WAIT).unwrap();
    assert!(!s.fs.inner.exists(&generation_path(1)), "older generations go");
    assert!(s.fs.inner.exists(&generation_path(2)) && s.fs.inner.exists(&generation_path(3)));
}

#[test]
fn closing_deletes_or_parks_the_generations() {
    let s = setup(fast());
    let page = sample_page().id;
    let handle = s.thread.open_page(&key(), page, meta("boot-1"), base(0)).unwrap();
    let seq = handle.append_txn(&txn(1));
    handle.after_save(Durability::Unconfirmed, base(1), seq);
    handle.close(Some((base(1).revision, Durability::Unconfirmed)));
    s.thread.flush_all(WAIT).unwrap();
    let parked = read(&s, 1);
    assert!(matches!(
        parked.records.last(),
        Some(JournalRecord::Closed { seq: 2, boot, .. }) if boot == "boot-1"
    ));
    let again = s.thread.open_page(&key(), page, meta("boot-1"), base(1)).unwrap();
    assert_eq!(again.append_txn(&txn(2)), 3, "numbers continue after every generation");
    again.after_save(Durability::Confirmed, base(2), 3);
    again.close(Some((base(2).revision, Durability::Confirmed)));
    s.thread.flush_all(WAIT).unwrap();
    assert!(s
        .fs
        .inner
        .files()
        .iter()
        .all(|p| p.extension().is_none_or(|e| e != "wal")));
}

#[test]
fn unsaved_edits_keep_their_generations_at_close_and_on_drop() {
    let s = setup(fast());
    let page = sample_page().id;
    let handle = s.thread.open_page(&key(), page, meta("boot-1"), base(0)).unwrap();
    let saved = handle.append_txn(&txn(1));
    handle.after_save(Durability::Confirmed, base(1), saved);
    handle.append_txn(&txn(2));
    handle.close(Some((base(1).revision, Durability::Confirmed)));
    s.thread.flush_all(WAIT).unwrap();
    assert_eq!(
        read(&s, 1).records.len(),
        2,
        "an edit after the last save keeps the journal"
    );
    let dropped = s.thread.open_page(&key(), page, meta("boot-1"), base(1)).unwrap();
    let seq = dropped.append_txn(&txn(3));
    drop(dropped);
    s.thread.flush_all(WAIT).unwrap();
    assert_eq!(read(&s, 2).records[0].seq(), seq);
}

#[test]
fn a_page_opens_once_and_bytes_since_save_reset_after_saves() {
    let s = setup(fast());
    let page = sample_page().id;
    let handle = s.thread.open_page(&key(), page, meta("boot-1"), base(0)).unwrap();
    assert!(s.thread.open_page(&key(), page, meta("boot-1"), base(0)).is_err());
    let seq = handle.append_txn(&txn(1));
    let bytes = handle.bytes_since_save();
    handle.append_txn(&txn(2));
    assert!(handle.bytes_since_save() > bytes);
    handle.after_save(Durability::Confirmed, base(1), seq);
    s.thread.flush_all(WAIT).unwrap();
    let left = handle.bytes_since_save();
    assert!(left > 0 && left < bytes * 2, "only the second edit is unsaved");
}

#[test]
fn a_journal_that_cant_be_written_degrades_and_recovers() {
    let s = setup(fast());
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    handle.append_txn(&txn(1));
    s.thread.flush_all(WAIT).unwrap();
    s.fs.fail_writes(true);
    let lost = handle.append_txn(&txn(2));
    let err = handle.wait_durable(lost, WAIT).unwrap_err();
    assert!(matches!(err, JournalError::Degraded(_)));
    assert!(handle.degraded());
    assert!(matches!(
        handle.save_begin(base(1).revision, lost, WAIT),
        Err(JournalError::Degraded(_))
    ));
    assert!(s.thread.flush_all(WAIT).is_err());
    let degraded = s.events.events();
    assert_eq!(
        degraded
            .iter()
            .filter(|e| matches!(e, crate::session::events::CoreEvent::JournalDegraded { .. }))
            .count(),
        1,
        "reported once"
    );
    s.fs.fail_writes(false);
    handle.after_save(Durability::Confirmed, base(1), lost);
    s.thread.flush_all(WAIT).unwrap();
    let next = handle.append_txn(&txn(3));
    handle.wait_durable(next, WAIT).unwrap();
    assert!(!handle.degraded());
    let rebuilt = read(&s, 2);
    assert_eq!((rebuilt.header.base, rebuilt.header.anchor), (base(1).revision, lost));
}

#[test]
fn shutdown_flushes_and_stops() {
    let s = setup(slow());
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    handle.append_txn(&txn(1));
    s.thread.shutdown(WAIT);
    let bytes =
        s.fs.inner
            .crash(crate::testing::MemCrash::PowerCut)
            .get(&generation_path(1))
            .unwrap();
    let generation = read_generation(&bytes, &s.codec, &Limits::default()).unwrap();
    assert_eq!(generation.records.len(), 1, "flushed at shutdown");
    assert!(handle.wait_durable(1, WAIT).is_ok());
    assert!(matches!(handle.wait_durable(2, WAIT), Err(JournalError::Closed)));
}

/// A page journal opened for a caller that stopped waiting (the open timed out, so the page runs journal-less)
/// has no handle, so no `Close` ever comes for it. Left open, every later open of the page found it and failed
/// as busy for the rest of the run (beta 4's T2-3 follow-up). The worker detaches it again when its answer has
/// nobody to go to.
#[test]
fn a_page_journal_nobody_waits_for_is_closed_again_so_the_next_open_of_the_page_works() {
    let fs = FailingFs::new(MemFs::new());
    fs.inner.mkdir_all(Path::new("/data"));
    let config = JournalConfig {
        fs: Arc::new(fs),
        codec: Arc::new(RegistryCodec::new()),
        root: "/data/journal".into(),
        clock: Arc::new(test_clock()),
        timings: Timings::default(),
        events: Arc::new(CollectingSink::default()),
    };
    let mut worker = super::worker::Worker::new(config);
    let page = sample_page().id;
    let open = |reply| super::worker::Command::OpenPage {
        key: key(),
        page,
        meta: meta("boot-1"),
        base: base(0),
        reply,
    };
    // The caller gave up: its receiver is gone before the worker answers.
    let (gone, _) = mpsc::channel();
    worker.handle(open(gone));
    let (reply, answer) = mpsc::channel();
    worker.handle(open(reply));
    let opened = answer.recv_timeout(WAIT).expect("the worker answers");
    assert!(opened.is_ok(), "the page opens again: {:?}", opened.as_ref().err());
    // A tree journal nobody waits for goes the same way.
    let (gone, _) = mpsc::channel();
    worker.handle(super::worker::Command::OpenTree {
        key: key(),
        meta: meta("boot-1"),
        reply: gone,
    });
    let (reply, answer) = mpsc::channel();
    worker.handle(super::worker::Command::OpenTree {
        key: key(),
        meta: meta("boot-1"),
        reply,
    });
    assert!(answer.recv_timeout(WAIT).expect("the worker answers").is_ok());
}

/// Opening a journal used to wait for the journal thread's answer with no limit, under the page's lock, and
/// a command that opened a page then held the core (beta 4's T2-3: every later command waited behind it, for
/// as long as the app ran). A thread that doesn't answer in time now fails the open with `Timeout`, and the
/// page runs without a journal (spec 20.12).
#[test]
fn opening_a_journal_gives_up_when_the_journal_thread_does_not_answer() {
    // A thread that never serves its commands: the receiver is kept, so sends succeed, and nobody reads it.
    let (commands, _unserved) = mpsc::channel();
    let thread = JournalThread {
        commands,
        codec: Arc::new(RegistryCodec::new()),
        thread: None,
        open_wait: Duration::from_millis(50),
    };
    let started = std::time::Instant::now();
    let page = thread.open_page(&key(), sample_page().id, meta("boot-1"), base(0));
    assert!(matches!(page, Err(JournalError::Timeout)), "{:?}", page.err());
    let tree = thread.open_tree(&key(), meta("boot-1"));
    assert!(matches!(tree, Err(JournalError::Timeout)), "{:?}", tree.err());
    assert!(started.elapsed() < WAIT, "the opens waited {:?}", started.elapsed());
}
