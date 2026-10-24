//! Word splitting and case folding, shared by titles, tags, links, snippets, and the full-text table.
//!
//! A word is a run of letters and digits, with the marks that follow them. Matching ignores case, and it ignores
//! accents on Latin, Greek, and Cyrillic letters. Scripts written without spaces between words (Chinese,
//! Japanese, Korean, Thai, and their neighbors) make each letter a word of its own, so a search finds a word
//! inside a sentence by matching its letters in a row.
//!
//! The full-text table stores the folded words of each column, not the raw text, and a query is folded the same
//! way. SQLite's tokenizer then only splits at the spaces between them. Keeping both sides here means a query
//! word can always meet the word it was typed for, and a snippet highlights the words the index matched.

use std::ops::Range;

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Folds case, removes accents, and collapses runs of white space to one space.
///
/// Case folds in full, so `Straße` matches `STRASSE`, and the Turkish dotted and dotless `i` match a plain `i`.
/// An accent is removed only from a Latin, Greek, Cyrillic, Hebrew, or Arabic letter. In other scripts a
/// combining mark is part of the letter, such as a Japanese voicing mark or a Hindi vowel sign, so it stays.
/// The result is recomposed, so Hangul syllables and kana stay whole.
pub fn fold(text: &str) -> String {
    if text.is_ascii() {
        return fold_ascii(text);
    }
    let mut cased = String::with_capacity(text.len());
    let mut pending_space = false;
    for c in text.chars() {
        if c.is_whitespace() {
            pending_space = !cased.is_empty();
            continue;
        }
        if pending_space {
            cased.push(' ');
            pending_space = false;
        }
        fold_case(c, &mut cased);
    }
    strip_accents(&cased)
}

/// Full case folding without a table: lower case, then upper, then lower again. The round trip maps `ß` and
/// `ẞ` to `ss`, the final sigma to `σ`, ligatures such as `ﬁ` to their letters, and `ı` to `i`.
fn fold_case(c: char, out: &mut String) {
    for lower in c.to_lowercase() {
        for upper in lower.to_uppercase() {
            out.extend(upper.to_lowercase());
        }
    }
}

/// Removes the combining marks that sit on a letter of a script whose marks are accents, then recomposes.
fn strip_accents(text: &str) -> String {
    let mut bare = String::with_capacity(text.len());
    let mut accented_base = false;
    for c in text.nfd() {
        if is_combining_mark(c) {
            if accented_base {
                continue;
            }
        } else {
            accented_base = takes_accents(c);
        }
        bare.push(c);
    }
    bare.nfc().collect()
}

/// Whether the marks on this letter are accents that matching ignores: Latin, Greek, Cyrillic, Hebrew, and
/// Arabic letters.
fn takes_accents(c: char) -> bool {
    matches!(
        u32::from(c),
        0x0000..=0x052F
            | 0x0590..=0x06FF
            | 0x0750..=0x077F
            | 0x08A0..=0x08FF
            | 0x1C80..=0x1C8F
            | 0x1D00..=0x1DBF
            | 0x1E00..=0x1FFF
            | 0x2C60..=0x2C7F
            | 0x2DE0..=0x2DFF
            | 0xA640..=0xA69F
            | 0xA720..=0xA7FF
            | 0xAB30..=0xAB6F
            | 0xFB00..=0xFDFF
            | 0xFE70..=0xFEFF
            | 0xFF21..=0xFF5A
    )
}

/// Whether a letter belongs to a script written without spaces between words, so that it is a word on its own:
/// Han, kana, Hangul, Thai, Lao, Khmer, and Myanmar.
fn stands_alone(c: char) -> bool {
    matches!(
        u32::from(c),
        0x0E00..=0x0EFF
            | 0x1000..=0x109F
            | 0x1100..=0x11FF
            | 0x1780..=0x17FF
            | 0x3040..=0x30FF
            | 0x3130..=0x318F
            | 0x31F0..=0x31FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xA960..=0xA97F
            | 0xAC00..=0xD7FF
            | 0xF900..=0xFAFF
            | 0xFF66..=0xFFDC
            | 0x20000..=0x3FFFF
    )
}

/// The same as [`fold`] for text that is all ASCII, which has no accents to remove and needs no normalizing.
fn fold_ascii(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut pending_space = false;
    for byte in text.bytes() {
        if char::from(byte).is_whitespace() {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            pending_space = false;
        }
        out.push(char::from(byte.to_ascii_lowercase()));
    }
    out
}

/// A word of a text: its byte range and its folded form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Word {
    /// Where the word sits in the text.
    pub range: Range<usize>,
    /// The word, folded.
    pub folded: String,
}

