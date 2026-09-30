use super::*;
use crate::time::{TestClock, Timestamp};

/// IDs and bytes from spec Appendix B.2.
const VECTORS: [(&str, [u8; 16]); 4] = [
    (
        "01m3sa8yempcnn2qgrtvppsafr",
        [
            0x01, 0xa0, 0xf2, 0xa4, 0x79, 0xd4, 0xb3, 0x2b, 0x51, 0x5e, 0x18, 0xd6, 0xed, 0x6c, 0xa9, 0xf8,
        ],
    ),
    (
        "01m3sa12426sg32pmtyffjaqcf",
        [
            0x01, 0xa0, 0xf2, 0xa0, 0x88, 0x82, 0x36, 0x60, 0x31, 0x5a, 0x9a, 0xf3, 0xdf, 0x25, 0x5d, 0x8f,
        ],
    ),
    (
        "01m3sa8wb93eknedj0qexh7af2",
        [
            0x01, 0xa0, 0xf2, 0xa4, 0x71, 0x69, 0x1b, 0xa7, 0x57, 0x36, 0x40, 0xbb, 0xbb, 0x13, 0xa9, 0xe2,
        ],
    ),
    (
        "01m3sa1242ayy4avvsz3yx5gxj",
        [
            0x01, 0xa0, 0xf2, 0xa0, 0x88, 0x82, 0x57, 0xbc, 0x45, 0x6f, 0x79, 0xf8, 0xfd, 0xd2, 0xc3, 0xb2,
        ],
    ),
];

#[test]
fn parses_and_prints_the_spec_vectors() {
    for (text, bytes) in VECTORS {
        let id = Id::parse(text).unwrap();
        assert_eq!(id.as_bytes(), &bytes, "{text}");
        assert_eq!(id.to_string(), text);
        assert_eq!(Id::from_bytes(bytes), id);
    }
}

#[test]
fn accepts_uppercase_and_stores_lowercase() {
    let id = Id::parse("01M3SA8YEMPCNN2QGRTVPPSAFR").unwrap();
    assert_eq!(id.to_string(), "01m3sa8yempcnn2qgrtvppsafr");
}

#[test]
fn rejects_letters_outside_the_alphabet() {
    for (index, letter) in [(25, 'i'), (3, 'l'), (10, 'o'), (20, 'u'), (5, '-'), (7, ' ')] {
        let mut text: Vec<char> = "01m3sa8yempcnn2qgrtvppsafr".chars().collect();
        text[index] = letter;
        let text: String = text.into_iter().collect();
        assert_eq!(Id::parse(&text), Err(IdError::Character { index }), "{text}");
    }
    assert!(Id::parse("01m3sa8yempcnn2qgrtvppsaé").is_err());
}

#[test]
fn rejects_other_lengths_and_overflow() {
    assert_eq!(Id::parse(""), Err(IdError::Length(0)));
    assert_eq!(Id::parse("01m3sa8yempcnn2qgrtvppsaf"), Err(IdError::Length(25)));
    assert_eq!(Id::parse("01m3sa8yempcnn2qgrtvppsafrr"), Err(IdError::Length(27)));
    assert_eq!(Id::parse("81m3sa8yempcnn2qgrtvppsafr"), Err(IdError::Overflow));
    assert_eq!(Id::parse("7zzzzzzzzzzzzzzzzzzzzzzzzz").unwrap().as_bytes(), &[0xff; 16]);
    assert_eq!(Id::parse("00000000000000000000000000").unwrap(), Id::ZERO);
}

#[test]
fn text_order_matches_byte_order() {
    let mut ids: Vec<Id> = VECTORS.iter().map(|(text, _)| Id::parse(text).unwrap()).collect();
    ids.sort();
    let texts: Vec<String> = ids.iter().map(Id::to_string).collect();
    let mut sorted = texts.clone();
    sorted.sort();
    assert_eq!(texts, sorted);
}

#[test]
fn generated_ids_carry_the_clock_time_and_differ() {
    let clock = TestClock::new(Timestamp::from_unix_ms(1_790_777_260_500));
    let a = Id::generate(&clock);
    let b = Id::generate(&clock);
    assert_eq!(a.time_ms(), 1_790_777_260_500);
    assert_ne!(a, b);
    assert_eq!(Id::parse(&a.to_string()).unwrap(), a);
}

#[test]
fn from_parts_keeps_time_and_low_random_bits() {
    let id = Id::from_parts(1_790_777_260_500, u128::MAX);
    assert_eq!(id.time_ms(), 1_790_777_260_500);
    assert_eq!(&id.as_bytes()[6..], &[0xff; 10]);
    assert_eq!(Id::from_parts(u64::MAX, 0).time_ms(), (1 << 48) - 1);
}

#[test]
fn typed_ids_serialize_as_text() {
    let page = PageId::parse("01m3sa12426sg32pmtyffjaqcf").unwrap();
    assert_eq!(serde_json::to_string(&page).unwrap(), "\"01m3sa12426sg32pmtyffjaqcf\"");
    let back: PageId = serde_json::from_str("\"01M3SA12426SG32PMTYFFJAQCF\"").unwrap();
    assert_eq!(back, page);
    assert!(serde_json::from_str::<PageId>("\"not an id\"").is_err());
    assert_eq!(format!("{page:?}"), "PageId(01m3sa12426sg32pmtyffjaqcf)");
}

#[test]
fn client_ids_follow_their_rule() {
    assert_eq!(ClientId::parse("main-1").unwrap().as_str(), "main-1");
    assert!(ClientId::parse(&"a".repeat(32)).is_ok());
    for bad in ["", "Main", "main_1", "main 1", "é", &"a".repeat(33)] {
        assert_eq!(ClientId::parse(bad), Err(IdError::Client), "{bad:?}");
    }
    let parsed: ClientId = serde_json::from_str("\"win-2\"").unwrap();
    assert_eq!(parsed.to_string(), "win-2");
    assert!(serde_json::from_str::<ClientId>("\"WIN\"").is_err());
}
