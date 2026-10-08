//! Tests of the SQLite reader: varints, refused files, and overflow chains that loop.

use super::*;

#[test]
fn varints_read_one_to_nine_bytes() {
    assert_eq!(varint(&[0x05], 0).expect("one byte"), (5, 1));
    assert_eq!(varint(&[0x81, 0x00], 0).expect("two bytes"), (128, 2));
    assert_eq!(varint(&[0xff; 9], 0).expect("nine bytes"), (u64::MAX, 9));
    assert!(varint(&[0x81], 0).is_err());
}

#[test]
fn files_that_are_not_databases_are_refused() {
    assert!(Database::from_bytes(b"not a database".to_vec(), None).is_err());
    let mut header = vec![0u8; 4096];
    header[..16].copy_from_slice(MAGIC);
    header[16..18].copy_from_slice(&4096u16.to_be_bytes());
    header[56..60].copy_from_slice(&1u32.to_be_bytes());
    // Page 1 is all zeros, which is not a table page.
    assert!(Database::from_bytes(header, None).is_err());
}

fn put_varint(value: u64) -> Vec<u8> {
    let mut groups = vec![(value & 0x7f) as u8];
    let mut rest = value >> 7;
    while rest > 0 {
        groups.push((rest & 0x7f) as u8 | 0x80);
        rest >>= 7;
    }
    groups.reverse();
    groups
}

/// Two 512-byte pages: page 1 holds one `sqlite_master` row whose payload claims `length` bytes and whose
/// overflow chain starts at page 2, which links to itself.
fn looping_database(length: u64) -> Vec<u8> {
    let mut file = vec![0u8; 1024];
    file[..16].copy_from_slice(MAGIC);
    file[16..18].copy_from_slice(&512u16.to_be_bytes());
    file[56..60].copy_from_slice(&1u32.to_be_bytes());
    file[100] = 0x0d;
    file[103..105].copy_from_slice(&1u16.to_be_bytes());
    file[108..110].copy_from_slice(&200u16.to_be_bytes());
    // The record: a header of 5 bytes that names one blob filling the rest of the payload.
    let blob = put_varint((length - 5) * 2 + 12);
    let mut cell = put_varint(length);
    cell.extend(put_varint(1));
    cell.push(5);
    cell.extend(&blob);
    cell.resize(cell.len() + 39 - 1 - blob.len(), 0);
    cell.extend(2u32.to_be_bytes());
    file[200..200 + cell.len()].copy_from_slice(&cell);
    file[512..516].copy_from_slice(&2u32.to_be_bytes());
    file
}

/// A log with one committed frame for page 2 that claims the database now has `size` pages.
fn log_claiming(size: u32, page: &[u8]) -> Vec<u8> {
    let mut log = Vec::new();
    for word in [0x377f_0682u32, 3_007_000, 512, 0, 7, 9] {
        log.extend(word.to_be_bytes());
    }
    let sums = wal::checksum((0, 0), &log, false);
    log.extend(sums.0.to_be_bytes());
    log.extend(sums.1.to_be_bytes());
    let mut frame = Vec::new();
    for word in [2u32, size, 7, 9] {
        frame.extend(word.to_be_bytes());
    }
    let sums = wal::checksum(wal::checksum(sums, &frame[..8], false), page, false);
    frame.extend(sums.0.to_be_bytes());
    frame.extend(sums.1.to_be_bytes());
    log.extend(frame);
    log.extend(page);
    log
}

#[test]
fn an_overflow_chain_that_loops_stops_at_once_whatever_the_log_claims() {
    // 39 bytes sit on page 1, and 8,000 overflow pages would hold the rest.
    let length = 39 + 508 * 8_000;
    let file = looping_database(length);
    let log = log_claiming(100_000, &file[512..]);
    let database = Database::from_bytes(file, Some(&log));
    assert!(database.is_err(), "the payload is longer than the file and the log");
    let short = looping_database(39 + 508 * 2);
    let log = log_claiming(u32::MAX, &short[512..]);
    assert!(Database::from_bytes(short, Some(&log)).is_err(), "page 2 is used twice");
}
