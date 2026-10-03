//! Tidying handwriting: leveling, spacing, and wrapping, on strokes drawn by `support/strokes.rs`.
//! Runs on every platform, because the geometry is plain Rust.

// The shared test inputs include images, which this file does not use.
#[allow(dead_code)]
#[path = "support/bitmap.rs"]
mod bitmap;
#[allow(dead_code)]
#[path = "support/cases.rs"]
mod cases;
#[path = "support/strokes.rs"]
mod strokes;

use opennote_intel::ink::{InkLine, InkRecognition, InkRecognizer, InkStroke, InkWord};
use opennote_intel::mock::ReplayInk;
use opennote_intel::tidy::{plan, Affine, TidyOperation, TidyPlan};
use opennote_intel::{IntelError, Rect};

/// A recognized word: its text and the strokes that make it.
struct Word {
    text: &'static str,
    strokes: Vec<InkStroke>,
}

fn word(text: &'static str, origin: (f32, f32), height: f32, first_key: u8) -> Word {
    Word {
        text,
        strokes: strokes::write_word(text, origin, height, first_key),
    }
}

fn box_of(strokes: &[InkStroke]) -> Rect {
    let points = || strokes.iter().flat_map(|s| s.points.iter());
    let min = |f: fn(&opennote_intel::ink::InkPoint) -> f32| points().map(f).fold(f32::INFINITY, f32::min);
    let max = |f: fn(&opennote_intel::ink::InkPoint) -> f32| points().map(f).fold(f32::NEG_INFINITY, f32::max);
    let (left, top) = (min(|p| p.x), min(|p| p.y));
    Rect {
        x: left,
        y: top,
        width: max(|p| p.x) - left,
        height: max(|p| p.y) - top,
    }
}

/// The strokes of all the words, and a recognition that groups them into the given lines.
fn writing(lines: Vec<Vec<Word>>) -> (Vec<InkStroke>, InkRecognition) {
    let mut all = Vec::new();
    let mut found = Vec::new();
    for line in lines {
        let mut words = Vec::new();
        for w in line {
            let bounds = box_of(&w.strokes);
            words.push(InkWord {
                text: w.text.to_owned(),
                alternates: vec![],
                strokes: w.strokes.iter().map(|s| s.key).collect(),
                bounds,
            });
            all.extend(w.strokes);
        }
        let bounds = Rect::union_all(words.iter().map(|w| &w.bounds)).unwrap();
        let text = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
        found.push(InkLine { text, bounds, words });
    }
    (all, InkRecognition { lines: found })
}

/// The strokes of one recognized word after a plan.
fn word_box(strokes: &[InkStroke], recognition: &InkRecognition, line: usize, word: usize) -> Rect {
    let keys = &recognition.lines[line].words[word].strokes;
    let own: Vec<InkStroke> = strokes.iter().filter(|s| keys.contains(&s.key)).cloned().collect();
    box_of(&own)
}

fn turned(strokes: &[InkStroke], degrees: f32, about: (f32, f32)) -> Vec<InkStroke> {
    let turn = Affine::rotate_about(degrees.to_radians(), about.0, about.1);
    strokes
        .iter()
        .map(|s| InkStroke {
            key: s.key,
            points: s.points.iter().map(|&p| turn.apply(p)).collect(),
        })
        .collect()
}

fn run(strokes: &[InkStroke], recognition: &InkRecognition, op: TidyOperation) -> (TidyPlan, Vec<InkStroke>) {
    let planned = plan(strokes, recognition, &op).expect("a plan");
    let after = planned.apply(strokes);
    (planned, after)
}

mod straighten {
    use super::*;

    fn slope_degrees(strokes: &[InkStroke], recognition: &InkRecognition) -> f32 {
        let first = word_box(strokes, recognition, 0, 0);
        let last_word = recognition.lines[0].words.len() - 1;
        let last = word_box(strokes, recognition, 0, last_word);
        let rise = last.bottom() - first.bottom();
        let run = last.right() - first.right();
        rise.atan2(run).to_degrees()
    }

