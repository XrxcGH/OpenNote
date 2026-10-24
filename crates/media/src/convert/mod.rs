//! Making a new copy of a recording's audio: compress it to a smaller size, or enhance the voice.
//!
//! Both decode each track, pass it through an optional [`Processor`], and encode it again into a new
//! asset, so the recording it starts from is never touched (assets are immutable, spec 10.3). The copy
//! has exactly the same number of frames, so its timeline is the old one word for word. Positions, flags,
//! strokes, and text marks all keep their place without a change.
//!
//! The work is offline. It runs as fast as the decoder and encoder allow, about 40 times real time, and
//! the enhancer is the slowest part at about 100 times real time, so a three-hour recording takes a few
//! minutes. A screen should run it in the background and offer to cancel by dropping the result.

use std::fs::File;
use std::path::Path;

use crate::audio::encoder::{opus_factory_at, opus_head, opus_tags, EncoderFactory, FrameEncoder};
use crate::audio::ogg::OggWriter;
use crate::audio::{
    AudioError, RecordingSummary, Result, TrackFiles, TrackKind, TrackRef, TrackSummary, FRAME_SAMPLES,
};
use crate::edit::{remove_files, write_sidecar, PAGE_PACKETS, STREAM_SERIAL};
use crate::layout::RecordingPlan;
use crate::playback::{DecoderFactory, TrackReader};

mod enhance;
mod fft;
mod pcm;

pub use enhance::{Enhancer, Settings};
pub use pcm::{export_opus, export_wav, import_pcm, write_opus, MemoryPcm, RATE};

const FRAME: u64 = FRAME_SAMPLES as u64;

/// Something that changes audio as it streams through, such as the voice enhancer.
pub trait Processor: Send {
    /// How many samples the output lags behind the input. The first that many output samples are discarded.
    fn latency(&self) -> usize {
        0
    }

    /// Takes the next samples of the track and appends output. The count may differ from the input's.
    fn process(&mut self, input: &[f32], out: &mut Vec<f32>);

    /// Appends the output still held back when the input ends.
    fn finish(&mut self, _out: &mut Vec<f32>) {}
}

/// Chooses the processor for a track, or none to pass the audio through.
pub type ProcessorFactory<'a> = &'a dyn Fn(TrackKind) -> Option<Box<dyn Processor>>;

/// How small a compressed recording should be. Both are good for speech.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Quality {
    /// 16 kbps, half the size of a recording.
    Smaller,
    /// 10 kbps, a third of the size, a little thinner to listen to.
    Smallest,
}

impl Quality {
    pub fn bitrate(self) -> i32 {
        match self {
            Quality::Smaller => 16_000,
            Quality::Smallest => 10_000,
        }
    }

    /// The Opus encoder at this quality.
    pub fn encoders(self) -> EncoderFactory {
        opus_factory_at(self.bitrate())
    }
}

/// Writes a smaller copy of a recording, with the encoders of `quality`.
pub fn compress(
    dir: &Path,
    summary: &RecordingSummary,
    output: &RecordingPlan,
    decoders: &DecoderFactory,
    quality: Quality,
) -> Result<RecordingSummary> {
    transcode(dir, summary, output, decoders, &quality.encoders(), &|_| None)
}

/// Writes a copy of a recording with the noise reduced and the voice leveled.
pub fn enhance(
    dir: &Path,
    summary: &RecordingSummary,
    output: &RecordingPlan,
    decoders: &DecoderFactory,
    encoders: &EncoderFactory,
    settings: Settings,
) -> Result<RecordingSummary> {
    let make = move |_: TrackKind| Some(Box::new(Enhancer::new(settings)) as Box<dyn Processor>);
    transcode(dir, summary, output, decoders, encoders, &make)
}

/// Decodes every track of a recording, passes it through its processor, and encodes it as the tracks of
/// `output`. If anything fails, the files already written are removed.
pub fn transcode(
    dir: &Path,
    summary: &RecordingSummary,
    output: &RecordingPlan,
    decoders: &DecoderFactory,
    encoders: &EncoderFactory,
    processors: ProcessorFactory,
) -> Result<RecordingSummary> {
    let mut tracks: Vec<TrackSummary> = Vec::new();
    for old in &summary.tracks {
        let target = output
            .tracks
            .iter()
            .find(|planned| planned.kind == old.kind)
            .ok_or_else(|| AudioError::Format("The output has no such track.".into()))?;
        match reencode(dir, summary, old, target, decoders, encoders, processors(old.kind)) {
            Ok(done) => tracks.push(done),
            Err(error) => {
                tracks.iter().for_each(|done| remove_files(dir, done));
                return Err(error);
            }
        }
    }
    Ok(RecordingSummary {
        id: output.id.clone(),
        tracks,
        ..summary.clone()
    })
}

