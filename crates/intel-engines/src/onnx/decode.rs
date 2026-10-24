//! The decoding loop of a translation model, apart from any model so it can be tested on its own.

/// What the decoder gives for the next word: the scores of every word in the vocabulary.
pub trait Step {
    /// The scores for the word after `decoded`, one for each word the model knows.
    ///
    /// # Errors
    /// Whatever the model reports.
    fn next_scores(&mut self, decoded: &[i64]) -> Result<Vec<f32>, super::OnnxError>;
}

/// The words with the best score at each step, from `start` until `eos` or `max_new` words.
///
/// The `pad` word is never chosen. A repeat of the same three words twice in a row ends the sentence, which is how
/// a small model usually gets stuck, and the repeat is cut off.
///
/// # Errors
/// Whatever the model reports.
pub fn greedy(
    step: &mut impl Step,
    start: i64,
    eos: i64,
    pad: i64,
    max_new: usize,
) -> Result<Vec<i64>, super::OnnxError> {
    let mut decoded = vec![start];
    for _ in 0..max_new {
        let scores = step.next_scores(&decoded)?;
        let mut best: Option<(usize, f32)> = None;
        for (id, &score) in scores.iter().enumerate() {
            if id as i64 == pad || !score.is_finite() {
                continue;
            }
            if best.is_none_or(|(_, top)| score > top) {
                best = Some((id, score));
            }
        }
        let Some((id, _)) = best else { break };
        let id = id as i64;
        if id == eos {
            break;
        }
        decoded.push(id);
        let words = &decoded[1..];
        if words.len() >= 6 && words[words.len() - 3..] == words[words.len() - 6..words.len() - 3] {
            decoded.truncate(decoded.len() - 3);
            break;
        }
    }
    decoded.remove(0);
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A model that says a fixed list of words, then the end.
    struct Script {
        words: Vec<i64>,
        vocabulary: usize,
        eos: i64,
        asked: Vec<usize>,
    }

    impl Step for Script {
        fn next_scores(&mut self, decoded: &[i64]) -> Result<Vec<f32>, super::super::OnnxError> {
            self.asked.push(decoded.len());
            let mut scores = vec![0.0; self.vocabulary];
            let at = decoded.len() - 1;
            let next = self.words.get(at).copied().unwrap_or(self.eos);
            scores[next as usize] = 5.0;
            Ok(scores)
        }
    }

    fn script(words: &[i64]) -> Script {
        Script {
            words: words.to_vec(),
            vocabulary: 20,
            eos: 1,
            asked: Vec::new(),
        }
    }

    #[test]
    fn it_follows_the_best_word_until_the_end() {
        let mut model = script(&[7, 8, 9]);
        assert_eq!(greedy(&mut model, 19, 1, 19, 50).unwrap(), vec![7, 8, 9]);
        assert_eq!(model.asked, vec![1, 2, 3, 4]);
    }

    #[test]
    fn it_stops_at_the_length_limit() {
        let mut model = script(&[7, 8, 9, 10, 11, 12]);
        assert_eq!(greedy(&mut model, 19, 1, 19, 4).unwrap(), vec![7, 8, 9, 10]);
    }

    #[test]
    fn it_never_picks_the_pad_word() {
        struct Pads;
        impl Step for Pads {
            fn next_scores(&mut self, decoded: &[i64]) -> Result<Vec<f32>, super::super::OnnxError> {
                // The pad word always scores highest, the word 4 next, and the end after that.
                let mut scores = vec![0.0; 10];
                scores[9] = 9.0;
                if decoded.len() == 1 {
                    scores[4] = 3.0;
                } else {
                    scores[1] = 3.0;
                }
                Ok(scores)
            }
        }
        assert_eq!(greedy(&mut Pads, 9, 1, 9, 10).unwrap(), vec![4]);
    }

    #[test]
    fn a_loop_of_three_words_is_cut_off() {
        struct Loops;
        impl Step for Loops {
            fn next_scores(&mut self, decoded: &[i64]) -> Result<Vec<f32>, super::super::OnnxError> {
                let mut scores = vec![0.0; 10];
                scores[3 + (decoded.len() - 1) % 3] = 1.0;
                Ok(scores)
            }
        }
        let words = greedy(&mut Loops, 9, 1, 9, 100).unwrap();
        assert_eq!(words, vec![3, 4, 5]);
    }

    #[test]
    fn scores_that_are_not_numbers_are_skipped() {
        struct Broken;
        impl Step for Broken {
            fn next_scores(&mut self, _: &[i64]) -> Result<Vec<f32>, super::super::OnnxError> {
                Ok(vec![f32::NAN; 5])
            }
        }
        assert_eq!(greedy(&mut Broken, 4, 1, 4, 10).unwrap(), Vec::<i64>::new());
    }
}
