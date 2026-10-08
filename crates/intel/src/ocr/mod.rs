//! Optical character recognition (OCR): text and word boxes from an image.
//!
//! [`OcrEngine`] is the platform-neutral interface. On Windows, [`default_engine`] returns an
//! engine backed by Windows.Media.Ocr. Other platforms swap in their own engine later.

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::{Language, Rect};

#[cfg(all(windows, feature = "winrt"))]
mod winrt;
#[cfg(all(windows, feature = "winrt", feature = "unstable-engines"))]
pub use self::winrt::WindowsOcr;
#[cfg(all(windows, feature = "winrt", not(feature = "unstable-engines")))]
use self::winrt::WindowsOcr;

/// The longest side an image may have, in pixels. Windows OCR accepts no more.
pub const MAX_IMAGE_SIDE: u32 = 10_000;

/// The most pixels an image may have, about a 6,500 by 4,900 photo. Scale a larger one down first. As JSON it
/// would cost hundreds of megabytes on its way to the engine, and text that small reads no better.
pub const MAX_IMAGE_PIXELS: u64 = 32_000_000;

/// Fails with [`IntelError::ImageTooLarge`] when a side is over [`MAX_IMAGE_SIDE`] or the area is over
/// [`MAX_IMAGE_PIXELS`]. Check this before decoding or copying any pixels.
pub fn check_image_size(width: u32, height: u32) -> Result<(), IntelError> {
    let too_large = width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE;
    if too_large || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(IntelError::ImageTooLarge {
            width,
            height,
            max: MAX_IMAGE_SIDE,
            max_pixels: MAX_IMAGE_PIXELS,
        });
    }
    Ok(())
}

/// How the bytes of an [`OcrImage`] are laid out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelFormat {
    /// Four bytes per pixel: red, green, blue, and straight alpha.
    Rgba8,
    /// One byte per pixel: brightness.
    Gray8,
}

impl PixelFormat {
    /// Bytes per pixel.
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            PixelFormat::Rgba8 => 4,
            PixelFormat::Gray8 => 1,
        }
    }
}

/// A decoded image, row by row from the top left, with no padding between rows.
#[derive(Clone, Debug)]
pub struct OcrImage {
    width: u32,
    height: u32,
    format: PixelFormat,
    pixels: Vec<u8>,
}

impl OcrImage {
    /// Wraps pixels after checking the size against [`check_image_size`] and the byte count against the size.
    pub fn new(width: u32, height: u32, format: PixelFormat, pixels: Vec<u8>) -> Result<OcrImage, IntelError> {
        if width > 0 && height > 0 {
            check_image_size(width, height)?;
        }
        let expected = (width as usize)
            .checked_mul(height as usize)
            .and_then(|n| n.checked_mul(format.bytes_per_pixel()));
        if width == 0 || height == 0 || expected != Some(pixels.len()) {
            return Err(IntelError::InvalidInput(format!(
                "a {width} by {height} {format:?} image needs {expected:?} bytes, not {}",
                pixels.len()
            )));
        }
        Ok(OcrImage {
            width,
            height,
            format,
            pixels,
        })
    }

    /// Width in pixels.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Height in pixels.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// The pixel layout.
    pub fn format(&self) -> PixelFormat {
        self.format
    }

    /// The raw bytes.
    pub fn pixels(&self) -> &[u8] {
        &self.pixels
    }
}

/// One recognized word and where it sits in the image.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OcrWord {
    /// The word as recognized.
    pub text: String,
    /// Its box in image pixels.
    pub bounds: Rect,
}

/// One line of text, with its words in reading order.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OcrLine {
    /// The line as recognized, words joined as the engine joins them.
    pub text: String,
    /// The box around every word of the line.
    pub bounds: Rect,
    /// The words.
    pub words: Vec<OcrWord>,
}

/// What an engine found in one image.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OcrResult {
    /// The language the engine recognized in.
    pub language: Language,
    /// The lines from top to bottom.
    pub lines: Vec<OcrLine>,
    /// How far the text is tilted from horizontal, in degrees, if the engine reports it.
    pub angle: Option<f32>,
}

impl OcrResult {
    /// All the text, one line per row.
    pub fn text(&self) -> String {
        self.lines
            .iter()
            .map(|line| line.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Settings for one recognition call.
#[derive(Clone, Debug, Default)]
pub struct OcrOptions {
    /// The language to recognize. `None` uses the languages of the person's profile.
    pub language: Option<Language>,
}

/// An OCR engine. Every call runs on the device and makes no network request.
///
/// Calls block until the engine finishes, so run them on a worker thread, never the interface thread.
pub trait OcrEngine: Send + Sync {
    /// The languages the engine can recognize on this computer.
    fn available_languages(&self) -> Result<Vec<Language>, IntelError>;

    /// Checks that the engine can run here without a language named, and says why not, such as
    /// [`IntelError::LanguageUnavailable`] when no language pack is installed. The settings screen shows it.
    fn check_ready(&self) -> Result<(), IntelError> {
        if self.available_languages()?.is_empty() {
            return Err(IntelError::LanguageUnavailable(
                "any language on this computer".to_owned(),
            ));
        }
        Ok(())
    }

    /// Finds the text in one image.
    fn recognize(&self, image: &OcrImage, options: &OcrOptions) -> Result<OcrResult, IntelError>;
}

engine_api! {
    /// The engine for this platform.
    fn default_engine() -> Result<Box<dyn OcrEngine>, IntelError> {
        #[cfg(all(windows, feature = "winrt"))]
        {
            Ok(Box::new(WindowsOcr::new()))
        }
        #[cfg(not(all(windows, feature = "winrt")))]
        {
            Err(IntelError::Unsupported {
                feature: "text recognition in images",
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_rejects_a_wrong_pixel_count() {
        assert!(OcrImage::new(2, 2, PixelFormat::Rgba8, vec![0; 16]).is_ok());
        assert!(OcrImage::new(2, 2, PixelFormat::Rgba8, vec![0; 15]).is_err());
        assert!(OcrImage::new(0, 2, PixelFormat::Gray8, vec![]).is_err());
    }

    #[test]
    fn image_size_has_a_limit_on_each_side_and_in_all() {
        assert!(check_image_size(MAX_IMAGE_SIDE, 3_200).is_ok());
        assert!(check_image_size(MAX_IMAGE_SIDE + 1, 1).is_err());
        assert!(check_image_size(1, MAX_IMAGE_SIDE + 1).is_err());
        // A 50-megapixel phone photo.
        let error = check_image_size(8_160, 6_120).unwrap_err();
        assert_eq!(error.info().code, "imageTooLarge");
        assert!(matches!(
            OcrImage::new(20_000, 1, PixelFormat::Gray8, vec![0; 20_000]),
            Err(IntelError::ImageTooLarge { width: 20_000, .. })
        ));
    }
}
