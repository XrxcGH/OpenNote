//! Reading ZIP archives safely: Word files, Notion exports, TextBundles, and Google Takeout.
//!
//! The reader works on any `Read + Seek` source, so a large export is read entry by entry and never sits in
//! memory whole. It reads the central directory (with ZIP64 sizes and offsets), checks every CRC, and caps how
//! much an entry may expand, so a ZIP bomb stops with an error. The method [`ZipArchive::extract`] unpacks an
//! archive into a folder. It refuses names that would leave it, and cleans names that Windows cannot create.

mod names;

use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use flate2::read::DeflateDecoder;

use self::names::safe_target;
use crate::error::{InteropError, Result};
use crate::run::{Control, Phase, Unit};

/// How often extraction reports progress, in bytes unpacked.
const PROGRESS_BYTES: u64 = 8 << 20;

const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_RECORD: u32 = 0x0605_4b50;
const END64_RECORD: u32 = 0x0606_4b50;
const END64_LOCATOR: u32 = 0x0706_4b50;

/// Limits that keep a hostile archive from filling the memory or the disk.
#[derive(Clone, Copy, Debug)]
pub struct ArchiveLimits {
    /// The most bytes one entry may expand to.
    pub entry_bytes: u64,
    /// The most bytes all entries may expand to when they are extracted.
    pub total_bytes: u64,
    /// The most entries an archive may hold.
    pub entries: usize,
}

impl Default for ArchiveLimits {
    fn default() -> ArchiveLimits {
        ArchiveLimits {
            entry_bytes: 2 << 30,
            total_bytes: 4 << 30,
            entries: 500_000,
        }
    }
}

/// One file or folder of an archive.
#[derive(Clone, Debug)]
pub struct ZipEntry {
    /// The path inside the archive, with `/` separators.
    pub name: String,
    /// The size after unpacking.
    pub size: u64,
    /// Whether the entry is a folder.
    pub is_dir: bool,
    /// Whether the entry is a symbolic link, which extraction never follows or creates.
    pub is_link: bool,
    /// When the file was last changed, as the archive records it (without a zone, read as UTC).
    pub modified: Option<std::time::SystemTime>,
    method: u16,
    packed: u64,
    crc: u32,
    offset: u64,
    encrypted: bool,
}

/// An open archive.
pub struct ZipArchive<R> {
    reader: R,
    entries: Vec<ZipEntry>,
    limits: ArchiveLimits,
}

impl ZipArchive<BufReader<File>> {
    /// Opens a `.zip` file.
    pub fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>> {
        let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
        ZipArchive::new(BufReader::new(file), ArchiveLimits::default())
            .map_err(|error| relabel(error, &path.display().to_string()))
    }
}

fn relabel(error: InteropError, what: &str) -> InteropError {
    match error {
        InteropError::Format { detail, .. } => InteropError::format(what, detail),
        other => other,
    }
}

impl<R: Read + Seek> ZipArchive<R> {
    /// Reads the central directory.
    pub fn new(mut reader: R, limits: ArchiveLimits) -> Result<ZipArchive<R>> {
        let entries = read_directory(&mut reader, &limits)?;
        Ok(ZipArchive {
            reader,
            entries,
            limits,
        })
    }

    /// The entries, in the order of the central directory.
    pub fn entries(&self) -> &[ZipEntry] {
        &self.entries
    }

    /// The index of the entry with this exact name, or else one that differs only in case.
    pub fn find(&self, name: &str) -> Option<usize> {
        let exact = self.entries.iter().position(|e| e.name == name);
        exact.or_else(|| self.entries.iter().position(|e| e.name.eq_ignore_ascii_case(name)))
    }

    /// Unpacks an entry into memory, after checking its size and CRC.
    pub fn read(&mut self, index: usize) -> Result<Vec<u8>> {
        let entry = self
            .entries
            .get(index)
            .cloned()
            .ok_or_else(|| InteropError::Missing(format!("archive entry {index}")))?;
        let mut out = Vec::with_capacity(usize::try_from(entry.size.min(1 << 24)).unwrap_or(0));
        self.copy_entry(&entry, &mut out, &mut |_| Ok(()))?;
        Ok(out)
    }

    /// Unpacks an entry by name.
    pub fn read_named(&mut self, name: &str) -> Result<Vec<u8>> {
        let index = self
            .find(name)
            .ok_or_else(|| InteropError::Missing(format!("{name} in the archive")))?;
        self.read(index)
    }

