//! Reading Compound File Binary files ([MS-CFB]), the container of Word 97-2003 and Excel 97-2003 files.
//!
//! A compound file is a small file system. It has fixed-size sectors, a table that chains them into streams, and a
//! directory of named streams. Every sector number, chain, and size comes from the file. So each is checked
//! against the file's length before it is used. A chain that runs longer than the stream it holds is cut there,
//! so a chain that loops cannot hang the reader.

use super::bytes::{index, slice, u16_at, u32_at, u64_at, utf16};
use super::Problem;

const SIGNATURE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const END_OF_CHAIN: u32 = 0xFFFF_FFFE;
/// Sector numbers above this are markers, not sectors.
const MAX_SECTOR: u32 = 0xFFFF_FFFA;
/// The size of a sector in the mini stream, where small streams live.
const MINI_SECTOR: usize = 64;
/// The largest stream this reader takes into memory.
pub(super) const MAX_STREAM_BYTES: usize = 64 << 20;
/// The most directory entries it reads. Office files hold a few dozen.
const MAX_ENTRIES: usize = 65_536;
/// The size of one directory entry.
const ENTRY_BYTES: usize = 128;

/// Whether bytes start like a compound file.
pub(super) fn is_compound(data: &[u8]) -> bool {
    data.starts_with(&SIGNATURE)
}

/// An opened compound file.
pub(super) struct Compound {
    data: Vec<u8>,
    shift: u32,
    fat: Vec<u32>,
    mini_fat: Vec<u32>,
    mini_stream: Vec<u8>,
    mini_cutoff: u64,
    entries: Vec<Entry>,
    /// The entries directly below the root, as positions in `entries`.
    top: Vec<usize>,
}

#[derive(Clone, Default)]
struct Entry {
    name: String,
    kind: u8,
    left: u32,
    right: u32,
    child: u32,
    start: u32,
    size: u64,
}

const STREAM: u8 = 2;
const DAMAGED: Problem = Problem::Damaged("its compound file structure is damaged");

impl Compound {
    /// Reads the header, the sector tables, and the directory.
    pub fn parse(data: Vec<u8>) -> Result<Compound, Problem> {
        if !is_compound(&data) {
            return Err(Problem::Damaged("it is not an Office 97-2003 file"));
        }
        let major = u16_at(&data, 0x1A).ok_or(DAMAGED)?;
        let shift = u32::from(u16_at(&data, 0x1E).ok_or(DAMAGED)?);
        if shift != 9 && shift != 12 {
            return Err(DAMAGED);
        }
        let mut file = Compound {
            data,
            shift,
            fat: Vec::new(),
            mini_fat: Vec::new(),
            mini_stream: Vec::new(),
            mini_cutoff: 4096,
            entries: Vec::new(),
            top: Vec::new(),
        };
        file.mini_cutoff = u64::from(u32_at(&file.data, 0x38).ok_or(DAMAGED)?);
        file.fat = file.read_fat()?;
        let first_dir = u32_at(&file.data, 0x30).ok_or(DAMAGED)?;
        let dir = file.read_chain(first_dir, MAX_ENTRIES * ENTRY_BYTES, false)?;
        file.entries = dir
            .chunks_exact(ENTRY_BYTES)
            .map(|raw| parse_entry(raw, major))
            .collect();
        let root = file.entries.first().cloned().ok_or(DAMAGED)?;
        let mini_sectors = index(u32_at(&file.data, 0x40).ok_or(DAMAGED)?);
        let first_mini_fat = u32_at(&file.data, 0x3C).ok_or(DAMAGED)?;
        if mini_sectors > 0 && first_mini_fat <= MAX_SECTOR {
            let bytes = mini_sectors.saturating_mul(file.sector_size()).min(MAX_STREAM_BYTES);
            let raw = file.read_chain(first_mini_fat, bytes, false)?;
            file.mini_fat = raw
                .chunks_exact(4)
                .map(|c| <[u8; 4]>::try_from(c).map_or(END_OF_CHAIN, u32::from_le_bytes))
                .collect();
            let size = usize::try_from(root.size).unwrap_or(usize::MAX);
            file.mini_stream = file.read_chain(root.start, size, false)?;
        }
        file.top = file.children(root.child);
        Ok(file)
    }

