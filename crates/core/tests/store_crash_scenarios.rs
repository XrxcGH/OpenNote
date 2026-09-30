//! The storage scenarios of plan 13.4: each operation crashes before every file system call it makes, once as
//! an app crash and once as a power cut. After each crash, recovery must succeed. Invariant I1 must hold
//! through `verify_notebook`, and the page must equal the oracle at a step no older than the last durable one.
//! A second recovery must change nothing.
//!
//! These run on the in-memory file system now. The same scenarios on the fault-injecting file system, with
//! every durability model and 16 random power cuts per crash point, wait for WP2.

mod store_support;

use std::sync::Arc;

use opennote_core::model::VersionReason;
use opennote_core::seams::Codec;
use opennote_core::store::compact::CompactionPlan;
use opennote_core::store::fs::Fs;
use opennote_core::store::history::write_version;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::PageFiles;
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs};
use opennote_core::testing::{MemCrash, RegistryCodec};
use opennote_core::Timings;
use store_support::damaging::DamagingCodec;
use store_support::{busy_timings, check_after_crash, notebook, notebook_on, page_dir, store_with, stroke};
use store_support::{CrashAtFs, Writer};

/// One operation to crash, after a script that sets it up.
struct Scenario {
    name: &'static str,
    timings: Timings,
    unconfirmed: bool,
    before: fn(&mut Writer, &RegistryCodec),
    action: fn(&mut Writer, &RegistryCodec),
}

/// A file system that crashes at a chosen call, and the one the next start sees.
trait Crashing {
    fn fs(&self) -> Arc<dyn Fs>;
    fn calls(&self) -> u64;
    fn crash_at(&self, call: u64);
    fn reboot(&self) -> Option<Arc<dyn Fs>>;
}

impl Crashing for CrashAtFs {
    fn fs(&self) -> Arc<dyn Fs> {
        Arc::new(self.clone())
    }
    fn calls(&self) -> u64 {
        CrashAtFs::calls(self)
    }
    fn crash_at(&self, call: u64) {
        CrashAtFs::crash_at(self, call);
    }
    fn reboot(&self) -> Option<Arc<dyn Fs>> {
        self.after().map(|fs| Arc::new(fs) as Arc<dyn Fs>)
    }
}

/// The fault-injecting file system of WP2, crashing in one way.
struct Faulty {
    fs: Arc<FaultFs>,
    kind: CrashKind,
}

impl Crashing for Faulty {
    fn fs(&self) -> Arc<dyn Fs> {
        self.fs.clone()
    }
    fn calls(&self) -> u64 {
        self.fs.calls()
    }
    fn crash_at(&self, call: u64) {
        self.fs.crash_at_call(call, self.kind);
    }
    fn reboot(&self) -> Option<Arc<dyn Fs>> {
        Some(Arc::new(self.fs.reboot()))
    }
}

/// Runs a scenario, crashing before each call of its action on file systems that `fresh` makes.
fn crash_everywhere(scenario: &Scenario, fresh: &dyn Fn(&RegistryCodec, bool) -> Box<dyn Crashing>) -> u64 {
    let codec = RegistryCodec::new();
    let probe = fresh(&codec, scenario.unconfirmed);
    let mut writer = Writer::open(probe.fs(), &codec, scenario.timings.clone());
    (scenario.before)(&mut writer, &codec);
    let start = probe.calls();
    (scenario.action)(&mut writer, &codec);
    let end = probe.calls();
    drop(writer);
    for call in start..=end {
        let codec = RegistryCodec::new();
        let crashing = fresh(&codec, scenario.unconfirmed);
        let mut writer = Writer::open(crashing.fs(), &codec, scenario.timings.clone());
        (scenario.before)(&mut writer, &codec);
        crashing.crash_at(call);
        (scenario.action)(&mut writer, &codec);
        let (floor, oracle) = (writer.durable_steps(), writer.oracle.clone());
        drop(writer);
        let Some(next) = crashing.reboot() else {
            continue;
        };
        if let Err(err) = check_after_crash(&next, &codec, &oracle, floor) {
            panic!("{}: a crash before call {call}: {err}", scenario.name);
        }
    }
    end.saturating_sub(start)
}