    #[test]
    fn a_tilted_line_is_leveled() {
        for tilt in [-9.0, -4.0, 3.0, 6.0, 12.0] {
            let (level, recognition) = writing(vec![vec![
                word("HELLO", (20.0, 40.0), 40.0, 0),
                word("OPEN", (300.0, 40.0), 40.0, 20),
                word("TOP", (520.0, 40.0), 40.0, 40),
            ]]);
            let tilted = turned(&level, tilt, (20.0, 60.0));
            let before = slope_degrees(&tilted, &recognition);
            let (planned, after) = run(&tilted, &recognition, TidyOperation::Straighten);
            let left_over = slope_degrees(&after, &recognition);
            assert!(before.abs() > 2.0, "the setup tilts the line: {before}");
            assert!(
                left_over.abs() < 0.7,
                "tilt {tilt}: {before:.2} degrees became {left_over:.2}"
            );
            assert_eq!(planned.moves.len(), tilted.len(), "every stroke of the line turns");
        }
    }

    #[test]
    fn the_readings_recorded_from_windows_group_strokes_well_enough_to_level_them() {
        let replay = ReplayInk::from_json(include_str!("fixtures/ink.json")).unwrap();
        let case = cases::ink_cases().remove(0);
        let recognition = replay.recognize(&case.strokes, &case.options).unwrap();
        let tilted = turned(&case.strokes, 7.0, (20.0, 60.0));
        let (_, after) = run(&tilted, &recognition, TidyOperation::Straighten);
        assert!(slope_degrees(&tilted, &recognition).abs() > 3.0);
        assert!(slope_degrees(&after, &recognition).abs() < 0.8);
    }

    #[test]
    fn level_writing_is_left_alone() {
        let (level, recognition) = writing(vec![vec![
            word("HELLO", (20.0, 40.0), 40.0, 0),
            word("OPEN", (300.0, 40.0), 40.0, 20),
        ]]);
        let (planned, _) = run(&level, &recognition, TidyOperation::Straighten);
        assert!(planned.moves.is_empty(), "{:?}", planned.moves.len());
        assert_eq!(planned.bounds, None);
    }

    #[test]
    fn each_line_turns_by_its_own_tilt_and_drawings_stay_put() {
        let (level, recognition) = writing(vec![
            vec![
                word("HELLO", (20.0, 40.0), 40.0, 0),
                word("OPEN", (300.0, 40.0), 40.0, 20),
            ],
            vec![
                word("TOP", (20.0, 200.0), 40.0, 40),
                word("NOTE", (300.0, 200.0), 40.0, 60),
            ],
        ]);
        let mut tilted = turned(&level[..level.len() / 2], 5.0, (20.0, 60.0));
        tilted.extend_from_slice(&level[level.len() / 2..]);
        let mut with_drawing = tilted.clone();
        let drawing = strokes::write_word("O", (700.0, 40.0), 40.0, 200);
        with_drawing.extend(drawing.clone());

        let (planned, after) = run(&with_drawing, &recognition, TidyOperation::Straighten);
        let keys: Vec<_> = planned.moves.iter().map(|m| m.key).collect();
        assert!(
            keys.iter().all(|k| !drawing.iter().any(|d| d.key == *k)),
            "the drawing does not move"
        );
        assert!(after.len() == with_drawing.len());
        let second_line_moved = recognition.lines[1]
            .words
            .iter()
            .flat_map(|w| &w.strokes)
            .any(|k| keys.contains(k));
        assert!(!second_line_moved, "the level second line does not move");
    }
}

mod spacing {
    use super::*;

    fn gaps(strokes: &[InkStroke], recognition: &InkRecognition, line: usize) -> Vec<f32> {
        let count = recognition.lines[line].words.len();
        let boxes: Vec<Rect> = (0..count).map(|w| word_box(strokes, recognition, line, w)).collect();
        boxes.windows(2).map(|p| p[1].x - p[0].right()).collect()
    }

    fn uneven() -> (Vec<InkStroke>, InkRecognition) {
        writing(vec![vec![
            word("HELLO", (20.0, 40.0), 40.0, 0),
            word("OPEN", (280.0, 40.0), 40.0, 20),
            word("TOP", (560.0, 40.0), 40.0, 40),
            word("NOTE", (620.0, 40.0), 40.0, 60),
        ]])
    }

