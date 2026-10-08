//! The JSON the interface and this crate exchange, for the app's command layer to pass through.
//!
//! The wiring layer in the app crate receives these requests from the interface and calls [`Engines`].
//! It returns the result types of the other modules, which already serialize in the shape the TypeScript
//! client in `app/src/services/intel` expects. `tests/wire.rs` writes a sample of every shape to
//! `tests/fixtures/wire`. The client's tests read those files, so the two sides cannot drift.
//!
//! Field names are camelCase. Offsets into text are UTF-16 units. Strokes carry their ID as the
//! 26-character text, and a point is `[x, y]`.
//!
//! [`Engines`]: crate::Engines

use serde::{Deserialize, Serialize};

use crate::base64;
use crate::engines::Engines;
use crate::error::IntelError;
use crate::geometry::Language;
use crate::ink::{InkOptions, InkStroke, StrokeKind};
use crate::ocr::{check_image_size, OcrImage, OcrOptions, PixelFormat};
use crate::summarize::{ChapterOptions, KeywordOptions, SummaryOptions};
use crate::tidy::TidyOperation;
use crate::transcribe::Transcript;
use crate::vocabulary::Vocabulary;

mod hub;
mod speech;

pub use self::hub::{SpeechHub, MAX_CLIPS, MAX_SESSIONS};
pub use self::speech::{ReadAloudNotice, ReadAloudRequest, ReadAloudStarted, SpeechClip, SynthesizeRequest};

// The result types, so the command layer names everything it passes through from this module.
pub use crate::engines::FeatureStatus;
pub use crate::error::ErrorInfo;
pub use crate::ink::InkRecognition;
pub use crate::ocr::OcrResult;
pub use crate::speech::{SpeechInfo, Voice};
pub use crate::summarize::{ActionItem, Chapter, Keyword, Summary};
pub use crate::tidy::TidyPlan;
pub use crate::vocabulary::{Change, Corrected, Offer};

/// Where the pixels of an image come from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OcrSource {
    /// Pixels in the request, as base64. Fit for a cropped region or a screenshot. A whole photo should
    /// be read from the notebook's own file instead, which a later source kind will allow.
    #[serde(rename_all = "camelCase")]
    Pixels {
        /// Width in pixels.
        width: u32,
        /// Height in pixels.
        height: u32,
        /// How the bytes are laid out.
        format: PixelFormat,
        /// The bytes, row by row from the top left with no padding, as base64.
        pixels: String,
    },
}

/// A request to read the text in an image.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    /// The image.
    pub source: OcrSource,
    /// The language to recognize, or `None` for the languages of the person's profile.
    #[serde(default)]
    pub language: Option<Language>,
}

impl OcrRequest {
    /// Checks the size against the limits and the length of the base64 text against the size, then decodes
    /// the pixels. A request that is too large or the wrong length is refused before anything is decoded.
    pub fn into_parts(self) -> Result<(OcrImage, OcrOptions), IntelError> {
        let OcrSource::Pixels {
            width,
            height,
            format,
            pixels,
        } = self.source;
        check_image_size(width, height)?;
        // The limits keep this under 128 MB, so it cannot overflow.
        let bytes = width as usize * height as usize * format.bytes_per_pixel();
        let expected = bytes.div_ceil(3) * 4;
        if pixels.len() != expected {
            return Err(IntelError::InvalidInput(format!(
                "a {width} by {height} {format:?} image needs {expected} base64 characters, not {}",
                pixels.len()
            )));
        }
        let image = OcrImage::new(width, height, format, base64::decode(&pixels)?)?;
        Ok((
            image,
            OcrOptions {
                language: self.language,
            },
        ))
    }
}

/// A request to read handwriting.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkRequest {
    /// The strokes, with each stroke's own transform already applied.
    pub strokes: Vec<InkStroke>,
    /// Whether to trust that the strokes are writing.
    #[serde(default)]
    pub kind: StrokeKind,
}

