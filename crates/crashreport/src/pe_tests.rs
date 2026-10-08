use super::*;

const GUID: [u8; 16] = [
    0x0C, 0x3F, 0x5F, 0x3E, 0x21, 0x8C, 0xB3, 0x47, 0xB2, 0xC3, 0xB3, 0xF6, 0xF3, 0xE6, 0xF7, 0xE7,
];

/// A minimal PE image in memory: DOS header, PE headers, and a debug directory with one CodeView entry.
fn image(plus: bool, age: u32) -> Vec<u8> {
    let mut bytes = vec![0u8; 0x1000];
    let put32 = |bytes: &mut Vec<u8>, at: usize, value: u32| bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    bytes[..2].copy_from_slice(b"MZ");
    put32(&mut bytes, 0x3C, 0x80);
    let nt = 0x80;
    bytes[nt..nt + 4].copy_from_slice(b"PE\0\0");
    let optional = nt + 24;
    let magic: u16 = if plus { 0x20B } else { 0x10B };
    bytes[optional..optional + 2].copy_from_slice(&magic.to_le_bytes());
    put32(&mut bytes, optional + 56, 0x1000);
    let directories = optional + if plus { 112 } else { 96 };
    put32(&mut bytes, directories + 6 * 8, 0x400);
    put32(&mut bytes, directories + 6 * 8 + 4, 28 * 2);
    // Entry 0 is not CodeView, entry 1 is.
    put32(&mut bytes, 0x400 + 12, 1);
    let entry = 0x400 + 28;
    put32(&mut bytes, entry + 12, 2);
    put32(&mut bytes, entry + 16, 40);
    put32(&mut bytes, entry + 20, 0x600);
    bytes[0x600..0x604].copy_from_slice(b"RSDS");
    bytes[0x604..0x614].copy_from_slice(&GUID);
    put32(&mut bytes, 0x614, age);
    bytes[0x618..0x620].copy_from_slice(b"app.pdb\0");
    bytes
}

fn reader(bytes: Vec<u8>) -> impl Fn(usize, usize) -> Option<Vec<u8>> {
    move |at, length| bytes.get(at..at.checked_add(length)?).map(<[u8]>::to_vec)
}

#[test]
fn reads_the_guid_and_age_in_breakpad_form() {
    for plus in [true, false] {
        let id = debug_id(&reader(image(plus, 0x1A)));
        assert_eq!(id.as_deref(), Some("3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A"), "plus {plus}");
    }
    assert_eq!(
        debug_id(&reader(image(true, 1))).as_deref(),
        Some("3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71")
    );
}

#[test]
fn ids_pass_the_shape_check() {
    assert!(is_debug_id("3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A"));
    assert!(!is_debug_id(""));
    assert!(!is_debug_id("3e5f"));
    assert!(!is_debug_id(&"A".repeat(41)));
    assert!(!is_debug_id(r"C:\Users\jdoe"));
}

#[test]
fn refuses_what_is_not_a_pe_image() {
    assert_eq!(debug_id(&reader(Vec::new())), None);
    assert_eq!(debug_id(&reader(vec![0; 0x1000])), None);
    let mut no_signature = image(true, 1);
    no_signature[0x80] = b'X';
    assert_eq!(debug_id(&reader(no_signature)), None);
    let mut odd_magic = image(true, 1);
    odd_magic[0x80 + 24] = 0x07;
    assert_eq!(debug_id(&reader(odd_magic)), None);
}

#[test]
fn has_no_id_without_a_debug_record() {
    let mut bytes = image(true, 1);
    let directories = 0x80 + 24 + 112;
    bytes[directories + 48..directories + 56].fill(0);
    assert_eq!(debug_id(&reader(bytes)), None);
    let mut not_codeview = image(true, 1);
    not_codeview[0x400 + 28 + 12] = 3;
    assert_eq!(debug_id(&reader(not_codeview)), None);
    let mut other_record = image(true, 1);
    other_record[0x600] = b'N';
    assert_eq!(debug_id(&reader(other_record)), None);
}

#[test]
fn never_reads_outside_the_image() {
    // A directory that claims to lie beyond the image is refused before anything is read there.
    let mut bytes = image(true, 1);
    let directories = 0x80 + 24 + 112;
    bytes[directories + 48..directories + 52].copy_from_slice(&0x0FFF_0000u32.to_le_bytes());
    let reads = std::cell::RefCell::new(Vec::new());
    let inner = reader(bytes);
    let spy = |at: usize, length: usize| {
        reads.borrow_mut().push((at, length));
        inner(at, length)
    };
    assert_eq!(debug_id(&spy), None);
    assert!(
        reads.borrow().iter().all(|&(at, length)| at + length <= 0x1000),
        "{:?}",
        reads.borrow()
    );
    // So is a record whose address is out of range, and a PE offset beyond the allowed limit.
    let mut far_record = image(true, 1);
    far_record[0x400 + 28 + 20..0x400 + 28 + 24].copy_from_slice(&0x2000u32.to_le_bytes());
    assert_eq!(debug_id(&reader(far_record)), None);
    let mut far_nt = image(true, 1);
    far_nt[0x3C..0x40].copy_from_slice(&0x0010_0000u32.to_le_bytes());
    assert_eq!(debug_id(&reader(far_nt)), None);
}

#[test]
fn reads_any_bytes_without_panicking() {
    let mut random = 0x2545_F491_4F6C_DD1Du64;
    for _ in 0..2000 {
        let mut bytes = image(true, 7);
        for _ in 0..8 {
            random ^= random << 13;
            random ^= random >> 7;
            random ^= random << 17;
            let at = (random % 0x700) as usize;
            bytes[at] = (random >> 32) as u8;
        }
        let _ = debug_id(&reader(bytes));
    }
}
