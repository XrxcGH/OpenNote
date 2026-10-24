//! The write-ahead log of a SQLite database: the pages that were committed after the main file was last written.

use std::collections::HashMap;

/// Reads the committed frames of a write-ahead log into `overlay`, and returns the size of the database in pages
/// after the last commit. A log that is damaged, or whose frames belong to an older log, ends the walk.
pub(super) fn read_wal(wal: &[u8], page_size: usize, overlay: &mut HashMap<u32, Vec<u8>>) -> Option<u32> {
    let word = |at: usize| {
        wal.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    let magic = word(0)?;
    if magic != 0x377f_0682 && magic != 0x377f_0683 {
        return None;
    }
    let big_endian = magic & 1 == 1;
    if usize::try_from(word(8)?).ok()? != page_size {
        return None;
    }
    let salt = (word(16)?, word(20)?);
    let mut sums = checksum((0, 0), wal.get(..24)?, big_endian);
    if sums != (word(24)?, word(28)?) {
        return None;
    }
    let mut pending: Vec<(u32, &[u8])> = Vec::new();
    let mut size = None;
    let mut at = 32;
    while let (Some(header), Some(data)) = (wal.get(at..at + 24), wal.get(at + 24..at + 24 + page_size)) {
        let field = |i: usize| u32::from_be_bytes([header[i], header[i + 1], header[i + 2], header[i + 3]]);
        if (field(8), field(12)) != salt {
            break;
        }
        sums = checksum(sums, &header[..8], big_endian);
        sums = checksum(sums, data, big_endian);
        if sums != (field(16), field(20)) {
            break;
        }
        pending.push((field(0), data));
        if field(4) != 0 {
            for (number, image) in pending.drain(..) {
                overlay.insert(number, image.to_vec());
            }
            size = Some(field(4));
        }
        at += 24 + page_size;
    }
    size
}

/// The checksum of SQLite's write-ahead log: two running sums over the words of `bytes`.
pub(super) fn checksum((mut a, mut b): (u32, u32), bytes: &[u8], big_endian: bool) -> (u32, u32) {
    for pair in bytes.as_chunks::<8>().0 {
        let read = |i: usize| {
            let raw = [pair[i], pair[i + 1], pair[i + 2], pair[i + 3]];
            if big_endian {
                u32::from_be_bytes(raw)
            } else {
                u32::from_le_bytes(raw)
            }
        };
        a = a.wrapping_add(read(0)).wrapping_add(b);
        b = b.wrapping_add(read(4)).wrapping_add(a);
    }
    (a, b)
}
