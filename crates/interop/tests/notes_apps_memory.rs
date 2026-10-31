//! How much memory hostile Notability notes in `corpus/notes-apps` take to import (ADR 0053).
//!
//! A counting allocator records the most memory held at once. Each case runs in this one test, one after another,
//! so no other test's allocations are counted.

use std::alloc::{GlobalAlloc, Layout, System};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use opennote_interop::testing::TestEnv;
use opennote_interop::{import_notes_apps, MemorySink, Outcome};

struct Counting;

static HELD: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

// SAFETY: every call goes straight to the system allocator; the counters only add and subtract sizes.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        // SAFETY: the layout is the caller's, passed on unchanged.
        let ptr = unsafe { System.alloc(layout) };
        if !ptr.is_null() {
            let now = HELD.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` came from `alloc` with this layout.
        unsafe { System.dealloc(ptr, layout) };
        HELD.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

const MIB: usize = 1 << 20;

/// Imports a corpus file and returns its skipped entries and the most memory the import held beyond what was
/// held before it.
fn import_peak(name: &str) -> (Vec<String>, usize) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/notes-apps")
        .join(name);
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let before = HELD.load(Ordering::Relaxed);
    PEAK.store(before, Ordering::Relaxed);
    let report = import_notes_apps(&path, &world.env(), &mut sink).expect("imports");
    let peak = PEAK.load(Ordering::Relaxed) - before;
    let skipped = report
        .pages
        .iter()
        .flat_map(|p| p.entries.iter())
        .filter(|e| e.outcome == Outcome::Skipped)
        .map(|e| e.what.clone())
        .collect();
    (skipped, peak)
}

#[test]
fn hostile_curve_lists_import_in_bounded_memory() {
    // 4,194,304 curves of no points in a 16 MiB count list. Keeping a curve record of at least 56 bytes for each
    // would hold over 224 MiB.
    let (skipped, peak) = import_peak("zero-count-flood.note");
    assert!(skipped.contains(&"4194304 strokes".to_owned()), "{skipped:?}");
    assert!(peak < 64 * MIB, "the empty curves took {} MiB", peak / MIB);

    // 64 curve lists share one list of 1,000,000 points, 8 MB. Reading every list would hold 64 copies of the
    // points, over 512 MiB; the page takes 2,000,000 points, 16 MB as read.
    let (skipped, peak) = import_peak("shared-points.note");
    assert!(skipped.contains(&"48 extra curve lists".to_owned()), "{skipped:?}");
    assert!(peak < 160 * MIB, "the shared points took {} MiB", peak / MIB);
}
