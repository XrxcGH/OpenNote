//! Telling voices apart (A1-5). Each stretch of speech gets a small voice print, made of the average shape of its
//! sound spectrum (mel cepstral coefficients) and its pitch. Stretches whose prints are close belong to one voice.
//! Everything runs here on the processor, reads nothing but the recording being transcribed, and keeps nothing:
//! the prints are dropped when the job ends. The prints are a plain signal-processing kind, not a neural model, so
//! they separate voices that sound clearly different and can confuse voices that sound alike. The labels are
//! "Speaker 1", "Speaker 2", and so on, in the order the voices first speak; the person renames them.

mod cluster;
mod features;
mod tee;

pub use cluster::{label_ranges, MAX_SPEAKERS};
pub use features::{Frame, FrameStream, FRAMES_PER_SECOND, MAX_FRAMES};
pub use tee::{Listening, Tee};
