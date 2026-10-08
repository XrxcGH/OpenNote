//! Handwriting recognition: words, alternatives, and stroke IDs from ink.
//!
//! [`InkRecognizer`] is the platform-neutral interface. On Windows, [`default_recognizer`] returns
//! a recognizer backed by the Windows Ink Analysis API, which groups strokes into lines and words.

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::Rect;

mod key;
#[cfg(all(windows, feature = "winrt"))]
mod winrt;
#[cfg(all(windows, feature = "winrt", feature = "unstable-engines"))]
pub use self::winrt::WindowsInk;
#[cfg(all(windows, feature = "winrt", not(feature = "unstable-engines")))]
use self::winrt::WindowsInk;

pub use self::key::StrokeKey;

/// The most strokes one call accepts. A page the size of a sheet of paper holds far fewer.
pub const MAX_STROKES: usize = 50_000;
/// The most points one stroke may carry, the same limit as the note file format.
pub const MAX_POINTS: usize = 200_000;
/// The largest coordinate a point may have, in either direction. A page is far smaller, and the limit
/// keeps the arithmetic of the recognizers and of tidying finite.
pub const MAX_COORDINATE: f32 = 1e7;

/// A point of a stroke, in page units with y growing downward. In JSON it is the pair `[x, y]`, which is
/// half the size of an object and a page holds many thousands of points.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "(f32, f32)", into = "(f32, f32)")]
pub struct InkPoint {
    /// Horizontal position.
    pub x: f32,
    /// Vertical position.
    pub y: f32,
}

/// A finished stroke. Apply the stroke's own transform to the points before passing it in.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InkStroke {
    /// Comes back in [`InkWord::strokes`].
    pub key: StrokeKey,
    /// The points in drawing order.
    pub points: Vec<InkPoint>,
}

impl InkStroke {
    /// Checks the point count and that every coordinate is a finite number within [`MAX_COORDINATE`].
    pub fn validate(&self) -> Result<(), IntelError> {
        // `abs() <= MAX` is false for NaN, so this also refuses every coordinate that is not a number.
        let in_range = |v: f32| v.abs() <= MAX_COORDINATE;
        let finite = self.points.iter().all(|p| in_range(p.x) && in_range(p.y));
        if self.points.is_empty() || self.points.len() > MAX_POINTS || !finite {
            return Err(IntelError::InvalidInput(format!(
                "a stroke needs 1 to {MAX_POINTS} points within {MAX_COORDINATE} of zero, and this one has {}",
                self.points.len()
            )));
        }
        Ok(())
    }
}

impl From<(f32, f32)> for InkPoint {
    fn from((x, y): (f32, f32)) -> Self {
        InkPoint { x, y }
    }
}

impl From<InkPoint> for (f32, f32) {
    fn from(point: InkPoint) -> Self {
        (point.x, point.y)
    }
}

/// How to treat the strokes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StrokeKind {
    /// Let the recognizer tell writing from drawing. Use this to index a whole page.
    #[default]
    Auto,
    /// Treat every stroke as writing. Use this for a "Writing pen" that converts as the person writes.
    Writing,
}

/// Settings for one recognition call.
#[derive(Clone, Debug, Default)]
pub struct InkOptions {
    /// Whether to trust that the strokes are writing.
    pub kind: StrokeKind,
}

/// One recognized word.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InkWord {
    /// The best reading.
    pub text: String,
    /// Other readings, most likely first. The best reading is not repeated here.
    pub alternates: Vec<String>,
    /// The strokes that make up the word, by the keys the caller gave.
    pub strokes: Vec<StrokeKey>,
    /// The box around the word, in the units of the points.
    pub bounds: Rect,
}

/// A line of handwriting.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct InkLine {
    /// The line as recognized.
    pub text: String,
    /// The box around the line.
    pub bounds: Rect,
    /// The words in reading order.
    pub words: Vec<InkWord>,
}

/// What a recognizer found in a set of strokes.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct InkRecognition {
    /// The lines of writing, from top to bottom. Strokes judged to be drawing are left out.
    pub lines: Vec<InkLine>,
}

impl InkRecognition {
    /// All the text, one line per row.
    pub fn text(&self) -> String {
        self.lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// A handwriting recognizer. Every call runs on the device and makes no network request.
///
/// Calls block until the recognizer finishes, so run them on a worker thread.
pub trait InkRecognizer: Send + Sync {
    /// Reads the handwriting in a set of strokes.
    fn recognize(&self, strokes: &[InkStroke], options: &InkOptions) -> Result<InkRecognition, IntelError>;

    /// Checks that a handwriting recognizer is installed, and says why not. The settings screen shows it.
    fn check_ready(&self) -> Result<(), IntelError> {
        Ok(())
    }
}

engine_api! {
    /// The recognizer for this platform.
    fn default_recognizer() -> Result<Box<dyn InkRecognizer>, IntelError> {
        #[cfg(all(windows, feature = "winrt"))]
        {
            Ok(Box::new(WindowsInk::new()))
        }
        #[cfg(not(all(windows, feature = "winrt")))]
        {
            Err(IntelError::Unsupported {
                feature: "handwriting recognition",
            })
        }
    }
}

/// Checks the stroke count and every stroke, for the platform recognizers.
pub(crate) fn validate_all(strokes: &[InkStroke]) -> Result<(), IntelError> {
    if strokes.len() > MAX_STROKES {
        return Err(IntelError::InvalidInput(format!(
            "{} strokes is more than the limit of {MAX_STROKES}",
            strokes.len()
        )));
    }
    strokes.iter().try_for_each(InkStroke::validate)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stroke(points: &[(f32, f32)]) -> InkStroke {
        InkStroke {
            key: StrokeKey([0; 16]),
            points: points.iter().map(|&(x, y)| InkPoint { x, y }).collect(),
        }
    }

    #[test]
    fn strokes_need_finite_points() {
        assert!(stroke(&[(0.0, 0.0), (1.0, 1.0)]).validate().is_ok());
        assert!(stroke(&[]).validate().is_err());
        assert!(stroke(&[(f32::NAN, 0.0)]).validate().is_err());
        assert!(validate_all(&[stroke(&[(0.0, f32::INFINITY)])]).is_err());
    }

    #[test]
    fn strokes_need_coordinates_of_a_sensible_size() {
        assert!(stroke(&[(-MAX_COORDINATE, MAX_COORDINATE)]).validate().is_ok());
        assert!(stroke(&[(0.0, 0.0), (1e11, 10.0)]).validate().is_err());
        assert!(stroke(&[(0.0, -2e7)]).validate().is_err());
    }
}
