//! M3: a cold open of a budget page, counting file opens (plan 2).
//!
//! A budget page is a 200 KB `page.json` and about 3.6 MB of ink. The measurement reads the page file, parses it
//! as JSON as a stand-in for the page reader, and reads every segment, with 1, 4, and 8 segments. That is the
//! file system share of the core's page open. Decoding the ink is the codec's share, which the format benchmark
//! in `tests/perf/core` measures.
//!
//! A reboot can't be scripted here, so each file is evicted from the cache first, the way Chromium's
//! `EvictFileFromSystemCache` does it: an unbuffered handle, and its times set to themselves. Folder metadata can
//! stay cached, so a real cold start can be slower. Microsoft Defender scans on open, so each run also has a
//! variant with new files, which Defender hasn't seen.

use std::path::{Path, PathBuf};

use opennote_core::store::fs::Fs;
use opennote_core::store::std_fs::StdFs;
use opennote_core::Timings;
use opennote_perf::harness::Samples;

use super::m5::{filler, PAGE_JSON_BYTES};
use super::Ctx;

/// A budget page's ink.
const INK_BYTES: usize = 3_600 * 1024;
/// Segment counts to try: after a major compaction, and at the minor and major compaction thresholds.
const LAYOUTS: [usize; 3] = [1, 4, 8];

/// Runs M3 in `ctx.dir`.
pub fn run(ctx: &mut Ctx) -> Result<(), String> {
    println!("M3: budget page opens in {}", ctx.dir.display());
    let dir = ctx.scratch("m3")?;
    let fs = StdFs::new(&Timings::default());
    let runs = ctx.runs.min(60);
    for segments in LAYOUTS {
        let page = write_page(&dir.join(format!("page-{segments}")), segments, 0)?;
        // Untimed opens first, so Defender has scanned the new files before the warm numbers.
        timed(5, |_| Ok(()), |()| open(&fs, &page))?;
        let warm = timed(runs, |_| Ok(()), |()| open(&fs, &page))?;
        ctx.add_percentiles(&format!("open.{segments}seg.warm"), &warm, None);
        if cfg!(windows) {
            let cold = timed(runs, |_| evict_all(&page), |()| open(&fs, &page))?;
            ctx.add_percentiles(&format!("open.{segments}seg.cold"), &cold, Some(60.0));
            let new_files = |n: usize| {
                let copy = write_page(&dir.join(format!("fresh-{segments}-{n}")), segments, n as u64 + 1)?;
                evict_all(&copy).map(|()| copy)
            };
            let fresh = timed(runs, new_files, |copy| open(&fs, copy))?;
            ctx.add_percentiles(&format!("open.{segments}seg.cold_new_files"), &fresh, None);
        }
        ctx.note(format!(
            "{} segments: {} file opens per page open",
            segments,
            segments + 1
        ));
    }
    let json = page_json(0);
    let parse = timed(
        runs,
        |_| Ok(()),
        |()| {
            serde_json::from_slice::<serde_json::Value>(&json)
                .map(|_| ())
                .map_err(|e| e.to_string())
        },
    )?;
    ctx.add_percentiles("open.parse_page_json", &parse, None);
    if !cfg!(windows) {
        ctx.note("cold opens need cache eviction, which is only written for Windows".into());
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// The files of one page: `page.json` first, then its segments.
struct PageFiles {
    files: Vec<PathBuf>,
}

/// Writes a page folder with `segments` segments. The first segment holds most of the ink, as after a
/// compaction, and the rest are small.
fn write_page(dir: &Path, segments: usize, seed: u64) -> Result<PageFiles, String> {
    std::fs::create_dir_all(dir.join("ink")).map_err(|e| e.to_string())?;
    let page = dir.join("page.json");
    std::fs::write(&page, page_json(seed)).map_err(|e| e.to_string())?;
    let mut files = vec![page];
    let small = 60 * 1024;
    for i in 0..segments {
        let len = if i == 0 {
            INK_BYTES - small * (segments - 1)
        } else {
            small
        };
        let path = dir.join("ink").join(format!("{i:026}.onk"));
        std::fs::write(&path, filler(len, seed * 100 + i as u64)).map_err(|e| e.to_string())?;
        files.push(path);
    }
    Ok(PageFiles { files })
}

/// A 200 KB `page.json` of 500 text blocks.
fn page_json(seed: u64) -> Vec<u8> {
    let text = String::from_utf8_lossy(&filler(300, seed)).replace(|c: char| !c.is_ascii_alphanumeric(), " ");
    let blocks: Vec<serde_json::Value> = (0..500)
        .map(|i| {
            serde_json::json!({
                "id": format!("01m3sa14y9zszek1wdk3s{i:05}"),
                "type": "text",
                "order": format!("a{i:04}"),
                "created": "2026-09-30T14:00:00.000Z",
                "modified": "2026-09-30T14:00:00.000Z",
                "data": { "markdown": text },
            })
        })
        .collect();
    let mut bytes =
        serde_json::to_vec(&serde_json::json!({ "formatVersion": 1, "blocks": blocks })).unwrap_or_default();
    bytes.resize(bytes.len().max(PAGE_JSON_BYTES), b' ');
    bytes
}

/// The file system share of a page open: read and parse `page.json`, then read every segment.
fn open(fs: &StdFs, page: &PageFiles) -> Result<(), String> {
    let mut files = page.files.iter();
    let json = files.next().ok_or("no page.json")?;
    let bytes = fs.read(json, 64 << 20).map_err(|e| e.to_string())?;
    let _: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    for segment in files {
        fs.read(segment, 64 << 20).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn evict_all(page: &PageFiles) -> Result<(), String> {
    page.files
        .iter()
        .try_for_each(|file| evict(file).map_err(|e| format!("{}: {e}", file.display())))
}

/// Evicts a file from the system cache: an unbuffered handle with no sharing, and its times set to themselves.
#[cfg(windows)]
fn evict(path: &Path) -> std::io::Result<()> {
    use std::fs::{FileTimes, OpenOptions};
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_NO_BUFFERING: u32 = 0x2000_0000;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_NO_BUFFERING)
        .open(path)?;
    let meta = file.metadata()?;
    file.set_times(
        FileTimes::new()
            .set_accessed(meta.accessed()?)
            .set_modified(meta.modified()?),
    )
}

#[cfg(not(windows))]
fn evict(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Times `f` `runs` times, each after an untimed `setup`.
fn timed<S>(
    runs: usize,
    mut setup: impl FnMut(usize) -> Result<S, String>,
    mut f: impl FnMut(&S) -> Result<(), String>,
) -> Result<Samples, String> {
    let mut samples = Samples::default();
    for run in 0..runs {
        let prepared = setup(run)?;
        let start = std::time::Instant::now();
        f(&prepared)?;
        samples.push(start.elapsed());
    }
    Ok(samples)
}
