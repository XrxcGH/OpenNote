//! Cabinet files, the container of OneNote notebook packages (`.onepkg`).
//!
//! The layout follows Microsoft's published Cabinet format ([MS-CAB]): a CFHEADER, then CFFOLDER records, then
//! CFFILE records, then the CFDATA blocks of each folder. Folders stored as they are and folders compressed with
//! MSZIP are read; other methods (Quantum, LZX) are reported, not decoded. The tests check this reader against
//! cabinets made by the `makecab` tool that comes with Windows (see README.md).
//!
//! MSZIP compresses each block with Deflate, and each block may refer back into the 32 KB before it. A raw
//! Deflate decoder starts with an empty window, so each block is decoded behind a stored Deflate block that
//! holds the previous 32 KB, and that prefix is dropped from the output.

use flate2::{Decompress, FlushDecompress};

use super::bytes::{Damage, Read, Reader};
use super::limits;

/// The reason [`Cabinet::extract`] gives when its `stop` ended it.
pub(crate) const STOPPED: &str = "unpacking was stopped";

/// How a cabinet folder is compressed, from the low 4 bits of `typeCompress`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Method {
    None,
    MsZip,
    /// Quantum or LZX, which this reader does not decode.
    Other(u16),
}

struct Folder {
    start: u32,
    blocks: u16,
    method: Method,
}

/// A file in a cabinet.
#[derive(Debug, Clone)]
pub(crate) struct CabFile {
    /// The name, with `\` between folders as the cabinet stores it.
    pub name: String,
    size: u32,
    offset: u32,
    folder: u16,
}

/// An open cabinet.
pub(crate) struct Cabinet<'a> {
    data: &'a [u8],
    folders: Vec<Folder>,
    data_reserve: usize,
    /// The files, in the order the cabinet lists them.
    pub files: Vec<CabFile>,
}

/// Whether the bytes start like a cabinet file.
pub(crate) fn is_cabinet(data: &[u8]) -> bool {
    data.starts_with(b"MSCF")
}

