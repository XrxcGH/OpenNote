//! Saves that compact the ink.

use super::*;

#[test]
fn compaction_saves_keep_the_live_strokes() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    let mut stamp = None;
    for n in 0..10 {
        draw(&mut page, stroke_n(n));
        if n == 4 {
            erase(&mut page, stroke_n(2).id);
        }
        let (next, outcome) = h.save(&page, stamp, CompactionPlan::None);
        page = next;
        stamp = Some(outcome.stamp);
    }
    assert_eq!(page.ink.segments().len(), 10);
    draw(&mut page, stroke_n(20));
    assert_ne!(plan_compaction(&page.ink), CompactionPlan::None);
    let (minor, outcome) = h.save(&page, stamp, CompactionPlan::Minor);
    assert_eq!(outcome.segments.len(), 2);
    assert_eq!(outcome.segments[0], page.ink.segments()[0]);
    let loaded = h.store.load(&h.dir).unwrap().page;
    assert_eq!(
        loaded.ink.strokes().collect::<Vec<_>>(),
        minor.ink.strokes().collect::<Vec<_>>()
    );
    let (major, outcome) = h.save(&loaded, Some(outcome.stamp), CompactionPlan::Major);
    assert_eq!((outcome.segments.len(), outcome.dead_bytes), (1, 0));
    let reloaded = h.store.load(&h.dir).unwrap().page;
    assert_eq!(reloaded, major);
    assert_eq!(reloaded.ink.len(), 11);
}

#[test]
fn a_minor_compaction_takes_the_segments_this_store_wrote_from_memory() {
    let h = Harness::new();
    let mut page = sample_page();
    h.put_assets(&page);
    let mut stamp = None;
    for n in 0..6 {
        draw(&mut page, stroke_n(n));
        let (next, outcome) = h.save(&page, stamp, CompactionPlan::None);
        page = next;
        stamp = Some(outcome.stamp);
    }
    // Without the later segments' files, a minor compaction can only work from what the store remembers.
    for segment in &page.ink.segments()[1..] {
        crate::store::fs::Fs::remove_file(&h.fs, &NotebookLayout::segment_path(&h.dir, segment.id)).unwrap();
    }
    draw(&mut page, stroke_n(20));
    let (minor, outcome) = h.save(&page, stamp, CompactionPlan::Minor);
    assert_eq!(outcome.segments.len(), 2);
    assert_eq!(outcome.segments[0], page.ink.segments()[0]);
    let loaded = h.store.load(&h.dir).unwrap();
    assert!(loaded.damaged.is_empty() && loaded.missing.is_empty());
    assert_eq!(loaded.page.ink.len(), page.ink.len());
    assert_eq!(
        loaded.page.ink.strokes().collect::<Vec<_>>(),
        minor.ink.strokes().collect::<Vec<_>>()
    );
}
