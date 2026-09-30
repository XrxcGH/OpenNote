//! P6: recovery after random edits, saves, and crashes gives a state no older than the last durable one. The
//! journal is also cut at every byte, and given zero-filled tails at record boundaries.

use proptest::prelude::*;

use super::*;
use crate::format::gzip::gzip;
use crate::store::journal::encode;
use crate::store::journal::format::encode_header;
use crate::store::journal::reader::{read_generation, JournalHeader, JournalRecord, StopReason};

/// One step of a script.
#[derive(Clone, Debug)]
pub enum Step {
    Retitle(u8),
    Draw(u8),
    Erase(u8),
    Save,
    Flush,
}

fn arb_step() -> impl Strategy<Value = Step> {
    prop_oneof![
        4 => any::<u8>().prop_map(Step::Retitle),
        4 => (0u8..8).prop_map(Step::Draw),
        2 => (0u8..8).prop_map(Step::Erase),
        1 => Just(Step::Save),
        2 => Just(Step::Flush),
    ]
}

/// Runs one step, and returns the sequence number of its transaction if it made one.
fn run_step(sim: &mut Sim, step: &Step) -> Option<u64> {
    let live = |sim: &Sim, n: u8| sim.page.ink.stroke(stroke(u64::from(n)).id).cloned();
    match step {
        Step::Retitle(n) => Some(sim.retitle(&format!("title {n}"))),
        Step::Draw(n) => live(sim, *n).is_none().then(|| sim.draw(u64::from(*n))),
        Step::Erase(n) => {
            let found = live(sim, *n)?;
            Some(sim.apply(vec![Op::RemoveStrokes { strokes: vec![found] }]))
        }
        Step::Save => {
            sim.save();
            None
        }
        Step::Flush => {
            sim.flush();
            None
        }
    }
}

/// Runs a script and returns the sequence number of each oracle step after the first.
fn run(sim: &mut Sim, steps: &[Step]) -> Vec<u64> {
    let mut seqs = Vec::new();
    for step in steps {
        seqs.extend(run_step(sim, step));
    }
    seqs
}

/// 256 cases, or `PROPTEST_CASES`, as the nightly run sets.
fn cases() -> proptest::test_runner::Config {
    let cases = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(256);
    proptest::test_runner::Config {
        cases,
        ..Default::default()
    }
}

proptest! {
    #![proptest_config(cases())]

    /// P6 on the in-memory file system. A random script ends in an app crash or a power cut. Recovery then
    /// gives the oracle's state at a step no older than the last durable one.
    #[test]
    fn recovery_never_goes_back_past_durable_records(
        steps in proptest::collection::vec(arb_step(), 1..24),
        power_cut in any::<bool>(),
    ) {
        let timings = Timings {
            group_commit: Duration::from_secs(3_600),
            rotate_bytes: 200,
            ..Timings::default()
        };
        let mut sim = Sim::new(timings);
        let seqs = run(&mut sim, &steps);
        sim.thread.open_tree(&key(&sim.fs), meta(&sim.fs)).unwrap();
        let durable = sim.handle.as_ref().unwrap().durable_seq();
        let appended = seqs.len();
        let durable_steps = seqs.iter().filter(|&&seq| seq <= durable).count();
        let kind = if power_cut { MemCrash::PowerCut } else { MemCrash::App };
        let (fs, codec, oracle) = sim.crash(kind);
        let floor = if power_cut { durable_steps } else { appended };
        recover(&fs, &codec, Some(page_dir()));
        let page = on_disk(&fs, &codec, &page_dir());
        let step = step_of(&oracle, &page, floor);
        prop_assert!(step.is_some(), "the recovered page matches no step from {} of {}", floor, oracle.len() - 1);
        prop_assert_eq!(recover(&fs, &codec, Some(page_dir())), RecoveryOutcome::Nothing);
        prop_assert!(same_content(&on_disk(&fs, &codec, &page_dir()), &page), "a second recovery changes nothing");
    }
}

/// A generation with `n` records.
fn generation(codec: &RegistryCodec, n: u64) -> (Vec<u8>, Vec<usize>) {
    let header = JournalHeader {
        version: 1,
        notebook: sample_notebook_id(),
        page: sample_page().id,
        base: Default::default(),
        generation: 1,
        anchor: 0,
        created: Timestamp::EPOCH,
        page_format: 1,
        meta: serde_json::json!({}),
    };
    let mut bytes = encode_header(&header, &gzip(b"base"));
    let mut ends = vec![bytes.len()];
    for seq in 1..=n {
        let record = JournalRecord::InkProgress {
            seq,
            stroke: stroke(seq),
        };
        bytes.extend_from_slice(&encode(&record, codec));
        ends.push(bytes.len());
    }
    (bytes, ends)
}

#[test]
fn a_journal_cut_at_any_byte_reads_every_complete_record() {
    let codec = RegistryCodec::new();
    let (bytes, ends) = generation(&codec, 4);
    let limits = crate::limits::Limits::default();
    for cut in ends[0]..=bytes.len() {
        let read = read_generation(&bytes[..cut], &codec, &limits).unwrap();
        let complete = ends.iter().filter(|&&end| end <= cut).count() - 1;
        assert_eq!(read.records.len(), complete, "cut at {cut}");
        let clean = if ends.contains(&cut) {
            StopReason::End
        } else {
            StopReason::Torn {
                offset: ends[complete] as u64,
            }
        };
        assert_eq!(read.stop, clean, "cut at {cut}");
        let mut padded = bytes[..cut].to_vec();
        padded.resize(bytes.len() + 64, 0);
        let zero = read_generation(&padded, &codec, &limits).unwrap();
        assert_eq!(zero.records.len(), complete, "zero tail after {cut}");
        assert!(zero.stop.is_clean(), "{:?}", zero.stop);
    }
    for cut in ends[..ends.len() - 1].iter().copied() {
        let mut padded = bytes[..cut].to_vec();
        padded.resize(cut + 100, 0);
        let read = read_generation(&padded, &codec, &limits).unwrap();
        assert_eq!(read.stop, StopReason::ZeroFilled { offset: cut as u64 });
    }
}
