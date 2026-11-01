//! Text in pictures on Linux, through Tesseract. The library is opened when it is first needed
//! (`libtesseract.so.5`, or 4), so OpenNote builds and starts without it, and the settings screen says to install
//! it (`tesseract-ocr` and a language pack such as `tesseract-ocr-eng`) when it is missing. Tesseract reads the
//! pixels it is handed and the language files on the disk, and nothing else.
//!
//! [`install`] makes it the OCR engine of `opennote-intel`, which also reads handwriting with it by drawing the
//! strokes as a picture first.

#[cfg(target_os = "linux")]
mod library;
mod parse;

#[cfg(target_os = "linux")]
pub use library::TesseractOcr;
pub use parse::{bcp47_for, code_for, gray_pixels, parse_tsv};

/// Installs Tesseract as the OCR engine of `opennote-intel`.
#[cfg(target_os = "linux")]
pub fn install() {
    opennote_intel::ocr::install_engine(|| Ok(Box::new(TesseractOcr::new())));
}
