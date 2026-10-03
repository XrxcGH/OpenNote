//! Image sizes and orientations read from file headers, without decoding a pixel (Phase 4 ARCHITECTURE.md section
//! 12.2). Windows Imaging Component checks these on Windows (see `wic.rs`); this reader answers for the formats WIC
//! can't open without an optional codec, such as AVIF and HEIC, and on other systems.

use super::probe::ImageFormat;

/// A size as stored in the file, before the orientation is applied, and the EXIF orientation from 1 to 8.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawSize {
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
}

/// The format a file's first bytes announce. SVG is told by its text: an `<svg` element near the start.
pub fn sniff(bytes: &[u8]) -> ImageFormat {
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    if starts(b"\x89PNG\r\n\x1a\n") {
        ImageFormat::Png
    } else if starts(b"\xff\xd8\xff") {
        ImageFormat::Jpeg
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        ImageFormat::Gif
    } else if bytes.len() >= 12 && starts(b"RIFF") && &bytes[8..12] == b"WEBP" {
        ImageFormat::Webp
    } else if starts(b"BM") && bytes.len() >= 26 {
        ImageFormat::Bmp
    } else if starts(b"II*\0") || starts(b"MM\0*") {
        ImageFormat::Tiff
    } else if let Some(format) = isobmff_format(bytes) {
        format
    } else if looks_like_svg(bytes) {
        ImageFormat::Svg
    } else {
        ImageFormat::Other
    }
}

fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(4096)];
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with('<') && text.contains("<svg")
}

/// AVIF and HEIC share the ISO base media file format: an `ftyp` box names the brands.
fn isobmff_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.len() < 16 || &bytes[4..8] != b"ftyp" {
        return None;
    }
    let size = (be32(bytes, 0)? as usize).min(bytes.len());
    let brands: Vec<&[u8]> = std::iter::once(&bytes[8..12])
        .chain(
            bytes
                .get(16..size)
                .unwrap_or_default()
                .as_chunks::<4>()
                .0
                .iter()
                .map(<[u8; 4]>::as_slice),
        )
        .collect();
    let has = |names: &[&[u8]]| brands.iter().any(|brand| names.contains(brand));
    if has(&[b"avif", b"avis"]) {
        Some(ImageFormat::Avif)
    } else if has(&[b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"]) {
        Some(ImageFormat::Heic)
    } else {
        None
    }
}

/// The stored size and orientation of a raster image, or None when the header is cut short or broken.
pub fn read(format: ImageFormat, bytes: &[u8]) -> Option<RawSize> {
    let plain = |(width, height): (u32, u32)| RawSize {
        width,
        height,
        orientation: 1,
    };
    let size = match format {
        ImageFormat::Png => png(bytes),
        ImageFormat::Jpeg => jpeg(bytes),
        ImageFormat::Gif => Some(plain((le16(bytes, 6)?.into(), le16(bytes, 8)?.into()))),
        ImageFormat::Bmp => bmp(bytes).map(plain),
        ImageFormat::Webp => webp(bytes),
        ImageFormat::Tiff => tiff(bytes, true),
        ImageFormat::Avif | ImageFormat::Heic => isobmff(bytes),
        ImageFormat::Svg | ImageFormat::Other => None,
    }?;
    (size.width > 0 && size.height > 0).then_some(size)
}

fn be16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}
fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}
fn le16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}
fn le24(bytes: &[u8], at: usize) -> Option<u32> {
    let b = bytes.get(at..at + 3)?;
    Some(u32::from(b[0]) | (u32::from(b[1]) << 8) | (u32::from(b[2]) << 16))
}
fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// PNG: the IHDR chunk, and the orientation from an `eXIf` chunk before the image data.
fn png(bytes: &[u8]) -> Option<RawSize> {
    if bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let (width, height) = (be32(bytes, 16)?, be32(bytes, 20)?);
    let mut orientation = 1;
    let mut at = 8;
    while let (Some(length), Some(kind)) = (be32(bytes, at), bytes.get(at + 4..at + 8)) {
        let data = at + 8;
        if kind == b"IDAT" || kind == b"IEND" {
            break;
        }
        if kind == b"eXIf" {
            let end = data.checked_add(length as usize)?;
            orientation = bytes.get(data..end).and_then(exif_orientation).unwrap_or(1);
            break;
        }
        at = data.checked_add(length as usize)?.checked_add(4)?;
    }
    Some(RawSize {
        width,
        height,
        orientation,
    })
}

