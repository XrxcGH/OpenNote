//! HEIC and TIFF conversion at import, behind `page.heicImport` (Phase 4 ARCHITECTURE.md section 12.7). WebView2
//! can't show either, so when Windows Imaging Component has a codec for the file, the shell decodes it once, turns
//! it upright, and stores a JPEG (opaque) or PNG (with transparency) instead. HEIC needs the HEIF extension from the
//! Microsoft Store; without it the import is refused as before.

use super::probe::ImageFormat;

/// The converted file and its upright size.
pub struct Converted {
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

/// Larger pictures aren't converted: the decoded pixels alone would take 400 MB.
const MAX_PIXELS: u64 = 100_000_000;

#[cfg(not(windows))]
pub fn to_web_format(_bytes: &[u8], _orientation: u8) -> Option<Converted> {
    None
}

#[cfg(windows)]
pub fn to_web_format(bytes: &[u8], orientation: u8) -> Option<Converted> {
    use windows::{
        core::Interface,
        Win32::{
            Foundation::HGLOBAL,
            Graphics::Imaging::{
                GUID_ContainerFormatJpeg, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppBGRA, IWICBitmapSource,
                WICBitmapDitherTypeNone, WICBitmapEncoderNoCache, WICBitmapPaletteTypeCustom,
                WICDecodeMetadataCacheOnDemand,
            },
            System::Com::{
                StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream},
                STREAM_SEEK_SET,
            },
            System::Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
    };

    super::wic::with_com(|| {
        // SAFETY: COM is initialized by `with_com`. The input stream reads `bytes`, which outlive every object here,
        // and the output memory is read while it is locked and released with its stream.
        unsafe {
            let factory = super::wic::factory()?;
            let input = factory.CreateStream()?;
            input.InitializeFromMemory(bytes)?;
            let decoder = factory.CreateDecoderFromStream(&input, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let frame: IWICBitmapSource = decoder.GetFrame(0)?.cast()?;
            let rotator = factory.CreateBitmapFlipRotator()?;
            rotator.Initialize(&frame, transform(orientation))?;
            let converter = factory.CreateFormatConverter()?;
            converter.Initialize(
                &rotator,
                &GUID_WICPixelFormat32bppBGRA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let (mut width, mut height) = (0u32, 0u32);
            converter.GetSize(&mut width, &mut height)?;
            if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
                return Err(windows::core::Error::from_hresult(
                    windows::Win32::Foundation::E_INVALIDARG,
                ));
            }
            let stride = width * 4;
            let mut pixels = vec![0u8; stride as usize * height as usize];
            converter.CopyPixels(std::ptr::null(), stride, &mut pixels)?;
            let opaque = pixels.as_chunks::<4>().0.iter().all(|pixel| pixel[3] == 255);
            drop(pixels);

            let output = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
            let container = if opaque {
                GUID_ContainerFormatJpeg
            } else {
                GUID_ContainerFormatPng
            };
            let encoder = factory.CreateEncoder(&container, std::ptr::null())?;
            encoder.Initialize(&output, WICBitmapEncoderNoCache)?;
            let mut target = None;
            let mut options = None;
            encoder.CreateNewFrame(&mut target, &mut options)?;
            let target = target.ok_or_else(windows::core::Error::empty)?;
            target.Initialize(options.as_ref())?;
            target.SetSize(width, height)?;
            let mut format = GUID_WICPixelFormat32bppBGRA;
            target.SetPixelFormat(&mut format)?;
            target.WriteSource(&converter, std::ptr::null())?;
            target.Commit()?;
            encoder.Commit()?;

            output.Seek(0, STREAM_SEEK_SET, None)?;
            let memory = GetHGlobalFromStream(&output)?;
            let size = GlobalSize(memory);
            let start = GlobalLock(memory) as *const u8;
            if start.is_null() {
                return Err(windows::core::Error::from_thread());
            }
            let encoded = std::slice::from_raw_parts(start, size).to_vec();
            let _ = GlobalUnlock(memory);
            Ok(Converted {
                format: if opaque { ImageFormat::Jpeg } else { ImageFormat::Png },
                width,
                height,
                bytes: encoded,
            })
        }
    })
}

/// The flip and rotation that turn a picture with this EXIF orientation upright. WIC rotates clockwise first, then
/// flips.
#[cfg(windows)]
fn transform(orientation: u8) -> windows::Win32::Graphics::Imaging::WICBitmapTransformOptions {
    use windows::Win32::Graphics::Imaging::{
        WICBitmapTransformFlipHorizontal as FLIP_H, WICBitmapTransformFlipVertical as FLIP_V,
        WICBitmapTransformOptions, WICBitmapTransformRotate0 as R0, WICBitmapTransformRotate180 as R180,
        WICBitmapTransformRotate270 as R270, WICBitmapTransformRotate90 as R90,
    };
    match orientation {
        2 => FLIP_H,
        3 => R180,
        4 => FLIP_V,
        5 => WICBitmapTransformOptions(R90.0 | FLIP_H.0),
        6 => R90,
        7 => WICBitmapTransformOptions(R270.0 | FLIP_H.0),
        8 => R270,
        _ => R0,
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/images/fixtures");

    /// The blue pixels of a decoded picture, by position.
    fn blue_pixels(bytes: &[u8]) -> (u32, u32, Vec<(u32, u32)>) {
        use windows::Win32::Graphics::Imaging::{
            GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom,
            WICDecodeMetadataCacheOnDemand,
        };
        super::super::wic::with_com(|| unsafe {
            let factory = super::super::wic::factory()?;
            let stream = factory.CreateStream()?;
            stream.InitializeFromMemory(bytes)?;
            let decoder = factory.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let converter = factory.CreateFormatConverter()?;
            converter.Initialize(
                &decoder.GetFrame(0)?,
                &GUID_WICPixelFormat32bppBGRA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
            let (mut w, mut h) = (0, 0);
            converter.GetSize(&mut w, &mut h)?;
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            converter.CopyPixels(std::ptr::null(), w * 4, &mut pixels)?;
            let blue = (0..h)
                .flat_map(|y| (0..w).map(move |x| (x, y)))
                .filter(|(x, y)| {
                    let at = ((y * w + x) * 4) as usize;
                    pixels[at] > 120 && pixels[at + 2] < 100
                })
                .collect();
            Ok((w, h, blue))
        })
        .unwrap()
    }

    #[test]
    fn every_orientation_comes_out_upright() {
        // Each fixture stores the same 6 by 4 picture, whose top row starts with three blue pixels; its EXIF tag
        // says how to turn it. Upright, orientation 1's picture turned by the tag's transform is what shows.
        let (_, _, stored) = blue_pixels(&std::fs::read(format!("{FIXTURES}/jpeg-o1.jpg")).unwrap());
        for orientation in 1..=8u8 {
            let bytes = std::fs::read(format!("{FIXTURES}/jpeg-o{orientation}.jpg")).unwrap();
            let converted = to_web_format(&bytes, orientation).expect("WIC converts JPEG");
            assert_eq!(converted.format, ImageFormat::Jpeg);
            let (w, h, blue) = blue_pixels(&converted.bytes);
            let turned = orientation >= 5;
            assert_eq!(
                (w, h),
                if turned { (4, 6) } else { (6, 4) },
                "orientation {orientation}"
            );
            let expected: Vec<(u32, u32)> = {
                let mut out: Vec<(u32, u32)> = stored
                    .iter()
                    .map(|&(x, y)| display_position(orientation, x, y, 6, 4))
                    .collect();
                out.sort_by_key(|&(x, y)| (y, x));
                out
            };
            assert_eq!(blue, expected, "orientation {orientation}");
        }
    }

    /// Where a stored pixel shows for an EXIF orientation (TIFF 6.0, tag 274).
    fn display_position(orientation: u8, x: u32, y: u32, w: u32, h: u32) -> (u32, u32) {
        let (mx, my) = (w - 1 - x, h - 1 - y);
        match orientation {
            2 => (mx, y),
            3 => (mx, my),
            4 => (x, my),
            5 => (y, x),
            6 => (my, x),
            7 => (my, mx),
            8 => (y, mx),
            _ => (x, y),
        }
    }

    #[test]
    fn transparent_pictures_become_png() {
        let bytes = std::fs::read(format!("{FIXTURES}/png-alpha.png")).unwrap();
        let converted = to_web_format(&bytes, 1).expect("WIC converts PNG");
        assert_eq!(
            (converted.format, converted.width, converted.height),
            (ImageFormat::Png, 6, 4)
        );
    }
}
