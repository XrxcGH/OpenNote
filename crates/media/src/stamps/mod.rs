//! The timestamp map: how everything written during a recording links back to its audio.
//!
//! Handwriting needs no new data, since every stroke already stores its start time (spec 9.3). The
//! recording's clock anchor turns that Unix time into a capture time, and the recording's position
//! map turns the capture time into a place in the audio. Text has no times of its own, so a block
//! keeps [`TextMarks`], which say when each stretch of it was typed. The [`StampIndex`] collects
//! strokes, marks, objects, and flags for lookups in both directions: tap a word and hear that
//! moment, or play the audio and highlight what was being written.

pub mod index;
pub mod text;

pub use index::{Entry, Seek, StampIndex, Target};
pub use text::{Stamp, TextMark, TextMarks};