fn mem(kind: MemCrash) -> impl Fn(&RegistryCodec, bool) -> Box<dyn Crashing> {
    move |codec, unconfirmed| {
        let fs = notebook(codec);
        fs.set_confirmed(!unconfirmed);
        Box::new(CrashAtFs::new(fs, u64::MAX, kind))
    }
}

fn nine_saves(writer: &mut Writer, _: &RegistryCodec) {
    for n in 0..9 {
        writer.draw(n);
        writer.save(CompactionPlan::None).unwrap();
    }
    writer.draw(20);
    writer.erase(3);
    writer.flush();
}

/// A scenario with journal timings that rotate constantly, on a file system that confirms its flushes.
fn base(
    name: &'static str,
    before: fn(&mut Writer, &RegistryCodec),
    action: fn(&mut Writer, &RegistryCodec),
) -> Scenario {
    Scenario {
        name,
        timings: busy_timings(),
        unconfirmed: false,
        before,
        action,
    }
}

fn scenarios() -> Vec<Scenario> {
    let mut all = save_scenarios();
    all.extend(file_scenarios());
    all
}

/// Saves with each kind of segment, and a history version.
fn save_scenarios() -> Vec<Scenario> {
    vec![
        base(
            "a save with a new segment",
            |w, _| {
                w.draw(1);
                w.retitle("One");
                w.flush();
            },
            |w, _| {
                let _ = w.save(CompactionPlan::None);
            },
        ),
        base("a save with minor compaction", nine_saves, |w, _| {
            let _ = w.save(CompactionPlan::Minor);
        }),
        base("a save with major compaction", nine_saves, |w, _| {
            let _ = w.save(CompactionPlan::Major);
        }),
        base(
            "a history version",
            |w, _| {
                w.retitle("One");
                w.save(CompactionPlan::None).unwrap();
            },
            |w, codec| {
                let files = PageFiles {
                    fs: &*w.fs,
                    codec,
                    dir: &page_dir(),
                };
                let bytes = w.fs.read(&NotebookLayout::page_json(&page_dir()), u64::MAX);
                if let Ok(bytes) = bytes {
                    let _ = write_version(&files, &bytes, &w.page, VersionReason::Interval, None);
                }
            },
        ),
    ]
}

/// Journal rotation and parking, absorbing a conflict copy, and repairing damaged ink.
fn file_scenarios() -> Vec<Scenario> {
    vec![
        Scenario {
            name: "a journal rotation",
            ..base(
                "",
                |w, _| {
                    w.retitle("One");
                    w.draw(1);
                    w.flush();
                },
                |w, _| {
                    let _ = w.save(CompactionPlan::None);
                    w.retitle("Two");
                    w.flush();
                },
            )
        },
        Scenario {
            name: "parking the journal at close",
            unconfirmed: true,
            ..base(
                "",
                |w, _| {
                    w.retitle("One");
                    w.save(CompactionPlan::None).unwrap();
                },
                |w, _| w.close(),
            )
        },
        base("absorbing a sync-tool conflict copy", put_conflict_copy, |w, _| {
            let copy = page_dir().join("page-LAPTOP.json");
            let _ = w.store.absorb_conflict_copy(&page_dir(), &copy);
        }),
        base(
            "repairing damaged ink",
            |w, _| {
                w.draw(1);
                w.save(CompactionPlan::None).unwrap();
                w.draw(2);
                w.save(CompactionPlan::None).unwrap();
            },
            repair_stroke_1,
        ),
    ]
}

/// Saves the page, and puts a sync tool's conflict copy of another version next to it.
fn put_conflict_copy(w: &mut Writer, codec: &RegistryCodec) {
    w.retitle("One");
    w.save(CompactionPlan::None).unwrap();
    let mut theirs = w.page.clone();
    theirs.title = "Theirs".into();
    theirs.revision.id = "01m3sa8yf8bryf28a7sjgb7mmz".parse().unwrap();
    let copy = page_dir().join("page-LAPTOP.json");
    w.fs.replace_durable(&copy, &codec.write_page(&theirs)).unwrap();
}

