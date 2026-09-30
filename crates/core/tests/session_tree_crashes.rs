//! Tree changes crashed before every file system call they make (plan 13.4). They create pages and sections,
//! move pages between sections, duplicate pages, and move pages and sections to another notebook. They also
//! delete to Trash, restore, and purge, some with a file held open inside the folder.
//!
//! After each crash, recovery rolls tree intents forward and scans. Every page and section must then show
//! exactly once, in a tree or in Trash, and recovering again must change no file.
//!
//! The in-memory file system runs these now, as an app crash and as a power cut that drops everything not
//! flushed. WP2's fault-injecting file system runs them under each durability model once it lands.

mod session_support;

use std::sync::Arc;

use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel};
use opennote_core::testing::MemCrash;
use session_support::disk::{Disk, FaultDisk, MemDisk};
use session_support::scenarios::{all, count_calls, crash_everywhere, crash_recovery};

fn every_scenario(disk: &dyn Fn() -> Arc<dyn Disk>) -> u64 {
    let mut points = 0;
    for scenario in all() {
        let outcome = crash_everywhere(&scenario, disk).unwrap_or_else(|e| panic!("{e}"));
        assert!(outcome.calls > 0, "{} makes no file system calls", scenario.name);
        points += outcome.calls + 1;
    }
    points
}

#[test]
fn tree_changes_survive_an_app_crash_before_every_call() {
    let points = every_scenario(&|| MemDisk::boxed(MemCrash::App));
    assert!(points >= 50, "only {points} crash points");
}

#[test]
fn tree_changes_survive_a_power_cut_before_every_call() {
    every_scenario(&|| MemDisk::boxed(MemCrash::PowerCut));
}

/// Whether this is the long nightly run, which `PROPTEST_CASES` above 1,000 selects.
fn nightly() -> bool {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .is_some_and(|n| n > 1_000)
}

/// Crashes recovery itself, for every crash point of the change. The everyday run takes every third point, and
/// the nightly run takes them all.
#[test]
fn rolling_intents_forward_survives_a_crash_during_recovery() {
    let stride = if nightly() { 1 } else { 3 };
    for kind in [MemCrash::App, MemCrash::PowerCut] {
        let disk = move || MemDisk::boxed(kind);
        for scenario in all() {
            let calls = count_calls(&scenario, disk()).unwrap_or_else(|e| panic!("{e}"));
            for n in (0..calls).step_by(stride) {
                crash_recovery(&scenario, &disk, n).unwrap_or_else(|e| panic!("{kind:?}: {e}"));
            }
        }
    }
}

/// Plan 13.4 runs each crash once as an app crash and as up to 16 random power cuts under each durability
/// model. `PROPTEST_CASES` above 1,000, as in the nightly run, uses all 16 seeds.
#[test]
#[ignore = "needs WP2"]
fn tree_changes_survive_crashes_under_every_durability_model() {
    let seeds = if nightly() { 16 } else { 4 };
    let models = [
        DurabilityModel::Ntfs,
        DurabilityModel::Ext4,
        DurabilityModel::Fat,
        DurabilityModel::Network,
    ];
    for model in models {
        every_scenario(&|| FaultDisk::boxed(model, CrashKind::App));
        for seed in 0..seeds {
            every_scenario(&|| FaultDisk::boxed(model, CrashKind::PowerCut { seed }));
        }
    }
}
