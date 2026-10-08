//! Tidying recognized handwriting: level the lines, even out the spacing, or wrap to a new width.
//!
//! The functions work on strokes and the recognition of them (see [`crate::ink`]) and return a plan of
//! moves. They change nothing themselves. The recognition says which strokes make which word and which
//! words make a line. The geometry comes from the strokes' own points, so a loose recognizer box does not
//! move anything. The strokes stay ink: no stroke is changed except by an [`Affine`] move, and the caller
//! keeps the originals so one undo reverses the change.
//!
//! A move is in page units, applied to the points after the stroke's own transform. A caller that stores
//! a transform on the stroke combines the two, for example `old.then(move)`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::Rect;
use crate::ink::{validate_all, InkRecognition, InkStroke};

mod affine;
mod model;
mod reflow;
mod spacing;
mod straighten;

pub use self::affine::{Affine, StrokeMove};

/// What to do to the writing.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TidyOperation {
    /// Level each line by turning it a little.
    Straighten,
    /// Make the gaps between words alike, and the sizes of words alike.
    EvenSpacing,
    /// Wrap the writing to a width in page units.
    Reflow {
        /// The width of the block, which must be more than zero.
        width: f32,
    },
}

/// The moves that carry out an operation.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyPlan {
    /// One move for each stroke that changes, in the order of the strokes given.
    pub moves: Vec<StrokeMove>,
    /// The box around the moved strokes after the moves, or `None` when nothing moves.
    pub bounds: Option<Rect>,
}

impl TidyPlan {
    /// The strokes after the moves. A stroke with no move is returned as it was.
    pub fn apply(&self, strokes: &[InkStroke]) -> Vec<InkStroke> {
        let by_key: HashMap<_, _> = self.moves.iter().map(|m| (m.key, m)).collect();
        strokes
            .iter()
            .map(|stroke| match by_key.get(&stroke.key) {
                Some(found) => found.apply_to(stroke),
                None => stroke.clone(),
            })
            .collect()
    }
}

/// The move for each stroke, collected as the operations run.
pub(crate) struct Moves {
    per_stroke: Vec<Affine>,
}

impl Moves {
    fn new(count: usize) -> Moves {
        Moves {
            per_stroke: vec![Affine::IDENTITY; count],
        }
    }

    /// Adds a move after whatever the strokes already have.
    fn add(&mut self, indexes: &[usize], transform: Affine) {
        for &i in indexes {
            self.per_stroke[i] = self.per_stroke[i].then(transform);
        }
    }

    /// The plan, leaving out strokes that move by less than a tenth of a page unit.
    fn into_plan(self, strokes: &[InkStroke]) -> TidyPlan {
        let mut moves = Vec::new();
        let mut moved = Vec::new();
        for (stroke, transform) in strokes.iter().zip(self.per_stroke) {
            if transform.is_negligible(0.1) {
                continue;
            }
            let step = StrokeMove {
                key: stroke.key,
                transform,
            };
            moved.extend(model::bounds_of(&[step.apply_to(stroke)], &[0]));
            moves.push(step);
        }
        TidyPlan {
            moves,
            bounds: Rect::union_all(&moved),
        }
    }
}

engine_api! {
    /// Plans a tidy operation for the writing in `strokes`, as `recognition` grouped it.
    ///
    /// Words whose strokes are not in `strokes` are skipped, and so are strokes the recognition did not call
    /// writing, such as a drawing. A reflow width that is not a positive number is [`IntelError::InvalidInput`].
    fn plan(
        strokes: &[InkStroke],
        recognition: &InkRecognition,
        operation: &TidyOperation,
    ) -> Result<TidyPlan, IntelError> {
        validate_all(strokes)?;
        let lines = model::lines_of(strokes, recognition);
        let mut moves = Moves::new(strokes.len());
        match *operation {
            TidyOperation::Straighten => straighten::straighten(strokes, &lines, &mut moves),
            TidyOperation::EvenSpacing => spacing::even_spacing(&lines, &mut moves),
            TidyOperation::Reflow { width } => {
                if !width.is_finite() || width <= 0.0 {
                    return Err(IntelError::InvalidInput(format!(
                        "a reflow width must be above zero, and {width} is not"
                    )));
                }
                reflow::reflow(&lines, width, &mut moves);
            }
        }
        Ok(moves.into_plan(strokes))
    }
}
