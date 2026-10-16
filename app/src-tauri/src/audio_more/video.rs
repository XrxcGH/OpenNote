//! Writing the narrated video as an MP4 file with the encoders Windows has: H.264 for the picture and AAC for the
//! sound, through Media Foundation's sink writer. The media crate draws the frames and reads the audio (see
//! `opennote_media::video`), and this is the sink they go to. A PC without the encoders (the "N" editions of Windows
//! lack the media pack) says so, and no file is left behind.

use std::path::Path;

use opennote_media::{
    transcribe::PcmSource,
    video::{self, Scene},
};

use crate::ipc::{IpcError, IpcResult};

/// The frames a second of the video.
pub const FPS: u32 = 15;

#[cfg(not(windows))]
pub fn write_mp4(
    _path: &Path,
    _scene: &Scene,
    _pcm: &mut dyn PcmSource,
    _duration_ns: u64,
    _progress: &mut dyn FnMut(f32),
) -> IpcResult<()> {
    Err(IpcError::not_implemented("Exporting a recording as a video"))
}

#[cfg(windows)]
mod mf {
    use opennote_media::audio::{AudioError, Result};
    use windows::{
        core::{Error, GUID, HSTRING},
        Win32::Media::MediaFoundation::{
            IMFMediaType, IMFSample, IMFSinkWriter, MFAudioFormat_AAC, MFAudioFormat_PCM, MFCreateMediaType,
            MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Audio, MFMediaType_Video,
            MFVideoFormat_H264, MFVideoFormat_RGB32, MFVideoInterlace_Progressive,
            MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE,
            MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE,
            MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO,
            MF_MT_SUBTYPE,
        },
    };

    pub struct Mp4Sink {
        writer: IMFSinkWriter,
        video_stream: u32,
        audio_stream: u32,
        width: usize,
        height: usize,
        flipped: Vec<u8>,
        source_stride: usize,
        frame_ns: u64,
    }

    fn failed(error: Error) -> AudioError {
        AudioError::Encoder(format!("Windows can't write this video ({}).", error.message()))
    }

    fn pair(high: u32, low: u32) -> u64 {
        (u64::from(high) << 32) | u64::from(low)
    }

    fn video_type(
        subtype: &GUID,
        width: u32,
        height: u32,
        fps: u32,
        bitrate: Option<u32>,
    ) -> windows::core::Result<IMFMediaType> {
        // SAFETY: plain calls on a media type this function made.
        unsafe {
            let media = MFCreateMediaType()?;
            media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
            if let Some(bitrate) = bitrate {
                media.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            }
            media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            media.SetUINT64(&MF_MT_FRAME_SIZE, pair(width, height))?;
            media.SetUINT64(&MF_MT_FRAME_RATE, pair(fps, 1))?;
            media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pair(1, 1))?;
            Ok(media)
        }
    }

    fn audio_type(subtype: &GUID, bytes_per_second: u32, bits: u32, align: u32) -> windows::core::Result<IMFMediaType> {
        // SAFETY: plain calls on a media type this function made.
        unsafe {
            let media = MFCreateMediaType()?;
            media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
            media.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
            media.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, 48_000)?;
            media.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, bits)?;
            media.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, align)?;
            media.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, bytes_per_second)?;
            Ok(media)
        }
    }

    impl Mp4Sink {
        pub fn create(path: &std::path::Path, width: u32, height: u32, fps: u32) -> Result<Mp4Sink> {
            // H.264 needs even sides.
            let source_width = width;
            let (width, height) = (width & !1, height & !1);
            // SAFETY: the writer and the types are COM objects owned by this value or dropped here.
            unsafe {
                let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, None).map_err(failed)?;
                let bitrate = (width * height * 3).clamp(800_000, 8_000_000);
                let video_out = video_type(&MFVideoFormat_H264, width, height, fps, Some(bitrate)).map_err(failed)?;
                let video_stream = writer.AddStream(&video_out).map_err(failed)?;
                let video_in = video_type(&MFVideoFormat_RGB32, width, height, fps, None).map_err(failed)?;
                writer
                    .SetInputMediaType(video_stream, &video_in, None)
                    .map_err(failed)?;
                let audio_out = audio_type(&MFAudioFormat_AAC, 12_000, 16, 1).map_err(failed)?;
                // AAC-LC at level 2.
                audio_out
                    .SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29)
                    .map_err(failed)?;
                let audio_stream = writer.AddStream(&audio_out).map_err(failed)?;
                let audio_in = audio_type(&MFAudioFormat_PCM, 96_000, 16, 2).map_err(failed)?;
                writer
                    .SetInputMediaType(audio_stream, &audio_in, None)
                    .map_err(failed)?;
                writer.BeginWriting().map_err(failed)?;
                Ok(Mp4Sink {
                    writer,
                    video_stream,
                    audio_stream,
                    width: width as usize,
                    height: height as usize,
                    flipped: vec![0; width as usize * height as usize * 4],
                    source_stride: source_width as usize * 4,
                    frame_ns: 1_000_000_000 / u64::from(fps),
                })
            }
        }

        fn sample(&self, bytes: &[u8], at_ns: u64, duration_ns: u64) -> windows::core::Result<IMFSample> {
            // SAFETY: the buffer is locked only while the bytes are copied in, and its length is set to what was copied.
            unsafe {
                let buffer = MFCreateMemoryBuffer(bytes.len() as u32)?;
                let (mut data, mut max) = (std::ptr::null_mut::<u8>(), 0u32);
                buffer.Lock(&mut data, Some(&mut max), None)?;
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len().min(max as usize));
                buffer.Unlock()?;
                buffer.SetCurrentLength(bytes.len() as u32)?;
                let sample = MFCreateSample()?;
                sample.AddBuffer(&buffer)?;
                sample.SetSampleTime((at_ns / 100) as i64)?;
                sample.SetSampleDuration((duration_ns / 100) as i64)?;
                Ok(sample)
            }
        }
    }

    impl opennote_media::video::VideoSink for Mp4Sink {
        fn frame(&mut self, bgra: &[u8], at_ns: u64) -> Result<()> {
            // RGB32 is stored with the bottom row first. The scene may be a pixel wider or taller than the video.
            let stride = self.width * 4;
            for row in 0..self.height {
                let from = row * self.source_stride;
                let to = (self.height - 1 - row) * stride;
                self.flipped[to..to + stride].copy_from_slice(&bgra[from..from + stride]);
            }
            let sample = self.sample(&self.flipped, at_ns, self.frame_ns).map_err(failed)?;
            // SAFETY: the writer is live until `finish`.
            unsafe { self.writer.WriteSample(self.video_stream, &sample) }.map_err(failed)
        }

        fn audio(&mut self, samples: &[i16], at_ns: u64) -> Result<()> {
            let mut bytes = Vec::with_capacity(samples.len() * 2);
            for sample in samples {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            let duration = samples.len() as u64 * 1_000_000_000 / 48_000;
            let sample = self.sample(&bytes, at_ns, duration).map_err(failed)?;
            // SAFETY: the writer is live until `finish`.
            unsafe { self.writer.WriteSample(self.audio_stream, &sample) }.map_err(failed)
        }

        fn finish(&mut self) -> Result<()> {
            // SAFETY: the writer is live; this ends it.
            unsafe { self.writer.Finalize() }.map_err(failed)
        }
    }
}

