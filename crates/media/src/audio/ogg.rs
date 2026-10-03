//! A small Ogg muxer and page scanner for Opus streams.
//!
//! The muxer writes each page as soon as the caller finishes it, so a crash loses only the page in
//! progress. The scanner finds the last page that is whole and has a correct checksum. Recovery uses
//! it to decide where to cut a file.
//!
//! Every packet here fits in one page. Opus packets are at most 1,275 bytes, far below the limit.

use std::io::{self, Read, Write};

/// Header flag: the first page of a stream.
pub const FLAG_BOS: u8 = 0x02;
/// Header flag: the last page of a stream.
pub const FLAG_EOS: u8 = 0x04;

const CAPTURE_PATTERN: &[u8; 4] = b"OggS";
const HEADER_LEN: usize = 27;
const CRC_OFFSET: usize = 22;
const MAX_SEGMENTS: usize = 255;
/// The longest packet one page can hold: 255 segments of 255 bytes, less the closing segment.
pub const MAX_PACKET: usize = 254 * 255 + 254;

const CRC_TABLE: [u32; 256] = build_crc_table();

/// Ogg's checksum: CRC-32 with polynomial 0x04C11DB7, no reflection, a zero start, and no final xor.
const fn build_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut index = 0;
    while index < 256 {
        let mut value = (index as u32) << 24;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 0x8000_0000 != 0 {
                (value << 1) ^ 0x04C1_1DB7
            } else {
                value << 1
            };
            bit += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
}

fn crc_update(crc: u32, bytes: &[u8]) -> u32 {
    bytes.iter().fold(crc, |crc, &byte| {
        (crc << 8) ^ CRC_TABLE[usize::from((crc >> 24) as u8 ^ byte)]
    })
}

/// The checksum of a whole page, computed as if its own checksum field held zeros.
pub fn page_crc(page: &[u8]) -> u32 {
    let crc = crc_update(0, &page[..CRC_OFFSET]);
    let crc = crc_update(crc, &[0; 4]);
    crc_update(crc, &page[CRC_OFFSET + 4..])
}

/// Writes Ogg pages for one logical stream.
pub struct OggWriter<W: Write> {
    out: W,
    serial: u32,
    sequence: u32,
    lacing: Vec<u8>,
    body: Vec<u8>,
    granule: u64,
}

impl<W: Write> OggWriter<W> {
    pub fn new(out: W, serial: u32) -> Self {
        OggWriter {
            out,
            serial,
            sequence: 0,
            lacing: Vec::new(),
            body: Vec::new(),
            granule: 0,
        }
    }

    /// Continues a stream that an earlier writer left off. The next page gets number `next_sequence`,
    /// and a page with no new packets keeps `granule`.
    pub fn resume(out: W, serial: u32, next_sequence: u32, granule: u64) -> Self {
        OggWriter {
            sequence: next_sequence,
            granule,
            ..OggWriter::new(out, serial)
        }
    }

    /// Adds a packet to the current page. `granule` is the stream position after this packet. A packet
    /// that would overflow the page's 255 segments first closes the page.
    pub fn push_packet(&mut self, packet: &[u8], granule: u64) -> io::Result<()> {
        if packet.len() > MAX_PACKET {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "The packet is too long for one Ogg page.",
            ));
        }
        let segments = packet.len() / 255 + 1;
        if self.lacing.len() + segments > MAX_SEGMENTS {
            self.finish_page(false)?;
        }
        self.lacing.extend(std::iter::repeat_n(255, segments - 1));
        self.lacing.push((packet.len() % 255) as u8);
        self.body.extend_from_slice(packet);
        self.granule = granule;
        Ok(())
    }

    /// Writes the current page to the output, and returns its length in bytes. With no packets waiting,
    /// it writes nothing, unless `end_of_stream` asks for a closing page.
    pub fn finish_page(&mut self, end_of_stream: bool) -> io::Result<usize> {
        if self.lacing.is_empty() && !end_of_stream {
            return Ok(0);
        }
        let mut flags = if self.sequence == 0 { FLAG_BOS } else { 0 };
        if end_of_stream {
            flags |= FLAG_EOS;
        }
        let mut page = Vec::with_capacity(HEADER_LEN + self.lacing.len() + self.body.len());
        page.extend_from_slice(CAPTURE_PATTERN);
        page.extend_from_slice(&[0, flags]);
        page.extend_from_slice(&self.granule.to_le_bytes());
        page.extend_from_slice(&self.serial.to_le_bytes());
        page.extend_from_slice(&self.sequence.to_le_bytes());
        page.extend_from_slice(&[0; 4]);
        page.push(self.lacing.len() as u8);
        page.extend_from_slice(&self.lacing);
        page.extend_from_slice(&self.body);
        let crc = page_crc(&page);
        page[CRC_OFFSET..CRC_OFFSET + 4].copy_from_slice(&crc.to_le_bytes());
        self.out.write_all(&page)?;
        self.sequence += 1;
        self.lacing.clear();
        self.body.clear();
        Ok(page.len())
    }

    /// The output, for flushing it to disk after a page.
    pub fn inner_mut(&mut self) -> &mut W {
        &mut self.out
    }
}

/// Where a valid page sits in a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageInfo {
    pub offset: u64,
    pub len: u64,
    pub flags: u8,
    pub granule: u64,
    pub serial: u32,
    pub sequence: u32,
}