    #[test]
    fn gaps_become_alike_and_the_first_word_stays() {
        let (input, recognition) = uneven();
        let before = gaps(&input, &recognition, 0);
        let (_, after) = run(&input, &recognition, TidyOperation::EvenSpacing);
        let now = gaps(&after, &recognition, 0);
        let spread =
            |g: &[f32]| g.iter().copied().fold(f32::MIN, f32::max) - g.iter().copied().fold(f32::MAX, f32::min);
        assert!(spread(&before) > 40.0, "the setup is uneven: {before:?}");
        assert!(spread(&now) < 1.5, "gaps after: {now:?}");
        let first_before = word_box(&input, &recognition, 0, 0);
        let first_after = word_box(&after, &recognition, 0, 0);
        assert!((first_before.x - first_after.x).abs() < 0.5);
        assert!((first_before.bottom() - first_after.bottom()).abs() < 0.5);
    }

    #[test]
    fn words_stay_in_order_and_on_their_baselines() {
        let (input, recognition) = uneven();
        let (_, after) = run(&input, &recognition, TidyOperation::EvenSpacing);
        for w in 0..4 {
            let before = word_box(&input, &recognition, 0, w);
            let now = word_box(&after, &recognition, 0, w);
            assert!(
                (before.bottom() - now.bottom()).abs() < 0.5,
                "word {w} stays on its baseline"
            );
        }
        assert!(
            gaps(&after, &recognition, 0).iter().all(|g| *g > 0.0),
            "no word overlaps the next"
        );
    }

    #[test]
    fn a_word_written_too_big_is_brought_toward_the_others() {
        let (input, recognition) = writing(vec![vec![
            word("HELLO", (20.0, 40.0), 40.0, 0),
            word("OPEN", (300.0, 30.0), 54.0, 20),
            word("NOTE", (560.0, 40.0), 40.0, 40),
        ]]);
        let size = |s: &[InkStroke], w: usize| {
            let b = word_box(s, &recognition, 0, w);
            b.width / recognition.lines[0].words[w].text.len() as f32
        };
        let (_, after) = run(&input, &recognition, TidyOperation::EvenSpacing);
        assert!(
            size(&after, 1) < size(&input, 1) * 0.92,
            "{} to {}",
            size(&input, 1),
            size(&after, 1)
        );
        assert!(
            (size(&after, 0) - size(&input, 0)).abs() < 0.5,
            "the usual words are not rescaled"
        );
        let (before, now) = (
            word_box(&input, &recognition, 0, 1),
            word_box(&after, &recognition, 0, 1),
        );
        assert!(
            (before.bottom() - now.bottom()).abs() < 0.5,
            "the big word keeps its baseline"
        );
    }
}

mod reflow {
    use super::*;

    fn paragraph() -> (Vec<InkStroke>, InkRecognition) {
        writing(vec![
            vec![
                word("HELLO", (20.0, 40.0), 40.0, 0),
                word("OPEN", (260.0, 40.0), 40.0, 20),
            ],
            vec![
                word("NOTE", (20.0, 110.0), 40.0, 40),
                word("TOP", (260.0, 110.0), 40.0, 60),
            ],
            vec![
                word("HELLO", (20.0, 180.0), 40.0, 80),
                word("NOTE", (260.0, 180.0), 40.0, 100),
            ],
        ])
    }

    /// The tops of the words in reading order, grouped into rows, as lists of the left edges.
    fn rows(strokes: &[InkStroke], recognition: &InkRecognition) -> Vec<Vec<Rect>> {
        let mut boxes: Vec<Rect> = Vec::new();
        for (l, line) in recognition.lines.iter().enumerate() {
            for w in 0..line.words.len() {
                boxes.push(word_box(strokes, recognition, l, w));
            }
        }
        let mut rows: Vec<Vec<Rect>> = Vec::new();
        for b in boxes {
            match rows.last_mut() {
                Some(row) if (row[0].y - b.y).abs() < 20.0 => row.push(b),
                _ => rows.push(vec![b]),
            }
        }
        rows
    }