fn reencode(
    dir: &Path,
    summary: &RecordingSummary,
    old: &TrackSummary,
    target: &TrackRef,
    decoders: &DecoderFactory,
    encoders: &EncoderFactory,
    processor: Option<Box<dyn Processor>>,
) -> Result<TrackSummary> {
    let mut reader = TrackReader::open(&dir.join(&old.audio_file), decoders)?;
    let files = TrackFiles::new(dir, &target.asset, target.kind)?;
    let written = write_audio(&files, &mut reader, encoders()?, processor, old.timeline.frames)
        .and_then(|()| write_sidecar(&files, summary, &old.timeline));
    if let Err(error) = written {
        let _ = std::fs::remove_file(&files.audio);
        let _ = std::fs::remove_file(&files.timeline);
        return Err(error);
    }
    let name = |path: &Path| {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    Ok(TrackSummary {
        asset: target.asset.clone(),
        audio_file: name(&files.audio),
        timeline_file: name(&files.timeline),
        ..old.clone()
    })
}

/// Reads the whole track in blocks, and writes what comes out of the processor as Opus.
fn write_audio(
    files: &TrackFiles,
    reader: &mut TrackReader,
    encoder: Box<dyn FrameEncoder>,
    mut processor: Option<Box<dyn Processor>>,
    frames: u64,
) -> Result<()> {
    let file = File::options().write(true).create_new(true).open(&files.audio)?;
    let mut sink = Sink::start(file, encoder, frames, processor.as_ref().map_or(0, |p| p.latency()))?;
    let (mut block, mut out) = (vec![0f32; FRAME_SAMPLES], Vec::new());
    let mut at = 0;
    while at < frames {
        let wanted = block.len().min((frames - at) as usize);
        let got = reader.read(at, &mut block[..wanted])?;
        if got == 0 {
            break;
        }
        at += got as u64;
        out.clear();
        match processor.as_mut() {
            Some(processor) => processor.process(&block[..got], &mut out),
            None => out.extend_from_slice(&block[..got]),
        }
        sink.push(&out)?;
    }
    out.clear();
    if let Some(processor) = processor.as_mut() {
        processor.finish(&mut out);
    }
    sink.push(&out)?;
    sink.finish()
}

/// Collects output samples into frames and writes them as packets in Ogg pages.
struct Sink {
    ogg: OggWriter<File>,
    encoder: Box<dyn FrameEncoder>,
    queue: Vec<f32>,
    packet: Vec<u8>,
    /// Output samples still to be thrown away: the processor's latency.
    discard: usize,
    /// Real samples accepted so far, and how many the track has.
    accepted: u64,
    frames: u64,
    skip: u64,
    packets: u64,
}

impl Sink {
    fn start(file: File, encoder: Box<dyn FrameEncoder>, frames: u64, latency: usize) -> Result<Self> {
        let skip = u64::from(encoder.pre_skip());
        let mut ogg = OggWriter::new(file, STREAM_SERIAL);
        ogg.push_packet(&opus_head(skip as u16), 0)?;
        ogg.finish_page(false)?;
        ogg.push_packet(&opus_tags(), 0)?;
        ogg.finish_page(false)?;
        Ok(Sink {
            ogg,
            encoder,
            queue: Vec::new(),
            packet: Vec::new(),
            discard: latency,
            accepted: 0,
            frames,
            skip,
            packets: 0,
        })
    }

    /// Accepts output samples, up to the number of frames the track has.
    fn push(&mut self, samples: &[f32]) -> Result<()> {
        let dropped = self.discard.min(samples.len());
        self.discard -= dropped;
        let room = (self.frames - self.accepted) as usize;
        let kept = &samples[dropped..];
        let kept = &kept[..kept.len().min(room)];
        self.accepted += kept.len() as u64;
        self.queue.extend_from_slice(kept);
        let whole = self.queue.len() / FRAME_SAMPLES;
        for index in 0..whole {
            self.write_frame(index * FRAME_SAMPLES)?;
        }
        self.queue.drain(..whole * FRAME_SAMPLES);
        Ok(())
    }

    /// Encodes the frame at `from` in the queue and writes its packet. The granule position of a packet is the
    /// number of samples through its end, but never more than the track has, which trims the padding of the
    /// last frame.
    fn write_frame(&mut self, from: usize) -> Result<()> {
        self.encoder
            .encode(&self.queue[from..from + FRAME_SAMPLES], &mut self.packet)?;
        self.packets += 1;
        let granule = self.skip + (FRAME * self.packets).min(self.frames);
        self.ogg.push_packet(&self.packet, granule)?;
        if (self.packets as usize).is_multiple_of(PAGE_PACKETS) {
            self.ogg.finish_page(false)?;
        }
        Ok(())
    }

    /// Pads a track that came up short, writes the last frames, and closes the stream.
    fn finish(mut self) -> Result<()> {
        let missing = (self.frames - self.accepted) as usize;
        self.queue.resize(self.queue.len() + missing, 0.0);
        let whole = self.queue.len().div_ceil(FRAME_SAMPLES);
        self.queue.resize(whole * FRAME_SAMPLES, 0.0);
        for index in 0..whole {
            self.write_frame(index * FRAME_SAMPLES)?;
        }
        if self.encoder.delays_output() && self.frames > 0 {
            self.queue.clear();
            self.queue.resize(FRAME_SAMPLES, 0.0);
            self.write_frame(0)?;
        }
        self.ogg.finish_page(true)?;
        self.ogg.inner_mut().sync_all()?;
        Ok(())
    }
}