/// The pages at the start of a stream that are whole and correct.
#[derive(Debug, Default)]
pub struct Scan {
    pub pages: Vec<PageInfo>,
    /// Bytes up to the end of the last valid page. Anything after is a torn or damaged tail.
    pub valid_len: u64,
}

/// Reads pages from the start of `reader` until the data ends, a page is cut short, or a page fails
/// its checksum or breaks the page numbering.
pub fn scan_pages<R: Read>(mut reader: R) -> io::Result<Scan> {
    let mut scan = Scan::default();
    while let Some(info) = read_page(&mut reader, scan.valid_len)? {
        if info.sequence as usize != scan.pages.len() {
            break;
        }
        scan.valid_len += info.len;
        scan.pages.push(info);
    }
    Ok(scan)
}

/// Reads one page. `None` means the data ended or is not a
/// valid page.
fn read_page<R: Read>(reader: &mut R, offset: u64) -> io::Result<Option<PageInfo>> {
    let mut header = [0u8; HEADER_LEN];
    if !read_full(reader, &mut header)? || &header[..4] != CAPTURE_PATTERN || header[4] != 0 {
        return Ok(None);
    }
    let mut lacing = vec![0u8; usize::from(header[26])];
    if !read_full(reader, &mut lacing)? {
        return Ok(None);
    }
    let mut body = vec![0u8; lacing.iter().map(|&value| usize::from(value)).sum()];
    if !read_full(reader, &mut body)? {
        return Ok(None);
    }
    let stored = u32::from_le_bytes([header[22], header[23], header[24], header[25]]);
    let mut crc = crc_update(0, &header[..CRC_OFFSET]);
    crc = crc_update(crc, &[0; 4]);
    crc = crc_update(crc, &header[CRC_OFFSET + 4..]);
    crc = crc_update(crc_update(crc, &lacing), &body);
    if crc != stored {
        return Ok(None);
    }
    let granule = u64::from_le_bytes(header[6..14].try_into().expect("eight bytes"));
    let serial = u32::from_le_bytes(header[14..18].try_into().expect("four bytes"));
    let sequence = u32::from_le_bytes(header[18..22].try_into().expect("four bytes"));
    let len = (HEADER_LEN + lacing.len() + body.len()) as u64;
    Ok(Some(PageInfo {
        offset,
        len,
        flags: header[5],
        granule,
        serial,
        sequence,
    }))
}

/// Fills `buffer`, or returns false if the data ends first.
fn read_full<R: Read>(reader: &mut R, buffer: &mut [u8]) -> io::Result<bool> {
    match reader.read_exact(buffer) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn sample_stream() -> Vec<u8> {
        let mut writer = OggWriter::new(Vec::new(), 7);
        writer.push_packet(b"OpusHead-ish", 0).unwrap();
        writer.finish_page(false).unwrap();
        writer.push_packet(&[1; 40], 960).unwrap();
        writer.push_packet(&[2; 600], 1920).unwrap();
        writer.finish_page(false).unwrap();
        writer.push_packet(&[3; 255], 2880).unwrap();
        writer.finish_page(true).unwrap();
        writer.out
    }

    #[test]
    fn the_ogg_crate_reads_what_the_writer_wrote() {
        let data = sample_stream();
        let mut reader = ogg::PacketReader::new(Cursor::new(data));
        let mut packets = Vec::new();
        while let Some(packet) = reader.read_packet().unwrap() {
            packets.push((packet.data.len(), packet.absgp_page(), packet.last_in_stream()));
        }
        assert_eq!(
            packets,
            vec![(12, 0, false), (40, 1920, false), (600, 1920, false), (255, 2880, true)]
        );
    }

    #[test]
    fn the_scanner_reports_each_page() {
        let data = sample_stream();
        let scan = scan_pages(Cursor::new(&data)).unwrap();
        assert_eq!(scan.pages.len(), 3);
        assert_eq!(scan.valid_len, data.len() as u64);
        assert_eq!(scan.pages[0].flags, FLAG_BOS);
        assert_eq!(scan.pages[2].flags, FLAG_EOS);
        assert_eq!(scan.pages[1].granule, 1920);
    }

    #[test]
    fn a_torn_tail_is_left_out() {
        let data = sample_stream();
        let whole = scan_pages(Cursor::new(&data)).unwrap();
        let cut = data.len() - 5;
        let scan = scan_pages(Cursor::new(&data[..cut])).unwrap();
        assert_eq!(scan.pages.len(), 2);
        assert_eq!(scan.valid_len, whole.pages[2].offset);
    }

    #[test]
    fn a_damaged_page_ends_the_valid_part() {
        let mut data = sample_stream();
        let second = scan_pages(Cursor::new(&data)).unwrap().pages[1];
        data[second.offset as usize + 40] ^= 0xFF;
        let scan = scan_pages(Cursor::new(&data)).unwrap();
        assert_eq!(scan.pages.len(), 1);
    }

    #[test]
    fn many_large_packets_spill_into_more_pages() {
        let mut writer = OggWriter::new(Vec::new(), 1);
        for index in 0..50u64 {
            writer.push_packet(&[9; 1275], index * 960).unwrap();
        }
        writer.finish_page(true).unwrap();
        let scan = scan_pages(Cursor::new(&writer.out)).unwrap();
        assert!(scan.pages.len() >= 2, "{} pages", scan.pages.len());
        assert!(writer.push_packet(&[0; MAX_PACKET + 1], 0).is_err());
    }
}
