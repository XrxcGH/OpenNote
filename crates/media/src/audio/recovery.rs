//! Recovery of a recording that a crash cut off.
//!
//! The writer syncs each Ogg page as it fills, so a crash leaves a file that is whole up to its last
//! complete page, perhaps followed by a torn one. Recovery cuts the torn tail and closes the stream
//! with an empty final page, so every player accepts the file. It then trims the timeline file to
//! the frames that survived.

use std::collections::BTreeSet;
use std::fs::{File, OpenOptions};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use super::clock::ClockAnchor;
use super::encoder::parse_pre_skip;
use super::files::{read_timeline_file, rewrite_timeline_file, TrackFiles, TrackKind, TrackRef};
use super::ogg::{scan_pages, OggWriter, PageInfo, Scan, FLAG_EOS};
use super::summary::{RecordingSummary, TrackSummary};
use super::timeline::Timeline;
use super::{AudioError, Result};

/// A track after recovery.
#[derive(Debug, PartialEq, Eq)]
pub struct RecoveredTrack {
    pub files: TrackFiles,
    pub timeline: Timeline,
    /// The anchor in the timeline file, or `None` if the file was missing or cut inside its header.
    /// Such a track has audio but no timeline, so nothing can place it against strokes.
    pub clock: Option<ClockAnchor>,
    /// Whether the file had ended cleanly already, so recovery changed nothing.
    pub was_complete: bool,
    /// Bytes of a torn or damaged tail that were cut.
    pub bytes_cut: u64,
}

/// Restores one track. Calling it on a file that ended cleanly changes nothing.
pub fn recover_track(files: &TrackFiles) -> Result<RecoveredTrack> {
    let mut file = OpenOptions::new().read(true).write(true).open(&files.audio)?;
    let scan = scan_pages(BufReader::new(&file))?;
    let (Some(first), Some(last)) = (scan.pages.first().copied(), scan.pages.last().copied()) else {
        return Err(AudioError::Corrupt(format!(
            "{} has no complete page.",
            files.audio.display()
        )));
    };
    if scan.pages.len() < 2 {
        return Err(AudioError::Corrupt(format!(
            "{} has no Opus headers.",
            files.audio.display()
        )));
    }
    let pre_skip = read_pre_skip(&mut file, first)?;
    // The two header pages hold no audio. Their granule position is zero.
    let frames = last.granule.saturating_sub(u64::from(pre_skip));
    let was_complete = last.flags & FLAG_EOS != 0;
    let bytes_cut = file.metadata()?.len() - scan.valid_len;
    if bytes_cut > 0 {
        file.set_len(scan.valid_len)?;
    }
    if !was_complete {
        close_stream(&mut file, last)?;
    }
    let (timeline, clock) = restore_timeline(files, frames, !was_complete)?;
    Ok(RecoveredTrack {
        files: files.clone(),
        timeline,
        clock,
        was_complete,
        bytes_cut,
    })
}

/// Restores every track of a recording, and summarizes it. The tracks are the files that the page's
/// entry names, in `dir`. A track whose audio file is missing is skipped. The summary has no pauses,
/// since nothing recorded them.
pub fn recover_recording(dir: &Path, id: &str, tracks: &[TrackRef]) -> Result<RecoveredRecording> {
    let mut summaries = Vec::new();
    let mut clock = None;
    for track in tracks {
        let files = TrackFiles::new(dir, &track.asset, track.kind)?;
        if !files.audio.exists() {
            continue;
        }
        let recovered = recover_track(&files)?;
        clock = clock.or(recovered.clock);
        let name = |path: &Path| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        summaries.push(TrackSummary {
            kind: track.kind,
            asset: track.asset.clone(),
            audio_file: name(&files.audio),
            timeline_file: name(&files.timeline),
            timeline: recovered.timeline,
            dropped_packets: 0,
            silence_frames: 0,
        });
    }
    if summaries.is_empty() {
        return Err(AudioError::Corrupt(format!(
            "There are no audio files for recording {id}."
        )));
    }
    Ok(RecoveredRecording {
        summary: summarize(id, summaries, clock),
        has_clock: clock.is_some(),
    })
}

