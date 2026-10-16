//! Property test: after any sequence of edits, a mark still names the moment its character was typed.

use opennote_media::stamps::{Stamp, TextMarks};
use proptest::prelude::*;

#[derive(Clone, Debug)]
enum Op {
    /// Types `length` characters at a position, as a fraction of the text so far.
    Type { at: u16, length: u8 },
    /// Deletes a range, as fractions of the text so far.
    Delete { from: u16, length: u8 },
    /// Replaces a range with new characters.
    Replace { from: u16, deleted: u8, inserted: u8 },
}

fn ops() -> impl Strategy<Value = Vec<Op>> {
    let op = prop_oneof![
        (any::<u16>(), 1..12u8).prop_map(|(at, length)| Op::Type { at, length }),
        (any::<u16>(), 1..12u8).prop_map(|(from, length)| Op::Delete { from, length }),
        (any::<u16>(), 1..8u8, 1..8u8).prop_map(|(from, deleted, inserted)| Op::Replace {
            from,
            deleted,
            inserted
        }),
    ];
    prop::collection::vec(op, 1..60)
}

/// Where in a text of `len` characters a fraction lands.
fn place(fraction: u16, len: usize) -> usize {
    (usize::from(fraction) * (len + 1)) / (usize::from(u16::MAX) + 1)
}

proptest! {
    #[test]
    fn marks_follow_their_characters(ops in ops()) {
        // One entry for each character: the time it was typed, in milliseconds.
        let mut text: Vec<u64> = Vec::new();
        let mut marks = TextMarks::default();
        let mut clock_ms = 10_000u64;
        for op in ops {
            // Edits are more than the merge gap apart, so a mark never spreads over two edits.
            clock_ms += 5_000;
            let stamp = Stamp { recording: "r", capture_ns: clock_ms * 1_000_000 };
            let (at, deleted, inserted) = match op {
                Op::Type { at, length } => (place(at, text.len()), 0, usize::from(length)),
                Op::Delete { from, length } => {
                    let at = place(from, text.len());
                    (at, usize::from(length).min(text.len() - at), 0)
                }
                Op::Replace { from, deleted, inserted } => {
                    let at = place(from, text.len());
                    (at, usize::from(deleted).min(text.len() - at), usize::from(inserted))
                }
            };
            marks.edit(at as u32, deleted as u32, inserted as u32, Some(stamp));
            text.splice(at..at + deleted, std::iter::repeat_n(clock_ms, inserted));

            for (index, typed_ms) in text.iter().enumerate() {
                let found = marks.time_at(index as u32);
                prop_assert_eq!(found, Some(("r", typed_ms * 1_000_000)), "character {}", index);
            }
            prop_assert!(marks.time_at(text.len() as u32).is_none());
            let mut end = 0;
            for mark in &marks.marks {
                prop_assert!(mark.from < mark.to && mark.from >= end, "{:?}", marks.marks);
                end = mark.to;
            }
        }
    }
}
