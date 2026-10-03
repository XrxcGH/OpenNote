//! The file system workload: a writer that journals edits and saves pages through `StdFs` exactly as the
//! page save does (spec 17.7), with none of the other packages. It runs today, and tests the save primitives,
//! the Busy retries, and the fail points under real kills.
//!
//! The writer prints `ACK p<k> <seq>` once a journal flush makes edits up to `seq` durable, and `SAVE p<k>
//! <step>` at each save step. The verifier checks invariants I1 and I2. Every page file must be whole, with
//! every segment it names there and correct. Every acknowledged edit must be in the page file or the journal.

use std::collections::BTreeMap;
use std::io::Write;
use std::time::Duration;

use opennote_core::store::failpoint;
use opennote_core::store::fs::{AppendFile, Durability, Fs};
use opennote_core::store::std_fs::StdFs;
use opennote_core::{FsError, FsErrorKind, Timings};

use super::fs_format::{self as format, JournalRead, Layout, PageFile, KEEP_SEGMENTS, PAGES};
use super::{say, Verified};
use crate::markers::Markers;
use crate::rng::Rng;

/// Fail points of this workload, and the highest hit number worth arming for each.
pub const FAIL_POINTS: [(&str, u64); 11] = [
    ("fs.tmp_flushed", 40),
    ("fs.renamed", 40),
    ("save.page.tmp_flushed", 12),
    ("save.page.renamed", 12),
    ("fsw.journal.appended", 300),
    ("fsw.journal.synced", 100),
    ("fsw.segment.written", 12),
    ("fsw.page.replaced", 12),
    ("fsw.gc.deleted", 12),
    ("fsw.rotate.created", 6),
    ("fsw.rotate.deleted", 6),
];

/// The fail point in the sabotaged save, between the two halves of an in-place write.
pub const SABOTAGE_POINT: &str = "fsw.sabotage.half_written";

/// One page in the writer.
struct PageState {
    saved: Option<PageFile>,
    last_seq: u64,
    synced_seq: u64,
    generation: u64,
    journal: Box<dyn AppendFile>,
}

