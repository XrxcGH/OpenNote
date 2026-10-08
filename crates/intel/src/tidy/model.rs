//! The recognized writing as the tidy operations see it: lines made of words. Each word has its strokes
//! and a box.

use std::collections::HashMap;

use crate::geometry::Rect;
use crate::ink::{InkRecognition, InkStroke};

/// One recognized word, with the strokes it is made of.
pub(super) struct WordShape {
    /// The letters in the word's best reading, for estimating its size.
    pub letters: usize,
    /// Positions in the caller's stroke list.
    pub strokes: Vec<usize>,
    /// The box around the word's points.
    pub bounds: Rect,
}

/// A line of words in reading order.
pub(super) struct LineShape {
    pub words: Vec<WordShape>,
}

impl LineShape {
    /// The box around every word.
    pub fn bounds(&self) -> Rect {
        Rect::union_all(self.words.iter().map(|w| &w.bounds)).unwrap_or_default()
    }

    /// The middle of the line, taken as the median of its words' middles so that one tall letter does not
    /// pull it.
    pub fn center_y(&self) -> f32 {
        median(self.words.iter().map(|w| w.bounds.y + w.bounds.height / 2.0).collect())
    }
}

/// The box around the points of the strokes at `indexes`, or `None` when they hold no points.
pub(super) fn bounds_of(strokes: &[InkStroke], indexes: &[usize]) -> Option<Rect> {
    let mut points = indexes.iter().flat_map(|&i| strokes[i].points.iter());
    let first = points.next()?;
    let (mut left, mut top, mut right, mut bottom) = (first.x, first.y, first.x, first.y);
    for p in points {
        left = left.min(p.x);
        right = right.max(p.x);
        top = top.min(p.y);
        bottom = bottom.max(p.y);
    }
    Some(Rect {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    })
}

/// Groups the strokes by the recognition's lines and words. A word whose strokes are all missing from
/// `strokes` is left out, and so is a line that ends up with no words.
pub(super) fn lines_of(strokes: &[InkStroke], recognition: &InkRecognition) -> Vec<LineShape> {
    let index: HashMap<_, _> = strokes.iter().enumerate().map(|(i, s)| (s.key, i)).collect();
    let mut lines = Vec::new();
    for line in &recognition.lines {
        let words: Vec<WordShape> = line
            .words
            .iter()
            .filter_map(|word| {
                let found: Vec<usize> = word.strokes.iter().filter_map(|key| index.get(key).copied()).collect();
                let bounds = bounds_of(strokes, &found)?;
                Some(WordShape {
                    letters: word.text.chars().filter(|c| c.is_alphanumeric()).count(),
                    strokes: found,
                    bounds,
                })
            })
            .collect();
        if !words.is_empty() {
            lines.push(LineShape { words });
        }
    }
    lines
}

/// The middle value of the numbers, or 0 for none.
pub(super) fn median(mut values: Vec<f32>) -> f32 {
    values.retain(|v| v.is_finite());
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f32::total_cmp);
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        values[mid]
    } else {
        (values[mid - 1] + values[mid]) / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_median_ignores_outliers_and_empty_input() {
        assert_eq!(median(vec![1.0, 100.0, 2.0]), 2.0);
        assert_eq!(median(vec![1.0, 2.0, 3.0, 10.0]), 2.5);
        assert_eq!(median(vec![]), 0.0);
        assert_eq!(median(vec![f32::NAN, 4.0]), 4.0);
    }
}
