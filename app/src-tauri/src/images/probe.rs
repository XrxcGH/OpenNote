//! The header read at import: format, pixel size, and orientation (owner after WP0: WP5).

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
    /// WP5 reads headers through WIC; until then nothing is probed.
    NotImplemented,
}

pub fn probe(bytes: &[u8]) -> Result<Probe, ProbeError> {
    if bytes.is_empty() {
        return Err(ProbeError::Unsupported);
    }
    Err(ProbeError::NotImplemented)
}
