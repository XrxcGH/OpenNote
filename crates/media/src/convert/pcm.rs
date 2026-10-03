//! Audio that did not come from the recorder: samples in memory written as a recording, and a recording
//! mixed down to one file.
//!
//! A dropped audio or video file is decoded to mono samples at 48 kHz. The app does that, with the decoder Windows
//! has. It hands the samples to [`import_pcm`], which writes them as the one track of a recording. The page can
//! play that recording, flag it, and take notes against it. Export goes the other way. [`export_opus`] and
//! [`export_wav`] mix a recording's tracks into one file, with the pauses left out.

use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

use super::Sink;
use crate::audio::encoder::EncoderFactory;
use crate::audio::{
    Anchor, AudioError, ClockAnchor, RecordingSummary, Result, Timeline, TrackFiles, TrackKind, TrackSummary,
    FRAME_SAMPLES,
};
use crate::edit::{remove_files, write_sidecar};
use crate::layout::RecordingPlan;
use crate::playback::{open_recording, DecoderFactory};
use crate::transcribe::{MixedPcm, PcmSource};

/// The sample rate of every track and every file written here.
pub const RATE: u64 = 48_000;

/// Samples in memory, read as a source.
pub struct MemoryPcm {
    samples: Vec<f32>,
    at: usize,
}

impl MemoryPcm {
    pub fn new(samples: Vec<f32>) -> Self {
        MemoryPcm { samples, at: 0 }
    }
}

impl PcmSource for MemoryPcm {
    fn read(&mut self, out: &mut [f32]) -> Result<usize> {
        let count = out.len().min(self.samples.len() - self.at);
        out[..count].copy_from_slice(&self.samples[self.at..self.at + count]);
        self.at += count;
        Ok(count)
    }

    fn position(&self) -> u64 {
        self.at as u64
    }

    fn total(&self) -> Option<u64> {
        Some(self.samples.len() as u64)
    }
}

