//! The model's tokens: the special ones by ID, turning token IDs back into text, and turning a prompt into tokens
//! by the longest match against the model's own token list.

use std::collections::HashMap;

use super::model::Hparams;

/// The languages a multilingual model knows, in the order of their tokens.
pub(crate) const LANGUAGES: [&str; 99] = [
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi",
    "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml",
    "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs",
    "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am",
    "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
    "ha", "ba", "jw", "su",
];

/// The IDs of the special tokens, which differ between English-only and multilingual models.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Special {
    pub eot: u32,
    pub sot: u32,
    pub transcribe: u32,
    pub prev: u32,
    pub no_speech: u32,
    /// The first timestamp, <|0.00|>. Each next one is 20 ms later.
    pub timestamp_begin: u32,
    pub multilingual: bool,
}

impl Special {
    pub(crate) fn of(hparams: &Hparams) -> Special {
        if hparams.multilingual() {
            // 99 languages start at sot + 1. Newer models with 100 move the tokens after them one further.
            let extra = (hparams.n_vocab as u32).saturating_sub(51_865);
            Special {
                eot: 50_257,
                sot: 50_258,
                transcribe: 50_359 + extra,
                prev: 50_361 + extra,
                no_speech: 50_362 + extra,
                timestamp_begin: 50_364 + extra,
                multilingual: true,
            }
        } else {
            Special {
                eot: 50_256,
                sot: 50_257,
                transcribe: 50_358,
                prev: 50_360,
                no_speech: 50_361,
                timestamp_begin: 50_363,
                multilingual: false,
            }
        }
    }

    /// The token of a language, by its primary subtag such as "fr".
    pub(crate) fn language(&self, code: &str) -> Option<u32> {
        if !self.multilingual {
            return None;
        }
        LANGUAGES
            .iter()
            .position(|&known| known == code)
            .map(|index| self.sot + 1 + index as u32)
    }

    /// Whether the token is text, as opposed to a special token or a timestamp.
    pub(crate) fn is_text(&self, token: u32) -> bool {
        token < self.eot
    }
}

/// Text from the model's tokens and back.
pub(crate) struct Tokenizer<'m> {
    vocab: &'m [Vec<u8>],
    by_bytes: HashMap<&'m [u8], u32>,
    longest: usize,
    special: Special,
}

impl<'m> Tokenizer<'m> {
    pub(crate) fn new(vocab: &'m [Vec<u8>], special: Special) -> Tokenizer<'m> {
        let mut by_bytes = HashMap::new();
        let mut longest = 1;
        for (id, bytes) in vocab.iter().enumerate().take(special.eot as usize) {
            if !bytes.is_empty() {
                by_bytes.entry(bytes.as_slice()).or_insert(id as u32);
                longest = longest.max(bytes.len());
            }
        }
        Tokenizer {
            vocab,
            by_bytes,
            longest,
            special,
        }
    }

    /// The bytes of the text tokens among `tokens`, as text.
    pub(crate) fn text(&self, tokens: &[u32]) -> String {
        let mut bytes = Vec::new();
        for &token in tokens {
            if self.special.is_text(token) {
                if let Some(piece) = self.vocab.get(token as usize) {
                    bytes.extend_from_slice(piece);
                }
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Splits text the way the model's tokens were made: words with their leading space, runs of digits, and runs
    /// of other marks.
    fn pieces(text: &str) -> Vec<String> {
        let mut pieces: Vec<String> = Vec::new();
        let mut current = String::new();
        let mut kind = 0_u8;
        for c in text.chars() {
            let next = if c.is_alphabetic() {
                1
            } else if c.is_numeric() {
                2
            } else if c.is_whitespace() {
                3
            } else {
                4
            };
            // A space joins the word that follows it.
            let joins = next == kind && next != 3 || (kind == 3 && current == " " && next != 3);
            if !joins && !current.is_empty() {
                pieces.push(std::mem::take(&mut current));
            }
            current.push(if next == 3 { ' ' } else { c });
            kind = next;
        }
        if !current.is_empty() {
            pieces.push(current);
        }
        pieces
    }

    /// The tokens for `text`, by the longest match at each point. Bytes with no token are skipped.
    pub(crate) fn encode(&self, text: &str) -> Vec<u32> {
        let mut tokens = Vec::new();
        for piece in Tokenizer::pieces(text) {
            let bytes = piece.as_bytes();
            let mut at = 0;
            while at < bytes.len() {
                let mut found = None;
                let mut len = self.longest.min(bytes.len() - at);
                while len > 0 {
                    if let Some(&id) = self.by_bytes.get(&bytes[at..at + len]) {
                        found = Some((id, len));
                        break;
                    }
                    len -= 1;
                }
                match found {
                    Some((id, len)) => {
                        tokens.push(id);
                        at += len;
                    }
                    None => at += 1,
                }
            }
        }
        tokens
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vocab() -> Vec<Vec<u8>> {
        ["a", "b", " ab", " a", "ab", "!", " ", "1", "12"]
            .iter()
            .map(|s| s.as_bytes().to_vec())
            .collect()
    }

    fn special() -> Special {
        Special {
            eot: 9,
            sot: 10,
            transcribe: 11,
            prev: 12,
            no_speech: 13,
            timestamp_begin: 14,
            multilingual: false,
        }
    }

    #[test]
    fn prompts_take_the_longest_token_at_each_point() {
        let list = vocab();
        let tokenizer = Tokenizer::new(&list, special());
        assert_eq!(tokenizer.encode("ab ab!"), vec![4, 2, 5]);
        assert_eq!(tokenizer.encode("121"), vec![8, 7]);
        assert_eq!(tokenizer.text(&[4, 2, 5, 14, 9]), "ab ab!");
    }

    #[test]
    fn words_keep_their_leading_space() {
        assert_eq!(
            Tokenizer::pieces("Hi there, 42x"),
            vec!["Hi", " there", ",", " 42", "x"]
        );
    }

    #[test]
    fn languages_have_tokens_only_in_multilingual_models() {
        let mut hparams = Hparams {
            n_vocab: 51_865,
            n_audio_ctx: 1500,
            n_audio_state: 384,
            n_audio_head: 6,
            n_audio_layer: 4,
            n_text_ctx: 448,
            n_text_state: 384,
            n_text_head: 6,
            n_text_layer: 4,
            n_mels: 80,
        };
        let many = Special::of(&hparams);
        assert_eq!(many.language("en"), Some(50_259));
        assert_eq!(many.language("fr"), Some(50_265));
        assert_eq!(many.timestamp_begin, 50_364);
        hparams.n_vocab = 51_864;
        let english = Special::of(&hparams);
        assert_eq!(english.language("en"), None);
        assert_eq!((english.eot, english.timestamp_begin), (50_256, 50_363));
    }
}