/// JPEG: the start-of-frame segment, and the orientation from the EXIF segment (APP1).
fn jpeg(bytes: &[u8]) -> Option<RawSize> {
    let mut orientation = 1;
    let mut at = 2;
    loop {
        while bytes.get(at) == Some(&0xff) && bytes.get(at + 1) == Some(&0xff) {
            at += 1;
        }
        if *bytes.get(at)? != 0xff {
            return None;
        }
        let marker = *bytes.get(at + 1)?;
        if marker == 0xd8 || (0xd0..=0xd7).contains(&marker) || marker == 0x01 {
            at += 2;
            continue;
        }
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        let length = usize::from(be16(bytes, at + 2)?);
        let body = bytes.get(at + 4..at + 2 + length)?;
        if marker == 0xe1 && body.starts_with(b"Exif\0\0") {
            orientation = exif_orientation(&body[6..]).unwrap_or(orientation);
        }
        // Start-of-frame markers, except DHT (C4), JPG (C8), and DAC (CC), hold the size.
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            return Some(RawSize {
                width: be16(body, 3)?.into(),
                height: be16(body, 1)?.into(),
                orientation,
            });
        }
        at += 2 + length;
    }
}

fn bmp(bytes: &[u8]) -> Option<(u32, u32)> {
    let header = le32(bytes, 14)?;
    if header == 12 {
        return Some((le16(bytes, 18)?.into(), le16(bytes, 20)?.into()));
    }
    let width = le32(bytes, 18)? as i32;
    let height = le32(bytes, 22)? as i32;
    Some((width.unsigned_abs(), height.unsigned_abs()))
}

/// WebP: the first chunk gives the size (VP8, VP8L, or VP8X); an EXIF chunk gives the orientation.
fn webp(bytes: &[u8]) -> Option<RawSize> {
    let kind = bytes.get(12..16)?;
    let plain = |width, height| RawSize {
        width,
        height,
        orientation: 1,
    };
    match kind {
        b"VP8 " => {
            if bytes.get(23..26)? != [0x9d, 0x01, 0x2a] {
                return None;
            }
            Some(plain(
                u32::from(le16(bytes, 26)? & 0x3fff),
                u32::from(le16(bytes, 28)? & 0x3fff),
            ))
        }
        b"VP8L" => {
            if *bytes.get(20)? != 0x2f {
                return None;
            }
            let bits = le32(bytes, 21)?;
            Some(plain((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8X" => {
            let mut size = plain(le24(bytes, 24)? + 1, le24(bytes, 27)? + 1);
            let mut at = 12;
            while let (Some(kind), Some(length)) = (bytes.get(at..at + 4), le32(bytes, at + 4)) {
                let data = at + 8;
                let end = data.checked_add(length as usize)?;
                if kind == b"EXIF" {
                    let exif = bytes.get(data..end.min(bytes.len()))?;
                    let exif = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
                    size.orientation = exif_orientation(exif).unwrap_or(1);
                    break;
                }
                at = end + (length as usize & 1);
            }
            Some(size)
        }
        _ => None,
    }
}

/// A TIFF structure's byte order, and its first directory.
struct Tiff<'a> {
    bytes: &'a [u8],
    little: bool,
}

impl Tiff<'_> {
    fn u16(&self, at: usize) -> Option<u16> {
        if self.little {
            le16(self.bytes, at)
        } else {
            be16(self.bytes, at)
        }
    }
    fn u32(&self, at: usize) -> Option<u32> {
        if self.little {
            le32(self.bytes, at)
        } else {
            be32(self.bytes, at)
        }
    }
    /// The first directory's entries as (tag, value) for SHORT and LONG values.
    fn entries(&self) -> Option<Vec<(u16, u32)>> {
        let ifd = self.u32(4)? as usize;
        let count = usize::from(self.u16(ifd)?).min(512);
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let at = ifd + 2 + i * 12;
            let (tag, kind) = (self.u16(at)?, self.u16(at + 2)?);
            let value = match kind {
                3 => u32::from(self.u16(at + 8)?),
                4 => self.u32(at + 8)?,
                _ => continue,
            };
            out.push((tag, value));
        }
        Some(out)
    }
}

fn tiff_of(bytes: &[u8]) -> Option<Tiff<'_>> {
    let little = match bytes.get(0..4)? {
        b"II*\0" => true,
        b"MM\0*" => false,
        _ => return None,
    };
    Some(Tiff { bytes, little })
}

fn tiff(bytes: &[u8], need_size: bool) -> Option<RawSize> {
    let entries = tiff_of(bytes)?.entries()?;
    let find = |tag: u16| entries.iter().find(|(found, _)| *found == tag).map(|(_, value)| *value);
    let orientation = find(274)
        .and_then(|value| u8::try_from(value).ok())
        .filter(|o| (1..=8).contains(o));
    let (width, height) = if need_size { (find(256)?, find(257)?) } else { (0, 0) };
    Some(RawSize {
        width,
        height,
        orientation: orientation.unwrap_or(1),
    })
}

