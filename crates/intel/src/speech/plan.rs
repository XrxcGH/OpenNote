//! Cutting a page's text into pieces that are quick to synthesize and easy to follow.

use std::ops::Range;

use crate::text::{split_sentences, utf16_spans, Span};

/// The default size of a piece, in characters. About half a minute of speech.
pub const DEFAULT_CHUNK_CHARS: usize = 400;

/// One piece of text to read, with its place in the page text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
    /// Where the piece sits in the original text, in UTF-16 units.
    pub span: Span,
    /// The text to hand to a synthesizer. It is as long as the span in UTF-16 units, so an offset in the
    /// piece is an offset in the page once `span.start` is added. List markers and line breaks are
    /// replaced by spaces, or by a period when the line had none, so items are read as separate sentences.
    pub text: String,
}

/// A sentence, or part of a long one.
struct Piece {
    range: Range<usize>,
    /// The piece continues the sentence before it, because that one was too long.
    continues: bool,
}

/// Splits `text` into chunks of whole sentences, each at most `max_chars` characters unless one
/// sentence alone is longer, in which case it is cut at a comma or a space.
///
/// The first chunk is a single sentence, so reading starts sooner. Text with no letters or digits gives
/// no chunks.
pub fn plan_chunks(text: &str, max_chars: usize) -> Vec<Chunk> {
    let max_chars = max_chars.max(40);
    let pieces: Vec<Piece> = split_sentences(text)
        .into_iter()
        .flat_map(|sentence| cut_long(text, sentence, max_chars))
        .collect();
    let mut groups: Vec<Vec<Piece>> = Vec::new();
    for piece in pieces {
        let joins = groups.len() > 1
            && groups
                .last()
                .and_then(|g| g.first())
                .is_some_and(|first| text[first.range.start..piece.range.end].chars().count() <= max_chars);
        match groups.last_mut() {
            Some(group) if joins => group.push(piece),
            _ => groups.push(vec![piece]),
        }
    }
    let bounds: Vec<Range<usize>> = groups
        .iter()
        .map(|g| g[0].range.start..g[g.len() - 1].range.end)
        .collect();
    utf16_spans(text, &bounds)
        .into_iter()
        .zip(&groups)
        .map(|(span, group)| Chunk {
            span,
            text: speakable(text, group),
        })
        .collect()
}

/// Cuts one sentence that is longer than `max_chars` at commas, then spaces.
fn cut_long(text: &str, sentence: Range<usize>, max_chars: usize) -> Vec<Piece> {
    let mut out = Vec::new();
    let mut start = sentence.start;
    while text[start..sentence.end].chars().count() > max_chars {
        let limit = text[start..sentence.end]
            .char_indices()
            .nth(max_chars)
            .map_or(sentence.end, |(i, _)| start + i);
        let window = &text[start..limit];
        let cut = window
            .rfind([',', ';', ':', '—', '–'])
            .map(|i| i + window[i..].chars().next().map_or(1, char::len_utf8))
            .or_else(|| window.rfind(char::is_whitespace))
            .filter(|&i| i > 0)
            .map_or(limit, |i| start + i);
        out.push(Piece {
            range: start..cut,
            continues: !out.is_empty(),
        });
        start = cut + (text[cut..sentence.end].len() - text[cut..sentence.end].trim_start().len());
    }
    if start < sentence.end {
        out.push(Piece {
            range: start..sentence.end,
            continues: !out.is_empty(),
        });
    }
    out
}

fn ends_a_clause(c: char) -> bool {
    matches!(
        c,
        '.' | '!' | '?' | '…' | '。' | '！' | '？' | ',' | ';' | ':' | '—' | '"' | '”' | '’' | ')' | '、' | '，'
    )
}

/// Joins the pieces of a chunk with their original gaps, keeping every length in UTF-16 units. A gap
/// becomes spaces, and its first character becomes a period, or a comma inside a long sentence, when the
/// piece before it ended without punctuation. Line breaks inside a piece are wrapped lines, so they
/// become spaces.
fn speakable(text: &str, group: &[Piece]) -> String {
    let mut out = String::new();
    for (i, piece) in group.iter().enumerate() {
        if i > 0 {
            let before = &group[i - 1].range;
            let stop = if piece.continues { ',' } else { '.' };
            let needs_stop = !text[..before.end].chars().next_back().is_some_and(ends_a_clause);
            for (n, c) in text[before.end..piece.range.start].chars().enumerate() {
                let units = c.len_utf16();
                if n == 0 && needs_stop {
                    out.push(stop);
                    out.extend(std::iter::repeat_n(' ', units - 1));
                } else {
                    out.extend(std::iter::repeat_n(' ', units));
                }
            }
        }
        out.extend(
            text[piece.range.clone()]
                .chars()
                .map(|c| if matches!(c, '\n' | '\r') { ' ' } else { c }),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(chunks: &[Chunk]) -> Vec<&str> {
        chunks.iter().map(|c| c.text.as_str()).collect()
    }

    #[test]
    fn the_first_chunk_is_one_sentence_and_the_rest_are_grouped() {
        let text = "One. Two. Three. Four. Five.";
        let chunks = plan_chunks(text, 400);
        assert_eq!(texts(&chunks), ["One.", "Two. Three. Four. Five."]);
        assert_eq!(chunks[0].span, Span { start: 0, end: 4 });
        assert_eq!(chunks[1].span, Span { start: 5, end: 28 });
    }

    #[test]
    fn chunks_stay_under_the_limit() {
        let text = "This sentence has about forty characters. ".repeat(30);
        let chunks = plan_chunks(&text, 100);
        assert!(chunks.len() > 5);
        assert!(
            chunks.iter().all(|c| c.text.chars().count() <= 100),
            "{:?}",
            texts(&chunks)
        );
    }

    #[test]
    fn a_very_long_sentence_is_cut_at_a_comma_or_a_space() {
        let text = format!("{}, {}.", "alpha ".repeat(20).trim(), "beta ".repeat(20).trim());
        let chunks = plan_chunks(&text, 130);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 130));
        let words: usize = chunks.iter().map(|c| c.text.split_whitespace().count()).sum();
        assert_eq!(words, 40, "no word is lost or split");
    }

    #[test]
    fn offsets_in_a_chunk_line_up_with_the_page_text() {
        let text = "Title\n- buy milk\n- call \u{1F600} mom\n";
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let chunks = plan_chunks(text, 400);
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            let piece: Vec<u16> = chunk.text.encode_utf16().collect();
            assert_eq!(piece.len(), chunk.span.end - chunk.span.start, "{chunk:?}");
            for (i, unit) in piece.iter().enumerate() {
                let original = utf16[chunk.span.start + i];
                if char::from_u32(u32::from(*unit)).is_some_and(char::is_alphanumeric) {
                    assert_eq!(*unit, original, "{chunk:?} at {i}");
                }
            }
        }
    }

    #[test]
    fn list_markers_vanish_and_unpunctuated_lines_become_sentences() {
        let chunks = plan_chunks("Todo\n- buy milk\n- call mom", 400);
        assert_eq!(texts(&chunks), ["Todo", "buy milk.  call mom"]);
    }

    #[test]
    fn a_wrapped_line_is_read_straight_through() {
        let chunks = plan_chunks("The quick brown\nfox jumps.", 400);
        assert_eq!(texts(&chunks), ["The quick brown fox jumps."]);
    }

    #[test]
    fn nothing_to_read_gives_no_chunks() {
        assert!(plan_chunks("", 400).is_empty());
        assert!(plan_chunks(" \n -- \n", 400).is_empty());
    }
}
