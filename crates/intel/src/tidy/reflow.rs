//! Wraps handwriting to a new width, as a word processor wraps text.
//!
//! Words keep their shape and size. Each moves to a new place on a line that starts at the block's
//! left edge. It keeps its small offset from the middle of its line, so the writing still looks like
//! writing. A big vertical gap between two lines is a paragraph break, and it stays.

use super::affine::Affine;
use super::model::{median, LineShape, WordShape};
use super::Moves;

/// A gap between line middles of more than this many word heights is a paragraph break. Ordinary line
/// spacing is between about 1.3 and 2.5 word heights.
const PARAGRAPH_HEIGHTS: f32 = 3.2;
/// A gap between line middles this many times the usual spacing is also a paragraph break.
const PARAGRAPH_BREAK: f32 = 1.6;
/// Line spacing, as a multiple of the median word height, when the block has one line.
const DEFAULT_PITCH: f32 = 1.5;
/// Word spacing, as a multiple of the median word height, when the block has one word.
const DEFAULT_GAP: f32 = 0.35;
const MIN_GAP_OF_HEIGHT: f32 = 0.15;

/// A word in reading order, with what the layout needs to know about it.
struct Placed<'a> {
    word: &'a WordShape,
    /// How far the word's middle sat above or below the middle of its original line.
    offset_y: f32,
    /// A paragraph break comes before this word, and this much extra space with it.
    paragraph_extra: Option<f32>,
}

/// What the whole block looks like: the usual word height, line spacing, and word spacing.
struct Rhythm {
    height: f32,
    pitch: f32,
    gap: f32,
}

pub(super) fn reflow(lines: &[LineShape], width: f32, moves: &mut Moves) {
    if lines.is_empty() {
        return;
    }
    let centers: Vec<f32> = lines.iter().map(LineShape::center_y).collect();
    let rhythm = rhythm_of(lines, &centers);
    let words = in_reading_order(lines, &centers, &rhythm);

    let left = lines.iter().map(|l| l.bounds().x).fold(f32::INFINITY, f32::min);
    let mut line_center = centers[0];
    let mut x = left;
    for placed in &words {
        let w = placed.word.bounds.width;
        // A word that is the first on its line never wraps, even if it is wider than the block.
        if let Some(extra) = placed.paragraph_extra {
            line_center += rhythm.pitch + extra;
            x = left;
        } else if x > left && x + w > left + width {
            line_center += rhythm.pitch;
            x = left;
        }
        let dx = x - placed.word.bounds.x;
        let old_center = placed.word.bounds.y + placed.word.bounds.height / 2.0;
        let dy = line_center + placed.offset_y - old_center;
        moves.add(&placed.word.strokes, Affine::translate(dx, dy));
        x += w + rhythm.gap;
    }
}

fn rhythm_of(lines: &[LineShape], centers: &[f32]) -> Rhythm {
    let heights = lines.iter().flat_map(|l| l.words.iter().map(|w| w.bounds.height));
    let height = median(heights.collect());
    // Steps that are paragraph breaks say nothing about ordinary spacing.
    let steps: Vec<f32> = centers
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .filter(|d| *d > 0.0 && *d <= PARAGRAPH_HEIGHTS * height)
        .collect();
    let pitch = median(steps);
    let gaps = lines
        .iter()
        .flat_map(|l| l.words.windows(2).map(|p| p[1].bounds.x - p[0].bounds.right()));
    let gap = median(gaps.collect());
    Rhythm {
        height,
        pitch: if pitch > 0.0 { pitch } else { DEFAULT_PITCH * height },
        gap: if gap > 0.0 { gap } else { DEFAULT_GAP * height }.max(MIN_GAP_OF_HEIGHT * height),
    }
}

fn in_reading_order<'a>(lines: &'a [LineShape], centers: &[f32], rhythm: &Rhythm) -> Vec<Placed<'a>> {
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let step = if i > 0 { centers[i] - centers[i - 1] } else { 0.0 };
        let is_break = i > 0 && (step > PARAGRAPH_BREAK * rhythm.pitch || step > PARAGRAPH_HEIGHTS * rhythm.height);
        for (n, word) in line.words.iter().enumerate() {
            out.push(Placed {
                word,
                offset_y: word.bounds.y + word.bounds.height / 2.0 - centers[i],
                paragraph_extra: (is_break && n == 0).then_some(step - rhythm.pitch),
            });
        }
    }
    out
}
