#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use proptest::prelude::*;

use super::*;
use crate::testing::gen::{arb_points, encode_test_points};

const PRESSURE_AND_TIME: Channels = Channels(Channels::PRESSURE | Channels::TIME);

fn worked_example() -> Vec<Point> {
    let point = |x, y, pressure, t| Point {
        x,
        y,
        pressure,
        t,
        ..Point::default()
    };
    vec![
        point(640, 1_280, 32_768, 0),
        point(672, 1_344, 34_078, 42),
        point(720, 1_440, 36_044, 83),
    ]
}

const WORKED_BYTES: [u8; 20] = [
    0x80, 0x0a, 0x80, 0x14, 0x80, 0x80, 0x02, 0x00, 0x40, 0x80, 0x01, 0xbc, 0x14, 0x2a, 0x60, 0xc0, 0x01, 0xdc, 0x1e,
    0x29,
];

#[test]
fn the_worked_example_of_spec_9_7() {
    let mut out = vec![0xaa];
    let bbox = encode_points(&worked_example(), PRESSURE_AND_TIME, &mut out).unwrap();
    assert_eq!(out[0], 0xaa, "encoding appends");
    assert_eq!(&out[1..], WORKED_BYTES);
    assert_eq!(
        bbox,
        BBox {
            min_x: 640,
            min_y: 1_280,
            max_x: 720,
            max_y: 1_440
        }
    );
    assert_eq!(
        decode_points(&WORKED_BYTES, 3, PRESSURE_AND_TIME).unwrap(),
        worked_example()
    );
    assert!(check_points(&WORKED_BYTES, 3, PRESSURE_AND_TIME, &bbox).is_ok());
}

#[test]
fn every_channel_round_trips_at_its_limits() {
    let points = vec![
        Point {
            x: -(1 << 29),
            y: 1 << 29,
            pressure: 65_535,
            tilt_x: -9_000,
            tilt_y: 9_000,
            t: 9,
        },
        Point {
            x: 1 << 29,
            y: -(1 << 29),
            pressure: 0,
            tilt_x: 9_000,
            tilt_y: -9_000,
            t: u32::MAX,
        },
    ];
    let all = Channels(Channels::ALL);
    let mut out = Vec::new();
    let bbox = encode_points(&points, all, &mut out).unwrap();
    assert_eq!(decode_points(&out, 2, all).unwrap(), points);
    assert!(check_points(&out, 2, all, &bbox).is_ok());
}

#[test]
fn encoding_rejects_bad_points() {
    let mut out = Vec::new();
    assert_eq!(encode_points(&[], Channels(0), &mut out), Err(InkError::PointCount(0)));
    let far = Point {
        x: (1 << 29) + 1,
        ..Point::default()
    };
    assert!(matches!(
        encode_points(&[far], Channels(0), &mut out),
        Err(InkError::OutOfRange { channel: "x", .. })
    ));
    let late = Point {
        t: 10,
        ..Point::default()
    };
    assert!(encode_points(&[late], Channels(Channels::TIME), &mut out).is_err());
    assert!(
        encode_points(&[late], Channels(0), &mut out).is_ok(),
        "absent channels are not written"
    );
    let backward = [
        Point {
            t: 5,
            ..Point::default()
        },
        Point {
            t: 4,
            ..Point::default()
        },
    ];
    assert!(encode_points(&backward, Channels(Channels::TIME), &mut out).is_err());
    let tilted = Point {
        tilt_x: 9_001,
        ..Point::default()
    };
    assert!(encode_points(&[tilted], Channels(Channels::TILT), &mut out).is_err());
}

#[test]
fn decoding_rejects_bad_counts_lengths_and_boxes() {
    let c = PRESSURE_AND_TIME;
    assert_eq!(decode_points(&WORKED_BYTES, 0, c), Err(InkError::PointCount(0)));
    assert_eq!(
        decode_points(&WORKED_BYTES, 200_001, c),
        Err(InkError::PointCount(200_001))
    );
    assert_eq!(decode_points(&WORKED_BYTES, 11, c), Err(InkError::Truncated));
    assert_eq!(decode_points(&WORKED_BYTES[..19], 3, c), Err(InkError::Truncated));
    assert_eq!(decode_points(&WORKED_BYTES, 2, c), Err(InkError::TrailingBytes(6)));
    let wrong_box = BBox::default();
    assert_eq!(
        check_points(&WORKED_BYTES, 3, c, &wrong_box),
        Err(InkError::BoundingBox)
    );
}