impl<'a> Cabinet<'a> {
    /// Reads the header, the folders, and the file list.
    pub(crate) fn open(data: &'a [u8]) -> Read<Cabinet<'a>> {
        let mut r = Reader::new(data);
        if r.bytes(4)? != b"MSCF" {
            return Err(Damage::new("it is not a cabinet file"));
        }
        r.u32()?;
        r.u32()?;
        r.u32()?;
        let files_at = r.u32()? as usize;
        r.u32()?;
        r.u16()?;
        let folder_count = usize::from(r.u16()?);
        let file_count = usize::from(r.u16()?);
        let flags = r.u16()?;
        r.u16()?;
        r.u16()?;
        if flags & 0x0003 != 0 {
            return Err(Damage::new("the package is split over several files"));
        }
        let (folder_reserve, data_reserve) = if flags & 0x0004 != 0 {
            let header_reserve = usize::from(r.u16()?);
            let folder = usize::from(r.u8()?);
            let data = usize::from(r.u8()?);
            r.bytes(header_reserve)?;
            (folder, data)
        } else {
            (0, 0)
        };
        if file_count > limits::CAB_FILES {
            return Err(Damage::new("the package holds more files than OpenNote reads"));
        }
        let mut folders = Vec::with_capacity(folder_count.min(1024));
        for _ in 0..folder_count {
            let start = r.u32()?;
            let blocks = r.u16()?;
            let method = match r.u16()? & 0x000F {
                0 => Method::None,
                1 => Method::MsZip,
                other => Method::Other(other),
            };
            r.bytes(folder_reserve)?;
            folders.push(Folder { start, blocks, method });
        }
        let mut r = Reader::new(
            data.get(files_at..)
                .ok_or_else(|| Damage::new("the file list is missing"))?,
        );
        let mut files = Vec::with_capacity(file_count);
        for _ in 0..file_count {
            let size = r.u32()?;
            let offset = r.u32()?;
            let folder = r.u16()?;
            r.u16()?;
            r.u16()?;
            let attributes = r.u16()?;
            let name = name(&mut r, attributes & 0x80 != 0)?;
            files.push(CabFile {
                name,
                size,
                offset,
                folder,
            });
        }
        Ok(Cabinet {
            data,
            folders,
            data_reserve,
            files,
        })
    }

    /// The first compression method of a folder that holds files and that this reader cannot decode.
    pub(crate) fn unreadable_method(&self) -> Option<u16> {
        self.folders.iter().find_map(|f| match f.method {
            Method::Other(m) => Some(m),
            _ => None,
        })
    }

    /// Unpacks every file, folder by folder, and hands each to `each` with its bytes. Stops at the first error,
    /// at [`limits::CAB_BYTES`] bytes in all, and between blocks once `stop` says so.
    pub(crate) fn extract(
        &self,
        stop: &dyn Fn() -> bool,
        mut each: impl FnMut(&CabFile, &[u8]) -> Read<()>,
    ) -> Read<()> {
        let mut total = 0usize;
        for (index, folder) in self.folders.iter().enumerate() {
            let files: Vec<&CabFile> = self.files.iter().filter(|f| usize::from(f.folder) == index).collect();
            let Some(needed) = files
                .iter()
                .map(|f| (f.offset as usize).saturating_add(f.size as usize))
                .max()
            else {
                continue;
            };
            total = total.saturating_add(needed);
            if total > limits::CAB_BYTES {
                return Err(Damage::new("the package unpacks to more than OpenNote reads"));
            }
            let bytes = self.folder_bytes(folder, needed, stop)?;
            for file in files {
                let start = file.offset as usize;
                let end = start.saturating_add(file.size as usize);
                let part = bytes
                    .get(start..end)
                    .ok_or_else(|| Damage::new("a file of the package is cut short"))?;
                each(file, part)?;
            }
        }
        Ok(())
    }

    /// The uncompressed bytes of a folder, up to `needed`.
    fn folder_bytes(&self, folder: &Folder, needed: usize, stop: &dyn Fn() -> bool) -> Read<Vec<u8>> {
        let mut r = Reader::new(
            self.data
                .get(folder.start as usize..)
                .ok_or_else(|| Damage::new("a folder of the package is missing"))?,
        );
        let mut out: Vec<u8> = Vec::new();
        for _ in 0..folder.blocks {
            if out.len() >= needed {
                break;
            }
            if stop() {
                return Err(Damage::new(STOPPED));
            }
            r.u32()?;
            let packed = usize::from(r.u16()?);
            let unpacked = usize::from(r.u16()?);
            r.bytes(self.data_reserve)?;
            let block = r.bytes(packed)?;
            match folder.method {
                Method::None => out.extend_from_slice(block),
                Method::MsZip => {
                    let history = &out[out.len().saturating_sub(32 * 1024)..];
                    let new = inflate(history, block, unpacked)?;
                    out.extend_from_slice(&new);
                }
                Method::Other(m) => return Err(Damage::new(format!("a folder uses compression {m}"))),
            }
        }
        if out.len() < needed {
            return Err(Damage::new("a folder of the package is cut short"));
        }
        Ok(out)
    }
}

/// A file name: UTF-8 when the cabinet says so, otherwise Windows-1252. At most 256 bytes, then a zero byte.
fn name(r: &mut Reader<'_>, utf8: bool) -> Read<String> {
    let mut bytes = Vec::new();
    loop {
        let b = r.u8()?;
        if b == 0 {
            break;
        }
        bytes.push(b);
        if bytes.len() > 256 {
            return Err(Damage::new("a file name of the package is too long"));
        }
    }
    Ok(if utf8 {
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        encoding_rs::WINDOWS_1252.decode(&bytes).0.into_owned()
    })
}

/// Decodes one MSZIP block (`CK` and Deflate data) that may refer back into `history`.
fn inflate(history: &[u8], block: &[u8], unpacked: usize) -> Read<Vec<u8>> {
    let data = block
        .strip_prefix(b"CK")
        .ok_or_else(|| Damage::new("a compressed block has the wrong signature"))?;
    let mut input = Vec::with_capacity(history.len() + data.len() + 5);
    if !history.is_empty() {
        // A stored, not-final Deflate block: one zero byte of header bits, then LEN and NLEN, then the bytes.
        let len = history.len() as u16;
        input.push(0);
        input.extend_from_slice(&len.to_le_bytes());
        input.extend_from_slice(&(!len).to_le_bytes());
        input.extend_from_slice(history);
    }
    input.extend_from_slice(data);
    let mut out = Vec::with_capacity(history.len() + unpacked);
    Decompress::new(false)
        .decompress_vec(&input, &mut out, FlushDecompress::Finish)
        .map_err(|_| Damage::new("a compressed block is damaged"))?;
    if out.len() != history.len() + unpacked {
        return Err(Damage::new("a compressed block has the wrong size"));
    }
    Ok(out.split_off(history.len()))
}
