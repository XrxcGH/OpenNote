//! Snapping the screen while recording. The interface asks for a capture when the person presses the shortcut, and
//! nothing is captured before that. OpenNote steps out of the way for a moment, so the picture is of what was behind
//! it, such as a slide or a whiteboard in a call, and then comes back. The picture is a PNG.

use tauri::{ipc::Response, WebviewWindow};

use crate::ipc::{codes, IpcError, IpcResult};

/// How long OpenNote waits after it minimizes, so Windows has drawn what was behind it.
#[cfg(windows)]
const SETTLE: std::time::Duration = std::time::Duration::from_millis(350);

/// Captures the whole screen (`screen`, which a region is cut from) or the window that was behind OpenNote (`window`).
/// The answer is the PNG's bytes.
#[tauri::command]
pub async fn audio_snap(window: WebviewWindow, kind: String) -> IpcResult<Response> {
    if kind != "screen" && kind != "window" {
        return Err(IpcError::invalid("kind", "A snap is of the screen or of a window."));
    }
    let _ = window.minimize();
    let taken = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        std::thread::sleep(SETTLE);
        capture(&kind)
    })
    .await
    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()));
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(Response::new(taken??))
}

#[cfg(not(windows))]
fn capture(_kind: &str) -> IpcResult<Vec<u8>> {
    Err(IpcError::not_implemented("Snapping the screen"))
}

#[cfg(windows)]
fn capture(kind: &str) -> IpcResult<Vec<u8>> {
    use windows::Win32::{
        Foundation::{HWND, RECT},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetSystemMetrics, GetWindowRect, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
            SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        },
    };

    // SAFETY: the metrics and the window rectangle are plain reads into values owned here.
    let area = unsafe {
        let screen = RECT {
            left: GetSystemMetrics(SM_XVIRTUALSCREEN),
            top: GetSystemMetrics(SM_YVIRTUALSCREEN),
            right: GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN),
            bottom: GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN),
        };
        let behind: HWND = GetForegroundWindow();
        if kind == "window" && !behind.0.is_null() {
            let mut frame = RECT::default();
            let bounds = DwmGetWindowAttribute(
                behind,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                std::ptr::from_mut(&mut frame).cast(),
                std::mem::size_of::<RECT>() as u32,
            );
            if bounds.is_err() {
                let _ = GetWindowRect(behind, &mut frame);
            }
            // Only what is on the screen.
            RECT {
                left: frame.left.max(screen.left),
                top: frame.top.max(screen.top),
                right: frame.right.min(screen.right),
                bottom: frame.bottom.min(screen.bottom),
            }
        } else {
            screen
        }
    };
    let (width, height) = (area.right - area.left, area.bottom - area.top);
    if width <= 0 || height <= 0 {
        return Err(IpcError::new("audioSnap", "There is nothing on the screen to capture."));
    }
    let pixels = grab(area.left, area.top, width, height).map_err(snap_failed)?;
    encode_png(&pixels, width as u32, height as u32).map_err(snap_failed)
}

#[cfg(windows)]
fn snap_failed(error: windows::core::Error) -> IpcError {
    IpcError::new("audioSnap", format!("The screen couldn’t be captured: {}", error.message()))
}

/// The pixels of a rectangle of the screen, as top-down BGRA with every pixel opaque.
#[cfg(windows)]
fn grab(x: i32, y: i32, width: i32, height: i32) -> windows::core::Result<Vec<u8>> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
    };

    // SAFETY: the device contexts and the bitmap are made, used, and released within this call, in reverse order.
    // GetDIBits fills `pixels`, which holds exactly width * height * 4 bytes.
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, width, height, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let lines = GetDIBits(
            memory,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        copied?;
        if lines == 0 {
            return Err(windows::core::Error::from_thread());
        }
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        Ok(pixels)
    }
}

/// A PNG of BGRA pixels, made by Windows Imaging Component.
#[cfg(windows)]
fn encode_png(pixels: &[u8], width: u32, height: u32) -> windows::core::Result<Vec<u8>> {
    use windows::Win32::{
        Foundation::HGLOBAL,
        Graphics::Imaging::{
            CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppBGRA, IWICImagingFactory,
            WICBitmapEncoderNoCache,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize,
                StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream},
                CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STREAM_SEEK_SET,
            },
            Memory::{GlobalLock, GlobalSize, GlobalUnlock},
        },
    };

    // SAFETY: COM starts and stops around the work. The bitmap copies `pixels` before it returns, and the output
    // memory is read only while it is locked and before its stream is released.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result = (|| -> windows::core::Result<Vec<u8>> {
            let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let bitmap = factory.CreateBitmapFromMemory(width, height, &GUID_WICPixelFormat32bppBGRA, width * 4, pixels)?;
            let output = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
            let encoder = factory.CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())?;
            encoder.Initialize(&output, WICBitmapEncoderNoCache)?;
            let mut target = None;
            let mut options = None;
            encoder.CreateNewFrame(&mut target, &mut options)?;
            let target = target.ok_or_else(windows::core::Error::empty)?;
            target.Initialize(options.as_ref())?;
            target.SetSize(width, height)?;
            let mut format = GUID_WICPixelFormat32bppBGRA;
            target.SetPixelFormat(&mut format)?;
            target.WriteSource(&bitmap, std::ptr::null())?;
            target.Commit()?;
            encoder.Commit()?;
            output.Seek(0, STREAM_SEEK_SET, None)?;
            let memory = GetHGlobalFromStream(&output)?;
            let size = GlobalSize(memory);
            let start = GlobalLock(memory) as *const u8;
            if start.is_null() {
                return Err(windows::core::Error::from_thread());
            }
            let bytes = std::slice::from_raw_parts(start, size).to_vec();
            let _ = GlobalUnlock(memory);
            Ok(bytes)
        })();
        if apartment.is_ok() {
            CoUninitialize();
        }
        result
    }
}
