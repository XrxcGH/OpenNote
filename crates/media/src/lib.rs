//! OpenNote's media crate. Today it holds audio recording; transcription and OCR adapters come later.
//! See [`audio`] for how a recording flows from the microphone to a file.

pub mod audio;
pub mod convert;
pub mod edit;
pub mod layout;
pub mod meeting;
pub mod pcm_codec;
pub mod playback;
pub mod positions;
pub mod service;
pub mod stamps;
pub mod storage;
pub mod transcribe;
