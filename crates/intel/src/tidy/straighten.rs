//! Levels each line of handwriting by finding the turn that makes its ink rows the sharpest.
//!
//! Writing sits in bands: the tops of capitals and the baseline pile up in a few rows. Turn the line the
//! right way and those bands become tall and thin, so the histogram of the points' heights gets
//! peaky. The turn with the peakiest histogram is the one that levels the line. This needs no
//! knowledge of the letters, and it works on one word.

use super::affine::Affine;
use super::model::{median, LineShape};
use super::Moves;
use crate::ink::InkStroke;

/// The largest tilt the search considers, in degrees.
const MAX_TILT_DEGREES: f32 = 15.0;
/// How finely the search steps, in degrees.
const STEP_DEGREES: f32 = 0.25;
/// A correction smaller than this is not worth a change, in degrees.
const MIN_CORRECTION_DEGREES: f32 = 0.4;
/// The leveled histogram must be this much peakier than the original, or the line is left alone.
const MIN_IMPROVEMENT: f32 = 1.03;
/// A line with fewer points than this gives no reliable answer.
const MIN_POINTS: usize = 12;
/// At most this many points are examined, spread evenly over the line.
const MAX_POINTS: usize = 4000;
/// The histogram never has more bins than this. A very wide, flat line gets wider bins instead of a
/// histogram the size of its width.
const MAX_BINS: usize = 4096;

/// Adds a leveling turn to every line that is visibly tilted.
pub(super) fn straighten(strokes: &[InkStroke], lines: &[LineShape], moves: &mut Moves) {
    for line in lines {
        let indexes: Vec<usize> = line.words.iter().flat_map(|w| w.strokes.iter().copied()).collect();
        let bounds = line.bounds();
        let word_height = median(line.words.iter().map(|w| w.bounds.height).collect());
        if word_height <= 0.0 || bounds.width < 1.2 * word_height {
            continue;
        }
        let points = sample_points(strokes, &indexes);
        if points.len() < MIN_POINTS {
            continue;
        }
        let Some(turn) = best_turn(&points, word_height / 10.0) else {
            continue;
        };
        if turn.abs() >= MIN_CORRECTION_DEGREES.to_radians() {
            moves.add(
                &indexes,
                Affine::rotate_about(turn, bounds.x, bounds.y + bounds.height / 2.0),
            );
        }
    }
}

fn sample_points(strokes: &[InkStroke], indexes: &[usize]) -> Vec<(f32, f32)> {
    let all: Vec<(f32, f32)> = indexes
        .iter()
        .flat_map(|&i| strokes[i].points.iter().map(|p| (p.x, p.y)))
        .collect();
    let step = all.len().div_ceil(MAX_POINTS).max(1);
    all.into_iter().step_by(step).collect()
}

/// How peaky the histogram of heights is after turning the points by `turn` radians. `bin` must be at
/// least the points' extent over [`MAX_BINS`], which [`best_turn`] ensures.
fn peakiness(points: &[(f32, f32)], turn: f32, bin: f32) -> f32 {
    let (sin, cos) = turn.sin_cos();
    let heights: Vec<f32> = points.iter().map(|&(x, y)| sin * x + cos * y).collect();
    let low = heights.iter().copied().fold(f32::INFINITY, f32::min);
    let high = heights.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    // Rounding can put a height one bin past the extent, so the last bin takes it.
    let bins = (((high - low) / bin) as usize).min(MAX_BINS) + 1;
    let mut counts = vec![0_u32; bins];
    for h in &heights {
        counts[(((h - low) / bin) as usize).min(bins - 1)] += 1;
    }
    counts.iter().map(|&c| (c as f32).powi(2)).sum()
}

/// The turn in radians that levels the points, or `None` when no turn is clearly better than none.
fn best_turn(points: &[(f32, f32)], bin: f32) -> Option<f32> {
    // No turn makes the heights spread further than the diagonal of the points' box, so a bin that size
    // over MAX_BINS keeps every histogram small. The same bin serves every turn, so their scores compare.
    let (mut min_x, mut min_y, mut max_x, mut max_y) =
        (f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for &(x, y) in points {
        (min_x, min_y, max_x, max_y) = (min_x.min(x), min_y.min(y), max_x.max(x), max_y.max(y));
    }
    let extent = (max_x - min_x).hypot(max_y - min_y);
    if !extent.is_finite() {
        return None;
    }
    let bin = bin.max(0.25).max(extent / MAX_BINS as f32);
    let steps = (MAX_TILT_DEGREES / STEP_DEGREES) as i32;
    let level = peakiness(points, 0.0, bin);
    let mut best = (level, 0.0_f32);
    for k in -steps..=steps {
        let turn = (k as f32 * STEP_DEGREES).to_radians();
        let score = peakiness(points, turn, bin);
        // On a tie the smaller turn wins.
        if score > best.0 * 1.0001 || (score >= best.0 && turn.abs() < best.1.abs()) {
            best = (score, turn);
        }
    }
    (best.0 >= level * MIN_IMPROVEMENT).then_some(best.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A wide, flat line: twelve points from x = 0 to `width`, with y between 0 and 10.
    fn flat_line(width: f32) -> Vec<(f32, f32)> {
        (0..12)
            .map(|i| (width * i as f32 / 11.0, if i % 2 == 0 { 0.0 } else { 10.0 }))
            .collect()
    }

    #[test]
    fn a_very_wide_line_keeps_the_histogram_small() {
        // Without the cap this asks for about 100 GB at a 15 degree turn, and the process aborts.
        assert_eq!(best_turn(&flat_line(1e11), 1.0), None);
        assert_eq!(best_turn(&flat_line(1e9), 1.0), None);
    }

    #[test]
    fn points_too_far_apart_to_measure_are_left_alone() {
        let mut points = flat_line(100.0);
        points[0] = (-3e38, 0.0);
        points[1] = (3e38, 10.0);
        assert_eq!(best_turn(&points, 1.0), None, "the extent overflows to infinity");
    }
}
