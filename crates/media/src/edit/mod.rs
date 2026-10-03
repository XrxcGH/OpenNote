//! Editing recordings: trim silence, split a long recording, and remove a part.
//!
//! An edit never touches the files it starts from. Assets are immutable (spec 10.3), so an edit writes
//! new track files under new asset IDs and returns the summary of the new recording. The caller saves
//! the new entry and assets, and drops the old ones. Removing a part for privacy also means deleting the
//! old assets from the page's history, which is the core's job.
//!
//! Edits copy Opus packets without decoding them, so they are fast and lose no quality. They keep the
//! capture time of every frame that survives. A removed part becomes a hole in capture time, like a
//! pause. So the strokes and words written during the rest of the recording still find their audio,
//! and "notes keep their timing".
//!
//! The packets at the edges of a removed part go too (see [`runs`]): up to 30 ms on each side. That
//! keeps the removed audio out of the file, and not merely silent. The decoder starts fresh after a cut,
//! so the first few milliseconds after it may sound a little rough.

use std::fs::File;
use std::path::Path;

use crate::audio::encoder::{opus_head, opus_tags};
use crate::audio::files::{append_anchor, create_timeline_file};
use crate::audio::ogg::OggWriter;
use crate::audio::{AudioError, Pause, RecordingSummary, Result, TrackFiles, TrackRef, TrackSummary, FRAME_SAMPLES};
use crate::layout::RecordingPlan;
use crate::playback::{open_recording, DecoderFactory, TrackReader};
use crate::positions::PositionMap;

mod runs;
mod silence;

pub use runs::Range;
pub use silence::find_sound;

use runs::{complement, kept_frames, kept_runs, merge, new_timeline, Run};

pub(crate) const STREAM_SERIAL: u32 = 0x4F4E_4F54;
pub(crate) const PAGE_PACKETS: usize = 25;
const FRAME: u64 = FRAME_SAMPLES as u64;

/// Keeps only the parts of a recording at these positions (nanoseconds into its audio), and writes them
/// as the tracks of `output`. It fails if nothing is left.
pub fn keep(
    dir: &Path,
    summary: &RecordingSummary,
    ranges: &[Range],
    output: &RecordingPlan,
) -> Result<RecordingSummary> {
    let map = PositionMap::from_summary(summary);
    let kept = capture_ranges(&map, &merge(ranges.to_vec()));
    if kept.is_empty() {
        return Err(AudioError::Format("No audio is left after this edit.".into()));
    }
    let mut tracks = Vec::new();
    for track in &summary.tracks {
        let target = output
            .tracks
            .iter()
            .find(|planned| planned.kind == track.kind)
            .ok_or_else(|| AudioError::Format("The output has no such track.".into()))?;
        match copy_track(dir, summary, track, &kept, target) {
            Ok(Some(copied)) => tracks.push(copied),
            Ok(None) => {}
            Err(error) => {
                for done in &tracks {
                    remove_files(dir, done);
                }
                return Err(error);
            }
        }
    }
    if tracks.is_empty() {
        return Err(AudioError::Format("No audio is left after this edit.".into()));
    }
    Ok(summarize(summary, &output.id, &kept, tracks))
}

/// Removes parts of a recording, at these positions, and writes the rest as the tracks of `output`.
pub fn remove(
    dir: &Path,
    summary: &RecordingSummary,
    parts: &[Range],
    output: &RecordingPlan,
) -> Result<RecordingSummary> {
    let total = PositionMap::from_summary(summary).duration_ns();
    keep(dir, summary, &complement(parts.to_vec(), total), output)
}

/// Splits a recording at a position into two recordings, each written as the tracks of its own plan.
pub fn split(
    dir: &Path,
    summary: &RecordingSummary,
    at_ns: u64,
    outputs: [&RecordingPlan; 2],
) -> Result<[RecordingSummary; 2]> {
    let total = PositionMap::from_summary(summary).duration_ns();
    if at_ns == 0 || at_ns >= total {
        return Err(AudioError::Format("A split must fall inside the recording.".into()));
    }
    let first = keep(dir, summary, &[(0, at_ns)], outputs[0])?;
    match keep(dir, summary, &[(at_ns, total)], outputs[1]) {
        Ok(second) => Ok([first, second]),
        Err(error) => {
            for track in &first.tracks {
                remove_files(dir, track);
            }
            Err(error)
        }
    }
}

/// Trims the silence at the start and end of a recording. It returns none when there is less than half a
/// second of silence to trim at each end, or when the recording is silent from end to end.
pub fn trim_silence(
    dir: &Path,
    summary: &RecordingSummary,
    output: &RecordingPlan,
    decoders: &DecoderFactory,
) -> Result<Option<RecordingSummary>> {
    let mut player = open_recording(dir, summary, decoders)?;
    let total = player.duration_ns();
    let Some((start, end)) = find_sound(&mut player)? else {
        return Ok(None);
    };
    if start < silence::WORTH_TRIMMING_NS && total - end < silence::WORTH_TRIMMING_NS {
        return Ok(None);
    }
    keep(dir, summary, &[(start, end)], output).map(Some)
}