/// The summary of a recovered recording: it starts when its first track does and ends when its last
/// one does.
fn summarize(id: &str, tracks: Vec<TrackSummary>, clock: Option<ClockAnchor>) -> RecordingSummary {
    let started_ns = tracks
        .iter()
        .filter_map(|track| track.timeline.start_ns())
        .min()
        .unwrap_or(0);
    let ended_ns = tracks
        .iter()
        .filter_map(|track| track.timeline.end_ns())
        .max()
        .unwrap_or(0);
    RecordingSummary {
        id: id.to_owned(),
        started_ns,
        ended_ns,
        clock: clock.unwrap_or(ClockAnchor {
            unix_ms: 0,
            capture_ns: 0,
        }),
        pauses: Vec::new(),
        tracks,
        recovered: true,
    }
}

/// A recording after recovery.
#[derive(Debug, PartialEq, Eq)]
pub struct RecoveredRecording {
    pub summary: RecordingSummary,
    /// Whether the clock anchor survived. If not, the summary's anchor is zero, and strokes can't be
    /// placed against the audio, though the audio plays.
    pub has_clock: bool,
}

/// The tracks in `dir` that a crash cut off. Run this when a page opens.
pub fn find_unfinished(dir: &Path) -> Result<Vec<TrackRef>> {
    let mut found = BTreeSet::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        let Some(track) = track_of(&path) else {
            continue;
        };
        let files = TrackFiles::from_audio(path);
        if files.timeline.exists() && !is_finished(&files.audio)? {
            found.insert(track);
        }
    }
    Ok(found.into_iter().collect())
}

/// The track in a file's name, such as the microphone track of asset `abc` in `abc-mic.ogg`.
fn track_of(path: &Path) -> Option<TrackRef> {
    if path.extension()? != "ogg" {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    [TrackKind::Microphone, TrackKind::SystemAudio].iter().find_map(|kind| {
        stem.strip_suffix(&format!("-{}", kind.stem())).map(|asset| TrackRef {
            kind: *kind,
            asset: asset.to_owned(),
        })
    })
}

/// Whether the file ends with a final page and nothing after it.
fn is_finished(audio: &Path) -> Result<bool> {
    let length = audio.metadata()?.len();
    let scan: Scan = scan_pages(BufReader::new(File::open(audio)?))?;
    let closed = scan.pages.last().is_some_and(|page| page.flags & FLAG_EOS != 0);
    Ok(closed && scan.valid_len == length)
}

fn read_pre_skip(file: &mut File, first: PageInfo) -> Result<u16> {
    let mut page = vec![0u8; first.len as usize];
    file.seek(SeekFrom::Start(first.offset))?;
    file.read_exact(&mut page)?;
    let body = page.get(27 + usize::from(page[26])..).unwrap_or_default();
    parse_pre_skip(body).ok_or_else(|| AudioError::Corrupt("The first packet is not an Opus header.".into()))
}

/// Appends an empty final page after `last`, which ends the stream.
fn close_stream(file: &mut File, last: PageInfo) -> Result<()> {
    file.seek(SeekFrom::End(0))?;
    let mut ogg = OggWriter::resume(&mut *file, last.serial, last.sequence + 1, last.granule);
    ogg.finish_page(true)?;
    file.sync_all()?;
    Ok(())
}

/// Reads the timeline file, keeps the anchors that still have frames, and saves the trimmed list.
fn restore_timeline(files: &TrackFiles, frames: u64, rewrite: bool) -> Result<(Timeline, Option<ClockAnchor>)> {
    let mut timeline = Timeline {
        anchors: Vec::new(),
        frames,
    };
    let Some(sidecar) = read_timeline_file(&files.timeline)? else {
        return Ok((timeline, None));
    };
    for anchor in sidecar.anchors {
        if anchor.frame < frames {
            timeline.push_anchor(anchor);
        }
    }
    if rewrite {
        rewrite_timeline_file(&files.timeline, sidecar.clock, &timeline.anchors)?;
    }
    Ok((timeline, Some(sidecar.clock)))
}