/// Writes the video to `path`, which must not exist. A failed or partial file is removed.
#[cfg(windows)]
pub fn write_mp4(
    path: &Path,
    scene: &Scene,
    pcm: &mut dyn PcmSource,
    duration_ns: u64,
    progress: &mut dyn FnMut(f32),
) -> IpcResult<()> {
    use windows::Win32::{
        Media::MediaFoundation::{MFShutdown, MFStartup, MFSTARTUP_FULL, MF_VERSION},
        System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
    };

    // SAFETY: COM and Media Foundation start and stop on this thread around the work, and the sink is dropped first.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_MULTITHREADED);
        let started = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        let result = (|| -> opennote_media::audio::Result<()> {
            started
                .clone()
                .map_err(|error| opennote_media::audio::AudioError::Encoder(error.message()))?;
            let mut sink = mf::Mp4Sink::create(path, scene.width, scene.height, FPS)?;
            video::export(scene, pcm, duration_ns, FPS, &mut sink, progress)
        })();
        if started.is_ok() {
            let _ = MFShutdown();
        }
        if apartment.is_ok() {
            CoUninitialize();
        }
        if let Err(error) = result {
            let _ = std::fs::remove_file(path);
            return Err(IpcError::new("videoEncoder", error.to_string()));
        }
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use opennote_media::{
        convert::MemoryPcm,
        video::{ScenePoint, SceneStroke},
    };

    #[test]
    fn a_short_recording_becomes_an_mp4_file() {
        let (width, height) = (320u32, 240u32);
        let rgba = vec![250u8; (width * height * 4) as usize];
        let stroke = SceneStroke {
            color: [10, 30, 200, 255],
            width: 5.0,
            points: (0..20)
                .map(|i| ScenePoint {
                    x: 20.0 + i as f32 * 12.0,
                    y: 60.0 + (i as f32 * 0.5).sin() * 20.0,
                    t_ns: i * 50_000_000,
                })
                .collect(),
        };
        let scene = Scene::from_rgba(width, height, &rgba, vec![stroke]).unwrap();
        let tone: Vec<f32> = (0..96_000).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.mp4");
        let mut last = 0.0;
        write_mp4(&path, &scene, &mut MemoryPcm::new(tone), 2_000_000_000, &mut |share| {
            last = share
        })
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.len() > 2_000, "only {} bytes", bytes.len());
        assert_eq!(&bytes[4..8], b"ftyp", "an MP4 file starts with its type box");
        assert_eq!(last, 1.0);
    }
}