    #[test]
    fn a_narrower_block_wraps_onto_more_lines_within_the_width() {
        let (input, recognition) = paragraph();
        let (_, after) = run(&input, &recognition, TidyOperation::Reflow { width: 300.0 });
        let found = rows(&after, &recognition);
        assert!(found.len() > 3, "{} rows", found.len());
        for row in &found {
            let left = row.first().unwrap().x;
            let right = row.last().unwrap().right();
            assert!(
                right - left <= 300.5 || row.len() == 1,
                "a row is {} wide",
                right - left
            );
            assert!(row.windows(2).all(|p| p[0].right() < p[1].x), "no overlaps in a row");
        }
        let flat: Vec<f32> = found.iter().flatten().map(|b| b.x).collect();
        assert_eq!(flat.len(), 6, "every word is placed");
        assert!(found.windows(2).all(|p| p[0][0].y < p[1][0].y), "rows go down the page");
    }

    #[test]
    fn a_wider_block_pulls_words_up_onto_fewer_lines() {
        let (input, recognition) = paragraph();
        let (_, after) = run(&input, &recognition, TidyOperation::Reflow { width: 3000.0 });
        let found = rows(&after, &recognition);
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].len(), 6);
        let order: Vec<f32> = found[0].iter().map(|b| b.x).collect();
        assert!(order.windows(2).all(|p| p[0] < p[1]), "words stay in reading order");
        assert!((found[0][0].x - 20.0).abs() < 0.5, "the block keeps its left edge");
    }

    #[test]
    fn a_word_wider_than_the_block_gets_a_line_to_itself() {
        let (input, recognition) = paragraph();
        let (_, after) = run(&input, &recognition, TidyOperation::Reflow { width: 50.0 });
        let found = rows(&after, &recognition);
        assert_eq!(found.len(), 6);
        assert!(found.iter().all(|row| row.len() == 1));
    }

    #[test]
    fn a_paragraph_break_stays_a_paragraph_break() {
        let (input, recognition) = writing(vec![
            vec![
                word("HELLO", (20.0, 40.0), 40.0, 0),
                word("OPEN", (260.0, 40.0), 40.0, 20),
            ],
            vec![
                word("NOTE", (20.0, 260.0), 40.0, 40),
                word("TOP", (260.0, 260.0), 40.0, 60),
            ],
        ]);
        let (_, after) = run(&input, &recognition, TidyOperation::Reflow { width: 3000.0 });
        let found = rows(&after, &recognition);
        assert_eq!(found.len(), 2, "the break keeps the paragraphs apart: {found:?}");
        assert!((found[1][0].y - found[0][0].y - 220.0).abs() < 3.0);
    }

    #[test]
    fn a_bad_width_is_refused() {
        let (input, recognition) = paragraph();
        for width in [0.0, -5.0, f32::NAN, f32::INFINITY] {
            let result = plan(&input, &recognition, &TidyOperation::Reflow { width });
            assert!(matches!(result, Err(IntelError::InvalidInput(_))), "{width}");
        }
    }
}

#[test]
fn plans_and_operations_cross_the_wire_as_json() {
    let (input, recognition) = writing(vec![vec![
        word("HELLO", (20.0, 40.0), 40.0, 0),
        word("OPEN", (300.0, 40.0), 40.0, 20),
    ]]);
    let tilted = turned(&input, 6.0, (20.0, 60.0));
    let planned = plan(&tilted, &recognition, &TidyOperation::Straighten).unwrap();
    let json = serde_json::to_string(&planned).unwrap();
    let back: TidyPlan = serde_json::from_str(&json).unwrap();
    assert_eq!(back, planned);
    assert_eq!(
        serde_json::to_value(TidyOperation::Straighten).unwrap(),
        serde_json::json!({"kind": "straighten"})
    );
    assert_eq!(
        serde_json::to_value(TidyOperation::Reflow { width: 250.0 }).unwrap(),
        serde_json::json!({"kind": "reflow", "width": 250.0})
    );
    let parsed: TidyOperation = serde_json::from_str(r#"{"kind": "evenSpacing"}"#).unwrap();
    assert_eq!(parsed, TidyOperation::EvenSpacing);
}

#[test]
fn words_missing_from_the_strokes_and_empty_input_are_skipped() {
    let (input, recognition) = writing(vec![vec![word("HELLO", (20.0, 40.0), 40.0, 0)]]);
    let planned = plan(&[], &recognition, &TidyOperation::Straighten).unwrap();
    assert!(planned.moves.is_empty());
    let planned = plan(
        &input,
        &InkRecognition::default(),
        &TidyOperation::Reflow { width: 100.0 },
    )
    .unwrap();
    assert!(planned.moves.is_empty());
}
