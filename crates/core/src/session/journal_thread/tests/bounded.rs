//! The memory bound on kept copies of journal records (spec 20.12).

use super::*;

/// Journal timings whose memory bound on kept copies is a couple of records.
fn tiny_bound() -> Timings {
    Timings {
        journal_force_bytes: 64,
        rotate_bytes: 10,
        ..fast()
    }
}

fn seqs(generation: &JournalGen) -> Vec<u64> {
    generation.records.iter().map(JournalRecord::seq).collect()
}

#[test]
fn a_healthy_journal_writes_every_record_past_the_memory_bound() {
    let s = setup(tiny_bound());
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    let mut last = 0;
    for n in 1..=12 {
        last = handle.append_txn(&txn(n));
    }
    handle.wait_durable(last, WAIT).unwrap();
    let generation = read(&s, 1);
    assert_eq!(
        seqs(&generation),
        (1..=last).collect::<Vec<_>>(),
        "no record is skipped"
    );
    assert!(matches!(
        generation.stop,
        crate::store::journal::reader::StopReason::End
    ));
}

#[test]
fn a_save_that_covers_part_of_the_dropped_copies_never_rotates_into_a_gap() {
    let s = setup(tiny_bound());
    let handle = s
        .thread
        .open_page(&key(), sample_page().id, meta("boot-1"), base(0))
        .unwrap();
    let through = handle.append_txn(&txn(1));
    let mut last = through;
    for n in 2..=12 {
        last = handle.append_txn(&txn(n));
    }
    handle.after_save(Durability::Confirmed, base(1), through);
    s.thread.flush_all(WAIT).unwrap();
    let first = read(&s, 1);
    assert_eq!(
        seqs(&first),
        (1..=last).collect::<Vec<_>>(),
        "the old generation stays whole"
    );
    if s.fs.inner.exists(&generation_path(2)) {
        let rotated = read(&s, 2);
        let expected: Vec<u64> = (rotated.header.anchor + 1..=last).collect();
        assert_eq!(
            seqs(&rotated),
            expected,
            "a rotated generation starts right after its anchor"
        );
    }
}