#[test]
fn decoding_rejects_bad_varints_and_values_out_of_range() {
    // An overlong varint: 0 written in two bytes.
    assert_eq!(
        decode_points(&[0x80, 0x00, 0x00], 1, Channels(0)),
        Err(InkError::Varint(0))
    );
    // A varint of 6 bytes, and a fifth byte with more than 4 bits.
    assert!(matches!(
        decode_points(&[0x80, 0x80, 0x80, 0x80, 0x80, 0x01, 0x00], 1, Channels(0)),
        Err(InkError::Varint(0))
    ));
    assert!(matches!(
        decode_points(&[0x80, 0x80, 0x80, 0x80, 0x10, 0x00], 1, Channels(0)),
        Err(InkError::Varint(0))
    ));
    // x beyond 2^29: zigzag of 2^29 + 1.
    let mut far = Vec::new();
    put_varint(&mut far, ((1u32 << 29) + 1) * 2);
    far.push(0);
    assert!(matches!(
        decode_points(&far, 1, Channels(0)),
        Err(InkError::OutOfRange { channel: "x", .. })
    ));
    // Point 0's time above 9.
    assert!(matches!(
        decode_points(&[0, 0, 10], 1, Channels(Channels::TIME)),
        Err(InkError::OutOfRange { channel: "time", .. })
    ));
    // Pressure going below 0.
    assert!(matches!(
        decode_points(&[0, 0, 0, 0, 0, 1], 2, Channels(Channels::PRESSURE)),
        Err(InkError::OutOfRange {
            channel: "pressure",
            ..
        })
    ));
}

#[test]
fn the_largest_varint_decodes() {
    let mut out = Vec::new();
    put_varint(&mut out, u32::MAX);
    assert_eq!(out, [0xff, 0xff, 0xff, 0xff, 0x0f]);
    let mut reader = Reader { bytes: &out, pos: 0 };
    assert_eq!(reader.varint(), Ok(u32::MAX));
}

/// The full decoder's verdict on point data, without the quick check in front of it.
fn full_check(bytes: &[u8], count: u32, channels: Channels, bbox: &BBox) -> bool {
    let mut found = EMPTY_BOX;
    check_count(bytes, count).is_ok()
        && walk(bytes, count, channels, |point| grow(&mut found, point)).is_ok()
        && found == *bbox
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The quick check accepts exactly what the full decoder accepts, for valid point data with one byte changed
    /// and with its bounding box moved.
    #[test]
    fn the_quick_check_agrees_with_the_full_decoder(
        (channels, points) in arb_points(64),
        at in any::<usize>(),
        byte in any::<u8>(),
        nudge in 0usize..6,
    ) {
        let mut out = Vec::new();
        let mut bbox = encode_points(&points, channels, &mut out).unwrap();
        let count = points.len() as u32;
        prop_assert!(quick_check(&out, count, channels, &bbox));
        let index = at % out.len();
        out[index] = byte;
        match nudge {
            0 => bbox.min_x = bbox.min_x.wrapping_sub(1),
            1 => bbox.max_y = bbox.max_y.wrapping_add(1),
            _ => {}
        }
        let full = full_check(&out, count, channels, &bbox);
        prop_assert_eq!(check_count(&out, count).is_ok() && quick_check(&out, count, channels, &bbox), full);
        prop_assert_eq!(check_points(&out, count, channels, &bbox).is_ok(), full);
    }

    /// P3, the codec half: decoding what was encoded gives the points, the encoder agrees byte for byte with
    /// the independent encoder of `testing::gen`, and checks pass.
    #[test]
    fn points_round_trip((channels, points) in arb_points(64)) {
        let mut out = Vec::new();
        let bbox = encode_points(&points, channels, &mut out).unwrap();
        let (reference, reference_box) = encode_test_points(&points, channels);
        prop_assert_eq!(&out, &reference);
        prop_assert_eq!(bbox, reference_box);
        let count = points.len() as u32;
        prop_assert_eq!(decode_points(&out, count, channels).unwrap(), points);
        prop_assert!(check_points(&out, count, channels, &bbox).is_ok());
    }

    /// Arbitrary bytes never panic the decoder.
    #[test]
    fn arbitrary_bytes_never_panic(
        bytes in proptest::collection::vec(any::<u8>(), 0..64),
        count in 0u32..40,
        channels in 0u16..8,
    ) {
        let _ = decode_points(&bytes, count, Channels(channels));
        let bbox = BBox::default();
        let checked = check_points(&bytes, count, Channels(channels), &bbox).is_ok();
        prop_assert_eq!(checked, full_check(&bytes, count, Channels(channels), &bbox));
    }
}
