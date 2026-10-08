//! Making asset table entries for imported files: names (spec 10.1), media types, sizes, and hashes.

use opennote_core::format::names::asset_file_name;
use opennote_core::model::Asset;
use opennote_core::{AssetId, Timestamp};
use sha2::{Digest, Sha256};

/// The media types of the file extensions that notes commonly hold, as `extension=type` pairs.
const MIME_TABLE: &str = "png=image/png,jpg=image/jpeg,jpeg=image/jpeg,gif=image/gif,webp=image/webp,\
    svg=image/svg+xml,bmp=image/bmp,pdf=application/pdf,mp3=audio/mpeg,wav=audio/wav,m4a=audio/mp4,\
    ogg=audio/ogg,mp4=video/mp4,txt=text/plain,md=text/markdown,csv=text/csv,zip=application/zip,\
    docx=application/vnd.openxmlformats-officedocument.wordprocessingml.document,\
    xlsx=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,\
    pptx=application/vnd.openxmlformats-officedocument.presentationml.presentation";

fn mime_pairs() -> impl Iterator<Item = (&'static str, &'static str)> {
    MIME_TABLE.split(',').filter_map(|pair| pair.split_once('='))
}

/// The media type for a file extension, or `application/octet-stream`.
pub fn mime_from_extension(extension: &str) -> &'static str {
    let lower = extension.to_ascii_lowercase();
    mime_pairs()
        .find(|(ext, _)| *ext == lower)
        .map_or("application/octet-stream", |(_, mime)| mime)
}

/// Whether the media type is an image that OpenNote shows in an `image` block.
pub fn is_image(mime: &str) -> bool {
    mime.starts_with("image/")
}

/// The width and height of a PNG, JPEG, or GIF, read from its header.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 {
        return Some((be32(bytes, 16)?, be32(bytes, 20)?));
    }
    if bytes.starts_with(b"GIF8") && bytes.len() >= 10 {
        let width = u32::from(u16::from_le_bytes([bytes[6], bytes[7]]));
        let height = u32::from(u16::from_le_bytes([bytes[8], bytes[9]]));
        return Some((width, height));
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        return jpeg_size(bytes);
    }
    None
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn jpeg_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    while at + 9 < bytes.len() {
        if bytes[at] != 0xff {
            at += 1;
            continue;
        }
        let marker = bytes[at + 1];
        let length = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        let is_frame = (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc);
        if is_frame {
            let height = u32::from(u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]));
            let width = u32::from(u16::from_be_bytes([bytes[at + 7], bytes[at + 8]]));
            return Some((width, height));
        }
        at += 2 + length.max(2);
    }
    None
}

/// The hash of a file, as an asset entry stores it.
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// The table entry for a file. `mime` defaults to the type of the file's extension.
///
/// The file name comes from the core's own rule (spec 10.1), so the core's reader always accepts it. A name made
/// by another rule could hold a character that the core's check refuses, such as a Thai or Hindi vowel sign.
pub fn make_asset(id: AssetId, name: &str, mime: Option<&str>, bytes: &[u8], created: Timestamp) -> Asset {
    let extension = name.rsplit_once('.').map_or("", |(_, ext)| ext);
    let mime = mime
        .filter(|m| !m.is_empty())
        .map_or_else(|| mime_from_extension(extension).to_owned(), str::to_owned);
    let size = if is_image(&mime) { image_size(bytes) } else { None };
    Asset {
        id,
        file: asset_file_name(id, name, &mime),
        mime,
        bytes: bytes.len() as u64,
        sha256: sha256(bytes),
        name: name.to_owned(),
        width: size.map(|s| s.0),
        height: size.map(|s| s.1),
        created,
        extra: opennote_core::model::JsonMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_spec_example() {
        let id: AssetId = "01m3sa43z1tp9rdr5e8df2jbxy".parse().expect("a valid ID");
        let at = Timestamp::EPOCH;
        let file = |name: &str, mime: Option<&str>| make_asset(id, name, mime, b"x", at).file;
        assert_eq!(file("Leaf section.PNG", None), format!("{id}-leaf-section.png"));
        assert_eq!(file("???.x y", Some("application/pdf")), format!("{id}.pdf"));
        assert_eq!(
            file("A very long original file name.jpg", None),
            format!("{id}-a-very-long-original-fil.jpg")
        );
    }

    #[test]
    fn names_with_vowel_signs_pass_the_cores_check() {
        let id: AssetId = "01m3sa43z1tp9rdr5e8df2jbxy".parse().expect("a valid ID");
        let at = Timestamp::EPOCH;
        for name in ["รูปภาพ.png", "चित्र.png", "ছবি.jpg", "படம்.gif", "שָׁלוֹם.png", "صُورَة.png"]
        {
            let asset = make_asset(id, name, None, b"x", at);
            assert!(
                opennote_core::format::names::check_asset_file_name(id, &asset.file),
                "{name} became {}",
                asset.file
            );
        }
    }

    #[test]
    fn png_and_gif_headers_give_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&[0, 0, 1, 0, 0, 0, 0, 200]);
        assert_eq!(image_size(&png), Some((256, 200)));
        assert_eq!(image_size(b"GIF89a\x10\0\x20\0"), Some((16, 32)));
        assert_eq!(image_size(b"not an image"), None);
    }
}
