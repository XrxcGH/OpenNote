//! Shared pieces of the engines that report lines but not always words. A box in the 0 to 1 space of an image,
//! with its origin at the bottom left as Apple's Vision gives it, becomes pixels. A line splits into words. A word
//! with no box of its own gets its share of the line's box.

use crate::geometry::Rect;

/// A box given as fractions of the image, with y growing upward from the bottom edge, in image pixels with y
/// growing downward. Values outside 0 to 1 are clamped to the image.
pub(crate) fn from_unit_box(x: f64, y: f64, width: f64, height: f64, image_width: u32, image_height: u32) -> Rect {
    let clamp = |v: f64| v.clamp(0.0, 1.0);
    let (left, right) = (clamp(x), clamp(x + width));
    let (bottom, top) = (clamp(y), clamp(y + height));
    let (w, h) = (f64::from(image_width), f64::from(image_height));
    Rect {
        x: (left * w) as f32,
        y: ((1.0 - top) * h) as f32,
        width: ((right - left) * w) as f32,
        height: ((top - bottom) * h) as f32,
    }
}

/// A word of a line: its text, and where it starts and how long it is in UTF-16 code units, which is how
/// Foundation strings count.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WordSpan<'a> {
    pub text: &'a str,
    pub utf16_start: usize,
    pub utf16_len: usize,
    /// Where it starts and how long it is in characters, for sharing out a box.
    pub char_start: usize,
    pub char_len: usize,
}

/// The words of a line, split on white space.
pub(crate) fn split_words(line: &str) -> Vec<WordSpan<'_>> {
    let mut words = Vec::new();
    let mut utf16 = 0;
    let mut chars = 0;
    let mut start: Option<(usize, usize, usize)> = None;
    for (at, c) in line.char_indices() {
        if c.is_whitespace() {
            if let Some((byte, u16_start, char_start)) = start.take() {
                words.push(WordSpan {
                    text: &line[byte..at],
                    utf16_start: u16_start,
                    utf16_len: utf16 - u16_start,
                    char_start,
                    char_len: chars - char_start,
                });
            }
        } else if start.is_none() {
            start = Some((at, utf16, chars));
        }
        utf16 += c.len_utf16();
        chars += 1;
    }
    if let Some((byte, u16_start, char_start)) = start {
        words.push(WordSpan {
            text: &line[byte..],
            utf16_start: u16_start,
            utf16_len: utf16 - u16_start,
            char_start,
            char_len: chars - char_start,
        });
    }
    words
}

/// A word's share of its line's box, by where its characters sit among the line's. Used when the engine gives
/// no box for a word.
pub(crate) fn share_of_line(line: &Rect, line_chars: usize, word: &WordSpan<'_>) -> Rect {
    let total = line_chars.max(1) as f32;
    let per = line.width / total;
    Rect {
        x: line.x + per * word.char_start as f32,
        y: line.y,
        width: per * word.char_len as f32,
        height: line.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_unit_box_from_the_bottom_left_becomes_pixels_from_the_top_left() {
        // The bottom-left quarter of a 200 by 100 image.
        let rect = from_unit_box(0.0, 0.0, 0.5, 0.5, 200, 100);
        assert_eq!(
            rect,
            Rect {
                x: 0.0,
                y: 50.0,
                width: 100.0,
                height: 50.0
            }
        );
        // A box that runs off the top right is cut at the edges.
        let rect = from_unit_box(0.75, 0.9, 0.5, 0.5, 200, 100);
        assert_eq!((rect.x, rect.y, rect.width), (150.0, 0.0, 50.0));
        assert!((rect.height - 10.0).abs() < 1e-3);
    }

    #[test]
    fn words_are_split_on_white_space_and_counted_in_utf16() {
        let words = split_words("  Café 𝛑 notes\tend ");
        let texts: Vec<&str> = words.iter().map(|w| w.text).collect();
        assert_eq!(texts, ["Café", "𝛑", "notes", "end"]);
        assert_eq!((words[0].utf16_start, words[0].utf16_len), (2, 4));
        // The mathematical pi is two UTF-16 units and one character.
        assert_eq!((words[1].utf16_start, words[1].utf16_len), (7, 2));
        assert_eq!((words[1].char_start, words[1].char_len), (7, 1));
        assert_eq!((words[2].utf16_start, words[2].char_start), (10, 9));
        assert!(split_words(" \n ").is_empty());
    }

    #[test]
    fn a_word_gets_its_share_of_the_line_box() {
        let line = Rect {
            x: 10.0,
            y: 5.0,
            width: 100.0,
            height: 20.0,
        };
        let words = split_words("ab cdefg");
        let second = share_of_line(&line, 8, &words[1]);
        assert_eq!(
            second,
            Rect {
                x: 47.5,
                y: 5.0,
                width: 62.5,
                height: 20.0
            }
        );
    }
}
