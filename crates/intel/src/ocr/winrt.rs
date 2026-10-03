//! The Windows OCR engine, on top of Windows.Media.Ocr.

use windows::core::HSTRING;
use windows::Globalization::Language as WinLanguage;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::{OcrEngine as WinEngine, OcrResult as WinResult};
use windows::Storage::Streams::DataWriter;

use super::{OcrEngine, OcrImage, OcrLine, OcrOptions, OcrResult, OcrWord, PixelFormat};
use crate::error::IntelError;
use crate::geometry::{Language, Rect};

/// OCR through Windows.Media.Ocr. It needs an OCR language pack, which ships with Windows for
/// the languages in the person's profile.
#[derive(Debug, Default)]
pub struct WindowsOcr;

impl WindowsOcr {
    /// Creates the engine. The Windows engine for a language is made for each call.
    pub fn new() -> WindowsOcr {
        WindowsOcr
    }
}

impl OcrEngine for WindowsOcr {
    fn available_languages(&self) -> Result<Vec<Language>, IntelError> {
        let mut found = Vec::new();
        for language in WinEngine::AvailableRecognizerLanguages()? {
            found.push(Language::new(&language.LanguageTag()?.to_string())?);
        }
        Ok(found)
    }

    /// Recognition without a language named uses the languages of the person's Windows profile, so that is
    /// what must have a language pack.
    fn check_ready(&self) -> Result<(), IntelError> {
        create_engine(None).map(|_| ())
    }

    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError> {
        let engine = create_engine(options.language.as_ref())?;
        let max = WinEngine::MaxImageDimension()?;
        if image.width() > max || image.height() > max {
            return Err(IntelError::ImageTooLarge {
                width: image.width(),
                height: image.height(),
                max,
                max_pixels: super::MAX_IMAGE_PIXELS,
            });
        }
        let bitmap = to_bitmap(image)?;
        let found = engine.RecognizeAsync(&bitmap)?.join()?;
        let language = Language::new(&engine.RecognizerLanguage()?.LanguageTag()?.to_string())?;
        convert(&found, language)
    }
}

fn create_engine(language: Option<&Language>) -> Result<WinEngine, IntelError> {
    let Some(language) = language else {
        return WinEngine::TryCreateFromUserProfileLanguages()
            .map_err(|_| IntelError::LanguageUnavailable("any language of your Windows profile".to_owned()));
    };
    let unavailable = || IntelError::LanguageUnavailable(language.to_string());
    let win_language = WinLanguage::CreateLanguage(&HSTRING::from(language.as_str()))?;
    if !WinEngine::IsLanguageSupported(&win_language)? {
        return Err(unavailable());
    }
    WinEngine::TryCreateFromLanguage(&win_language).map_err(|_| unavailable())
}

/// Copies the pixels into a bitmap Windows accepts: opaque BGRA, or gray.
fn to_bitmap(image: &OcrImage) -> Result<SoftwareBitmap, IntelError> {
    let (format, bytes) = match image.format() {
        PixelFormat::Gray8 => (BitmapPixelFormat::Gray8, image.pixels().to_vec()),
        PixelFormat::Rgba8 => (BitmapPixelFormat::Bgra8, rgba_to_opaque_bgra(image.pixels())),
    };
    let invalid = |_| IntelError::InvalidInput("the image is too large for Windows".to_owned());
    let bitmap = SoftwareBitmap::Create(
        format,
        i32::try_from(image.width()).map_err(invalid)?,
        i32::try_from(image.height()).map_err(invalid)?,
    )?;
    let writer = DataWriter::new()?;
    writer.WriteBytes(&bytes)?;
    bitmap.CopyFromBuffer(&writer.DetachBuffer()?)?;
    Ok(bitmap)
}

/// Swaps red and blue, and blends each pixel onto white, so transparent areas read as paper.
fn rgba_to_opaque_bgra(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for px in rgba.as_chunks::<4>().0 {
        let alpha = u32::from(px[3]);
        let blend = |c: u8| ((u32::from(c) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        out.extend_from_slice(&[blend(px[2]), blend(px[1]), blend(px[0]), 255]);
    }
    out
}

fn convert(found: &WinResult, language: Language) -> Result<OcrResult, IntelError> {
    let mut lines = Vec::new();
    for line in found.Lines()? {
        let mut words = Vec::new();
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            words.push(OcrWord {
                text: word.Text()?.to_string(),
                bounds: Rect {
                    x: r.X,
                    y: r.Y,
                    width: r.Width,
                    height: r.Height,
                },
            });
        }
        let bounds = Rect::union_all(words.iter().map(|w| &w.bounds)).unwrap_or_default();
        lines.push(OcrLine {
            text: line.Text()?.to_string(),
            bounds,
            words,
        });
    }
    let angle = found.TextAngle().and_then(|a| a.Value()).ok().map(|a| a as f32);
    Ok(OcrResult { language, lines, angle })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transparent_pixels_become_white_and_channels_swap() {
        let rgba = [10, 20, 30, 255, 10, 20, 30, 0, 0, 0, 0, 128];
        let bgra = rgba_to_opaque_bgra(&rgba);
        assert_eq!(bgra[..4], [30, 20, 10, 255], "opaque pixels keep their color");
        assert_eq!(bgra[4..8], [255, 255, 255, 255], "transparent pixels read as paper");
        assert_eq!(bgra[8..], [127, 127, 127, 255], "half transparent black is mid gray");
    }
}
