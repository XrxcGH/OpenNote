//! Pixel sizes of common image files, and media types from file names.

/// Media types by file extension, one per line, for files imported from disk.
const MIME_BY_EXTENSION: &str = "png image/png
jpg image/jpeg
jpeg image/jpeg
gif image/gif
webp image/webp
svg image/svg+xml
bmp image/bmp
heic image/heic
pdf application/pdf
mp3 audio/mpeg
m4a audio/mp4
ogg audio/ogg
wav audio/wav
webm video/webm
mp4 video/mp4
mov video/quicktime
txt text/plain
md text/markdown
csv text/csv
json application/json
zip application/zip
docx application/vnd.openxmlformats-officedocument.wordprocessingml.document
xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
pptx application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// The media type of a file, from its extension. Unknown extensions are `application/octet-stream`.
pub fn mime_for_name(name: &str) -> &'static str {
    let Some((_, extension)) = name.rsplit_once('.') else {
        return "application/octet-stream";
    };
    let extension = extension.to_ascii_lowercase();
    MIME_BY_EXTENSION
        .lines()
        .find_map(|line| {
            let (known, mime) = line.split_once(' ')?;
            (known == extension).then_some(mime)
        })
        .unwrap_or("application/octet-stream")
}

// The width and height in pixels of a PNG, GIF, JPEG, or BMP image, read from its header.
pub fn image_size(bytes: &[u8], mime: &str) -> Option<(u32, u32)> {
    if !mime.starts_with("image/") {
        return None;
    }
    png(bytes)
        .or_else(|| gif(bytes))
        .or_else(|| jpeg(bytes))
        .or_else(|| bmp(bytes))
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn be_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at.checked_add(2)?)?.try_into().ok()?))
}

fn le_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at.checked_add(2)?)?.try_into().ok()?))
}

fn le_i32(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(bytes.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn png(bytes: &[u8]) -> Option<(u32, u32)> {
    let signature = b"\x89PNG\r\n\x1a\n";
    (bytes.get(..8)? == signature && bytes.get(12..16)? == b"IHDR").then_some(())?;
    Some((be_u32(bytes, 16)?, be_u32(bytes, 20)?))
}

fn gif(bytes: &[u8]) -> Option<(u32, u32)> {
    (bytes.get(..4)? == b"GIF8").then_some(())?;
    Some((u32::from(le_u16(bytes, 6)?), u32::from(le_u16(bytes, 8)?)))
}

fn bmp(bytes: &[u8]) -> Option<(u32, u32)> {
    (bytes.get(..2)? == b"BM").then_some(())?;
    let width = le_i32(bytes, 18)?.unsigned_abs();
    let height = le_i32(bytes, 22)?.unsigned_abs();
    Some((width, height))
}

/// Walks the JPEG markers to the first start-of-frame marker.
fn jpeg(bytes: &[u8]) -> Option<(u32, u32)> {
    (bytes.get(..2)? == [0xff, 0xd8]).then_some(())?;
    let mut at = 2usize;
    loop {
        let (&marker_start, &marker) = (bytes.get(at)?, bytes.get(at.checked_add(1)?)?);
        if marker_start != 0xff {
            return None;
        }
        let length = usize::from(be_u16(bytes, at.checked_add(2)?)?);
        let is_frame = (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker);
        if is_frame {
            let height = be_u16(bytes, at.checked_add(5)?)?;
            let width = be_u16(bytes, at.checked_add(7)?)?;
            return Some((u32::from(width), u32::from(height)));
        }
        at = at.checked_add(2)?.checked_add(length)?;
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    #[test]
    fn reads_sizes_from_headers() {
        let mut png_bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png_bytes.extend_from_slice(&1600u32.to_be_bytes());
        png_bytes.extend_from_slice(&1200u32.to_be_bytes());
        assert_eq!(image_size(&png_bytes, "image/png"), Some((1600, 1200)));
        assert_eq!(image_size(&png_bytes, "application/pdf"), None);
        let gif_bytes = [b'G', b'I', b'F', b'8', b'9', b'a', 10, 0, 20, 0];
        assert_eq!(image_size(&gif_bytes, "image/gif"), Some((10, 20)));
        let jpeg_bytes = [
            0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40,
        ];
        assert_eq!(image_size(&jpeg_bytes, "image/jpeg"), Some((64, 48)));
        let mut bmp_bytes = vec![0u8; 26];
        bmp_bytes[..2].copy_from_slice(b"BM");
        bmp_bytes[18..22].copy_from_slice(&5i32.to_le_bytes());
        bmp_bytes[22..26].copy_from_slice(&(-7i32).to_le_bytes());
        assert_eq!(image_size(&bmp_bytes, "image/bmp"), Some((5, 7)));
        assert_eq!(image_size(b"\xff\xd8\xff", "image/jpeg"), None);
        assert_eq!(image_size(b"", "image/png"), None);
    }

    #[test]
    fn guesses_media_types_from_names() {
        assert_eq!(mime_for_name("Leaf section.PNG"), "image/png");
        assert_eq!(mime_for_name("notes.pdf"), "application/pdf");
        assert_eq!(mime_for_name("archive.tar.gz"), "application/octet-stream");
        assert_eq!(mime_for_name("README"), "application/octet-stream");
    }
}
