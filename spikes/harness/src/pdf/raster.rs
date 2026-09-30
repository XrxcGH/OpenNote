//! Renders PDF pages to images with Windows.Data.Pdf, the PDF renderer built into Windows. It is independent
//! of Chromium, so a match between its images and the screen shows the PDF itself is right, not just that
//! Chromium agrees with itself.
//!
//! Two quirks shape this module. Windows.Data.Pdf multiplies the requested size by a display scale factor
//! (1.4 on a 150% screen), so the first render of each page size is a probe that measures the factor. And
//! not every output size can be reached through that factor, so each render sets a source rectangle that
//! gives exactly the chosen resolution, then crops to the page.

use std::path::Path;

use image::{ImageFormat, RgbaImage};
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPage, PdfPageRenderOptions};
use windows::Foundation::Rect;
use windows::Storage::StorageFile;
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

use crate::common::{clock, Result};

pub struct Rendered {
    pub pages: Vec<RgbaImage>,
    /// Time to render and decode each page, in milliseconds.
    pub page_ms: Vec<f64>,
    /// How much Windows.Data.Pdf enlarged the requested size (1.0 means not at all).
    pub scale_factor: f64,
}

/// Renders every page at `dpi` pixels per inch. Blocking WinRT calls must not run on a single-threaded
/// apartment, so the work runs on its own thread in the multithreaded apartment.
pub fn rasterize(path: &Path, dpi: f64) -> Result<Rendered> {
    let path = path.to_path_buf();
    std::thread::spawn(move || {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }?;
        let outcome = render_all(&path, dpi / 96.0);
        unsafe { RoUninitialize() };
        outcome
    })
    .join()
    .map_err(|_| "The PDF rendering thread panicked.")?
}

/// `scale` is output pixels per device-independent pixel (1/96 inch).
fn render_all(path: &Path, scale: f64) -> Result<Rendered> {
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?.join()?;
    let document = PdfDocument::LoadFromFileAsync(&file)?.join()?;
    let mut rendered = Rendered {
        pages: Vec::new(),
        page_ms: Vec::new(),
        scale_factor: 0.0,
    };
    for index in 0..document.PageCount()? {
        let started = clock::now();
        let page = document.GetPage(index)?;
        let media = page.Dimensions()?.MediaBox()?;
        let target = (
            (f64::from(media.Width) * scale).round() as u32,
            (f64::from(media.Height) * scale).round() as u32,
        );
        if rendered.scale_factor == 0.0 {
            let probe = render(&page, target, None)?;
            rendered.scale_factor = f64::from(probe.width()) / f64::from(target.0);
        }
        let image = render_exact(&page, target, scale, rendered.scale_factor)?;
        rendered.page_ms.push(clock::elapsed_ms(started, clock::now()));
        rendered.pages.push(image);
    }
    Ok(rendered)
}

/// Renders the page at exactly `scale` pixels per device-independent pixel, cropped to `target`.
fn render_exact(page: &PdfPage, target: (u32, u32), scale: f64, factor: f64) -> Result<RgbaImage> {
    let request = (
        (f64::from(target.0) / factor).round() as u32,
        (f64::from(target.1) / factor).round() as u32,
    );
    let mut expected = (
        (f64::from(request.0) * factor).round() as u32,
        (f64::from(request.1) * factor).round() as u32,
    );
    for _ in 0..2 {
        let source = Rect {
            X: 0.0,
            Y: 0.0,
            Width: (f64::from(expected.0) / scale) as f32,
            Height: (f64::from(expected.1) / scale) as f32,
        };
        let image = render(page, request, Some(source))?;
        if image.dimensions() == expected {
            let (width, height) = (target.0.min(image.width()), target.1.min(image.height()));
            return Ok(image::imageops::crop_imm(&image, 0, 0, width, height).to_image());
        }
        // The size was rounded differently than predicted; match the source rectangle to it and try again.
        expected = image.dimensions();
    }
    Err("Windows.Data.Pdf didn't render at a predictable size.".into())
}

fn render(page: &PdfPage, (width, height): (u32, u32), source: Option<Rect>) -> Result<RgbaImage> {
    let options = PdfPageRenderOptions::new()?;
    options.SetDestinationWidth(width)?;
    options.SetDestinationHeight(height)?;
    options.SetIsIgnoringHighContrast(true)?;
    if let Some(rect) = source {
        options.SetSourceRect(rect)?;
    }
    let stream = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&stream, &options)?.join()?;
    let length = u32::try_from(stream.Size()?)?;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(length)?.join()?;
    let mut bytes = vec![0u8; length as usize];
    reader.ReadBytes(&mut bytes)?;
    Ok(image::load_from_memory_with_format(&bytes, ImageFormat::Png)?.to_rgba8())
}
