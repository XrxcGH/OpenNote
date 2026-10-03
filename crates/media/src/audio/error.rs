//! The error type for audio recording.

use std::fmt;

/// What can go wrong while recording, encoding, or recovering audio.
#[derive(Debug)]
pub enum AudioError {
    /// A file could not be read or written.
    Io(std::io::Error),
    /// The audio device failed, or there is none.
    Device(String),
    /// The encoder failed, or this build has none.
    Encoder(String),
    /// The device format is one the recorder can't handle.
    Format(String),
    /// A recording file is damaged beyond recovery.
    Corrupt(String),
    /// The writer thread stopped before the recording ended.
    Writer(String),
}

/// A result with an [`AudioError`].
pub type Result<T> = std::result::Result<T, AudioError>;

impl fmt::Display for AudioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AudioError::Io(error) => write!(f, "Audio file error: {error}"),
            AudioError::Device(message) => write!(f, "Audio device error: {message}"),
            AudioError::Encoder(message) => write!(f, "Audio encoder error: {message}"),
            AudioError::Format(message) => write!(f, "Unsupported audio format: {message}"),
            AudioError::Corrupt(message) => write!(f, "Damaged recording: {message}"),
            AudioError::Writer(message) => write!(f, "The recording writer stopped: {message}"),
        }
    }
}

impl std::error::Error for AudioError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AudioError::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AudioError {
    fn from(error: std::io::Error) -> Self {
        AudioError::Io(error)
    }
}
