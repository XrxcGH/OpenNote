//! An OCR engine that replays recorded answers.

use serde::{Deserialize, Serialize};

use super::Fingerprint;
use crate::error::IntelError;
use crate::geometry::Language;
use crate::ocr::{OcrEngine, OcrImage, OcrOptions, OcrResult, PixelFormat};

/// The longest side the Windows engine accepts, which the replay engine refuses beyond as well.
pub const MAX_IMAGE_SIDE: u32 = crate::ocr::MAX_IMAGE_SIDE;

/// The fingerprint of one recognition call: the pixels, their layout, and the language asked for.
pub fn ocr_fingerprint(image: &OcrImage, options: &OcrOptions) -> Fingerprint {
    let format = match image.format() {
        PixelFormat::Rgba8 => 0,
        PixelFormat::Gray8 => 1,
    };
    Fingerprint::default()
        .u32(image.width())
        .u32(image.height())
        .u32(format)
        .text(options.language.as_ref().map_or("", Language::as_str))
        .bytes(image.pixels())
}

/// One recorded answer.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecording {
    /// What the recording shows, for people reading the file.
    pub name: String,
    /// The input's fingerprint as 16 hexadecimal digits.
    pub fingerprint: String,
    /// What the engine returned.
    pub result: OcrResult,
}

impl OcrRecording {
    /// Records `result` as the answer for this image and these options.
    pub fn new(name: &str, image: &OcrImage, options: &OcrOptions, result: OcrResult) -> OcrRecording {
        OcrRecording {
            name: name.to_owned(),
            fingerprint: ocr_fingerprint(image, options).to_hex(),
            result,
        }
    }
}

/// A file of OCR recordings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedOcr {
    /// The recordings.
    pub recordings: Vec<OcrRecording>,
}

/// Answers from recordings, and refuses any image it has no recording for.
///
/// Like the Windows engine, it reports only the languages it can recognize, which are the languages of its
/// recordings, and refuses a language outside them.
#[derive(Clone, Debug, Default)]
pub struct ReplayOcr {
    recordings: Vec<OcrRecording>,
    languages: Vec<Language>,
}

impl ReplayOcr {
    /// An engine that knows these recordings, and the languages they were recorded in.
    pub fn new(recordings: Vec<OcrRecording>) -> ReplayOcr {
        let mut languages: Vec<Language> = Vec::new();
        for recording in &recordings {
            if !languages.contains(&recording.result.language) {
                languages.push(recording.result.language.clone());
            }
        }
        ReplayOcr { recordings, languages }
    }

    /// Reads a [`RecordedOcr`] file.
    pub fn from_json(json: &str) -> Result<ReplayOcr, IntelError> {
        let file: RecordedOcr = serde_json::from_str(json)
            .map_err(|e| IntelError::InvalidInput(format!("the OCR recordings are not valid: {e}")))?;
        Ok(ReplayOcr::new(file.recordings))
    }
}

impl OcrEngine for ReplayOcr {
    fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
        Ok(self.languages.clone())
    }

    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError> {
        if let Some(language) = &options.language {
            if !self.languages.iter().any(|known| known.primary() == language.primary()) {
                return Err(IntelError::LanguageUnavailable(language.to_string()));
            }
        }
        if image.width() > MAX_IMAGE_SIDE || image.height() > MAX_IMAGE_SIDE {
            return Err(IntelError::ImageTooLarge {
                width: image.width(),
                height: image.height(),
                max: MAX_IMAGE_SIDE,
                max_pixels: crate::ocr::MAX_IMAGE_PIXELS,
            });
        }
        let print = ocr_fingerprint(image, options).to_hex();
        self.recordings
            .iter()
            .find(|r| r.fingerprint == print)
            .map(|r| r.result.clone())
            .ok_or_else(|| {
                IntelError::InvalidInput(format!(
                    "there is no recording for this {} by {} image ({print})",
                    image.width(),
                    image.height()
                ))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ocr::{OcrLine, OcrWord};
    use crate::Rect;

    fn image(shade: u8) -> OcrImage {
        OcrImage::new(4, 2, PixelFormat::Gray8, vec![shade; 8]).unwrap()
    }

    fn result(text: &str) -> OcrResult {
        let bounds = Rect {
            x: 1.0,
            y: 1.0,
            width: 2.0,
            height: 1.0,
        };
        OcrResult {
            language: Language::new("en-US").unwrap(),
            lines: vec![OcrLine {
                text: text.to_owned(),
                bounds,
                words: vec![OcrWord {
                    text: text.to_owned(),
                    bounds,
                }],
            }],
            angle: Some(0.5),
        }
    }

    fn engine() -> ReplayOcr {
        let options = OcrOptions::default();
        ReplayOcr::new(vec![OcrRecording::new("gray", &image(9), &options, result("gray"))])
    }

    #[test]
    fn replays_the_answer_for_the_same_pixels_and_refuses_others() {
        let options = OcrOptions::default();
        assert_eq!(engine().recognize(&image(9), &options).unwrap().text(), "gray");
        assert!(engine().recognize(&image(10), &options).is_err());
    }

    #[test]
    fn the_language_is_part_of_the_input_and_must_be_known() {
        let en = OcrOptions {
            language: Some(Language::new("en").unwrap()),
        };
        // A named language is another input, so it needs its own recording.
        assert!(matches!(
            engine().recognize(&image(9), &en),
            Err(IntelError::InvalidInput(_))
        ));
        let fr = OcrOptions {
            language: Some(Language::new("fr-FR").unwrap()),
        };
        assert_eq!(
            engine().recognize(&image(9), &fr),
            Err(IntelError::LanguageUnavailable("fr-FR".to_owned()))
        );
        let languages = engine().available_languages().unwrap();
        assert_eq!(languages, [Language::new("en-US").unwrap()]);
    }

    #[test]
    fn a_huge_image_is_refused_before_it_reaches_an_engine() {
        let wide = OcrImage::new(
            MAX_IMAGE_SIDE + 1,
            1,
            PixelFormat::Gray8,
            vec![0; MAX_IMAGE_SIDE as usize + 1],
        );
        assert!(matches!(wide, Err(IntelError::ImageTooLarge { .. })));
    }

    #[test]
    fn recordings_survive_a_trip_through_json() {
        let file = RecordedOcr {
            recordings: vec![OcrRecording::new("g", &image(3), &OcrOptions::default(), result("g"))],
        };
        let replay = ReplayOcr::from_json(&serde_json::to_string(&file).unwrap()).unwrap();
        assert_eq!(replay.recognize(&image(3), &OcrOptions::default()).unwrap().text(), "g");
    }
}
