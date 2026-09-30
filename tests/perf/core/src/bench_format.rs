//! Format benchmarks: reading and writing `page.json`, and encoding and decoding ink segments (plan 13.9).
//! Owned by WP1.
//!
//! The suite also takes measurement M2: bytes per point of synthetic handwriting from each pen profile, and the
//! time to decode 5,000 strokes. It writes the budget page's handwriting to `m2-budget.onk` and
//! `m2-budget.records` in the scratch folder, so the TypeScript codec can be timed on the same bytes.

use std::sync::Arc;

use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::format::points::decode_points;
use opennote_core::format::segment::{decode_records, decode_segment, encode_records, encode_segment};
use opennote_core::format::SegmentHeader;
use opennote_core::model::InkRecord;
use opennote_core::{BlockId, Limits, PageId, SegmentId, Timestamp};

use crate::generate::{build_page, handwriting, Built, PageKind, PenProfile, Rng, FINE_TILT, SURFACE_PEN, WACOM};
use crate::harness::{measure, BenchCtx, Samples};

/// M2's threshold: at most 10 bytes per point with tilt.
const M2_BYTES_PER_POINT: f64 = 10.0;

fn ms(samples: &Samples, p: f64) -> f64 {
    samples.percentile(p).as_secs_f64() * 1_000.0
}

/// Runs the `format` suite and adds its measurements to the report. Timings from a debug build mean nothing, so
/// a debug build, such as the test's, runs each measure once to check that it works.
pub fn run(ctx: &mut BenchCtx) -> Result<(), String> {
    let runs = match (cfg!(debug_assertions), ctx.quick) {
        (true, _) => 1,
        (false, true) => 10,
        (false, false) => 50,
    };
    let mut rng = Rng::new(42);
    let page_id: PageId = rng.id(1_790_777_000_000);
    let built = build_page(&mut rng, PageKind::Budget, page_id, "Budget page", &SURFACE_PEN);
    page_json(ctx, &built, runs)?;
    let strokes: Vec<InkRecord> = built.page.ink.strokes().map(|s| InkRecord::Stroke(s.clone())).collect();
    segments(ctx, &strokes, runs)?;
    for pen in [SURFACE_PEN, WACOM, FINE_TILT] {
        bytes_per_point(ctx, &mut rng, &pen);
    }
    std::fs::create_dir_all(&ctx.dir).map_err(|e| format!("{}: {e}", ctx.dir.display()))?;
    let header = SegmentHeader {
        id: rng.id(1_790_777_000_000),
        page: page_id,
        created: Timestamp::from_unix_ms(1_790_777_000_000),
    };
    let write = |name: &str, bytes: Vec<u8>| {
        let path = ctx.dir.join(name);
        std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
    };
    write("m2-budget.onk", encode_segment(&header, &strokes))?;
    write("m2-budget.records", encode_records(&strokes))
}

/// Reading and writing the budget page's `page.json`: 500 blocks and 5,000 strokes in two segments.
fn page_json(ctx: &mut BenchCtx, built: &Built, runs: usize) -> Result<(), String> {
    let bytes = write_page(&built.page);
    let limits = Limits::default();
    read_page(&bytes, &limits).map_err(|e| e.to_string())?;
    let write = measure(runs, || {
        std::hint::black_box(write_page(&built.page));
    });
    let read = measure(runs, || {
        std::hint::black_box(read_page(&bytes, &limits).ok());
    });
    ctx.report.add(
        "format.page_json.bytes.budget",
        "KB",
        bytes.len() as f64 / 1_024.0,
        None,
    );
    ctx.report
        .add("format.page_json.write.budget.p95", "ms", ms(&write, 95.0), None);
    ctx.report
        .add("format.page_json.read.budget.p95", "ms", ms(&read, 95.0), None);
    Ok(())
}

