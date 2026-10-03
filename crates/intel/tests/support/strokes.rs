//! Test helper: draws capital letters as pen strokes, so handwriting tests need no pen or recording.

use opennote_intel::ink::{InkPoint, InkStroke, StrokeKey};

/// A polyline in a letter's own box: x from 0 to about 0.6, y from 0 at the top to 1 at the bottom.
type Polyline = Vec<(f32, f32)>;

/// Rounds a sine or cosine to four decimals. The last bits of `sin` and `cos` differ between the math
/// libraries of Windows and Linux, and the recordings in `tests/fixtures` are matched on the exact points.
fn steady(value: f32) -> f32 {
    ((f64::from(value) * 1e4).round() / 1e4) as f32
}

/// Points on an ellipse arc, angles in degrees with 0 at the right and 90 at the bottom.
fn arc(center: (f32, f32), radii: (f32, f32), from: f32, to: f32) -> Polyline {
    let steps = 24;
    (0..=steps)
        .map(|i| {
            let angle = (from + (to - from) * i as f32 / steps as f32).to_radians();
            (
                center.0 + radii.0 * steady(angle.cos()),
                center.1 + radii.1 * steady(angle.sin()),
            )
        })
        .collect()
}

/// The strokes of one letter, in the order a person would draw them.
fn letter(ch: char) -> Vec<Polyline> {
    match ch {
        'H' => vec![
            vec![(0.0, 0.0), (0.0, 1.0)],
            vec![(0.6, 0.0), (0.6, 1.0)],
            vec![(0.0, 0.5), (0.6, 0.5)],
        ],
        'E' => vec![
            vec![(0.6, 0.0), (0.0, 0.0), (0.0, 1.0), (0.6, 1.0)],
            vec![(0.0, 0.5), (0.45, 0.5)],
        ],
        'L' => vec![vec![(0.0, 0.0), (0.0, 1.0), (0.6, 1.0)]],
        'T' => vec![vec![(0.0, 0.0), (0.6, 0.0)], vec![(0.3, 0.0), (0.3, 1.0)]],
        'N' => vec![vec![(0.0, 1.0), (0.0, 0.0), (0.6, 1.0), (0.6, 0.0)]],
        'O' => vec![arc((0.3, 0.5), (0.3, 0.5), -90.0, 270.0)],
        'P' => {
            let mut bowl = vec![(0.0, 0.0), (0.35, 0.0)];
            bowl.extend(arc((0.35, 0.25), (0.25, 0.25), -90.0, 90.0));
            bowl.push((0.0, 0.5));
            vec![vec![(0.0, 1.0), (0.0, 0.0)], bowl]
        }
        other => panic!("the test pen cannot write {other:?}"),
    }
}

/// Adds points along each segment, about `gap` apart, the way a pen digitizer samples.
fn densify(line: &Polyline, gap: f32) -> Vec<InkPoint> {
    let mut points = vec![InkPoint {
        x: line[0].0,
        y: line[0].1,
    }];
    for pair in line.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        // A square root is exact on every platform, which `hypot` does not promise.
        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
        let length = (dx * dx + dy * dy).sqrt();
        let steps = ((length / gap).ceil() as usize).max(1);
        for i in 1..=steps {
            let t = i as f32 / steps as f32;
            points.push(InkPoint {
                x: a.0 + (b.0 - a.0) * t,
                y: a.1 + (b.1 - a.1) * t,
            });
        }
    }
    points
}

/// Writes `word` with its top left at `origin`, letters `height` tall, and returns its strokes.
/// Keys count up from `first_key`, stored in the first byte.
pub fn write_word(word: &str, origin: (f32, f32), height: f32, first_key: u8) -> Vec<InkStroke> {
    let mut strokes = Vec::new();
    for (index, ch) in word.chars().enumerate() {
        let left = origin.0 + index as f32 * height * 0.9;
        for line in letter(ch) {
            let placed: Polyline = line
                .iter()
                .map(|&(x, y)| (left + x * height, origin.1 + y * height))
                .collect();
            let mut key = [0_u8; 16];
            key[0] = first_key + strokes.len() as u8;
            strokes.push(InkStroke {
                key: StrokeKey(key),
                points: densify(&placed, height / 12.0),
            });
        }
    }
    strokes
}
