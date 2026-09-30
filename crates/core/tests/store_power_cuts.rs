//! Randomized power cuts (plan 13.5): random scripts of edits and saves, cut off at a random file system call.
//! Afterward recovery must succeed and invariant I1 must hold. The page must equal the oracle at a step no
//! older than the last durable one: nothing flushed before the cut is lost.
//!
//! This runs on the in-memory file system now, where a power cut drops everything not flushed. The same
//! property on the fault-injecting file system's weakest model, where unflushed data can also come back cut
//! short, zero-filled, or garbled, waits for WP2.

mod common;
mod store_support;

use std::sync::Arc;

use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::Fs;
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs};
use opennote_core::testing::{MemCrash, RegistryCodec};
use proptest::prelude::*;
use store_support::{busy_timings, check_after_crash, notebook, notebook_on, CrashAtFs, Writer};

/// One step of a script.
#[derive(Clone, Debug)]
enum Step {
    Retitle(u8),
    Draw(u8),
    Erase(u8),
    Save(u8),
    Flush,
}

fn arb_step() -> impl Strategy<Value = Step> {
    prop_oneof![
        4 => any::<u8>().prop_map(Step::Retitle),
        4 => (0u8..10).prop_map(Step::Draw),
        2 => (0u8..10).prop_map(Step::Erase),
        2 => (0u8..3).prop_map(Step::Save),
        2 => Just(Step::Flush),
    ]
}

fn run(writer: &mut Writer, steps: &[Step]) {
    for step in steps {
        match step {
            Step::Retitle(n) => {
                writer.retitle(&format!("title {n}"));
            }
            Step::Draw(n) => {
                writer.draw(u64::from(*n));
            }
            Step::Erase(n) => {
                writer.erase(u64::from(*n));
            }
            Step::Save(plan) => {
                let plan = [CompactionPlan::None, CompactionPlan::Minor, CompactionPlan::Major][usize::from(*plan)];
                let _ = writer.save(plan);
            }
            Step::Flush => {
                writer.flush();
            }
        }
    }
}

proptest! {
    #![proptest_config(common::cases(2_000))]

    #[test]
    fn a_power_cut_at_any_call_loses_nothing_that_was_flushed(
        steps in proptest::collection::vec(arb_step(), 1..20),
        cut in 0u64..400,
        power in any::<bool>(),
    ) {
        let codec = RegistryCodec::new();
        let kind = if power { MemCrash::PowerCut } else { MemCrash::App };
        let fs = CrashAtFs::new(notebook(&codec), u64::MAX, kind);
        let mut writer = Writer::open(Arc::new(fs.clone()), &codec, busy_timings());
        fs.crash_at(fs.calls().saturating_add(cut));
        run(&mut writer, &steps);
        let (floor, oracle) = (writer.durable_steps(), writer.oracle.clone());
        let next: Arc<dyn Fs> = Arc::new(fs.crash_now());
        drop(writer);
        let checked = check_after_crash(&next, &codec, &oracle, floor);
        prop_assert!(checked.is_ok(), "{:?}", checked);
    }
}

#[test]
fn a_power_cut_on_the_weakest_model_loses_nothing_that_was_flushed() {
    let mut runner = proptest::test_runner::TestRunner::new(common::cases(2_000));
    let strategy = (proptest::collection::vec(arb_step(), 1..20), 0u64..400, any::<u64>());
    runner
        .run(&strategy, |(steps, cut, seed)| {
            let codec = RegistryCodec::new();
            let fs = Arc::new(FaultFs::new(DurabilityModel::Fat));
            notebook_on(fs.clone(), &codec);
            let mut writer = Writer::open(fs.clone(), &codec, busy_timings());
            fs.crash_at_call(fs.calls().saturating_add(cut), CrashKind::PowerCut { seed });
            run(&mut writer, &steps);
            let (floor, oracle) = (writer.durable_steps(), writer.oracle.clone());
            drop(writer);
            let next: Arc<dyn Fs> = Arc::new(fs.reboot());
            let checked = check_after_crash(&next, &codec, &oracle, floor);
            prop_assert!(checked.is_ok(), "{:?}", checked);
            Ok(())
        })
        .unwrap();
}