/// The capture times of the parts at these positions.
fn capture_ranges(map: &PositionMap, positions: &[Range]) -> Vec<Range> {
    let mut ranges = Vec::new();
    for span in map.spans() {
        let span_end = span.position_start_ns + span.len_ns();
        for &(from, to) in positions {
            let (low, high) = (from.max(span.position_start_ns), to.min(span_end));
            if low < high {
                let base = span.capture_start_ns;
                ranges.push((
                    base + (low - span.position_start_ns),
                    base + (high - span.position_start_ns),
                ));
            }
        }
    }
    merge(ranges)
}

/// Copies the packets of one track that survive, to a new file.
fn copy_track(
    dir: &Path,
    summary: &RecordingSummary,
    old: &TrackSummary,
    kept: &[Range],
    target: &TrackRef,
) -> Result<Option<TrackSummary>> {
    let mut reader = TrackReader::open_packets(&dir.join(&old.audio_file))?;
    let skip = u64::from(reader.pre_skip());
    let frames = kept_frames(&old.timeline, kept);
    let runs = kept_runs(&frames, old.timeline.frames, reader.packet_count());
    if runs.is_empty() {
        return Ok(None);
    }
    let timeline = new_timeline(&old.timeline, &runs, skip);
    let files = TrackFiles::new(dir, &target.asset, target.kind)?;
    let written = write_packets(&files, &mut reader, &runs, skip, timeline.frames);
    let sidecar = written.and_then(|()| write_sidecar(&files, summary, &timeline));
    if let Err(error) = sidecar {
        let _ = std::fs::remove_file(&files.audio);
        let _ = std::fs::remove_file(&files.timeline);
        return Err(error);
    }
    let name = |path: &Path| {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    Ok(Some(TrackSummary {
        kind: old.kind,
        asset: target.asset.clone(),
        audio_file: name(&files.audio),
        timeline_file: name(&files.timeline),
        timeline,
        dropped_packets: old.dropped_packets,
        silence_frames: old.silence_frames,
    }))
}

/// Writes the headers and the packets of the runs, in Ogg pages of 25 packets.
fn write_packets(files: &TrackFiles, reader: &mut TrackReader, runs: &[Run], skip: u64, frames: u64) -> Result<()> {
    let file = File::options().write(true).create_new(true).open(&files.audio)?;
    let mut ogg = OggWriter::new(file, STREAM_SERIAL);
    ogg.push_packet(&opus_head(skip as u16), 0)?;
    ogg.finish_page(false)?;
    ogg.push_packet(&opus_tags(), 0)?;
    ogg.finish_page(false)?;
    let mut written = 0u64;
    for run in runs {
        for index in run.first..run.first + run.count {
            written += 1;
            let granule = skip + (FRAME * written).min(frames);
            ogg.push_packet(&reader.packet(index)?, granule)?;
            if (written as usize).is_multiple_of(PAGE_PACKETS) {
                ogg.finish_page(false)?;
            }
        }
    }
    ogg.finish_page(true)?;
    ogg.inner_mut().sync_all()?;
    Ok(())
}

/// Writes the timeline file beside the audio, as a recording would have.
pub(crate) fn write_sidecar(
    files: &TrackFiles,
    summary: &RecordingSummary,
    timeline: &crate::audio::Timeline,
) -> Result<()> {
    let mut sidecar = create_timeline_file(&files.timeline, summary.clock)?;
    for anchor in &timeline.anchors {
        append_anchor(&mut sidecar, *anchor)?;
    }
    sidecar.sync_all()?;
    Ok(())
}

pub(crate) fn remove_files(dir: &Path, track: &TrackSummary) {
    let _ = std::fs::remove_file(dir.join(&track.audio_file));
    let _ = std::fs::remove_file(dir.join(&track.timeline_file));
}

/// The summary of the edited recording.
fn summarize(old: &RecordingSummary, id: &str, kept: &[Range], tracks: Vec<TrackSummary>) -> RecordingSummary {
    let started_ns = tracks
        .iter()
        .filter_map(|t| t.timeline.start_ns())
        .min()
        .unwrap_or(old.started_ns);
    let ended_ns = tracks
        .iter()
        .filter_map(|t| t.timeline.end_ns())
        .max()
        .unwrap_or(old.ended_ns);
    let inside = |pause: &Pause| {
        kept.iter()
            .any(|&(from, to)| from <= pause.paused_ns && pause.resumed_ns <= to)
    };
    RecordingSummary {
        id: id.to_owned(),
        started_ns,
        ended_ns,
        clock: old.clock,
        pauses: old.pauses.iter().filter(|pause| inside(pause)).copied().collect(),
        tracks,
        recovered: old.recovered,
    }
}
