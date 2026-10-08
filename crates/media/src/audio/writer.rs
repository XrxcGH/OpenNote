//! Writes one track: fills gaps, encodes frames, and puts them in Ogg pages on disk.
//!
//! This is the part of recording that touches files. It has no threads of its own, so tests drive
//! it directly. The worker thread in [`super::worker`] feeds it packets from the ring.
//!
//! Each page is written and synced as soon as it holds enough frames, or when the worker finds the
//! source idle. A crash then loses the page in progress and at most one partial frame.

use std::fs::File;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::clock::ClockAnchor;
use super::encoder::{opus_head, opus_tags, FrameEncoder};
use super::files::{append_anchor, create_timeline_file, create_track_file, TrackFiles};
use super::ogg::OggWriter;
use super::ring::TrackStats;
use super::timeline::{Anchor, Timeline};
use super::track_clock::{Admission, ClockConfig, TrackClock};
use super::{Options, Result, FRAME_SAMPLES};

/// The serial number of the audio stream. Each file holds one stream, so any value works.
const STREAM_SERIAL: u32 = 0x4F4E_4F54;

/// The file side of a track.
pub struct TrackWriter {
    encoder: Box<dyn FrameEncoder>,
    ogg: OggWriter<File>,
    sidecar: File,
    clock: TrackClock,
    timeline: Timeline,
    /// Samples that don't fill a frame yet.
    pending: Vec<f32>,
    packet: Vec<u8>,
    pre_skip: u64,
    frames_encoded: u64,
    frames_in_page: usize,
    page_frames: usize,
    sync: bool,
    stats: Arc<TrackStats>,
}

impl TrackWriter {
    /// Creates the track's files, and writes and syncs the two Opus header pages. A file that
    /// already exists is an error, so a recording never overwrites an earlier one.
    pub fn create(
        files: &TrackFiles,
        encoder: Box<dyn FrameEncoder>,
        options: &Options,
        stats: Arc<TrackStats>,
        clock: ClockAnchor,
    ) -> Result<Self> {
        let audio = create_track_file(&files.audio)?;
        let sidecar = match create_timeline_file(&files.timeline, clock) {
            Ok(sidecar) => sidecar,
            Err(error) => {
                // Don't leave an audio file that has no timeline. It is closed first, since no one may
                // delete it while it is open.
                drop(audio);
                let _ = std::fs::remove_file(&files.audio);
                return Err(error);
            }
        };
        let pre_skip = encoder.pre_skip();
        let mut ogg = OggWriter::new(audio, STREAM_SERIAL);
        ogg.push_packet(&opus_head(pre_skip), 0)?;
        ogg.finish_page(false)?;
        ogg.push_packet(&opus_tags(), 0)?;
        ogg.finish_page(false)?;
        let clock_config = ClockConfig {
            frame_samples: FRAME_SAMPLES as u64,
            ..options.clock
        };
        let mut writer = TrackWriter {
            encoder,
            ogg,
            sidecar,
            clock: TrackClock::new(clock_config),
            timeline: Timeline::default(),
            pending: Vec::with_capacity(2 * FRAME_SAMPLES),
            packet: Vec::new(),
            pre_skip: u64::from(pre_skip),
            frames_encoded: 0,
            frames_in_page: 0,
            page_frames: options.page_frames(),
            sync: options.sync,
            stats,
        };
        writer.sync_files()?;
        Ok(writer)
    }

    /// Writes one packet of mono samples at the track rate, captured at `capture_ns`. It first fills
    /// a short gap with silence, or starts a new stretch of the timeline. It returns the track frame
    /// of the packet's first sample.
    pub fn write_packet(&mut self, capture_ns: u64, samples: &[f32]) -> Result<u64> {
        match self.clock.admit(capture_ns, samples.len() as u64) {
            Admission::Contiguous => {}
            Admission::Fill(frames) => self.push_silence(frames)?,
            Admission::Segment { pad, anchor } => self.start_stretch(pad, anchor)?,
        }
        let first_frame = self.clock.total_frames().saturating_sub(samples.len() as u64);
        self.push_pcm(samples)?;
        self.stats.frames.store(self.clock.total_frames(), Ordering::Relaxed);
        Ok(first_frame)
    }

    /// Ends the current stretch at a pause. Everything so far goes to disk, and the next packet
    /// starts a new stretch.
    pub fn note_pause(&mut self) -> Result<()> {
        let pad = self.clock.pause();
        self.push_silence(pad)?;
        self.flush_page()
    }

    /// Whether frames wait in a page that hasn't reached the disk.
    pub fn has_unflushed(&self) -> bool {
        self.frames_in_page > 0
    }

    /// Writes the current page to disk.
    pub fn flush_page(&mut self) -> Result<()> {
        if self.ogg.finish_page(false)? > 0 {
            self.frames_in_page = 0;
            self.sync_files()?;
        }
        Ok(())
    }

    /// Completes the last frame, closes the stream with a final page, and returns the timeline. The
    /// last granule position leaves out the padding, so decoders play exactly the frames recorded.
    pub fn finish(mut self) -> Result<Timeline> {
        let real_frames = self.clock.total_frames();
        let granule = self.pre_skip + real_frames;
        if !self.pending.is_empty() {
            self.pending.resize(FRAME_SAMPLES, 0.0);
            self.encoder.encode(&self.pending, &mut self.packet)?;
            self.ogg.push_packet(&self.packet, granule)?;
        }
        if self.encoder.delays_output() && real_frames > 0 {
            // The encoder holds back its lookahead. A frame of silence pushes the last samples out.
            self.encoder.encode(&[0.0; FRAME_SAMPLES], &mut self.packet)?;
            self.ogg.push_packet(&self.packet, granule)?;
        }
        self.ogg.finish_page(true)?;
        self.sync_files()?;
        Ok(Timeline {
            frames: real_frames,
            ..self.timeline
        })
    }

    fn start_stretch(&mut self, pad: u64, anchor: Anchor) -> Result<()> {
        self.push_silence(pad)?;
        self.flush_page()?;
        self.timeline.push_anchor(anchor);
        append_anchor(&mut self.sidecar, anchor)
    }

    fn push_silence(&mut self, frames: u64) -> Result<()> {
        const SILENCE: [f32; FRAME_SAMPLES] = [0.0; FRAME_SAMPLES];
        self.stats.silence_frames.fetch_add(frames, Ordering::Relaxed);
        let mut left = frames as usize;
        while left > 0 {
            let chunk = left.min(FRAME_SAMPLES);
            self.push_pcm(&SILENCE[..chunk])?;
            left -= chunk;
        }
        Ok(())
    }

    /// Adds samples, and encodes every whole frame they complete.
    fn push_pcm(&mut self, samples: &[f32]) -> Result<()> {
        self.pending.extend_from_slice(samples);
        let whole = self.pending.len() / FRAME_SAMPLES;
        for index in 0..whole {
            let frame = &self.pending[index * FRAME_SAMPLES..(index + 1) * FRAME_SAMPLES];
            self.encoder.encode(frame, &mut self.packet)?;
            self.frames_encoded += FRAME_SAMPLES as u64;
            self.ogg
                .push_packet(&self.packet, self.pre_skip + self.frames_encoded)?;
            self.frames_in_page += 1;
            if self.frames_in_page >= self.page_frames {
                self.flush_page()?;
            }
        }
        self.pending.drain(..whole * FRAME_SAMPLES);
        Ok(())
    }

    fn sync_files(&mut self) -> Result<()> {
        if self.sync {
            self.ogg.inner_mut().sync_data()?;
            self.sidecar.sync_data()?;
        }
        Ok(())
    }
}
