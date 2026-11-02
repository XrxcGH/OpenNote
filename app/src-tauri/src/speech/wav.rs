//! The WAV a speech program wrote, and the word boundaries the interface highlights while it plays. The programs
//! don't report when each word is spoken, so a word's time is its share of the clip's length, weighted by the
//! word's length and by a pause after punctuation. That keeps the highlight within a word or two of the voice.

use serde::Serialize;

use crate::ipc::{codes, IpcError, IpcResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Boundary {
    pub ms: u64,
    pub start: usize,
    pub length: usize,
}

/// The length of a PCM WAV in milliseconds, or `None` when the bytes aren't one.
pub fn duration_ms(wav: &[u8]) -> Option<u64> {
    if wav.len() < 12 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let (mut byte_rate, mut at) = (0u64, 12usize);
    while at + 8 <= wav.len() {
        let id = &wav[at..at + 4];
        let size = u32::from_le_bytes(wav[at + 4..at + 8].try_into().ok()?) as usize;
        let body = at + 8;
        if id == b"fmt " && body + 12 <= wav.len() {
            byte_rate = u64::from(u32::from_le_bytes(wav[body + 8..body + 12].try_into().ok()?));
        } else if id == b"data" {
            // A streaming writer may leave the size at its maximum or zero; the data then runs to the end.
            let available = wav.len() - body;
            let data = if size == 0 || size > available { available } else { size };
            return (byte_rate > 0).then(|| data as u64 * 1000 / byte_rate);
        }
        at = body.checked_add(size)?.checked_add(size & 1)?;
    }
    None
}

/// Where each word of `text` is spoken, given the clip's length. Ranges are UTF-16 units.
pub fn boundaries(text: &str, duration_ms: u64) -> Vec<Boundary> {
    let mut words: Vec<(usize, usize, f64)> = Vec::new();
    let (mut unit, mut current): (usize, Option<(usize, usize)>) = (0, None);
    let chars: Vec<char> = text.chars().collect();
    for (index, ch) in chars.iter().enumerate() {
        let in_word = ch.is_alphanumeric() || matches!(ch, '\'' | '\u{2019}' | '-');
        match (in_word, current) {
            (true, None) => current = Some((unit, ch.len_utf16())),
            (true, Some((start, length))) => current = Some((start, length + ch.len_utf16())),
            (false, Some((start, length))) => {
                words.push((start, length, weight(length, chars.get(index).copied())));
                current = None;
            }
            (false, None) => {}
        }
        unit += ch.len_utf16();
    }
    if let Some((start, length)) = current {
        words.push((start, length, weight(length, None)));
    }
    let total: f64 = words.iter().map(|word| word.2).sum();
    let mut elapsed = 0.0;
    words
        .into_iter()
        .map(|(start, length, weight)| {
            let ms = if total > 0.0 {
                (elapsed / total * duration_ms as f64) as u64
            } else {
                0
            };
            elapsed += weight;
            Boundary { ms, start, length }
        })
        .collect()
}

fn weight(length: usize, after: Option<char>) -> f64 {
    let pause = match after {
        Some('.' | '!' | '?' | ';' | ':') => 4.0,
        Some(',') => 2.0,
        _ => 0.0,
    };
    length as f64 + 1.0 + pause
}

/// The reply of `speech_synthesize`: the boundaries' JSON length as 4 bytes, the JSON, then the WAV.
pub fn reply(text: &str, wav: Vec<u8>) -> IpcResult<Vec<u8>> {
    let duration =
        duration_ms(&wav).ok_or_else(|| IpcError::new(codes::INTERNAL, "The voice made no sound for that text."))?;
    let json = serde_json::to_vec(&boundaries(text, duration))
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    let mut out = Vec::with_capacity(4 + json.len() + wav.len());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&wav);
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// A mono 16-bit 22050 Hz WAV of `seconds` of silence.
    fn silence(seconds: u32) -> Vec<u8> {
        let data = 22050 * 2 * seconds;
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&[1, 0, 1, 0]);
        wav.extend_from_slice(&22050u32.to_le_bytes());
        wav.extend_from_slice(&(22050u32 * 2).to_le_bytes());
        wav.extend_from_slice(&[2, 0, 16, 0]);
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data.to_le_bytes());
        wav.extend(std::iter::repeat_n(0u8, data as usize));
        wav
    }

    #[test]
    fn measures_a_wav() {
        assert_eq!(duration_ms(&silence(3)), Some(3000));
        assert_eq!(duration_ms(b"not a wav at all"), None);
    }

    #[test]
    fn a_streamed_wav_with_no_data_size_runs_to_the_end() {
        let mut wav = silence(2);
        let at = wav.windows(4).position(|w| w == b"data").unwrap() + 4;
        wav[at..at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(duration_ms(&wav), Some(2000));
    }

    #[test]
    fn words_get_ranges_in_utf16_units_and_rising_times() {
        // The emoji takes two UTF-16 units, so the second word starts at 4, not 3.
        let marks = boundaries("Hi \u{1F600} there, friend.", 1000);
        assert_eq!(
            marks.iter().map(|m| (m.start, m.length)).collect::<Vec<_>>(),
            [(0, 2), (6, 5), (13, 6)]
        );
        assert_eq!(marks[0].ms, 0);
        assert!(marks.windows(2).all(|pair| pair[0].ms < pair[1].ms));
        assert!(marks.last().unwrap().ms < 1000);
    }

    #[test]
    fn the_reply_carries_the_json_length_then_json_then_the_wav() {
        let wav = silence(1);
        let out = reply("One two", wav.clone()).unwrap();
        let length = u32::from_le_bytes(out[..4].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&out[4..4 + length]).unwrap();
        assert_eq!(json.as_array().unwrap().len(), 2);
        assert_eq!(&out[4 + length..], wav.as_slice());
        assert!(reply("One", b"junk".to_vec()).is_err());
    }
}
