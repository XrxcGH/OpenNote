//! A handwriting recognizer that replays recorded answers.

use serde::{Deserialize, Serialize};

use super::Fingerprint;
use crate::error::IntelError;
use crate::ink::{validate_all, InkOptions, InkRecognition, InkRecognizer, InkStroke, StrokeKind};

/// The fingerprint of one recognition call: the keys, the exact points, and the stroke kind.
pub fn ink_fingerprint(strokes: &[InkStroke], options: &InkOptions) -> Fingerprint {
    let kind = match options.kind {
        StrokeKind::Auto => 0,
        StrokeKind::Writing => 1,
    };
    let mut print = Fingerprint::default().u32(kind).u32(strokes.len() as u32);
    for stroke in strokes {
        print = print.bytes(&stroke.key.0).u32(stroke.points.len() as u32);
        for point in &stroke.points {
            print = print.f32(point.x).f32(point.y);
        }
    }
    print
}

/// One recorded answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkRecording {
    /// What the recording shows, for people reading the file.
    pub name: String,
    /// The input's fingerprint as 16 hexadecimal digits.
    pub fingerprint: String,
    /// What the engine returned.
    pub recognition: InkRecognition,
}

impl InkRecording {
    /// Records `recognition` as the answer for these strokes and options.
    pub fn new(name: &str, strokes: &[InkStroke], options: &InkOptions, recognition: InkRecognition) -> InkRecording {
        InkRecording {
            name: name.to_owned(),
            fingerprint: ink_fingerprint(strokes, options).to_hex(),
            recognition,
        }
    }
}

/// A file of ink recordings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedInk {
    /// The recordings.
    pub recordings: Vec<InkRecording>,
}

/// Answers from recordings, and refuses any strokes it has no recording for.
#[derive(Clone, Debug, Default)]
pub struct ReplayInk {
    recordings: Vec<InkRecording>,
    fallback: Option<InkRecognition>,
}

impl ReplayInk {
    /// A recognizer that knows these recordings.
    pub fn new(recordings: Vec<InkRecording>) -> ReplayInk {
        ReplayInk {
            recordings,
            fallback: None,
        }
    }

    /// Reads a [`RecordedInk`] file.
    pub fn from_json(json: &str) -> Result<ReplayInk, IntelError> {
        let file: RecordedInk = serde_json::from_str(json)
            .map_err(|e| IntelError::InvalidInput(format!("the ink recordings are not valid: {e}")))?;
        Ok(ReplayInk::new(file.recordings))
    }

    /// Gives this answer to strokes with no recording, so an interface test needs no recording per input.
    pub fn with_fallback(mut self, recognition: InkRecognition) -> ReplayInk {
        self.fallback = Some(recognition);
        self
    }
}

impl InkRecognizer for ReplayInk {
    fn recognize(&self, strokes: &[InkStroke], options: &InkOptions) -> Result<InkRecognition, IntelError> {
        validate_all(strokes)?;
        let print = ink_fingerprint(strokes, options).to_hex();
        if let Some(found) = self.recordings.iter().find(|r| r.fingerprint == print) {
            return Ok(found.recognition.clone());
        }
        self.fallback.clone().ok_or_else(|| {
            IntelError::InvalidInput(format!(
                "there is no recording for these {} strokes ({print})",
                strokes.len()
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::{InkLine, InkPoint, InkWord, StrokeKey};
    use crate::Rect;

    fn stroke(id: u8, points: &[(f32, f32)]) -> InkStroke {
        InkStroke {
            key: StrokeKey([id; 16]),
            points: points.iter().map(|&(x, y)| InkPoint { x, y }).collect(),
        }
    }

    fn answer(text: &str, key: u8) -> InkRecognition {
        let bounds = Rect::default();
        InkRecognition {
            lines: vec![InkLine {
                text: text.to_owned(),
                bounds,
                words: vec![InkWord {
                    text: text.to_owned(),
                    alternates: vec![],
                    strokes: vec![StrokeKey([key; 16])],
                    bounds,
                }],
            }],
        }
    }

    #[test]
    fn replays_the_answer_for_the_same_strokes_and_refuses_others() {
        let one = [stroke(1, &[(0.0, 0.0), (5.0, 5.0)])];
        let moved = [stroke(1, &[(0.0, 0.0), (5.0, 5.5)])];
        let options = InkOptions::default();
        let replay = ReplayInk::new(vec![InkRecording::new("one", &one, &options, answer("one", 1))]);
        assert_eq!(replay.recognize(&one, &options).unwrap().text(), "one");
        assert!(
            replay.recognize(&moved, &options).is_err(),
            "a moved point is another input"
        );
        let writing = InkOptions {
            kind: StrokeKind::Writing,
        };
        assert!(
            replay.recognize(&one, &writing).is_err(),
            "the stroke kind is part of the input"
        );
    }

    #[test]
    fn invalid_strokes_fail_like_the_real_engine() {
        let replay = ReplayInk::default().with_fallback(answer("any", 0));
        let nan = [stroke(1, &[(f32::NAN, 0.0)])];
        assert!(replay.recognize(&nan, &InkOptions::default()).is_err());
        let fine = [stroke(2, &[(1.0, 1.0)])];
        assert_eq!(replay.recognize(&fine, &InkOptions::default()).unwrap().text(), "any");
    }

    #[test]
    fn recordings_survive_a_trip_through_json() {
        let strokes = [stroke(7, &[(1.0, 2.0), (3.0, 4.0)])];
        let options = InkOptions::default();
        let file = RecordedInk {
            recordings: vec![InkRecording::new("seven", &strokes, &options, answer("seven", 7))],
        };
        let json = serde_json::to_string(&file).unwrap();
        let replay = ReplayInk::from_json(&json).unwrap();
        assert_eq!(replay.recognize(&strokes, &options).unwrap().text(), "seven");
        assert!(ReplayInk::from_json("{").is_err());
    }
}