    /// Writes an entry to `out`, checking its size and CRC. Returns the bytes written. `tick` hears how many bytes
    /// each piece wrote, and stops the copy when it fails, such as when the person cancels.
    fn copy_entry(
        &mut self,
        entry: &ZipEntry,
        out: &mut dyn Write,
        tick: &mut dyn FnMut(u64) -> Result<()>,
    ) -> Result<u64> {
        if entry.encrypted {
            return Err(InteropError::unsupported(
                &entry.name,
                "the archive is password protected",
            ));
        }
        if entry.size > self.limits.entry_bytes {
            return Err(InteropError::TooBig(format!("{} in the archive", entry.name)));
        }
        let start = data_start(&mut self.reader, entry.offset, &entry.name)?;
        self.reader
            .seek(SeekFrom::Start(start))
            .map_err(|e| InteropError::format(&entry.name, e.to_string()))?;
        let packed = (&mut self.reader).take(entry.packed);
        let mut source: Box<dyn Read + '_> = match entry.method {
            0 => Box::new(packed),
            8 => Box::new(DeflateDecoder::new(packed)),
            other => {
                return Err(InteropError::unsupported(
                    &entry.name,
                    format!("the archive uses compression method {other}"),
                ))
            }
        };
        // One byte more than the entry claims shows when the data is bigger than the directory said.
        let mut limited = (&mut source).take(entry.size.saturating_add(1));
        let mut hasher = crc32fast::Hasher::new();
        let mut written = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let n = limited
                .read(&mut buffer)
                .map_err(|e| InteropError::format(&entry.name, e.to_string()))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
            out.write_all(&buffer[..n])
                .map_err(|e| InteropError::format(&entry.name, e.to_string()))?;
            written += n as u64;
            tick(n as u64)?;
        }
        if written != entry.size || hasher.finalize() != entry.crc {
            return Err(InteropError::format(
                &entry.name,
                "the data does not match the archive's checks",
            ));
        }
        Ok(written)
    }

    /// The name of the one folder that holds every entry, if there is such a folder. Archives made by dragging
    /// a folder into a zip tool have one, and `__MACOSX` metadata beside it does not count.
    pub fn common_root(&self) -> Option<String> {
        let mut root: Option<&str> = None;
        for entry in self.entries.iter().filter(|e| !e.name.starts_with("__MACOSX/")) {
            let (first, rest) = entry.name.split_once('/')?;
            if rest.is_empty() && !entry.is_dir {
                return None;
            }
            match root {
                None => root = Some(first),
                Some(seen) if seen == first => {}
                Some(_) => return None,
            }
        }
        root.map(str::to_owned)
    }

    /// Unpacks the whole archive into `dir`, and returns the paths written. With `strip_root`, the folder that
    /// [`ZipArchive::common_root`] names is left out of the paths. Entries whose names would leave `dir`,
    /// links, and entries that cannot be read or created are listed in `skipped` with the reason.
    ///
    /// `control` hears the bytes unpacked so far, and its Cancel stops the work between entries and inside one.
    pub fn extract(
        &mut self,
        dir: &Path,
        strip_root: bool,
        skipped: &mut Vec<(String, String)>,
        control: &Control,
    ) -> Result<Vec<PathBuf>> {
        let mut written = Vec::new();
        let mut total = 0u64;
        let root = if strip_root { self.common_root() } else { None };
        let declared = self.entries.iter().fold(0u64, |sum, e| sum.saturating_add(e.size));
        control.begin(
            Phase::Scanning,
            Unit::Bytes,
            Some(declared.min(self.limits.total_bytes)),
        );
        let mut unpacked = Unpacked::default();
        for index in 0..self.entries.len() {
            control.checkpoint()?;
            let Some((entry, target)) = self.target(index, root.as_deref(), dir, skipped) else {
                continue;
            };
            total = total.saturating_add(entry.size);
            if total > self.limits.total_bytes {
                return Err(InteropError::TooBig("the archive when unpacked".to_owned()));
            }
            if self.unpack(&entry, &target, skipped, &mut |n| unpacked.add(n, control))? {
                written.push(target);
            }
        }
        Ok(written)
    }

    /// The entry at `index` with `root/` taken off its name, and the path it unpacks to. A folder, a link, and an
    /// entry whose name leaves `dir` give `None`, and the last two are listed in `skipped`.
    fn target(
        &self,
        index: usize,
        root: Option<&str>,
        dir: &Path,
        skipped: &mut Vec<(String, String)>,
    ) -> Option<(ZipEntry, PathBuf)> {
        let mut entry = self.entries.get(index)?.clone();
        if entry.is_dir || entry.name.starts_with("__MACOSX/") {
            return None;
        }
        if let Some(stripped) = root.and_then(|root| entry.name.strip_prefix(&format!("{root}/"))) {
            entry.name = stripped.to_owned();
        }
        if entry.is_link {
            skipped.push((entry.name, "It is a link, and imports do not follow links.".to_owned()));
            return None;
        }
        match safe_target(dir, &entry.name) {
            Some(target) => Some((entry, target)),
            None => {
                skipped.push((entry.name, "Its name points outside the folder.".to_owned()));
                None
            }
        }
    }

    /// Writes one entry to `target`. Returns whether it was written: an entry that cannot be created or read is
    /// listed in `skipped` instead. Cancel and other failures of the whole job are errors.
    fn unpack(
        &mut self,
        entry: &ZipEntry,
        target: &Path,
        skipped: &mut Vec<(String, String)>,
        tick: &mut dyn FnMut(u64) -> Result<()>,
    ) -> Result<bool> {
        let created = target
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| File::create(target));
        let file = match created {
            Ok(file) => file,
            Err(error) => {
                skipped.push((entry.name.clone(), format!("It could not be unpacked: {error}.")));
                return Ok(false);
            }
        };
        let mut buffered = std::io::BufWriter::new(file);
        match self
            .copy_entry(entry, &mut buffered, tick)
            .and_then(|_| buffered.flush().map_err(|e| InteropError::io(target, e)))
        {
            Ok(()) => Ok(true),
            Err(error @ (InteropError::Format { .. } | InteropError::Unsupported { .. })) => {
                drop(buffered);
                let _ = fs::remove_file(target);
                skipped.push((entry.name.clone(), error.to_string()));
                Ok(false)
            }
            Err(other) => Err(other),
        }
    }
}

