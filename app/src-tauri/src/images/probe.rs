//! The header read at import: format, pixel size, and orientation (Phase 4 ARCHITECTURE.md section 12.2). The page
//! never decodes an image to learn its size. The format comes from the first bytes, the size and the EXIF orientation
//! from the header, and on Windows, Windows Imaging Component confirms the size for every format it has a codec for.
//! SVG gets its size from its `width`, `height`, or `viewBox`, or 300 by 150.

use super::{header, svg};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
    Bmp,
    Avif,
    Svg,
    Heic,
    Tiff,
    Other,
}

impl ImageFormat {
    /// The media type the page's asset gets.
    pub fn mime(self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Gif => "image/gif",
            ImageFormat::Webp => "image/webp",
            ImageFormat::Bmp => "image/bmp",
            ImageFormat::Avif => "image/avif",
            ImageFormat::Svg => "image/svg+xml",
            ImageFormat::Heic => "image/heic",
            ImageFormat::Tiff => "image/tiff",
            ImageFormat::Other => "application/octet-stream",
        }
    }

    /// The file name extension for that media type.
    pub fn extension(self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpeg => "jpg",
            ImageFormat::Gif => "gif",
            ImageFormat::Webp => "webp",
            ImageFormat::Bmp => "bmp",
            ImageFormat::Avif => "avif",
            ImageFormat::Svg => "svg",
            ImageFormat::Heic => "heic",
            ImageFormat::Tiff => "tif",
            ImageFormat::Other => "bin",
        }
    }

    /// The format a media type names, with the aliases browsers and Windows use.
    pub fn from_mime(mime: &str) -> Option<ImageFormat> {
        let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
        Some(match mime.as_str() {
            "image/png" | "image/apng" => ImageFormat::Png,
            "image/jpeg" | "image/jpg" | "image/pjpeg" => ImageFormat::Jpeg,
            "image/gif" => ImageFormat::Gif,
            "image/webp" => ImageFormat::Webp,
            "image/bmp" | "image/x-bmp" | "image/x-ms-bmp" => ImageFormat::Bmp,
            "image/avif" => ImageFormat::Avif,
            "image/svg+xml" => ImageFormat::Svg,
            "image/heic" | "image/heif" | "image/heic-sequence" | "image/heif-sequence" => ImageFormat::Heic,
            "image/tiff" | "image/tif" => ImageFormat::Tiff,
            _ => return None,
        })
    }

    /// Whether WebView2 shows the format in an `<img>`.
    pub fn displayable(self) -> bool {
        matches!(
            self,
            ImageFormat::Png
                | ImageFormat::Jpeg
                | ImageFormat::Gif
                | ImageFormat::Webp
                | ImageFormat::Bmp
                | ImageFormat::Avif
                | ImageFormat::Svg
        )
    }
}

/// The oriented size: width and height after the EXIF orientation is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Probe {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeError {
    /// The bytes aren't an image this version reads.
    Unsupported,
    /// The bytes start like an image, but its header is cut short or broken.
    Malformed(ImageFormat),
}

/// The format alone, from the first bytes.
pub fn sniff(bytes: &[u8]) -> ImageFormat {
    header::sniff(bytes)
}

pub fn probe(bytes: &[u8]) -> Result<Probe, ProbeError> {
    let format = header::sniff(bytes);
    match format {
        ImageFormat::Other => Err(ProbeError::Unsupported),
        ImageFormat::Svg => {
            let (width, height) = svg::size(bytes).ok_or(ProbeError::Malformed(format))?;
            Ok(Probe {
                format,
                width,
                height,
                orientation: 1,
            })
        }
        _ => {
            let raw = header::read(format, bytes);
            let checked = confirm(bytes, raw.map(|raw| (raw.width, raw.height)));
            let (width, height) = checked.ok_or(ProbeError::Malformed(format))?;
            let orientation = raw.map_or(1, |raw| raw.orientation);
            let turned = orientation >= 5;
            Ok(Probe {
                format,
                width: if turned { height } else { width },
                height: if turned { width } else { height },
                orientation,
            })
        }
    }
}

/// The stored size as WIC reads it, when a codec is installed for the format, else the header's.
#[cfg(windows)]
fn confirm(bytes: &[u8], header: Option<(u32, u32)>) -> Option<(u32, u32)> {
    super::wic::frame_size(bytes)
        .filter(|(w, h)| *w > 0 && *h > 0)
        .or(header)
}

