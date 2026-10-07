//! Thumbnails of attached PDF and Office files. Windows already draws a picture of the first page for these files
//! in File Explorer, through the thumbnail handler of the app that opens them. OpenNote asks for that same picture,
//! so a card shows the document's first page rather than a plain icon. Where Windows has no handler, the card keeps
//! its icon. Only document types are asked; a program is never handed to the shell. Nothing leaves the PC.

use std::path::Path;

use opennote_core::AssetId;
use tauri::{ipc::Response, AppHandle};

use super::attach::{safe_name, temp_folder};
use crate::{
    images::import::{on_blocking, open_page},
    ipc::{codes, IpcError, IpcResult},
};

/// The document types whose first page is drawn. Everything else keeps its icon.
const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "docm", "dot", "dotx", "rtf", "odt", "xls", "xlsx", "xlsm", "ods", "ppt", "pptx", "pptm",
    "odp",
];

/// The smallest and largest thumbnail, in device pixels along the longer side.
const MIN_SIZE: u32 = 64;
const MAX_SIZE: u32 = 512;

/// Whether a file of this name is a document that gets a thumbnail.
pub fn is_document(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, extension)| DOCUMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

/// The size asked for, kept in range.
pub fn clamp_size(size: u32) -> u32 {
    size.clamp(MIN_SIZE, MAX_SIZE)
}

fn io_error(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::IO, error.to_string())
}

/// A PNG of the first page of an attached document, or `noThumbnail` when Windows can't draw one.
#[tauri::command]
pub async fn attachment_thumbnail(
    app: AppHandle,
    page: String,
    asset: String,
    name: String,
    size: u32,
) -> IpcResult<Response> {
    let name = safe_name(&name);
    if !is_document(&name) {
        return Err(IpcError::new("noThumbnail", "Only documents get a thumbnail."));
    }
    let size = clamp_size(size);
    let png = on_blocking(move || {
        let handle = open_page(&app, &page)?;
        let id = AssetId::parse(&asset).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
        let bytes = handle.asset_bytes(id, None).map_err(io_error)?.bytes;
        let folder = temp_folder(&format!("thumbnail-{asset}"));
        std::fs::create_dir_all(&folder).map_err(io_error)?;
        let path = folder.join(&name);
        let drawn = std::fs::write(&path, bytes)
            .map_err(io_error)
            .and_then(|()| draw(&path, size));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&folder);
        drawn
    })
    .await?;
    Ok(Response::new(png))
}

#[cfg(not(windows))]
fn draw(_file: &Path, _size: u32) -> IpcResult<Vec<u8>> {
    Err(IpcError::not_implemented("attachment_thumbnail"))
}

/// Asks the Windows shell for the file's thumbnail (never its icon) and encodes it as a PNG.
#[cfg(windows)]
fn draw(file: &Path, size: u32) -> IpcResult<Vec<u8>> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::SIZE,
            Graphics::Gdi::{
                CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            },
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            UI::Shell::{
                IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_THUMBNAILONLY,
            },
        },
    };

    // SAFETY: COM starts and stops around the work. The bitmap Windows hands back is read once and deleted, and
    // `pixels` has exactly the width * height * 4 bytes GetDIBits is told about.
    let drawn = unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> Result<(Vec<u8>, u32, u32), ()> {
            let factory: IShellItemImageFactory =
                SHCreateItemFromParsingName(&HSTRING::from(file.as_os_str()), None).map_err(|_| ())?;
            let wanted = SIZE {
                cx: size as i32,
                cy: size as i32,
            };
            let bitmap = factory
                .GetImage(wanted, SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK)
                .map_err(|_| ())?;
            let mut header = BITMAP::default();
            if GetObjectW(
                bitmap.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some((&raw mut header).cast()),
            ) == 0
            {
                let _ = DeleteObject(bitmap.into());
                return Err(());
            }
            let (width, height) = (header.bmWidth.max(1) as u32, header.bmHeight.max(1) as u32);
            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width as i32,
                    biHeight: -(height as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; width as usize * height as usize * 4];
            let context = CreateCompatibleDC(None);
            let lines = GetDIBits(
                context,
                bitmap,
                0,
                height,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(context);
            let _ = DeleteObject(bitmap.into());
            if lines == 0 {
                return Err(());
            }
            Ok((pixels, width, height))
        })();
        if apartment.is_ok() {
            CoUninitialize();
        }
        result
    };
    let (mut pixels, width, height) =
        drawn.map_err(|()| IpcError::new("noThumbnail", "Windows has no picture of this file."))?;
    // A thumbnail without transparency comes back with its alpha bytes unset; show those pixels solid.
    if pixels.as_chunks::<4>().0.iter().all(|pixel| pixel[3] == 0) {
        for pixel in pixels.as_chunks_mut::<4>().0 {
            pixel[3] = 255;
        }
    }
    crate::audio_more::snap::encode_png(&pixels, width, height).map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_documents_get_a_thumbnail() {
        for name in ["scan.PDF", "plan.docx", "budget.xlsx", "talk.pptx", "a.b.odt"] {
            assert!(is_document(name), "{name}");
        }
        for name in ["setup.exe", "run.bat", "photo.png", "notes.txt", "readme", "x.lnk"] {
            assert!(!is_document(name), "{name}");
        }
    }

    #[test]
    fn the_size_stays_in_range() {
        assert_eq!(clamp_size(0), MIN_SIZE);
        assert_eq!(clamp_size(200), 200);
        assert_eq!(clamp_size(9999), MAX_SIZE);
    }
}