/// The bytes an extraction has unpacked, and how many of them it last reported.
#[derive(Default)]
struct Unpacked {
    done: u64,
    reported: u64,
}

impl Unpacked {
    /// Counts `n` more bytes, stops on Cancel, and reports progress every [`PROGRESS_BYTES`].
    fn add(&mut self, n: u64, control: &Control) -> Result<()> {
        control.checkpoint()?;
        self.done = self.done.saturating_add(n);
        if self.done - self.reported >= PROGRESS_BYTES {
            self.reported = self.done;
            control.set_done(Phase::Scanning, self.done, "");
        }
        Ok(())
    }
}

fn le16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le64(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(bytes.get(at..at + 8)?.try_into().ok()?))
}

fn bad(detail: &str) -> InteropError {
    InteropError::format("the archive", detail)
}

fn read_directory<R: Read + Seek>(reader: &mut R, limits: &ArchiveLimits) -> Result<Vec<ZipEntry>> {
    let length = reader.seek(SeekFrom::End(0)).map_err(|e| bad(&e.to_string()))?;
    let tail_len = length.min(66_000);
    reader
        .seek(SeekFrom::Start(length - tail_len))
        .map_err(|e| bad(&e.to_string()))?;
    let mut tail = vec![0u8; usize::try_from(tail_len).unwrap_or(0)];
    reader.read_exact(&mut tail).map_err(|e| bad(&e.to_string()))?;
    let end = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&at| le32(&tail, at) == Some(END_RECORD))
        .ok_or_else(|| bad("it is not a ZIP file"))?;
    let mut count = u64::from(le16(&tail, end + 10).ok_or_else(|| bad("the end record is cut short"))?);
    let mut size = u64::from(le32(&tail, end + 12).ok_or_else(|| bad("the end record is cut short"))?);
    let mut offset = u64::from(le32(&tail, end + 16).ok_or_else(|| bad("the end record is cut short"))?);
    let needs_64 = count == 0xffff || size == 0xffff_ffff || offset == 0xffff_ffff;
    if needs_64 && end >= 20 && le32(&tail, end - 20) == Some(END64_LOCATOR) {
        let end64 = le64(&tail, end - 20 + 8).ok_or_else(|| bad("the ZIP64 locator is cut short"))?;
        let mut record = [0u8; 56];
        reader.seek(SeekFrom::Start(end64)).map_err(|e| bad(&e.to_string()))?;
        reader.read_exact(&mut record).map_err(|e| bad(&e.to_string()))?;
        if le32(&record, 0) != Some(END64_RECORD) {
            return Err(bad("the ZIP64 end record is missing"));
        }
        count = le64(&record, 32).unwrap_or(count);
        size = le64(&record, 40).unwrap_or(size);
        offset = le64(&record, 48).unwrap_or(offset);
    }
    if usize::try_from(count).map_or(true, |c| c > limits.entries) {
        return Err(InteropError::TooBig("the archive's list of files".to_owned()));
    }
    if size > (256 << 20) || offset.saturating_add(size) > length {
        return Err(bad("the list of files is damaged"));
    }
    reader.seek(SeekFrom::Start(offset)).map_err(|e| bad(&e.to_string()))?;
    let mut directory = vec![0u8; usize::try_from(size).unwrap_or(0)];
    reader.read_exact(&mut directory).map_err(|e| bad(&e.to_string()))?;
    parse_entries(&directory, count)
}