#[cfg(not(windows))]
fn confirm(_bytes: &[u8], header: Option<(u32, u32)>) -> Option<(u32, u32)> {
    header
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/images/fixtures");

    /// The fixtures are 6 by 4 pixels, made with Pillow 12: one per format, and a JPEG for each EXIF orientation.
    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{FIXTURES}/{name}")).unwrap_or_else(|error| panic!("{name}: {error}"))
    }

    fn expect(name: &str, format: ImageFormat, size: (u32, u32), orientation: u8) {
        let found = probe(&fixture(name)).unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(
            (found.format, (found.width, found.height), found.orientation),
            (format, size, orientation),
            "{name}"
        );
    }

    #[test]
    fn every_format_reports_its_size() {
        expect("png.png", ImageFormat::Png, (6, 4), 1);
        expect("png-alpha.png", ImageFormat::Png, (6, 4), 1);
        expect("jpeg-plain.jpg", ImageFormat::Jpeg, (6, 4), 1);
        expect("gif.gif", ImageFormat::Gif, (6, 4), 1);
        expect("webp-lossy.webp", ImageFormat::Webp, (6, 4), 1);
        expect("webp-lossless.webp", ImageFormat::Webp, (6, 4), 1);
        expect("bmp.bmp", ImageFormat::Bmp, (6, 4), 1);
        expect("avif.avif", ImageFormat::Avif, (6, 4), 1);
    }

    #[test]
    fn orientations_5_to_8_swap_width_and_height() {
        for orientation in 1..=8u8 {
            let size = if orientation >= 5 { (4, 6) } else { (6, 4) };
            expect(
                &format!("jpeg-o{orientation}.jpg"),
                ImageFormat::Jpeg,
                size,
                orientation,
            );
        }
        expect("webp-exif.webp", ImageFormat::Webp, (4, 6), 6);
        expect("tiff-o6.tif", ImageFormat::Tiff, (4, 6), 6);
    }

    #[test]
    fn heic_is_read_from_its_boxes_even_without_a_codec() {
        // A header only: an `ispe` of 6 by 4 and an `irot` of a quarter turn counterclockwise.
        expect("heic-header.heic", ImageFormat::Heic, (4, 6), 8);
    }

    #[test]
    fn svg_sizes_come_from_the_root_element() {
        let found = probe(br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"/>"#);
        assert_eq!(
            found.map(|p| (p.format, p.width, p.height)),
            Ok((ImageFormat::Svg, 30, 20))
        );
    }

    #[test]
    fn other_bytes_are_refused() {
        assert_eq!(probe(b""), Err(ProbeError::Unsupported));
        assert_eq!(probe(b"just some text"), Err(ProbeError::Unsupported));
        assert_eq!(probe(b"\x01\x00\x00\x00 EMF"), Err(ProbeError::Unsupported));
        let png = fixture("png.png");
        assert_eq!(probe(&png[..14]), Err(ProbeError::Malformed(ImageFormat::Png)));
        let jpeg = fixture("jpeg-o6.jpg");
        assert_eq!(probe(&jpeg[..40]), Err(ProbeError::Malformed(ImageFormat::Jpeg)));
    }

    #[test]
    fn media_types_name_their_formats() {
        assert_eq!(ImageFormat::from_mime("image/JPG"), Some(ImageFormat::Jpeg));
        assert_eq!(
            ImageFormat::from_mime("image/svg+xml; charset=utf-8"),
            Some(ImageFormat::Svg)
        );
        assert_eq!(ImageFormat::from_mime("image/x-emf"), None);
        assert!(ImageFormat::Avif.displayable());
        assert!(!ImageFormat::Heic.displayable() && !ImageFormat::Tiff.displayable());
    }

    #[cfg(windows)]
    #[test]
    fn wic_agrees_with_the_header_reader() {
        for name in [
            "png.png",
            "jpeg-o6.jpg",
            "gif.gif",
            "bmp.bmp",
            "webp-lossy.webp",
            "webp-lossless.webp",
            "tiff-o6.tif",
        ] {
            let bytes = fixture(name);
            let raw = header::read(header::sniff(&bytes), &bytes).map(|raw| (raw.width, raw.height));
            assert_eq!(super::super::wic::frame_size(&bytes), raw, "{name}");
        }
    }
}