impl InkRequest {
    /// The options for the recognizer.
    pub fn options(&self) -> InkOptions {
        InkOptions { kind: self.kind }
    }
}

/// A request for a summary.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizeRequest {
    /// The text to summarize.
    pub text: String,
    /// How long the summary may be, and the language.
    #[serde(default)]
    pub options: SummaryOptions,
}

/// A request for keywords.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeywordsRequest {
    /// The text to read.
    pub text: String,
    /// How many keywords, how long, and the language.
    #[serde(default)]
    pub options: KeywordOptions,
}

/// A request to tidy handwriting that was already recognized.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyRequest {
    /// The strokes, with each stroke's own transform already applied.
    pub strokes: Vec<InkStroke>,
    /// What the recognizer made of them, which groups them into words and lines.
    pub recognition: InkRecognition,
    /// What to do.
    pub operation: TidyOperation,
}

/// A request to find tasks and decisions in a transcript.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionItemsRequest {
    /// The transcript.
    pub transcript: Transcript,
}

/// A request to cut a transcript into chapters.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersRequest {
    /// The transcript.
    pub transcript: Transcript,
    /// How many chapters, and how short they may be.
    #[serde(default)]
    pub options: ChapterOptions,
}

/// A request to offer a word for the custom vocabulary after the person fixed it in a transcript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyOfferRequest {
    /// The vocabulary in its plain-text form.
    pub vocabulary: String,
    /// The word as the transcript had it.
    pub original: String,
    /// The word as the person fixed it.
    pub fixed: String,
}

impl VocabularyOfferRequest {
    /// The term to offer, if any, after checking that transcription is on. The app calls this, because it cannot
    /// name [`Vocabulary`] itself.
    pub fn offer(&self, engines: &Engines) -> Result<Option<Offer>, IntelError> {
        engines.vocabulary_offer(&Vocabulary::parse(&self.vocabulary), &self.original, &self.fixed)
    }
}

/// A request to fix a transcript's text with a custom vocabulary. It needs no engine, because it only replaces words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyCorrectRequest {
    /// The vocabulary in its plain-text form.
    pub vocabulary: String,
    /// The transcript text to fix.
    pub text: String,
}

impl VocabularyCorrectRequest {
    /// The text with each listed mishearing replaced, and the replacements made.
    pub fn correct(&self) -> Corrected {
        Vocabulary::parse(&self.vocabulary).correct(&self.text)
    }
}

/// The base64 text of pixels, for building an [`OcrSource`].
pub fn encode_pixels(pixels: &[u8]) -> String {
    base64::encode(pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(width: u32, height: u32, pixels: String) -> OcrRequest {
        OcrRequest {
            source: OcrSource::Pixels {
                width,
                height,
                format: PixelFormat::Rgba8,
                pixels,
            },
            language: None,
        }
    }

    #[test]
    fn an_image_over_the_limits_is_refused_before_its_pixels_are_read() {
        // A 50-megapixel phone photo, whose pixels never need to arrive for the refusal.
        let error = request(8_160, 6_120, String::new()).into_parts().unwrap_err();
        assert!(
            matches!(error, IntelError::ImageTooLarge { width: 8_160, .. }),
            "{error:?}"
        );
        let error = request(100_000, 100_000, "AAAA".to_owned()).into_parts().unwrap_err();
        assert!(matches!(error, IntelError::ImageTooLarge { .. }), "{error:?}");
    }

    #[test]
    fn base64_of_the_wrong_length_is_refused_before_it_is_decoded() {
        // Not base64 at all, but the length is wrong, which is found without decoding a byte.
        let error = request(2, 2, "@".repeat(28)).into_parts().unwrap_err();
        assert!(
            error.to_string().contains("needs 24 base64 characters, not 28"),
            "{error}"
        );
        let (image, _) = request(2, 2, encode_pixels(&[7; 16])).into_parts().unwrap();
        assert_eq!(image.pixels(), [7; 16]);
    }
}