/// The orientation tag of an EXIF block (a TIFF structure), if it has a valid one.
pub fn exif_orientation(exif: &[u8]) -> Option<u8> {
    tiff(exif, false).map(|size| size.orientation).filter(|o| *o != 1)
}

/// A box of the ISO base media file format: its type and its payload.
fn boxes(bytes: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut at = 0usize;
    std::iter::from_fn(move || {
        let size = be32(bytes, at)? as usize;
        let kind = bytes.get(at + 4..at + 8)?;
        let (header, size) = match size {
            0 => (8, bytes.len() - at),
            1 => (
                16,
                usize::try_from(u64::from(be32(bytes, at + 8)?) << 32 | u64::from(be32(bytes, at + 12)?)).ok()?,
            ),
            size => (8, size),
        };
        let end = at.checked_add(size)?.min(bytes.len());
        let payload = bytes.get(at + header..end)?;
        at = end.max(at + header);
        Some((kind, payload))
    })
}

fn child<'a>(bytes: &'a [u8], kind: &[u8]) -> Option<&'a [u8]> {
    boxes(bytes)
        .find(|(found, _)| *found == kind)
        .map(|(_, payload)| payload)
}

/// AVIF and HEIC: the primary item's `ispe` size, turned by its `irot` and `imir` properties.
fn isobmff(bytes: &[u8]) -> Option<RawSize> {
    let meta = child(bytes, b"meta")?.get(4..)?;
    let primary = child(meta, b"pitm").and_then(|pitm| be16(pitm, 4)).map(u32::from);
    let iprp = child(meta, b"iprp")?;
    let properties: Vec<(&[u8], &[u8])> = boxes(child(iprp, b"ipco")?).collect();
    let ipma = child(iprp, b"ipma")?;
    let (version, flags) = (*ipma.first()?, be32(ipma, 0)? & 0xff_ffff);
    let entries = be32(ipma, 4)?;
    let mut at = 8;
    let mut chosen: Option<Vec<usize>> = None;
    for _ in 0..entries.min(4096) {
        let item = if version < 1 {
            u32::from(be16(ipma, at)?)
        } else {
            be32(ipma, at)?
        };
        at += if version < 1 { 2 } else { 4 };
        let count = usize::from(*ipma.get(at)?);
        at += 1;
        let mut indexes = Vec::with_capacity(count);
        for _ in 0..count {
            let index = if flags & 1 == 1 {
                let value = be16(ipma, at)?;
                at += 2;
                usize::from(value & 0x7fff)
            } else {
                let value = *ipma.get(at)?;
                at += 1;
                usize::from(value & 0x7f)
            };
            indexes.push(index);
        }
        if chosen.is_none() || Some(item) == primary {
            chosen = Some(indexes);
        }
        if Some(item) == primary {
            break;
        }
    }
    let mut size = None;
    let mut matrix = IDENTITY;
    for index in chosen? {
        let Some((kind, payload)) = index.checked_sub(1).and_then(|i| properties.get(i)) else {
            continue;
        };
        match *kind {
            b"ispe" => size = Some((be32(payload, 4)?, be32(payload, 8)?)),
            b"irot" => {
                for _ in 0..(payload.first()? & 3) {
                    matrix = multiply(ROTATE_CCW, matrix);
                }
            }
            b"imir" => matrix = multiply(if payload.first()? & 1 == 0 { FLIP_H } else { FLIP_V }, matrix),
            _ => {}
        }
    }
    let (width, height) = size?;
    Some(RawSize {
        width,
        height,
        orientation: orientation_of(matrix),
    })
}

/// A transform of the plane, with y pointing down, as a 2 by 2 matrix.
type Matrix = [[i8; 2]; 2];
const IDENTITY: Matrix = [[1, 0], [0, 1]];
const FLIP_H: Matrix = [[-1, 0], [0, 1]];
const FLIP_V: Matrix = [[1, 0], [0, -1]];
const ROTATE_CCW: Matrix = [[0, 1], [-1, 0]];

/// The EXIF orientations 1 to 8 as transforms.
const ORIENTATIONS: [Matrix; 8] = [
    IDENTITY,
    FLIP_H,
    [[-1, 0], [0, -1]],
    FLIP_V,
    [[0, 1], [1, 0]],
    [[0, -1], [1, 0]],
    [[0, -1], [-1, 0]],
    ROTATE_CCW,
];

fn multiply(a: Matrix, b: Matrix) -> Matrix {
    let cell = |r: usize, c: usize| a[r][0] * b[0][c] + a[r][1] * b[1][c];
    [[cell(0, 0), cell(0, 1)], [cell(1, 0), cell(1, 1)]]
}

fn orientation_of(matrix: Matrix) -> u8 {
    ORIENTATIONS
        .iter()
        .position(|found| *found == matrix)
        .and_then(|i| u8::try_from(i + 1).ok())
        .unwrap_or(1)
}