/// Loads the page with stroke 1 damaged in every segment, and repairs it from the journal's copy. Then it
/// saves the repaired page, as a session does after "Repair this page".
fn repair_stroke_1(w: &mut Writer, codec: &RegistryCodec) {
    let damaging = DamagingCodec {
        inner: codec.clone(),
        stroke: stroke(1).id,
    };
    let store = store_with(w.fs.clone(), Arc::new(damaging));
    let Ok(loaded) = store.load(&page_dir()) else {
        return;
    };
    let read_all = loaded.missing.is_empty();
    assert!(!read_all || !loaded.damaged.is_empty(), "stroke 1 reads as damaged");
    let Ok(repaired) = store.repair_ink(&page_dir(), &loaded.page, &[stroke(1)]) else {
        return;
    };
    assert!(
        repaired.ink.stroke(stroke(1).id).is_some(),
        "the journal's copy is back"
    );
    w.page = repaired;
    let _ = w.save(CompactionPlan::Major);
}

#[test]
fn every_storage_operation_survives_a_crash_at_every_call() {
    for scenario in scenarios() {
        for kind in [MemCrash::App, MemCrash::PowerCut] {
            let calls = crash_everywhere(&scenario, &mem(kind));
            assert!(calls > 0, "{} makes file system calls", scenario.name);
        }
    }
}

#[test]
fn recovery_survives_a_crash_at_every_call() {
    let crashed = |codec: &RegistryCodec, _: bool| -> Box<dyn Crashing> {
        let fs = notebook(codec);
        let mut writer = Writer::open(Arc::new(fs.clone()), codec, busy_timings());
        writer.retitle("One");
        writer.draw(1);
        writer.flush();
        writer.retitle("Two");
        writer.thread.flush_all(store_support::WAIT).unwrap();
        drop(writer);
        Box::new(CrashAtFs::new(fs.crash(MemCrash::App), u64::MAX, MemCrash::PowerCut))
    };
    let codec = RegistryCodec::new();
    let probe = crashed(&codec, false);
    store_support::recover(&probe.fs(), &codec);
    for call in 0..=probe.calls() {
        let codec = RegistryCodec::new();
        let crashing = crashed(&codec, false);
        crashing.crash_at(call);
        let _ = store_support::try_recover(&crashing.fs(), &codec);
        let Some(next) = crashing.reboot() else {
            continue;
        };
        let oracle = expected_after_script(&codec);
        if let Err(err) = check_after_crash(&next, &codec, &oracle, oracle.len() - 1) {
            panic!("recovery, a crash before call {call}: {err}");
        }
    }
}

/// The states of the recovery scenario's script, run again without a crash.
fn expected_after_script(codec: &RegistryCodec) -> Vec<opennote_core::model::Page> {
    let fs = notebook(codec);
    let mut writer = Writer::open(Arc::new(fs), codec, busy_timings());
    writer.retitle("One");
    writer.draw(1);
    writer.retitle("Two");
    writer.oracle.clone()
}

#[test]
#[ignore = "needs WP2"]
fn every_storage_operation_survives_a_crash_on_the_fault_injecting_file_system() {
    let models = [
        DurabilityModel::Ntfs,
        DurabilityModel::Ext4,
        DurabilityModel::Fat,
        DurabilityModel::Network,
    ];
    let kinds = std::iter::once(CrashKind::App).chain((0..16).map(|seed| CrashKind::PowerCut { seed }));
    let runs: Vec<(DurabilityModel, CrashKind)> = kinds.flat_map(|kind| models.map(|model| (model, kind))).collect();
    for scenario in scenarios() {
        for &(model, kind) in &runs {
            crash_everywhere(&scenario, &faulty(model, kind));
        }
    }
}

fn faulty(model: DurabilityModel, kind: CrashKind) -> impl Fn(&RegistryCodec, bool) -> Box<dyn Crashing> {
    move |codec, _| {
        let fs = Arc::new(FaultFs::new(model));
        notebook_on(fs.clone(), codec);
        Box::new(Faulty { fs, kind })
    }
}