/// Writes `frames` samples of `pcm` as an Ogg Opus file. A file that fails is removed.
pub fn write_opus(path: &Path, pcm: &mut dyn PcmSource, frames: u64, encoders: &EncoderFactory) -> Result<()> {
    let written = (|| {
        let file = File::options().write(true).create_new(true).open(path)?;
        let mut sink = Sink::start(file, encoders()?, frames, 0)?;
        let mut block = vec![0f32; FRAME_SAMPLES];
        loop {
            let got = pcm.read(&mut block)?;
            if got == 0 {
                break;
            }
            sink.push(&block[..got])?;
        }
        sink.finish()
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(path);
    }
    written
}

/// Writes decoded samples as a recording of one microphone track, under `plan`. The recording starts at
/// `started_ns` on the capture clock, which `clock` ties to Unix time.
pub fn import_pcm(
    dir: &Path,
    plan: &RecordingPlan,
    samples: Vec<f32>,
    clock: ClockAnchor,
    started_ns: u64,
    encoders: &EncoderFactory,
) -> Result<RecordingSummary> {
    let target = plan
        .tracks
        .iter()
        .find(|track| track.kind == TrackKind::Microphone)
        .ok_or_else(|| AudioError::Format("The plan has no track for the file.".into()))?;
    let frames = samples.len() as u64;
    if frames == 0 {
        return Err(AudioError::Format("The file has no sound in it.".into()));
    }
    let files = TrackFiles::new(dir, &target.asset, target.kind)?;
    let timeline = Timeline {
        anchors: vec![Anchor {
            frame: 0,
            time_ns: started_ns,
        }],
        frames,
    };
    let name = |path: &Path| {
        path.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    let track = TrackSummary {
        kind: target.kind,
        asset: target.asset.clone(),
        audio_file: name(&files.audio),
        timeline_file: name(&files.timeline),
        timeline: timeline.clone(),
        dropped_packets: 0,
        silence_frames: 0,
    };
    let summary = RecordingSummary {
        id: plan.id.clone(),
        started_ns,
        ended_ns: started_ns + frames * 1_000_000_000 / RATE,
        clock,
        pauses: Vec::new(),
        tracks: vec![track.clone()],
        recovered: false,
    };
    let written = write_opus(&files.audio, &mut MemoryPcm::new(samples), frames, encoders)
        .and_then(|()| write_sidecar(&files, &summary, &timeline));
    if let Err(error) = written {
        remove_files(dir, &track);
        return Err(error);
    }
    Ok(summary)
}

/// The mix of a recording as one source, and its length in samples.
fn mixed(dir: &Path, summary: &RecordingSummary, decoders: &DecoderFactory) -> Result<(MixedPcm, u64)> {
    let player = open_recording(dir, summary, decoders)?;
    let frames = player.duration_ns() * RATE / 1_000_000_000;
    Ok((MixedPcm::new(player), frames))
}

/// Mixes a recording's tracks into one Ogg Opus file at `dest`, which must not exist. Answers its size.
pub fn export_opus(
    dir: &Path,
    summary: &RecordingSummary,
    decoders: &DecoderFactory,
    encoders: &EncoderFactory,
    dest: &Path,
) -> Result<u64> {
    let (mut pcm, frames) = mixed(dir, summary, decoders)?;
    write_opus(dest, &mut pcm, frames, encoders)?;
    Ok(std::fs::metadata(dest)?.len())
}

/// Mixes a recording's tracks into one 16-bit WAV file at `dest`, which must not exist. Answers its size.
pub fn export_wav(dir: &Path, summary: &RecordingSummary, decoders: &DecoderFactory, dest: &Path) -> Result<u64> {
    let (mut pcm, _) = mixed(dir, summary, decoders)?;
    let written = write_wav(dest, &mut pcm);
    if written.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    written
}

fn write_wav(dest: &Path, pcm: &mut dyn PcmSource) -> Result<u64> {
    let file = File::options().write(true).create_new(true).open(dest)?;
    let mut out = BufWriter::new(file);
    out.write_all(&wav_header(0))?;
    let (mut block, mut bytes, mut data) = (vec![0f32; FRAME_SAMPLES * 4], Vec::new(), 0u64);
    loop {
        let got = pcm.read(&mut block)?;
        if got == 0 {
            break;
        }
        bytes.clear();
        for sample in &block[..got] {
            bytes.extend_from_slice(&((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
        }
        out.write_all(&bytes)?;
        data += bytes.len() as u64;
    }
    let mut file = out.into_inner().map_err(|error| error.into_error())?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&wav_header(u32::try_from(data).unwrap_or(u32::MAX - 36)))?;
    file.sync_all()?;
    Ok(data + 44)
}

/// The 44-byte header of a mono, 16-bit WAV file at 48 kHz with `data` bytes of samples.
fn wav_header(data: u32) -> [u8; 44] {
    let mut header = [0u8; 44];
    let rate = RATE as u32;
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36 + data).to_le_bytes());
    header[8..16].copy_from_slice(b"WAVEfmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&1u16.to_le_bytes());
    header[24..28].copy_from_slice(&rate.to_le_bytes());
    header[28..32].copy_from_slice(&(rate * 2).to_le_bytes());
    header[32..34].copy_from_slice(&2u16.to_le_bytes());
    header[34..36].copy_from_slice(&16u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data.to_le_bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcm_codec::{pcm_decoder_factory, pcm_encoder_factory};

    fn tone(frames: usize) -> Vec<f32> {
        (0..frames).map(|i| (i as f32 * 0.05).sin() * 0.5).collect()
    }

    fn plan() -> RecordingPlan {
        RecordingPlan {
            id: "rec".into(),
            tracks: vec![crate::audio::TrackRef {
                kind: TrackKind::Microphone,
                asset: "asset1".into(),
            }],
        }
    }

    fn anchor() -> ClockAnchor {
        ClockAnchor {
            unix_ms: 1_700_000_000_000,
            capture_ns: 5_000_000_000,
        }
    }

    #[test]
    fn imported_samples_make_a_recording_that_plays_and_exports() {
        let dir = tempfile::tempdir().unwrap();
        let encoders = pcm_encoder_factory();
        let decoders = pcm_decoder_factory();
        let summary = import_pcm(dir.path(), &plan(), tone(48_000), anchor(), 5_000_000_000, &encoders).unwrap();
        assert_eq!(summary.tracks[0].timeline.frames, 48_000);
        assert_eq!(summary.ended_ns - summary.started_ns, 1_000_000_000);

        let wav = dir.path().join("out.wav");
        let size = export_wav(dir.path(), &summary, &decoders, &wav).unwrap();
        assert_eq!(size, 44 + 48_000 * 2);
        let bytes = std::fs::read(&wav).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 96_000);

        let ogg = dir.path().join("out.ogg");
        assert!(export_opus(dir.path(), &summary, &decoders, &encoders, &ogg).unwrap() > 0);
    }

    #[test]
    fn a_silent_file_with_no_samples_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let result = import_pcm(dir.path(), &plan(), Vec::new(), anchor(), 0, &pcm_encoder_factory());
        assert!(result.is_err());
    }
}