/// The writer: recovers the pages, then edits and saves until it is killed.
pub fn write(layout: &Layout, seed: u64, sabotage: bool) -> Result<(), String> {
    format::make_dirs(layout).map_err(|e| e.to_string())?;
    let fs = StdFs::new(&Timings::for_crash_tests());
    let mut pages = Vec::new();
    for page in 0..PAGES {
        pages.push(recover(&fs, layout, page).map_err(|e| format!("p{page}: {e}"))?);
    }
    say("READY");
    let mut rng = Rng::new(seed);
    loop {
        let page = rng.below(PAGES);
        let state = pages.get_mut(page).ok_or("no page")?;
        edit(state, page, &mut rng).map_err(|e| e.to_string())?;
        if state.last_seq - state.saved.as_ref().map_or(0, |p| p.seq) < 6 || rng.below(2) == 1 {
            continue;
        }
        match save(&fs, layout, state, page, &mut rng, sabotage) {
            Ok(()) => {}
            // A scanner held a file past the retries. The app tries again later, and so does the writer.
            Err(err) if matches!(err.kind, FsErrorKind::Busy | FsErrorKind::Blocked) => {
                say(&format!("SAVE p{page} busy"));
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

/// Reads a page back as the app would at start-up: its page file, and the edits in its journal after it.
fn recover(fs: &StdFs, layout: &Layout, page: usize) -> Result<PageState, FsError> {
    let saved = match fs.read(&layout.page_json(page), 1 << 20) {
        Ok(bytes) => Some(PageFile::decode(&bytes).map_err(|_| FsError::new(FsErrorKind::Io, layout.page_json(page)))?),
        Err(err) if err.kind == FsErrorKind::NotFound => None,
        Err(err) => return Err(err),
    };
    let names: Vec<String> = fs
        .read_dir(&layout.journal_dir())?
        .into_iter()
        .map(|e| e.name)
        .collect();
    let generations = format::generations(&names, page);
    let mut last_seq = saved.as_ref().map_or(0, |p| p.seq);
    for &generation in &generations {
        let bytes = fs.read(&layout.journal(page, generation), 1 << 30)?;
        last_seq = last_seq.max(format::read_journal(page, &bytes).seqs.into_iter().max().unwrap_or(0));
    }
    // A new generation for this run, so a torn tail left by a crash is never appended to.
    let generation = generations.last().map_or(1, |g| g + 1);
    let journal = fs.open_append(&layout.journal(page, generation), true)?;
    Ok(PageState {
        saved,
        last_seq,
        synced_seq: last_seq,
        generation,
        journal,
    })
}

/// Journals one to four edits, and sometimes flushes them.
fn edit(state: &mut PageState, page: usize, rng: &mut Rng) -> Result<(), FsError> {
    for _ in 0..1 + rng.below(4) {
        state.last_seq += 1;
        state.journal.append(&format::record(page, state.last_seq))?;
        failpoint::hit("fsw.journal.appended");
    }
    if rng.below(3) == 0 {
        sync(state, page)?;
    }
    Ok(())
}

fn sync(state: &mut PageState, page: usize) -> Result<(), FsError> {
    state.journal.sync()?;
    failpoint::hit("fsw.journal.synced");
    state.synced_seq = state.last_seq;
    say(&format!("ACK p{page} {}", state.synced_seq));
    Ok(())
}

/// Saves a page as spec 17.7 does. It flushes the journal, writes a segment, and replaces the page file. Then
/// it writes the readable copy, deletes segments nothing refers to, and rotates the journal after a confirmed save.
fn save(
    fs: &StdFs,
    layout: &Layout,
    state: &mut PageState,
    page: usize,
    rng: &mut Rng,
    sabotage: bool,
) -> Result<(), FsError> {
    sync(state, page)?;
    let seq = state.synced_seq;
    say(&format!("SAVE p{page} begin"));
    let len = rng.range(200..24_000);
    fs.create_durable(&layout.segment(page, seq), &format::segment_bytes(page, seq, len))?;
    failpoint::hit("fsw.segment.written");
    say(&format!("SAVE p{page} segment"));
    let mut segments = state.saved.as_ref().map(|p| p.segments.clone()).unwrap_or_default();
    segments.push((seq, len));
    let dropped: Vec<(u64, u64)> = segments.drain(..segments.len().saturating_sub(KEEP_SEGMENTS)).collect();
    let file = PageFile {
        page,
        seq,
        segments,
        body: PageFile::body_for(page, seq),
    };
    let durability = if sabotage {
        write_in_place(layout, page, &file.encode())?
    } else {
        fs.replace_durable(&layout.page_json(page), &file.encode())?.durability
    };
    failpoint::hit("fsw.page.replaced");
    say(&format!("SAVE p{page} page"));
    state.saved = Some(file);
    fs.write_derived(&layout.page_md(page), &format::page_md(page, seq))?;
    for (old, _) in dropped {
        // A segment a scanner holds stays behind, unreferenced, as after a crash.
        let _ = fs.remove_file(&layout.segment(page, old));
        failpoint::hit("fsw.gc.deleted");
    }
    if durability == Durability::Confirmed {
        rotate(fs, layout, state, page)?;
    }
    say(&format!("SAVE p{page} done"));
    Ok(())
}

/// Starts a new journal generation, then deletes the older ones, whose edits the page file now holds.
fn rotate(fs: &StdFs, layout: &Layout, state: &mut PageState, page: usize) -> Result<(), FsError> {
    let next = state.generation + 1;
    state.journal = fs.open_append(&layout.journal(page, next), true)?;
    failpoint::hit("fsw.rotate.created");
    for old in format::generations(&format::names(&layout.journal_dir()), page) {
        if old < next {
            // A generation a scanner holds is deleted at the next rotation.
            let _ = fs.remove_file(&layout.journal(page, old));
        }
    }
    failpoint::hit("fsw.rotate.deleted");
    state.generation = next;
    Ok(())
}

/// The sabotaged save: the page file is rewritten in place, so a crash halfway leaves it torn.
fn write_in_place(layout: &Layout, page: usize, bytes: &[u8]) -> Result<Durability, FsError> {
    let path = layout.page_json(page);
    let io = |err: std::io::Error| FsError::new(FsErrorKind::Io, &path).with_message(err);
    let mut file = std::fs::File::create(&path).map_err(io)?;
    let (first, second) = bytes.split_at(bytes.len() / 2);
    file.write_all(first).map_err(io)?;
    failpoint::hit(SABOTAGE_POINT);
    std::thread::sleep(Duration::from_millis(15));
    file.write_all(second).map_err(io)?;
    Ok(Durability::Unconfirmed)
}

trait WithMessage {
    fn with_message(self, err: std::io::Error) -> FsError;
}

impl WithMessage for FsError {
    fn with_message(self, err: std::io::Error) -> FsError {
        FsError {
            os_code: err.raw_os_error(),
            ..self
        }
    }
}

/// Checks the notebook after a kill. The state keeps every page's highest acknowledged edit so far. It also
/// keeps each page file's sequence number at the last check, which must never go back.
pub fn verify(layout: &Layout, markers: &Markers, state: &mut VerifyState) -> Result<Verified, String> {
    for (page, seq) in &markers.acks {
        let entry = state.acked.entry(page.clone()).or_default();
        *entry = (*entry).max(*seq);
    }
    let mut note = Verified::default();
    let journal_names = format::names(&layout.journal_dir());
    for page in 0..PAGES {
        let name = format!("p{page}");
        let saved = check_page_file(layout, page).map_err(|e| format!("{name}: {e}"))?;
        let saved_seq = saved.as_ref().map_or(0, |p| p.seq);
        let previous = state.saved.get(&name).copied().unwrap_or(0);
        if saved_seq < previous {
            return Err(format!(
                "{name}: the page file went back from edit {previous} to {saved_seq}"
            ));
        }
        state.saved.insert(name.clone(), saved_seq);
        let journal = read_journals(layout, page, &journal_names);
        if !journal.wrong.is_empty() {
            return Err(format!(
                "{name}: journal records with the wrong bytes: {:?}",
                journal.wrong
            ));
        }
        note.torn_tails += u32::from(journal.torn);
        let durable = journal.seqs.iter().copied().chain([saved_seq]).max().unwrap_or(0);
        let acked = state.acked.get(&name).copied().unwrap_or(0);
        if durable < acked {
            return Err(format!(
                "{name}: edit {acked} was acknowledged, but only {durable} survived (I2)"
            ));
        }
        let missing = (saved_seq + 1..=acked).find(|seq| !journal.seqs.contains(seq));
        if let Some(seq) = missing {
            return Err(format!(
                "{name}: acknowledged edit {seq} is in neither the page file nor the journal"
            ));
        }
        note.pages += 1;
    }
    note.temp_files = count_temp_files(&layout.notebook);
    Ok(note)
}

/// What the verifier remembers between iterations.
#[derive(Debug, Default)]
pub struct VerifyState {
    /// Each page's highest acknowledged edit.
    pub acked: BTreeMap<String, u64>,
    /// Each page file's sequence number at the last check.
    pub saved: BTreeMap<String, u64>,
}

/// Invariant I1 for one page: the page file is whole, and its segments are there with the right bytes.
fn check_page_file(layout: &Layout, page: usize) -> Result<Option<PageFile>, String> {
    let bytes = match std::fs::read(layout.page_json(page)) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("page.json can't be read: {err}")),
    };
    let file = PageFile::decode(&bytes).map_err(|e| format!("page.json is damaged (I1): {e}"))?;
    for &(seq, len) in &file.segments {
        let path = layout.segment(page, seq);
        let bytes = std::fs::read(&path).map_err(|e| format!("segment {seq} is missing (I1): {e}"))?;
        if bytes != format::segment_bytes(page, seq, len) {
            return Err(format!("segment {seq} has the wrong bytes (I1)"));
        }
    }
    Ok(Some(file))
}

fn read_journals(layout: &Layout, page: usize, names: &[String]) -> JournalRead {
    let mut all = JournalRead::default();
    for generation in format::generations(names, page) {
        let bytes = std::fs::read(layout.journal(page, generation)).unwrap_or_default();
        let read = format::read_journal(page, &bytes);
        all.seqs.extend(read.seqs);
        all.wrong.extend(read.wrong);
        all.torn |= read.torn;
    }
    all
}

/// Temporary files left in the notebook, which the scan deletes after 24 hours.
fn count_temp_files(dir: &std::path::Path) -> u32 {
    let mut count = 0;
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(&next).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if opennote_core::store::layout::parse_temp_name(&entry.file_name().to_string_lossy()).is_some() {
                count += 1;
            }
        }
    }
    count
}
