//! The macOS OCR engine, on top of the Vision framework's text recognition (`VNRecognizeTextRequest` at the
//! accurate level, which also reads handwriting). Vision runs on the device and needs no language pack.

use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, NSObjectProtocol};
use objc2::{msg_send, sel, AnyThread};
use objc2_core_foundation::{CFData, CGRect};
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage, CGImageAlphaInfo,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSRange, NSString};
use objc2_vision::{
    VNImageRequestHandler, VNRecognizeTextRequest, VNRecognizedText, VNRectangleObservation, VNRequest,
    VNRequestTextRecognitionLevel,
};

use super::words::{from_unit_box, share_of_line, split_words};
use super::{OcrEngine, OcrImage, OcrLine, OcrOptions, OcrResult, OcrWord, PixelFormat};
use crate::error::IntelError;
use crate::geometry::{Language, Rect};

/// OCR through Apple's Vision framework.
#[derive(Debug, Default)]
pub struct VisionOcr;

impl VisionOcr {
    /// Creates the engine. Vision makes its recognizer for each call.
    pub fn new() -> VisionOcr {
        VisionOcr
    }
}

fn platform(error: Retained<NSError>) -> IntelError {
    IntelError::Platform(error.localizedDescription().to_string())
}

fn text_request() -> Retained<VNRecognizeTextRequest> {
    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    request
}

impl OcrEngine for VisionOcr {
    fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
        autoreleasepool(|_| {
            let request = text_request();
            let tags = if request.respondsToSelector(sel!(supportedRecognitionLanguagesAndReturnError:)) {
                // SAFETY: the request is a live text request that answers this selector (macOS 12 and later).
                unsafe { request.supportedRecognitionLanguagesAndReturnError() }.map_err(platform)?
            } else {
                languages_before_monterey(&request)?
            };
            Ok(to_languages(&tags))
        })
    }

    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError> {
        autoreleasepool(|_| {
            let picture = to_cg_image(image)?;
            let request = text_request();
            if let Some(language) = &options.language {
                let tag = NSString::from_str(language.as_str());
                request.setRecognitionLanguages(&NSArray::from_retained_slice(&[tag]));
            }
            let no_options: Retained<NSDictionary<_, AnyObject>> = NSDictionary::new();
            // SAFETY: the image is a valid CGImage that outlives the handler, and the options are empty.
            let handler = unsafe {
                VNImageRequestHandler::initWithCGImage_options(VNImageRequestHandler::alloc(), &picture, &no_options)
            };
            let base: &VNRequest = &request;
            handler
                .performRequests_error(&NSArray::from_slice(&[base]))
                .map_err(platform)?;
            let language = match &options.language {
                Some(language) => language.clone(),
                // SAFETY: the request is live; this reads the languages it used.
                None => unsafe { request.recognitionLanguages() }
                    .firstObject()
                    .and_then(|tag| Language::new(&tag.to_string()).ok())
                    .unwrap_or(Language::new("en-US")?),
            };
            let (width, height) = (image.width(), image.height());
            let mut lines = Vec::new();
            for observation in request.results().map(|found| found.to_vec()).unwrap_or_default() {
                let Some(best) = observation.topCandidates(1).firstObject() else {
                    continue;
                };
                let text = best.string().to_string();
                if text.trim().is_empty() {
                    continue;
                }
                // SAFETY: a recognized-text observation always has a box.
                let unit: CGRect = unsafe { observation.boundingBox() };
                let bounds = pixels(unit, width, height);
                let words = words_of(&best, &text, &bounds, width, height);
                lines.push(OcrLine { text, bounds, words });
            }
            Ok(OcrResult {
                language,
                lines,
                angle: None,
            })
        })
    }
}

/// The languages for the request's level and revision on macOS 11, which lacks the instance method above. Sending
/// that selector there would raise an Objective-C exception, which can't unwind through Rust and aborts the app.
fn languages_before_monterey(request: &VNRecognizeTextRequest) -> Result<Retained<NSArray<NSString>>, IntelError> {
    let base: &VNRequest = request;
    // SAFETY: the class method has been on VNRecognizeTextRequest since macOS 10.15; the revision is the request's own.
    #[allow(deprecated)]
    unsafe {
        VNRecognizeTextRequest::supportedRecognitionLanguagesForTextRecognitionLevel_revision_error(
            VNRequestTextRecognitionLevel::Accurate,
            base.revision(),
        )
    }
    .map_err(platform)
}

fn to_languages(tags: &NSArray<NSString>) -> Vec<Language> {
    tags.to_vec()
        .into_iter()
        .filter_map(|tag| Language::new(&tag.to_string()).ok())
        .collect()
}

fn pixels(unit: CGRect, width: u32, height: u32) -> Rect {
    from_unit_box(
        unit.origin.x,
        unit.origin.y,
        unit.size.width,
        unit.size.height,
        width,
        height,
    )
}

/// Each word of the line with its own box from Vision, or its share of the line's box when Vision has none.
fn words_of(best: &VNRecognizedText, text: &str, line: &Rect, width: u32, height: u32) -> Vec<OcrWord> {
    let chars = text.chars().count();
    split_words(text)
        .into_iter()
        .map(|span| {
            let range = NSRange::new(span.utf16_start, span.utf16_len);
            // SAFETY: the range is inside the candidate's string, counted in UTF-16 units as Foundation counts.
            let found: Result<Retained<VNRectangleObservation>, Retained<NSError>> =
                unsafe { msg_send![best, boundingBoxForRange: range, error: _] };
            let bounds = match found {
                // SAFETY: a rectangle observation always has a box.
                Ok(observation) => pixels(unsafe { observation.boundingBox() }, width, height),
                Err(_) => share_of_line(line, chars, &span),
            };
            OcrWord {
                text: span.text.to_owned(),
                bounds,
            }
        })
        .collect()
}

/// A CGImage over a copy of the pixels: gray, or RGBA with straight alpha.
fn to_cg_image(image: &OcrImage) -> Result<objc2_core_foundation::CFRetained<CGImage>, IntelError> {
    let failed = || IntelError::Platform("Core Graphics couldn't make an image of the pixels".to_owned());
    let (space, bits, alpha) = match image.format() {
        PixelFormat::Gray8 => (CGColorSpace::new_device_gray(), 8, CGImageAlphaInfo::None),
        PixelFormat::Rgba8 => (CGColorSpace::new_device_rgb(), 32, CGImageAlphaInfo::Last),
    };
    let space = space.ok_or_else(failed)?;
    let data = CFData::from_bytes(image.pixels());
    let provider = CGDataProvider::with_cf_data(Some(&data)).ok_or_else(failed)?;
    let width = image.width() as usize;
    // SAFETY: the sizes match the pixels, which OcrImage checked, and `decode` may be null.
    unsafe {
        CGImage::new(
            width,
            image.height() as usize,
            8,
            bits,
            width * image.format().bytes_per_pixel(),
            Some(&space),
            CGBitmapInfo(alpha.0),
            Some(&provider),
            std::ptr::null(),
            false,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    }
    .ok_or_else(failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The macOS 11 path, run on whatever Mac the tests run on: the class method still answers there.
    #[test]
    fn the_big_sur_language_list_reads_without_the_instance_method() {
        let languages = autoreleasepool(|_| languages_before_monterey(&text_request()).map(|tags| to_languages(&tags)))
            .expect("the class method answers");
        assert!(
            languages.iter().any(|language| language.as_str().starts_with("en")),
            "{languages:?}"
        );
    }
}