/// Encoding and decoding 5,000 strokes: a whole segment with its checks, and a record blob with every point
/// decoded, as the page envelope is.
fn segments(ctx: &mut BenchCtx, strokes: &[InkRecord], runs: usize) -> Result<(), String> {
    let limits = Limits::default();
    let header = SegmentHeader {
        id: SegmentId::ZERO,
        page: PageId::ZERO,
        created: Timestamp::from_unix_ms(1_790_777_000_000),
    };
    let bytes = encode_segment(&header, strokes);
    let entry = opennote_core::model::SegmentRef {
        id: header.id,
        bytes: bytes.len() as u64,
        records: strokes.len() as u32,
        crc32: opennote_core::format::segment_footer_crc(&bytes).ok_or("no footer")?,
        extra: Default::default(),
    };
    let blob = encode_records(strokes);
    let encode = measure(runs, || {
        std::hint::black_box(encode_segment(&header, strokes));
    });
    let decode = measure(runs, || {
        std::hint::black_box(decode_segment(&bytes, &entry, header.page, &limits).ok());
    });
    let points = measure(runs, || {
        let records = decode_records(&blob, &limits).unwrap_or_default();
        for record in &records {
            if let InkRecord::Stroke(s) = record {
                std::hint::black_box(decode_points(&s.points, s.point_count, s.channels).ok());
            }
        }
    });
    ctx.report.add(
        "format.segment.bytes.5000_strokes",
        "MB",
        bytes.len() as f64 / 1_048_576.0,
        None,
    );
    ctx.report
        .add("format.segment.encode.5000_strokes.p95", "ms", ms(&encode, 95.0), None);
    ctx.report
        .add("format.segment.decode.5000_strokes.p95", "ms", ms(&decode, 95.0), None);
    ctx.report
        .add("m2.decode_5000_strokes.rust.p50", "ms", ms(&points, 50.0), None);
    ctx.report
        .add("m2.decode_5000_strokes.rust.p95", "ms", ms(&points, 95.0), None);
    Ok(())
}

/// M2: bytes per point of 5,000 strokes from one pen profile. It counts the points alone, then whole records.
fn bytes_per_point(ctx: &mut BenchCtx, rng: &mut Rng, pen: &PenProfile) {
    let strokes = handwriting(rng, pen, BlockId::ZERO, 5_000, 400.0);
    let points: u64 = strokes.iter().map(|s| u64::from(s.point_count)).sum();
    let point_bytes: usize = strokes.iter().map(|s| s.points.len()).sum();
    let records: Vec<InkRecord> = strokes.into_iter().map(|s| InkRecord::Stroke(Arc::new(s))).collect();
    let record_bytes = encode_records(&records).len();
    let name = pen.name;
    let per_point = point_bytes as f64 / points as f64;
    ctx.report.add(
        &format!("m2.bytes_per_point.{name}"),
        "B",
        per_point,
        Some(M2_BYTES_PER_POINT),
    );
    let with_records = record_bytes as f64 / points as f64;
    ctx.report.add(
        &format!("m2.bytes_per_point.{name}.with_records"),
        "B",
        with_records,
        None,
    );
    ctx.report.add(
        &format!("m2.points_per_stroke.{name}"),
        "points",
        points as f64 / 5_000.0,
        None,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::Report;

    #[test]
    fn the_quick_suite_measures_and_writes_the_m2_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut ctx = BenchCtx {
            pages: 1,
            quick: true,
            dir: dir.path().to_path_buf(),
            report: Report::default(),
        };
        run(&mut ctx).unwrap();
        let names: Vec<&str> = ctx.report.results.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"m2.bytes_per_point.surface_pen"), "{names:?}");
        assert!(names.contains(&"format.page_json.read.budget.p95"));
        assert!(ctx.report.over_budget().is_empty(), "{:?}", ctx.report.over_budget());
        let blob = std::fs::read(dir.path().join("m2-budget.records")).unwrap();
        assert_eq!(decode_records(&blob, &Limits::default()).unwrap().len(), 5_000);
    }
}