fn parse_entries(directory: &[u8], count: u64) -> Result<Vec<ZipEntry>> {
    let mut entries = Vec::new();
    let mut at = 0usize;
    for _ in 0..count {
        if le32(directory, at) != Some(CENTRAL_HEADER) {
            return Err(bad("the list of files is damaged"));
        }
        let field = |offset: usize| le32(directory, at + offset).ok_or_else(|| bad("the list of files is cut short"));
        let half = |offset: usize| le16(directory, at + offset).ok_or_else(|| bad("the list of files is cut short"));
        let flags = half(8)?;
        let (method, crc) = (half(10)?, field(16)?);
        let modified = dos_to_system_time(half(14)?, half(12)?);
        let (mut packed, mut size, mut offset) = (u64::from(field(20)?), u64::from(field(24)?), u64::from(field(42)?));
        let (name_len, extra_len, comment_len) =
            (usize::from(half(28)?), usize::from(half(30)?), usize::from(half(32)?));
        let attributes = field(38)?;
        let name_bytes = directory
            .get(at + 46..at + 46 + name_len)
            .ok_or_else(|| bad("a name is cut short"))?;
        let extra = directory
            .get(at + 46 + name_len..at + 46 + name_len + extra_len)
            .ok_or_else(|| bad("an extra field is cut short"))?;
        if size == 0xffff_ffff || packed == 0xffff_ffff || offset == 0xffff_ffff {
            read_zip64_extra(extra, &mut size, &mut packed, &mut offset);
        }
        let name = decode_name(name_bytes, flags & 0x0800 != 0).replace('\\', "/");
        let unix_mode = attributes >> 16;
        entries.push(ZipEntry {
            is_dir: name.ends_with('/'),
            is_link: unix_mode & 0o170_000 == 0o120_000,
            modified,
            name,
            size,
            method,
            packed,
            crc,
            offset,
            encrypted: flags & 1 != 0,
        });
        at += 46 + name_len + extra_len + comment_len;
    }
    Ok(entries)
}

/// Reads the date and time that ZIP stores in the old DOS form. A date before 1980 or a bad date gives `None`.
fn dos_to_system_time(date: u16, time: u16) -> Option<std::time::SystemTime> {
    let (year, month, day) = (
        1980 + i64::from(date >> 9),
        i64::from((date >> 5) & 0xf),
        i64::from(date & 0x1f),
    );
    let (hour, minute, second) = (
        i64::from(time >> 11),
        i64::from((time >> 5) & 0x3f),
        i64::from(time & 0x1f) * 2,
    );
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    // Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let seconds = u64::try_from(days * 86_400 + hour * 3_600 + minute * 60 + second).ok()?;
    Some(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
}

/// Fills in the 64-bit sizes and offset, in the order the ZIP64 extra field stores them.
fn read_zip64_extra(extra: &[u8], size: &mut u64, packed: &mut u64, offset: &mut u64) {
    let mut at = 0;
    while at + 4 <= extra.len() {
        let (id, len) = (
            le16(extra, at).unwrap_or(0),
            usize::from(le16(extra, at + 2).unwrap_or(0)),
        );
        if id == 1 {
            let mut cursor = at + 4;
            for slot in [&mut *size, &mut *packed, &mut *offset] {
                if *slot == 0xffff_ffff {
                    if let Some(value) = le64(extra, cursor) {
                        *slot = value;
                        cursor += 8;
                    }
                }
            }
            return;
        }
        at += 4 + len;
    }
}

/// Names are UTF-8 when the flag says so. Otherwise they are in the old DOS code page, and a name that is
/// not valid UTF-8 is read as Windows-1252, which keeps accented letters readable.
fn decode_name(bytes: &[u8], utf8: bool) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) if utf8 => String::from_utf8_lossy(bytes).into_owned(),
        Err(_) => encoding_rs::WINDOWS_1252.decode(bytes).0.into_owned(),
    }
}

/// Where the data of an entry starts: after its local header. The header can differ in length
/// from the central directory's.
fn data_start<R: Read + Seek>(reader: &mut R, offset: u64, name: &str) -> Result<u64> {
    let mut header = [0u8; 30];
    reader
        .seek(SeekFrom::Start(offset))
        .and_then(|_| reader.read_exact(&mut header))
        .map_err(|e| InteropError::format(name, e.to_string()))?;
    if le32(&header, 0) != Some(LOCAL_HEADER) {
        return Err(InteropError::format(name, "its header is damaged"));
    }
    let name_len = u64::from(le16(&header, 26).unwrap_or(0));
    let extra_len = u64::from(le16(&header, 28).unwrap_or(0));
    Ok(offset + 30 + name_len + extra_len)
}

#[cfg(test)]
mod tests;
