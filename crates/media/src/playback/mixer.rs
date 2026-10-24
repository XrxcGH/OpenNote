//! Mixes a recording's tracks into one stream of audio by position.
//!
//! The mixer holds each track's reader and timeline. To render, it turns a position into a capture
//! time with the position map, finds each track's frames for that time in its timeline, and adds
//! them. A track that has no audio at that time adds nothing. A render never crosses from one stretch
//! of the position map into the next, so the caller asks again at the new position.

use super::reader::TrackReader;
use crate::audio::timeline::{frames_to_ns, ns_to_frames, Segment};
use crate::audio::{Result, Timeline, TrackKind, TRACK_RATE};
use crate::positions::PositionMap;

/// One track in the mix.
pub struct MixTrack {
    pub kind: TrackKind,
    pub reader: TrackReader,
    segments: Vec<Segment>,
    /// A multiplier from 0 (muted) up. Playback applies it before the tracks are added.
    pub gain: f32,
}

impl MixTrack {
    pub fn new(kind: TrackKind, reader: TrackReader, timeline: &Timeline) -> Self {
        MixTrack {
            kind,
            reader,
            segments: timeline.segments().collect(),
            gain: 1.0,
        }
    }

    /// What the track has at capture time `t_ns`.
    fn locate(&self, t_ns: u64) -> Place {
        let next = self.segments.partition_point(|segment| segment.start_ns <= t_ns);
        // Resyncs can overlap a stretch with the one before it, and the later one wins.
        let inside = (next.saturating_sub(2)..next)
            .rev()
            .map(|index| self.segments[index])
            .find(|segment| t_ns < segment.end_ns);
        match (inside, self.segments.get(next)) {
            (Some(segment), _) => Place::Inside(segment),
            (None, Some(upcoming)) => Place::Before(upcoming.start_ns),
            (None, None) => Place::After,
        }
    }
}

enum Place {
    Inside(Segment),
    Before(u64),
    After,
}

/// Converts a position in nanoseconds to samples at the track rate.
pub fn ns_to_samples(ns: u64) -> u64 {
    ns_to_frames(ns)
}

/// Converts samples at the track rate to nanoseconds.
pub fn samples_to_ns(samples: u64) -> u64 {
    frames_to_ns(samples)
}

pub struct Mixer {
    map: PositionMap,
    tracks: Vec<MixTrack>,
    scratch: Vec<f32>,
}

impl Mixer {
    pub fn new(map: PositionMap, tracks: Vec<MixTrack>) -> Self {
        Mixer {
            map,
            tracks,
            scratch: Vec::new(),
        }
    }

    pub fn map(&self) -> &PositionMap {
        &self.map
    }

    /// The length of the audio, in samples.
    pub fn duration_samples(&self) -> u64 {
        ns_to_samples(self.map.duration_ns())
    }

    pub fn tracks_mut(&mut self) -> &mut [MixTrack] {
        &mut self.tracks
    }

    /// Fills `out` with audio from sample `position`, up to the end of the stretch it is in. It
    /// returns how many samples it wrote, which is zero only at the end of the audio.
    pub fn render(&mut self, position: u64, out: &mut [f32]) -> Result<usize> {
        let position_ns = samples_to_ns(position);
        let Some((_, span)) = self.map.span_at(position_ns) else {
            return Ok(0);
        };
        let start_ns = span.capture_start_ns + (position_ns - span.position_start_ns);
        let left = ns_to_samples(span.capture_end_ns - start_ns).max(1);
        let count = out.len().min(usize::try_from(left).unwrap_or(usize::MAX));
        out[..count].fill(0.0);
        for index in 0..self.tracks.len() {
            self.add_track(index, start_ns, &mut out[..count])?;
        }
        for sample in &mut out[..count] {
            *sample = sample.clamp(-1.0, 1.0);
        }
        Ok(count)
    }

    /// Adds one track's audio for the capture times from `start_ns` on.
    fn add_track(&mut self, index: usize, start_ns: u64, out: &mut [f32]) -> Result<()> {
        let mut done = 0;
        while done < out.len() {
            let t_ns = start_ns + samples_to_ns(done as u64);
            let track = &mut self.tracks[index];
            match track.locate(t_ns) {
                Place::After => break,
                Place::Before(next_ns) => {
                    done += (ns_to_samples(next_ns - t_ns).max(1) as usize).min(out.len() - done);
                }
                Place::Inside(segment) => {
                    let available = ns_to_samples(segment.end_ns - t_ns).max(1) as usize;
                    let count = available.min(out.len() - done);
                    let frame = segment.start_frame + ns_to_frames(t_ns - segment.start_ns);
                    self.scratch.resize(count, 0.0);
                    let read = track.reader.read(frame, &mut self.scratch)?;
                    let gain = track.gain;
                    for (sample, heard) in out[done..done + read].iter_mut().zip(&self.scratch) {
                        *sample += heard * gain;
                    }
                    done += count;
                }
            }
        }
        Ok(())
    }
}

/// The rate of everything the mixer produces.
pub const MIX_RATE: u32 = TRACK_RATE;