/// The words of a text, in order. A word is a run of letters and digits with the marks that follow them, or one
/// letter of a script written without spaces, with its marks.
pub fn words(text: &str) -> Vec<Word> {
    let mut out = Vec::new();
    // Where the current word starts, and whether it is one letter that stands alone.
    let mut current: Option<(usize, bool)> = None;
    for (at, c) in text.char_indices() {
        if is_combining_mark(c) {
            // A mark belongs to the word before it, or to no word.
            continue;
        }
        if let Some((from, alone)) = current {
            if !alone && c.is_alphanumeric() && !stands_alone(c) {
                continue;
            }
            out.push(word(text, from..at));
            current = None;
        }
        if c.is_alphanumeric() {
            current = Some((at, stands_alone(c)));
        }
    }
    if let Some((from, _)) = current {
        out.push(word(text, from..text.len()));
    }
    out
}

fn word(text: &str, range: Range<usize>) -> Word {
    Word {
        folded: fold(&text[range.clone()]),
        range,
    }
}

/// The text the full-text table stores for a column: its folded words, one space apart.
pub fn index_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for found in words(text) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&found.folded);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folded_words(text: &str) -> Vec<String> {
        words(text).into_iter().map(|w| w.folded).collect()
    }

    #[test]
    fn folds_case_accents_and_spaces() {
        assert_eq!(fold("  \u{c9}cole   NORMALE\t"), "ecole normale");
        assert_eq!(fold(""), "");
        assert_eq!(fold("e\u{301}cole"), "ecole");
    }

    #[test]
    fn splits_words_with_byte_ranges() {
        let found = words("Don't panic, 42 \u{e9}t\u{e9}!");
        let folded: Vec<&str> = found.iter().map(|w| w.folded.as_str()).collect();
        assert_eq!(folded, ["don", "t", "panic", "42", "ete"]);
        assert_eq!(found[2].range, 6..11);
    }

    #[test]
    fn folds_case_in_full() {
        assert_eq!(fold("STRASSE"), fold("Stra\u{df}e"));
        assert_eq!(fold("\u{1e9e}"), "ss");
        assert_eq!(fold("I\u{15e}IK"), fold("I\u{15f}\u{131}k"));
        assert_eq!(fold("\u{130}stanbul"), "istanbul");
        assert_eq!(
            fold("\u{3a3}\u{39f}\u{3a6}\u{39f}\u{3a3}"),
            fold("\u{3c3}\u{3bf}\u{3c6}\u{3bf}\u{3c2}")
        );
        assert_eq!(fold("\u{fb01}le"), "file");
    }

    #[test]
    fn removes_accents_only_where_they_are_accents() {
        assert_eq!(
            fold("\u{3ba}\u{3b1}\u{3bb}\u{3b7}\u{3bc}\u{3ad}\u{3c1}\u{3b1}"),
            "\u{3ba}\u{3b1}\u{3bb}\u{3b7}\u{3bc}\u{3b5}\u{3c1}\u{3b1}"
        );
        assert_eq!(fold("\u{435}\u{449}\u{451}"), "\u{435}\u{449}\u{435}");
        let distinct = [
            ["\u{304b}\u{304e}", "\u{304c}\u{304d}", "\u{304b}\u{304d}"],
            ["\u{30d1}\u{30f3}", "\u{30cf}\u{30f3}", "\u{30d0}\u{30f3}"],
            [
                "\u{915}\u{92e}\u{932}",
                "\u{915}\u{92e}\u{93e}\u{932}",
                "\u{915}\u{94b}\u{92e}\u{932}",
            ],
            ["\u{e01}\u{e34}\u{e19}", "\u{e01}\u{e31}\u{e19}", "\u{e01}\u{e19}"],
        ];
        for group in distinct {
            let folded: Vec<String> = group.iter().map(|word| fold(word)).collect();
            assert!(
                folded[0] != folded[1] && folded[1] != folded[2] && folded[0] != folded[2],
                "{group:?}"
            );
        }
        assert_eq!(
            fold("\u{d55c}\u{ad6d}\u{c5b4}"),
            "\u{d55c}\u{ad6d}\u{c5b4}",
            "Hangul stays whole"
        );
        assert_eq!(
            fold("\u{304b}\u{3099}"),
            "\u{304c}",
            "a decomposed voicing mark recomposes"
        );
    }

    #[test]
    fn a_letter_of_a_script_without_spaces_is_a_word() {
        assert_eq!(
            folded_words("\u{6771}\u{4eac}\u{306b}2024"),
            ["\u{6771}", "\u{4eac}", "\u{306b}", "2024"]
        );
        assert_eq!(folded_words("\u{304b}\u{3099}\u{304d}"), ["\u{304c}", "\u{304d}"]);
        assert_eq!(
            folded_words("\u{915}\u{93f}\u{924}\u{93e}\u{92c}"),
            ["\u{915}\u{93f}\u{924}\u{93e}\u{92c}"]
        );
        assert_eq!(index_text("Caf\u{e9} \u{6771}\u{4eac}!"), "cafe \u{6771} \u{4eac}");
    }
}
