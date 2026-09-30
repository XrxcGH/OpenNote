//! Random power cuts on `FaultFs` (plan 6): random calls under every durability model, cut at a random call
//! with a random seed. Durable writes that were acknowledged, or interrupted, are never torn or lost, and the
//! journal keeps every byte synced before the cut.

mod common;

use std::path::PathBuf;

use opennote_core::store::fs::{AppendFile, Fs};
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs};
use opennote_core::{FsError, FsErrorKind};
use proptest::prelude::*;

const MODELS: [DurabilityModel; 4] = [
    DurabilityModel::Ntfs,
    DurabilityModel::Ext4,
    DurabilityModel::Fat,
    DurabilityModel::Network,
];

#[derive(Clone, Debug)]
enum Op {
    Replace(usize, u8),
    Create(usize, u8),
    Derived(u8),
    Append(u8, bool),
    Remove,
}

fn arb_op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0..3usize, any::<u8>()).prop_map(|(f, b)| Op::Replace(f, b)),
        (0..3usize, any::<u8>()).prop_map(|(f, b)| Op::Create(f, b)),
        any::<u8>().prop_map(Op::Derived),
        (any::<u8>(), any::<bool>()).prop_map(|(b, s)| Op::Append(b, s)),
        Just(Op::Remove),
    ]
}

/// Files 0 to 2, in two folders. They are only ever written durably.
fn file(index: usize) -> PathBuf {
    let folder = if index.is_multiple_of(2) { "a" } else { "b" };
    PathBuf::from(format!("/nb/{folder}/f{index}"))
}

/// What the script did before the cut.
#[derive(Default)]
struct Seen {
    acked: [Option<Vec<u8>>; 3],
    interrupted: [Option<Vec<u8>>; 3],
    synced: Vec<u8>,
    written: Vec<u8>,
    attempted: Vec<u8>,
}

fn durable_write(fs: &FaultFs, op: &Op, seen: &mut Seen) -> Result<(), FsError> {
    let (Op::Replace(f, b) | Op::Create(f, b)) = op else {
        return Ok(());
    };
    let bytes = vec![*b; 3 + *f];
    let result = match op {
        Op::Replace(..) => fs.replace_durable(&file(*f), &bytes),
        _ => fs.create_durable(&file(*f), &bytes),
    };
    match &result {
        Ok(_) => seen.acked[*f] = Some(bytes),
        Err(e) if e.kind == FsErrorKind::Crashed => seen.interrupted[*f] = Some(bytes),
        Err(_) => {}
    }
    result.map(|_| ())
}

fn append(journal: &mut dyn AppendFile, byte: u8, sync: bool, seen: &mut Seen) -> Result<(), FsError> {
    let bytes = [byte; 4];
    seen.attempted.extend_from_slice(&bytes);
    journal.append(&bytes)?;
    seen.written.extend_from_slice(&bytes);
    if sync {
        journal.sync()?;
        seen.synced = seen.written.clone();
    }
    Ok(())
}

/// Runs the script until the cut, and returns what the next start sees and what the script did.
fn run(model: DurabilityModel, ops: &[Op], crash: u64, seed: u64) -> (FaultFs, Seen) {
    let fs = FaultFs::new(model);
    fs.mkdir_all(&PathBuf::from("/nb/a"));
    fs.mkdir_all(&PathBuf::from("/nb/b"));
    let mut journal = fs.open_append(&PathBuf::from("/nb/j"), true).unwrap();
    let mut seen = Seen::default();
    fs.crash_at_call(crash, CrashKind::PowerCut { seed });
    let page_md = PathBuf::from("/nb/a/page.md");
    for op in ops {
        let result = match op {
            Op::Replace(..) | Op::Create(..) => durable_write(&fs, op, &mut seen),
            Op::Derived(b) => fs.write_derived(&page_md, &[*b; 9]),
            Op::Append(b, sync) => append(journal.as_mut(), *b, *sync, &mut seen),
            Op::Remove => fs.remove_file(&page_md),
        };
        if result.is_err_and(|e| e.kind == FsErrorKind::Crashed) {
            break;
        }
    }
    (fs.reboot(), seen)
}

fn check(model: DurabilityModel, ops: &[Op], crash: u64, seed: u64) -> Result<(), TestCaseError> {
    let (after, seen) = run(model, ops, crash, seed);
    for (f, (acked, interrupted)) in seen.acked.iter().zip(&seen.interrupted).enumerate() {
        let got = after.get(&file(f));
        let fine = match &got {
            Some(bytes) => [acked, interrupted].into_iter().flatten().any(|a| a == bytes),
            None => acked.is_none(),
        };
        prop_assert!(fine, "{model:?} file {f}: {got:?}, acknowledged {acked:?}");
    }
    let log = after.get(&PathBuf::from("/nb/j")).unwrap_or_default();
    prop_assert!(log.starts_with(&seen.synced), "{model:?}: synced journal bytes lost");
    prop_assert!(
        log.len() <= seen.attempted.len(),
        "{model:?}: more than was ever appended"
    );
    Ok(())
}

proptest! {
    #![proptest_config(common::cases(256))]

    #[test]
    fn acknowledged_writes_survive_random_power_cuts(
        model in prop::sample::select(MODELS.to_vec()),
        ops in prop::collection::vec(arb_op(), 1..25),
        crash in 0u64..60,
        seed in any::<u64>(),
    ) {
        check(model, &ops, crash, seed)?;
    }
}
