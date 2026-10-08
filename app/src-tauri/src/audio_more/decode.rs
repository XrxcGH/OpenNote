//! Decoding an audio or video file to mono samples at 48 kHz, with the codecs Windows has: MP3, AAC in M4A and
//! MP4, WAV, and the others Media Foundation opens. Nothing is added to the app for this. A PC without the codec
//! for a file (the "N" editions of Windows lack the media pack) says so, and nothing is made.

use std::path::Path;

use crate::ipc::{IpcError, IpcResult};

/// The format the decoded samples have, which is the format of every recording track.
const RATE: u32 = 48_000;

#[cfg(not(windows))]
pub fn decode_file(_path: &Path, _max_ns: u64) -> IpcResult<Vec<f32>> {
    Err(IpcError::not_implemented("Importing audio files"))
}

#[cfg(windows)]
fn unreadable(message: &str) -> IpcError {
    IpcError::new("audioFormat", message)
}

/// Decodes the first audio stream of the file. The answer holds at most `max_ns` of sound.
#[cfg(windows)]
pub fn decode_file(path: &Path, max_ns: u64) -> IpcResult<Vec<f32>> {
    use windows::{
        core::{Error, HSTRING},
        Win32::{
            Media::MediaFoundation::{
                IMFSample, MFAudioFormat_Float, MFCreateMediaType, MFCreateSourceReaderFromURL, MFMediaType_Audio,
                MFShutdown, MFStartup, MFSTARTUP_FULL, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE,
                MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND,
                MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_VERSION,
            },
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
        },
    };

    /// The source reader's names for "the first audio stream" and "every stream".
    const FIRST_AUDIO: u32 = 0xFFFF_FFFD;
    const ALL_STREAMS: u32 = 0xFFFF_FFFE;
    const END_OF_STREAM: u32 = 0x2;

    let max_samples = (max_ns / 1_000_000_000 * u64::from(RATE)) as usize;
    // SAFETY: COM and Media Foundation start and stop on this thread around the work, and every object below is
    // dropped before they stop. Each sample's buffer is locked only while its floats are copied out.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_MULTITHREADED);
        let started = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        let result = (|| -> windows::core::Result<Vec<f32>> {
            started.clone()?;
            let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), None)?;
            reader.SetStreamSelection(ALL_STREAMS, false)?;
            reader.SetStreamSelection(FIRST_AUDIO, true)?;
            let wanted = MFCreateMediaType()?;
            wanted.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            wanted.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_Float)?;
            wanted.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
            wanted.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, RATE)?;
            wanted.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 32)?;
            wanted.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 4)?;
            wanted.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, RATE * 4)?;
            reader.SetCurrentMediaType(FIRST_AUDIO, None, &wanted)?;
            let mut samples: Vec<f32> = Vec::new();
            loop {
                let (mut flags, mut sample): (u32, Option<IMFSample>) = (0, None);
                reader.ReadSample(FIRST_AUDIO, 0, None, Some(&mut flags), None, Some(&mut sample))?;
                if let Some(sample) = sample {
                    let buffer = sample.ConvertToContiguousBuffer()?;
                    let (mut data, mut length) = (std::ptr::null_mut::<u8>(), 0u32);
                    buffer.Lock(&mut data, None, Some(&mut length))?;
                    let floats = std::slice::from_raw_parts(data as *const f32, length as usize / 4);
                    samples.extend_from_slice(floats);
                    buffer.Unlock()?;
                }
                if flags & END_OF_STREAM != 0 || samples.len() >= max_samples {
                    break;
                }
            }
            samples.truncate(max_samples);
            Ok(samples)
        })();
        if started.is_ok() {
            let _ = MFShutdown();
        }
        if apartment.is_ok() {
            CoUninitialize();
        }
        result.map_err(|error: Error| {
            unreadable(&format!(
                "Windows can't read the sound in this file ({}). The codec may be missing.",
                error.message()
            ))
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// A mono 16-bit WAV file of a tone, `seconds` long, at `rate`.
    fn wav(rate: u32, seconds: u32) -> Vec<u8> {
        let frames = rate * seconds;
        let data = frames * 2;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data.to_le_bytes());
        for i in 0..frames {
            let value = ((i as f32 * 0.05).sin() * 8000.0) as i16;
            out.extend_from_slice(&value.to_le_bytes());
        }
        out
    }

    #[test]
    fn a_wav_file_comes_back_as_48_khz_mono_samples() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tone.wav");
        std::fs::write(&path, wav(16_000, 2)).unwrap();
        let samples = decode_file(&path, 60 * 1_000_000_000).unwrap();
        let seconds = samples.len() as f32 / RATE as f32;
        assert!((seconds - 2.0).abs() < 0.1, "got {seconds} seconds");
        assert!(samples.iter().any(|sample| sample.abs() > 0.1));
    }

    #[test]
    fn a_file_that_is_not_audio_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.wav");
        std::fs::write(&path, b"this is not a sound").unwrap();
        assert!(decode_file(&path, 1_000_000_000).is_err());
    }
}