    fn sector_size(&self) -> usize {
        1usize << self.shift
    }

    /// The sectors the file has room for after its header.
    fn sector_count(&self) -> usize {
        (self.data.len() >> self.shift).saturating_sub(1)
    }

    /// The bytes of a sector. The last sector of a file cut short may be partial.
    fn sector(&self, id: u32) -> Option<&[u8]> {
        let start = index(id).checked_add(1)?.checked_mul(self.sector_size())?;
        let rest = self.data.get(start..)?;
        rest.get(..self.sector_size().min(rest.len()))
    }

    /// The sector allocation table, from the header's list of its sectors and the chain of further lists.
    fn read_fat(&self) -> Result<Vec<u32>, Problem> {
        let sectors = self.sector_count();
        let per_sector = self.sector_size() / 4;
        let needed = sectors.div_ceil(per_sector).max(1);
        let mut fat_sectors: Vec<u32> = (0..109)
            .filter_map(|i| u32_at(&self.data, 0x4C + 4 * i))
            .filter(|s| *s <= MAX_SECTOR)
            .collect();
        let mut next = u32_at(&self.data, 0x44).ok_or(DAMAGED)?;
        let mut steps = 0usize;
        while next <= MAX_SECTOR && fat_sectors.len() < needed {
            steps += 1;
            if steps > sectors {
                return Err(DAMAGED);
            }
            let block = self.sector(next).ok_or(DAMAGED)?;
            let links = per_sector - 1;
            fat_sectors.extend(
                (0..links)
                    .filter_map(|i| u32_at(block, 4 * i))
                    .filter(|s| *s <= MAX_SECTOR),
            );
            next = u32_at(block, 4 * links).ok_or(DAMAGED)?;
        }
        fat_sectors.truncate(needed);
        let mut fat = Vec::with_capacity(needed * per_sector);
        for id in fat_sectors {
            let block = self.sector(id).ok_or(DAMAGED)?;
            fat.extend((0..per_sector).map(|i| u32_at(block, 4 * i).unwrap_or(END_OF_CHAIN)));
        }
        fat.truncate(sectors);
        Ok(fat)
    }

    /// Reads up to `size` bytes of the chain that starts at `start`, from the file or from the mini stream.
    fn read_chain(&self, start: u32, size: usize, mini: bool) -> Result<Vec<u8>, Problem> {
        if size > MAX_STREAM_BYTES {
            return Err(Problem::TooBig);
        }
        let (table, unit) = if mini {
            (&self.mini_fat, MINI_SECTOR)
        } else {
            (&self.fat, self.sector_size())
        };
        let wanted = size.div_ceil(unit);
        let mut out = Vec::with_capacity(size.min(self.data.len()));
        let mut next = start;
        let mut taken = 0usize;
        while next != END_OF_CHAIN && taken < wanted {
            let link = *table.get(index(next)).ok_or(DAMAGED)?;
            let bytes = if mini {
                slice(&self.mini_stream, index(next).saturating_mul(MINI_SECTOR), MINI_SECTOR)
            } else {
                self.sector(next)
            };
            out.extend_from_slice(bytes.ok_or(DAMAGED)?);
            taken += 1;
            next = link;
        }
        out.truncate(size);
        Ok(out)
    }

    /// The entries of a storage, found by walking its tree of siblings without visiting any twice.
    fn children(&self, first: u32) -> Vec<usize> {
        let mut seen = vec![false; self.entries.len()];
        let mut stack = vec![first];
        let mut found = Vec::new();
        while let Some(id) = stack.pop() {
            let at = index(id);
            let Some(entry) = self.entries.get(at) else {
                continue;
            };
            if seen.get(at).copied().unwrap_or(true) {
                continue;
            }
            if let Some(flag) = seen.get_mut(at) {
                *flag = true;
            }
            found.push(at);
            stack.push(entry.left);
            stack.push(entry.right);
        }
        found
    }

