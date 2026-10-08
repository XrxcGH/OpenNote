//! Random access to the audio of one track file.
//!
//! The reader indexes the Ogg pages without reading their bodies, so opening a three-hour file takes
//! about 0.2 seconds. To read frames it finds the page that holds them and checks its checksum.
//! It then decodes from a few packets before the first wanted frame, since Opus needs that lead-in
//! after a seek. A reading position that follows the last one needs no lead-in.
//!
//! Frames are numbered the way the timeline counts them: frame 0 is the first recorded sample, and the
//! decoder's pre-skip is already taken out. The reader can also follow a file that is still growing.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

use super::decoder::{DecoderFactory, FrameDecoder};
use crate::audio::encoder::parse_pre_skip;
use crate::audio::ogg::{page_crc, FLAG_EOS};
use crate::audio::{AudioError, Result, FRAME_SAMPLES};

const HEADER_LEN: usize = 27;
const CRC_OFFSET: usize = 22;
/// The buffer for indexing: about 100 pages of a recording at 32 kbps.
const SCAN_BUFFER: usize = 256 * 1024;
/// Packets decoded and thrown away after a seek, 80 ms as RFC 7845 recommends.
const PRE_ROLL: u64 = 4;
const FRAME: u64 = FRAME_SAMPLES as u64;

/// Where an audio page sits in the file, and which packets it holds.
#[derive(Clone, Copy, Debug)]
struct PageEntry {
    offset: u64,
    len: u32,
    first_packet: u64,
    packets: u32,
}

/// The packets of the page that was read last.
struct CachedPage {
    index: usize,
    body: Vec<u8>,
    packets: Vec<Range<usize>>,
}

pub struct TrackReader {
    file: File,
    decoder: Box<dyn FrameDecoder>,
    pre_skip: u64,
    pages: Vec<PageEntry>,
    pages_seen: u64,
    scan_offset: u64,
    total_packets: u64,
    last_granule: u64,
    ended: bool,
    cache: Option<CachedPage>,
    frame: Vec<f32>,
    decoded: Option<u64>,
    next_packet: u64,
    damaged_packets: u64,
}

impl TrackReader {
    /// Opens a track file only to copy its packets, which needs no decoder.
    pub fn open_packets(path: &Path) -> Result<Self> {
        let none: DecoderFactory = std::sync::Arc::new(|| Ok(Box::new(NoDecoder) as Box<dyn FrameDecoder>));
        Self::open(path, &none)
    }

    /// Opens a track file and indexes its pages.
    pub fn open(path: &Path, decoders: &DecoderFactory) -> Result<Self> {
        let mut reader = TrackReader {
            file: File::open(path)?,
            decoder: decoders()?,
            pre_skip: 0,
            pages: Vec::new(),
            pages_seen: 0,
            scan_offset: 0,
            total_packets: 0,
            last_granule: 0,
            ended: false,
            cache: None,
            frame: vec![0.0; FRAME_SAMPLES],
            decoded: None,
            next_packet: 0,
            damaged_packets: 0,
        };
        reader.refresh()?;
        if reader.pages_seen < 2 {
            return Err(AudioError::Corrupt(format!("{} has no Opus headers.", path.display())));
        }
        Ok(reader)
    }

    /// The frames that can be played now. This grows while the file does.
    pub fn frames(&self) -> u64 {
        self.last_granule.saturating_sub(self.pre_skip)
    }

    /// Whether the file ends with a closing page, so it won't grow.
    pub fn is_complete(&self) -> bool {
        self.ended
    }

    /// The samples at the start of the stream that a decoder skips.
    pub fn pre_skip(&self) -> u32 {
        self.pre_skip as u32
    }

    /// The number of packets in the file, of 960 samples each.
    pub fn packet_count(&self) -> u64 {
        self.total_packets
    }

    /// The bytes of packet `index`, after checking its page's checksum. Editing copies packets this
    /// way, without decoding them.
    pub fn packet(&mut self, index: u64) -> Result<Vec<u8>> {
        let range = self.packet_range(index)?;
        let cache = self.cache.as_ref().expect("the page was just read");
        Ok(cache.body[range].to_vec())
    }

    /// Packets that failed their checksum or could not be decoded, and played as silence.
    pub fn damaged_packets(&self) -> u64 {
        self.damaged_packets
    }

    /// Indexes pages that were written since the last scan. It reads the file through a large buffer
    /// and skips the page bodies, so the whole file costs a few hundred reads, however long it is.
    pub fn refresh(&mut self) -> Result<()> {
        let length = self.file.metadata()?.len();
        let mut reader = BufReader::with_capacity(SCAN_BUFFER, &mut self.file);
        reader.seek(SeekFrom::Start(self.scan_offset))?;
        let mut offset = self.scan_offset;
        while let Some(page) = read_header(&mut reader, offset, length)? {
            let body = (page.len as usize) - page.body_start;
            if self.pages_seen == 0 {
                let mut bytes = vec![0u8; body];
                reader.read_exact(&mut bytes)?;
                let skip = parse_pre_skip(&bytes)
                    .ok_or_else(|| AudioError::Corrupt("The first packet is not an Opus header.".into()))?;
                self.pre_skip = u64::from(skip);
            } else {
                reader.seek_relative(body as i64)?;
            }
            if self.pages_seen >= 2 {
                self.last_granule = page.granule;
                if page.packets > 0 {
                    self.pages.push(PageEntry {
                        offset,
                        len: page.len,
                        first_packet: self.total_packets,
                        packets: page.packets,
                    });
                    self.total_packets += u64::from(page.packets);
                }
            }
            self.pages_seen += 1;
            self.ended |= page.flags & FLAG_EOS != 0;
            offset += u64::from(page.len);
        }
        self.scan_offset = offset;
        Ok(())
    }

