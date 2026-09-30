//! Small helpers with no Windows dependencies: base64 for DevTools replies, and colors in PDF content.

/// Decodes standard base64 (RFC 4648), as the DevTools protocol returns PDFs and screenshots.
pub fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(text.len() / 4 * 3);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for (index, symbol) in text.bytes().enumerate() {
        let value = match symbol {
            b'A'..=b'Z' => symbol - b'A',
            b'a'..=b'z' => symbol - b'a' + 26,
            b'0'..=b'9' => symbol - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' => continue,
            _ => return Err(format!("Invalid base64 at position {index}.")),
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(bytes)
}

/// A color in sRGB, with 8 bits per channel.
pub type Rgb = [u8; 3];

/// Converts PDF color components (0 to 1) to 8-bit sRGB.
pub fn rgb_from_unit(red: f32, green: f32, blue: f32) -> Rgb {
    let channel = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    [channel(red), channel(green), channel(blue)]
}

/// Formats a color as `#rrggbb`.
pub fn hex(color: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])
}

/// Parses `#rrggbb` (either case).
pub fn parse_hex(text: &str) -> Option<Rgb> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 || !digits.is_ascii() {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// True when two colors differ by at most `tolerance` in every channel.
pub fn close(a: Rgb, b: Rgb, tolerance: u8) -> bool {
    a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= tolerance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base64_with_and_without_padding() {
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64("TQ==").unwrap(), b"M");
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("JVBERi0x\nLjQ=").unwrap(), b"%PDF-1.4");
        assert!(decode_base64("TW*u").is_err());
    }

    #[test]
    fn converts_and_compares_colors() {
        assert_eq!(rgb_from_unit(0.184, 0.310, 0.604), [47, 79, 154]);
        assert_eq!(hex([47, 79, 154]), "#2f4f9a");
        assert_eq!(parse_hex("#2F4F9A"), Some([47, 79, 154]));
        assert_eq!(parse_hex("2F4F9A"), None);
        assert_eq!(parse_hex("#2F4F9"), None);
        assert!(close([47, 79, 154], [48, 78, 154], 1));
        assert!(!close([47, 79, 154], [50, 79, 154], 2));
    }
}