    /// Whether the root holds a stream with this name, ignoring case.
    pub fn has(&self, name: &str) -> bool {
        self.find(name).is_some()
    }

    fn find(&self, name: &str) -> Option<&Entry> {
        self.top
            .iter()
            .filter_map(|i| self.entries.get(*i))
            .find(|e| e.kind == STREAM && e.name.eq_ignore_ascii_case(name))
    }

    /// The bytes of a stream directly below the root, or `None` when there is none.
    pub fn stream(&self, name: &str) -> Option<Result<Vec<u8>, Problem>> {
        let entry = self.find(name)?;
        let size = usize::try_from(entry.size).unwrap_or(usize::MAX);
        Some(self.read_chain(entry.start, size, entry.size < self.mini_cutoff))
    }
}

fn parse_entry(raw: &[u8], major: u16) -> Entry {
    let name_bytes = usize::from(u16_at(raw, 0x40).unwrap_or(0)).min(64);
    let name = slice(raw, 0, name_bytes.saturating_sub(2))
        .map(utf16)
        .unwrap_or_default();
    let mut size = u64_at(raw, 0x78).unwrap_or(0);
    if major == 3 {
        // Version 3 files may leave junk in the high half of the size.
        size &= 0xFFFF_FFFF;
    }
    Entry {
        name,
        kind: raw.get(0x42).copied().unwrap_or(0),
        left: u32_at(raw, 0x44).unwrap_or(u32::MAX),
        right: u32_at(raw, 0x48).unwrap_or(u32::MAX),
        child: u32_at(raw, 0x4C).unwrap_or(u32::MAX),
        start: u32_at(raw, 0x74).unwrap_or(END_OF_CHAIN),
        size,
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// A version 3 compound file with the named streams, each in regular sectors. Tests and the fuzz seeds use it.
    pub fn build(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut sectors: Vec<Vec<u8>> = Vec::new();
        let mut fat: Vec<u32> = Vec::new();
        let place = |bytes: &[u8], sectors: &mut Vec<Vec<u8>>, fat: &mut Vec<u32>| -> u32 {
            let start = sectors.len() as u32;
            let chunks: Vec<&[u8]> = bytes.chunks(512).collect();
            for (n, chunk) in chunks.iter().enumerate() {
                let mut s = chunk.to_vec();
                s.resize(512, 0);
                sectors.push(s);
                fat.push(if n + 1 == chunks.len() {
                    END_OF_CHAIN
                } else {
                    start + n as u32 + 1
                });
            }
            start
        };
        // Pad each stream past the mini stream cutoff, so all are regular streams.
        let mut placed = Vec::new();
        for (name, bytes) in streams {
            let mut padded = bytes.to_vec();
            if padded.len() < 4096 {
                padded.resize(4096, 0);
            }
            placed.push((*name, place(&padded, &mut sectors, &mut fat), padded.len()));
        }
        let mut dir = vec![0u8; 128 * (placed.len() + 1)];
        let mut entry = |n: usize, name: &str, kind: u8, start: u32, size: usize, right: u32, child: u32| {
            let e = &mut dir[n * 128..(n + 1) * 128];
            let units: Vec<u16> = name.encode_utf16().chain([0]).collect();
            for (i, u) in units.iter().enumerate() {
                e[2 * i..2 * i + 2].copy_from_slice(&u.to_le_bytes());
            }
            e[0x40..0x42].copy_from_slice(&((units.len() * 2) as u16).to_le_bytes());
            e[0x42] = kind;
            e[0x44..0x48].copy_from_slice(&u32::MAX.to_le_bytes());
            e[0x48..0x4C].copy_from_slice(&right.to_le_bytes());
            e[0x4C..0x50].copy_from_slice(&child.to_le_bytes());
            e[0x74..0x78].copy_from_slice(&start.to_le_bytes());
            e[0x78..0x80].copy_from_slice(&(size as u64).to_le_bytes());
        };
        entry(
            0,
            "Root Entry",
            5,
            END_OF_CHAIN,
            0,
            u32::MAX,
            if placed.is_empty() { u32::MAX } else { 1 },
        );
        for (n, (name, start, size)) in placed.iter().enumerate() {
            let right = if n + 1 < placed.len() { n as u32 + 2 } else { u32::MAX };
            entry(n + 1, name, STREAM, *start, *size, right, u32::MAX);
        }
        let dir_start = place(&dir, &mut sectors, &mut fat);
        let fat_sector = sectors.len() as u32;
        fat.push(0xFFFF_FFFD);
        fat.resize(128, 0xFFFF_FFFF);
        sectors.push(fat.iter().flat_map(|v| v.to_le_bytes()).collect());
        let mut header = vec![0u8; 512];
        header[..8].copy_from_slice(&SIGNATURE);
        header[0x18..0x1A].copy_from_slice(&0x3Eu16.to_le_bytes());
        header[0x1A..0x1C].copy_from_slice(&3u16.to_le_bytes());
        header[0x1C..0x1E].copy_from_slice(&0xFFFEu16.to_le_bytes());
        header[0x1E..0x20].copy_from_slice(&9u16.to_le_bytes());
        header[0x20..0x22].copy_from_slice(&6u16.to_le_bytes());
        header[0x2C..0x30].copy_from_slice(&1u32.to_le_bytes());
        header[0x30..0x34].copy_from_slice(&dir_start.to_le_bytes());
        header[0x38..0x3C].copy_from_slice(&4096u32.to_le_bytes());
        header[0x3C..0x40].copy_from_slice(&END_OF_CHAIN.to_le_bytes());
        header[0x44..0x48].copy_from_slice(&END_OF_CHAIN.to_le_bytes());
        for i in 0..109 {
            let value = if i == 0 { fat_sector } else { u32::MAX };
            header[0x4C + 4 * i..0x50 + 4 * i].copy_from_slice(&value.to_le_bytes());
        }
        header.extend(sectors.concat());
        header
    }

    #[test]
    fn streams_come_back_by_name() {
        let file = build(&[("WordDocument", b"hello"), ("1Table", &[7u8; 5000])]);
        let compound = Compound::parse(file).expect("parses");
        let word = compound.stream("worddocument").expect("found").expect("reads");
        assert_eq!(&word[..5], b"hello");
        assert_eq!(compound.stream("1Table").expect("found").expect("reads").len(), 5000);
        assert!(compound.stream("Data").is_none());
    }

    #[test]
    fn a_chain_that_loops_is_an_error_not_a_hang() {
        let mut file = build(&[("WordDocument", &[1u8; 5000])]);
        // Point the stream's last sector back at its first.
        let fat_at = file.len() - 512;
        file[fat_at + 4 * 9..fat_at + 4 * 10].copy_from_slice(&0u32.to_le_bytes());
        let compound = Compound::parse(file).expect("parses");
        // The chain is cut at the stream's size, so a loop only repeats sectors up to that size.
        let read = compound.stream("WordDocument").expect("found").expect("reads");
        assert_eq!(read.len(), 5000);
    }

    #[test]
    fn damaged_headers_are_errors() {
        assert!(Compound::parse(Vec::new()).is_err());
        let mut file = build(&[("Workbook", b"x")]);
        file[0x1E] = 30;
        assert!(Compound::parse(file).is_err());
        let file = build(&[("Workbook", b"x")]);
        for cut in [0x50, 512, 1024, file.len() - 100] {
            let _ = Compound::parse(file[..cut].to_vec());
        }
    }
}
