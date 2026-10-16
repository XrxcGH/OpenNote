//! Evens out the gaps between words and the sizes of words.
//!
//! The size of a word is its width per letter, which handwriting keeps steady within a line while the
//! box height jumps with each tall or hanging letter. A word is scaled toward the median, within limits,
//! about its bottom left corner so it stays on its baseline. Then each gap is set to the median gap.

use super::affine::Affine;
use super::model::{median, LineShape, WordShape};
use super::Moves;

/// Words are scaled by at most these factors.
const MIN_SCALE: f32 = 0.85;
const MAX_SCALE: f32 = 1.18;
/// A scale this close to 1 is not worth a change.
const NEGLIGIBLE_SCALE: f32 = 0.02;
/// Words with fewer letters than this have too little width to measure a size from.
const MIN_LETTERS_FOR_SIZE: usize = 3;
/// A gap is never set below this fraction of a word's height.
const MIN_GAP_OF_HEIGHT: f32 = 0.15;

pub(super) fn even_spacing(lines: &[LineShape], moves: &mut Moves) {
    let all_words = || lines.iter().flat_map(|l| l.words.iter());
    let height = median(all_words().map(|w| w.bounds.height).collect());
    let size = median(all_words().filter_map(size_of).collect());
    let global_gap = median(lines.iter().flat_map(gaps).collect());
    for line in lines {
        let scales: Vec<f32> = line.words.iter().map(|w| scale_of(w, size)).collect();
        let own_gap = if line.words.len() >= 3 {
            median(gaps(line).collect())
        } else {
            global_gap
        };
        let gap = own_gap.max(MIN_GAP_OF_HEIGHT * height);
        let mut cursor = line.words[0].bounds.x;
        for (i, (word, scale)) in line.words.iter().zip(scales).enumerate() {
            let left = if i == 0 { word.bounds.x } else { cursor + gap };
            let grow = Affine::scale_about(scale, scale, word.bounds.x, word.bounds.bottom());
            moves.add(&word.strokes, grow.then(Affine::translate(left - word.bounds.x, 0.0)));
            cursor = left + word.bounds.width * scale;
        }
    }
}

/// Width per letter, or `None` for a word too short to tell.
fn size_of(word: &WordShape) -> Option<f32> {
    (word.letters >= MIN_LETTERS_FOR_SIZE && word.bounds.width > 0.0).then(|| word.bounds.width / word.letters as f32)
}

fn scale_of(word: &WordShape, typical_size: f32) -> f32 {
    let Some(size) = size_of(word).filter(|_| typical_size > 0.0) else {
        return 1.0;
    };
    let scale = (typical_size / size).clamp(MIN_SCALE, MAX_SCALE);
    if (scale - 1.0).abs() < NEGLIGIBLE_SCALE {
        1.0
    } else {
        scale
    }
}

/// The space between each word of a line and the next.
fn gaps(line: &LineShape) -> impl Iterator<Item = f32> + '_ {
    line.words
        .windows(2)
        .map(|pair| pair[1].bounds.x - pair[0].bounds.right())
}