    /// Fills `out` with the frames from `frame` on and returns how many it wrote. That is fewer than
    /// `out.len()` only at the end of the track. Damaged audio reads as silence.
    pub fn read(&mut self, frame: u64, out: &mut [f32]) -> Result<usize> {
        let end = self.frames().min(frame.saturating_add(out.len() as u64));
        let mut written = 0;
        while frame + (written as u64) < end {
            let raw = frame + written as u64 + self.pre_skip;
            let (packet, offset) = (raw / FRAME, (raw % FRAME) as usize);
            self.decode(packet)?;
            let wanted = (end - frame) as usize - written;
            let count = wanted.min(FRAME_SAMPLES - offset);
            out[written..written + count].copy_from_slice(&self.frame[offset..offset + count]);
            written += count;
        }
        Ok(written)
    }

    /// Leaves the decoded packet `packet` in `self.frame`.
    fn decode(&mut self, packet: u64) -> Result<()> {
        if self.decoded == Some(packet) {
            return Ok(());
        }
        if packet != self.next_packet {
            self.decoder.reset();
            self.next_packet = packet.saturating_sub(PRE_ROLL);
        }
        while self.next_packet <= packet {
            let current = self.next_packet;
            self.next_packet += 1;
            if current >= self.total_packets {
                // A recovered file can lack its last packet, which is a frame of silence.
                self.frame.fill(0.0);
                continue;
            }
            if let Err(error) = self.decode_one(current) {
                if matches!(error, AudioError::Io(_)) {
                    return Err(error);
                }
                self.damaged_packets += 1;
                self.frame.fill(0.0);
                self.decoder.reset();
            }
        }
        self.decoded = Some(packet);
        Ok(())
    }

    fn decode_one(&mut self, packet: u64) -> Result<()> {
        let range = self.packet_range(packet)?;
        let cache = self.cache.as_ref().expect("the page was just read");
        let samples = self.decoder.decode(&cache.body[range], &mut self.frame)?;
        self.frame[samples..].fill(0.0);
        Ok(())
    }

    /// Reads the page that holds `packet` into the cache, and returns the packet's place in it. A
    /// packet past the end of the file is a frame of silence, as a recovered file can lack its tail.
    fn packet_range(&mut self, packet: u64) -> Result<Range<usize>> {
        let index = self
            .pages
            .partition_point(|page| page.first_packet <= packet)
            .checked_sub(1)
            .filter(|&i| packet < self.pages[i].first_packet + u64::from(self.pages[i].packets))
            .ok_or_else(|| AudioError::Corrupt("The packet is past the end of the file.".into()))?;
        if self.cache.as_ref().is_none_or(|cache| cache.index != index) {
            self.cache = Some(self.load_page(index)?);
        }
        let cache = self.cache.as_ref().expect("the page was just loaded");
        let within = (packet - self.pages[index].first_packet) as usize;
        Ok(cache.packets[within].clone())
    }

    fn load_page(&mut self, index: usize) -> Result<CachedPage> {
        let entry = self.pages[index];
        let mut bytes = vec![0u8; entry.len as usize];
        self.file.seek(SeekFrom::Start(entry.offset))?;
        self.file.read_exact(&mut bytes)?;
        let stored = u32::from_le_bytes(bytes[CRC_OFFSET..CRC_OFFSET + 4].try_into().expect("four bytes"));
        if page_crc(&bytes) != stored {
            return Err(AudioError::Corrupt("A page failed its checksum.".into()));
        }
        let lacing_len = usize::from(bytes[26]);
        let body_start = HEADER_LEN + lacing_len;
        let mut packets = Vec::with_capacity(entry.packets as usize);
        let mut start = 0;
        let mut length = 0;
        for &value in &bytes[HEADER_LEN..body_start] {
            length += usize::from(value);
            if value < 255 {
                packets.push(start..start + length);
                start += length;
                length = 0;
            }
        }
        Ok(CachedPage {
            index,
            body: bytes.split_off(body_start),
            packets,
        })
    }
}

/// Reads one page header and its lacing values from `reader`, which is at `offset`. It gives none if the
/// file ends or the page is torn.
fn read_header(reader: &mut impl Read, offset: u64, length: u64) -> Result<Option<Header>> {
    if offset + HEADER_LEN as u64 > length {
        return Ok(None);
    }
    let mut head = [0u8; HEADER_LEN];
    reader.read_exact(&mut head)?;
    if &head[..4] != b"OggS" || head[4] != 0 {
        return Ok(None);
    }
    let mut lacing = vec![0u8; usize::from(head[26])];
    reader.read_exact(&mut lacing)?;
    let body: u64 = lacing.iter().map(|&value| u64::from(value)).sum();
    let len = HEADER_LEN as u64 + lacing.len() as u64 + body;
    if offset + len > length {
        return Ok(None);
    }
    Ok(Some(Header {
        len: len as u32,
        flags: head[5],
        granule: u64::from_le_bytes(head[6..14].try_into().expect("eight bytes")),
        packets: lacing.iter().filter(|&&value| value < 255).count() as u32,
        body_start: HEADER_LEN + lacing.len(),
    }))
}

struct Header {
    len: u32,
    flags: u8,
    granule: u64,
    packets: u32,
    body_start: usize,
}

/// Stands in for a decoder in a reader that only copies packets.
struct NoDecoder;

impl FrameDecoder for NoDecoder {
    fn decode(&mut self, _packet: &[u8], _out: &mut [f32]) -> Result<usize> {
        Err(AudioError::Format("This reader only copies packets.".into()))
    }

    fn reset(&mut self) {}
}
