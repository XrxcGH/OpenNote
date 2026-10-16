//! Reading and writing the small subset of WAV files that speech synthesis uses: PCM, any rate.

use crate::error::IntelError;

/// What a WAV file says about its sound.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WavInfo {
    /// Samples per second, per channel.
    pub sample_rate: u32,
    /// Interleaved channels.
    pub channels: u16,
    /// Bits in one sample.
    pub bits_per_sample: u16,
    /// Bytes of sound.
    pub data_len: u32,
}

impl WavInfo {
    /// The length of the sound in milliseconds, rounded to the nearest.
    pub fn duration_ms(&self) -> u64 {
        let frame = u64::from(self.channels) * u64::from(self.bits_per_sample / 8);
        let bytes_per_second = frame * u64::from(self.sample_rate);
        if bytes_per_second == 0 {
            return 0;
        }
        (u64::from(self.data_len) * 1000 + bytes_per_second / 2) / bytes_per_second
    }
}

/// Wraps 16-bit mono samples in a WAV file.
pub fn write_pcm16_mono(sample_rate: u32, samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1_u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

/// Reads the format and the length of the sound from a WAV file's header.
pub fn read_info(wav: &[u8]) -> Result<WavInfo, IntelError> {
    let bad = |why: &str| IntelError::Engine(format!("the speech audio is not a WAV file: {why}"));
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err(bad("no RIFF header"));
    }
    let mut format: Option<(u16, u32, u16)> = None;
    let mut at = 12;
    while at + 8 <= wav.len() {
        let id = &wav[at..at + 4];
        let size = u32::from_le_bytes([wav[at + 4], wav[at + 5], wav[at + 6], wav[at + 7]]);
        let body = at + 8;
        if id == b"fmt " && body + 16 <= wav.len() {
            let channels = u16::from_le_bytes([wav[body + 2], wav[body + 3]]);
            let rate = u32::from_le_bytes([wav[body + 4], wav[body + 5], wav[body + 6], wav[body + 7]]);
            let bits = u16::from_le_bytes([wav[body + 14], wav[body + 15]]);
            format = Some((channels, rate, bits));
        } else if id == b"data" {
            let (channels, sample_rate, bits_per_sample) =
                format.ok_or_else(|| bad("the data came before the format"))?;
            // A streamed file may claim more sound than it holds.
            let held = (wav.len() - body) as u32;
            return Ok(WavInfo {
                sample_rate,
                channels,
                bits_per_sample,
                data_len: size.min(held),
            });
        }
        at = body.saturating_add(size as usize).saturating_add(size as usize % 2);
    }
    Err(bad("no sound data"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn written_files_read_back() {
        let wav = write_pcm16_mono(8000, &[0; 4000]);
        let info = read_info(&wav).unwrap();
        assert_eq!(
            info,
            WavInfo {
                sample_rate: 8000,
                channels: 1,
                bits_per_sample: 16,
                data_len: 8000
            }
        );
        assert_eq!(info.duration_ms(), 500);
    }

    #[test]
    fn a_data_size_larger_than_the_file_is_clamped() {
        let mut wav = write_pcm16_mono(16000, &[0; 160]);
        wav[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(read_info(&wav).unwrap().data_len, 320);
    }

    #[test]
    fn other_bytes_are_refused() {
        assert!(read_info(b"").is_err());
        assert!(read_info(b"RIFF0000WAVEfmt ").is_err());
        assert!(read_info(&[0; 64]).is_err());
    }
}
