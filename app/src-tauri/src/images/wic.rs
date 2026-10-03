//! Windows Imaging Component (WIC), which reads an image's header the way Windows and WebView2 will decode it.
//! Opening a decoder reads only the header; no pixel is decoded here.

use windows::Win32::{
    Graphics::Imaging::{CLSID_WICImagingFactory, IWICImagingFactory, WICDecodeMetadataCacheOnDemand},
    System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
};

/// Runs `body` with COM initialized on this thread, and releases COM after it if this call initialized it.
pub fn with_com<T>(body: impl FnOnce() -> windows::core::Result<T>) -> Option<T> {
    // SAFETY: COM is initialized for this call and released after it; every COM object `body` makes is dropped
    // before it returns.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_MULTITHREADED);
        let result = body();
        if apartment.is_ok() {
            CoUninitialize();
        }
        result.ok()
    }
}

/// The factory every WIC call starts from.
///
/// # Safety
/// COM must be initialized on the calling thread.
pub unsafe fn factory() -> windows::core::Result<IWICImagingFactory> {
    CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
}

/// The pixel size of the first frame as stored, before any orientation, or None when no installed codec opens it.
pub fn frame_size(bytes: &[u8]) -> Option<(u32, u32)> {
    with_com(|| {
        // SAFETY: COM is initialized by `with_com`. The stream reads `bytes`, which outlive every object here.
        unsafe {
            let factory = factory()?;
            let stream = factory.CreateStream()?;
            stream.InitializeFromMemory(bytes)?;
            let decoder = factory.CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let frame = decoder.GetFrame(0)?;
            let (mut width, mut height) = (0u32, 0u32);
            frame.GetSize(&mut width, &mut height)?;
            Ok((width, height))
        }
    })
}
