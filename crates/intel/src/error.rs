//! The error type every engine in this crate returns.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::settings::Feature;
use crate::transcribe::Device;

/// Why an on-device intelligence call failed.
///
/// The type is `Clone` so that a job queue can keep a failure and hand it to several readers.
/// Errors from the operating system are kept as text for the same reason.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum IntelError {
    /// The feature has no engine on this platform.
    #[error("{feature} is not available on this platform")]
    Unsupported {
        /// The feature, such as "text recognition".
        feature: &'static str,
    },
    /// No recognizer is installed for the language.
    #[error("no recognizer is installed for {0}")]
    LanguageUnavailable(String),
    /// No voice is installed, so nothing can be read aloud until the person adds one in the system settings.
    #[error("no voice is installed on this computer")]
    VoiceUnavailable,
    /// The image is larger than the engine accepts.
    #[error("the image is {width} by {height} pixels, and the limit is {max} on each side and {max_pixels} in all")]
    ImageTooLarge {
        /// Image width in pixels.
        width: u32,
        /// Image height in pixels.
        height: u32,
        /// The longest side the engine accepts.
        max: u32,
        /// The most pixels an image may have.
        max_pixels: u64,
    },
    /// The input is malformed, such as a pixel buffer of the wrong length.
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// The requested device is not present.
    #[error("the {0} is not available on this computer")]
    DeviceUnavailable(Device),
    /// The speech model has not been downloaded, because the person has not agreed to it yet.
    #[error("the speech model \"{model}\" is not on this computer")]
    ModelMissing {
        /// The model's name.
        model: String,
    },
    /// The job was canceled before it finished.
    #[error("the job was canceled")]
    Canceled,
    /// Reading the audio failed.
    #[error("reading the audio failed: {0}")]
    Audio(String),
    /// An engine failed, such as the transcription or the speech engine.
    #[error("the engine failed: {0}")]
    Engine(String),
    /// The operating system reported an error.
    #[error("the operating system reported an error: {0}")]
    Platform(String),
    /// The person has not turned the feature on.
    #[error("{0} is turned off")]
    Disabled(Feature),
}

/// An error as the interface receives it: a stable code to branch on, and a sentence to show.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    /// What kind of failure it was. One of `unsupported`, `languageUnavailable`, `voiceUnavailable`,
    /// `imageTooLarge`, `invalidInput`, `deviceUnavailable`, `modelMissing`, `canceled`, `audio`, `engine`,
    /// `platform`, or `disabled`.
    pub code: String,
    /// A sentence in plain words.
    pub message: String,
    /// For `disabled`, the feature to offer to turn on.
    pub feature: Option<Feature>,
}

impl IntelError {
    /// The error in the form the interface receives.
    pub fn info(&self) -> ErrorInfo {
        let code = match self {
            IntelError::Unsupported { .. } => "unsupported",
            IntelError::LanguageUnavailable(_) => "languageUnavailable",
            IntelError::VoiceUnavailable => "voiceUnavailable",
            IntelError::ImageTooLarge { .. } => "imageTooLarge",
            IntelError::InvalidInput(_) => "invalidInput",
            IntelError::DeviceUnavailable(_) => "deviceUnavailable",
            IntelError::ModelMissing { .. } => "modelMissing",
            IntelError::Canceled => "canceled",
            IntelError::Audio(_) => "audio",
            IntelError::Engine(_) => "engine",
            IntelError::Platform(_) => "platform",
            IntelError::Disabled(_) => "disabled",
        };
        ErrorInfo {
            code: code.to_owned(),
            message: self.to_string(),
            feature: match self {
                IntelError::Disabled(feature) => Some(*feature),
                _ => None,
            },
        }
    }
}

#[cfg(windows)]
impl From<windows::core::Error> for IntelError {
    fn from(error: windows::core::Error) -> Self {
        let message = error.message();
        if message.is_empty() {
            IntelError::Platform(format!("error code {:#010x}", error.code().0))
        } else {
            IntelError::Platform(message)
        }
    }
}
