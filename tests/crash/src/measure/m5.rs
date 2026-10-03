//! M5: the cost of each write primitive, and of a full save of a budget page after one new stroke (plan 2).
//!
//! The save is steps S3 to S8 of spec 17.7 as file system calls. It writes a small segment with
//! `create_durable`, appends and flushes the `SaveBegin` record, checks the fingerprint, and replaces a 200 KB
//! `page.json`. `save.full` adds the readable copy of step S11. The journal stays in the scratch folder, so on
//! the internal drive the numbers include both flushes on one drive, as the app has them.

use std::path::Path;

use opennote_core::store::fs::{Durability, Fs};
use opennote_core::store::std_fs::StdFs;
use opennote_core::Timings;
use opennote_perf::harness::{measure, Samples};

use super::Ctx;
use crate::rng::Rng;

/// A budget page's `page.json`: 500 blocks at about 400 bytes each.
pub const PAGE_JSON_BYTES: usize = 200 * 1024;
/// A budget page's `page.md`.
const PAGE_MD_BYTES: usize = 100 * 1024;
/// A segment holding one stroke of about 200 points.
const STROKE_SEGMENT_BYTES: usize = 1_800;
/// A `SaveBegin` record.
const SAVE_BEGIN_BYTES: usize = 120;
/// The gate on the 95th percentile of a save after one stroke, on the reference drive (plan 13.9).
const SAVE_GATE_MS: f64 = 25.0;

/// Deterministic filler that compresses like real JSON and ink, rather than like zeros.
pub fn filler(len: usize, seed: u64) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    Rng::new(seed).fill(&mut bytes);
    for (i, byte) in bytes.iter_mut().enumerate() {
        if i % 3 == 0 {
            *byte = b'a' + *byte % 26;
        }
    }
    bytes
}

/// Runs M5 in `ctx.dir`.
pub fn run(ctx: &mut Ctx) -> Result<(), String> {
    println!("M5: write primitives and saves in {}", ctx.dir.display());
    let dir = ctx.scratch("m5")?;
    let fs = StdFs::new(&Timings::default());
    let err = |e: opennote_core::FsError| e.to_string();
    primitives(ctx, &fs, &dir).map_err(err)?;
    saves(ctx, &fs, &dir).map_err(err)?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

fn primitives(ctx: &mut Ctx, fs: &StdFs, dir: &Path) -> Result<(), opennote_core::FsError> {
    let runs = ctx.runs;
    for (name, len) in [("1k", 1024), ("200k", PAGE_JSON_BYTES), ("4m", 4 << 20)] {
        let bytes = filler(len, 1);
        let path = dir.join(format!("replace-{name}.json"));
        fs.replace_durable(&path, &bytes)?;
        let samples = timed(runs.min(if len > 1 << 20 { 40 } else { runs }), || {
            fs.replace_durable(&path, &bytes)
        })?;
        ctx.add_percentiles(&format!("replace_durable.{name}"), &samples, None);
    }
    for (name, len) in [("2k", STROKE_SEGMENT_BYTES), ("1m", 1 << 20)] {
        let bytes = filler(len, 2);
        let mut n = 0u64;
        let samples = timed(runs.min(if len > 1 << 16 { 60 } else { runs }), || {
            n += 1;
            fs.create_durable(&dir.join(format!("seg-{name}-{n}.onk")), &bytes)
        })?;
        ctx.add_percentiles(&format!("create_durable.{name}"), &samples, None);
    }
    let md = filler(PAGE_MD_BYTES, 3);
    let samples = timed(runs, || fs.write_derived(&dir.join("page.md"), &md))?;
    ctx.add_percentiles("write_derived.100k", &samples, None);
    let mut n = 0u64;
    let samples = timed(runs, || {
        n += 1;
        fs.create_dir_durable(&dir.join(format!("folder-{n}")))
    })?;
    ctx.add_percentiles("create_dir_durable", &samples, None);
    let mut n = 0u64;
    let samples = timed(runs.min(100), || {
        n += 1;
        fs.rename_dir(&dir.join(format!("folder-{n}")), &dir.join(format!("moved-{n}")))
    })?;
    ctx.add_percentiles("rename_dir", &samples, None);
    let mut journal = fs.open_append(&dir.join("journal.onj"), true)?;
    let record = filler(200, 4);
    let samples = timed(runs, || {
        journal.append(&record)?;
        journal.sync()
    })?;
    ctx.add_percentiles("journal.append_sync.200b", &samples, None);
    let page = dir.join("replace-200k.json");
    let samples = timed(runs, || fs.metadata(&page))?;
    ctx.add_percentiles("metadata", &samples, None);
    let samples = timed(runs, || fs.read(&page, 1 << 30))?;
    ctx.add_percentiles("read.200k.warm", &samples, None);
    Ok(())
}

/// Full saves of a budget page after one new stroke: S3, S6, S7, and S8, then S11.
fn saves(ctx: &mut Ctx, fs: &StdFs, dir: &Path) -> Result<(), opennote_core::FsError> {
    let page_dir = dir.join("page");
    fs.create_dir_durable(&page_dir)?;
    fs.create_dir_durable(&page_dir.join("ink"))?;
    let page_json = page_dir.join("page.json");
    fs.replace_durable(&page_json, &filler(PAGE_JSON_BYTES, 5))?;
    let mut journal = fs.open_append(&dir.join("page-journal.onj"), true)?;
    let (mut commit, mut full) = (Samples::default(), Samples::default());
    let mut unconfirmed = 0;
    for n in 0..ctx.runs {
        let segment = filler(STROKE_SEGMENT_BYTES, 100 + n as u64);
        let json = filler(PAGE_JSON_BYTES, 200 + n as u64);
        let md = filler(PAGE_MD_BYTES, 300 + n as u64);
        let start = std::time::Instant::now();
        fs.create_durable(&page_dir.join("ink").join(format!("{n:08}.onk")), &segment)?;
        journal.append(&filler(SAVE_BEGIN_BYTES, n as u64))?;
        journal.sync()?;
        fs.metadata(&page_json)?;
        let committed = fs.replace_durable(&page_json, &json)?;
        commit.push(start.elapsed());
        fs.write_derived(&page_dir.join("page.md"), &md)?;
        full.push(start.elapsed());
        unconfirmed += usize::from(committed.durability == Durability::Unconfirmed);
    }
    let gate = (ctx.label == "nvme").then_some(SAVE_GATE_MS);
    ctx.add_percentiles("save.one_stroke.commit", &commit, gate);
    ctx.add_percentiles("save.one_stroke.full", &full, None);
    ctx.note(format!(
        "{}: {unconfirmed} of {} saves were unconfirmed",
        ctx.label, ctx.runs
    ));
    Ok(())
}

/// Times `runs` calls of `f`, failing on the first error.
fn timed<T>(
    runs: usize,
    mut f: impl FnMut() -> Result<T, opennote_core::FsError>,
) -> Result<Samples, opennote_core::FsError> {
    let mut failure = None;
    let samples = measure(runs, || {
        if failure.is_none() {
            if let Err(err) = f() {
                failure = Some(err);
            }
        }
    });
    failure.map_or(Ok(samples), Err)
}
