//! A large notebook: 3,000 pages and a 24 MiB recording. Prints the times, so the numbers can be recorded, and
//! checks generous bounds that catch a slow path, not a slow machine.

mod common;

use std::sync::Arc;
use std::time::Instant;

use common::*;
use opennote_sync::MemoryBackend;

#[test]
fn a_large_notebook_syncs_in_reasonable_time() {
    let store = MemoryBackend::new();
    let d = devices(Arc::new(store.clone()), 2);
    let pages = 3_000u128;
    for p in 0..pages {
        let dir = format!("Big/{}/{}", p % 30, p);
        d[0].write(
            &format!("{dir}/page.json"),
            &page(p + 10, &format!("Page {p}"), p + 10, &[], 1_000, &[]),
        );
    }
    d[0].write("Big/0/0/assets/rec.m4a", &vec![7u8; 24 * 1024 * 1024]);

    let time = |label: &str, f: &dyn Fn()| {
        let start = Instant::now();
        f();
        let ms = start.elapsed().as_millis();
        eprintln!("sync perf: {label}: {ms} ms");
        ms
    };
    let up = time("first upload of 3,000 pages and 24 MiB", &|| {
        d[0].engine.sync().expect("syncs");
    });
    let down = time("first download on the second device", &|| {
        d[1].engine.sync().expect("syncs");
    });
    let idle = time("a round with nothing to do", &|| {
        let report = d[0].engine.sync().expect("syncs");
        assert!(report.summary.is_empty());
    });
    d[1].write("Big/7/7/page.json", &page(17, "Changed", 999_999, &[17], 2_000, &[]));
    let one = time("one changed page, both devices", &|| {
        d[1].engine.sync().expect("syncs");
        d[0].engine.sync().expect("syncs");
    });
    assert_eq!(d[0].files(), d[1].files());
    let head = store
        .snapshot()
        .iter()
        .filter(|(n, _)| n.starts_with("h/"))
        .map(|(_, b)| b.len())
        .max()
        .unwrap_or(0);
    eprintln!("sync perf: largest head {head} bytes for {} files", pages + 1);
    assert!(
        head < 200 * pages as usize,
        "about 150 bytes a file or less, compressed"
    );
    assert!(
        up < 120_000 && down < 120_000,
        "debug builds stay well under two minutes"
    );
    assert!(idle < 15_000 && one < 30_000, "rounds with little to do stay quick");
}
