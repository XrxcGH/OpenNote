//! Decoding the bytes of text files: UTF-8, UTF-16, and the Windows code pages older tools still write.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};

/// Text decoded from bytes, and how.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decoded {
    /// The text, without a byte order mark.
    pub text: String,
    /// The name of the encoding that was used, such as `UTF-8` or `windows-1252`.
    pub encoding: &'static str,
    /// Whether some bytes were not valid in that encoding and became replacement marks.
    pub lossy: bool,
    /// Whether the encoding was a guess. A file with a byte order mark, or valid UTF-8, is not a guess.
    pub guessed: bool,
}

/// Decodes a text file. A byte order mark decides first, then valid UTF-8, then UTF-16 without a mark (Windows
/// tools write it), and last Windows-1252, the usual code page of old Windows text files.
pub fn decode(bytes: &[u8]) -> Decoded {
    if let Some((encoding, skip)) = Encoding::for_bom(bytes) {
        let (text, _) = encoding.decode_without_bom_handling(bytes.get(skip..).unwrap_or(&[]));
        let lossy = text.contains('\u{fffd}');
        return Decoded {
            text: text.into_owned(),
            encoding: encoding.name(),
            lossy,
            guessed: false,
        };
    }
    // Text never holds a zero byte, but UTF-16 text does, and its bytes can still be valid UTF-8.
    if bytes.contains(&0) {
        if let Some(encoding) = guess_utf16(bytes) {
            let (text, _) = encoding.decode_without_bom_handling(bytes);
            return Decoded {
                lossy: text.contains('\u{fffd}'),
                text: text.into_owned(),
                encoding: encoding.name(),
                guessed: true,
            };
        }
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Decoded {
            text: text.to_owned(),
            encoding: UTF_8.name(),
            lossy: false,
            guessed: false,
        };
    }
    let (text, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
    Decoded {
        text: text.into_owned(),
        encoding: WINDOWS_1252.name(),
        lossy: false,
        guessed: true,
    }
}

/// Decodes bytes in the encoding a label names, such as the `charset` of an email or web page header. An unknown label falls
/// back to [`decode`].
pub fn decode_labelled(bytes: &[u8], label: &str) -> Decoded {
    let Some(encoding) = Encoding::for_label(label.trim().as_bytes()) else {
        return decode(bytes);
    };
    let (text, _, lossy) = encoding.decode(bytes);
    Decoded {
        text: text.into_owned(),
        encoding: encoding.name(),
        lossy,
        guessed: false,
    }
}

/// UTF-16 text without a mark: ASCII-heavy text has a zero byte in every other position.
fn guess_utf16(bytes: &[u8]) -> Option<&'static Encoding> {
    if bytes.len() < 4 || !bytes.len().is_multiple_of(2) {
        return None;
    }
    let pairs = bytes.len() / 2;
    let even_zero = bytes.iter().step_by(2).filter(|b| **b == 0).count();
    let odd_zero = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    let threshold = pairs * 6 / 10;
    if odd_zero >= threshold && even_zero == 0 {
        Some(UTF_16LE)
    } else if even_zero >= threshold && odd_zero == 0 {
        Some(UTF_16BE)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_with_and_without_a_mark() {
        assert_eq!(decode("héllo".as_bytes()).text, "héllo");
        let marked = [&[0xef, 0xbb, 0xbf][..], "héllo".as_bytes()].concat();
        let decoded = decode(&marked);
        assert_eq!((decoded.text.as_str(), decoded.encoding), ("héllo", "UTF-8"));
        assert!(!decoded.guessed);
    }

    #[test]
    fn utf16_with_a_mark_and_without() {
        let units: Vec<u8> = "Notes à faire".encode_utf16().flat_map(u16::to_le_bytes).collect();
        let marked = [&[0xff, 0xfe][..], &units].concat();
        assert_eq!(decode(&marked).text, "Notes à faire");
        let guessed = decode(&units);
        assert_eq!(guessed.text, "Notes à faire");
        assert!(guessed.guessed);
        let big: Vec<u8> = "Notes".encode_utf16().flat_map(u16::to_be_bytes).collect();
        assert_eq!(decode(&big).text, "Notes");
    }

    #[test]
    fn old_windows_files_are_read_as_windows_1252() {
        let decoded = decode(b"caf\xe9 \x93quoted\x94");
        assert_eq!(decoded.text, "caf\u{e9} \u{201c}quoted\u{201d}");
        assert_eq!(decoded.encoding, "windows-1252");
        assert!(decoded.guessed && !decoded.lossy);
    }

    #[test]
    fn labels_pick_the_encoding() {
        assert_eq!(decode_labelled(b"caf\xe9", "iso-8859-1").text, "caf\u{e9}");
        assert_eq!(decode_labelled(b"caf\xc3\xa9", "utf-8").text, "caf\u{e9}");
        assert_eq!(decode_labelled(b"plain", "made-up").text, "plain");
    }
}
