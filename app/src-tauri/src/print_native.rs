//! Saving a page as PDF on macOS and Linux (ADR 0055). Windows asks WebView2 for the PDF. The other web views
//! have their own print machinery. Both write the pages to a file, as the Windows route does.
//! Everything above `start_print` (page_export.rs) is shared: the print window, the sheet, and the bytes handed
//! back to the interface for the range, the headers, Save as PDF, and File > Print.
//!
//! - Linux: WebKitGTK's `PrintOperation` prints to a file with GTK's "Print to File" printer. No dialog opens.
//! - macOS: `WKWebView`'s `NSPrintOperation` runs with its panels off and a save-to-file job disposition. It runs
//!   without blocking the main thread, so the file is watched until it is a whole PDF.

use std::{
    path::Path,
    sync::mpsc,
    time::{Duration, Instant},
};

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::PathBuf;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
use crate::ipc::codes;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use crate::ipc::{IpcError, IpcResult};

/// Points in an inch, which GTK and AppKit both measure a sheet in.
#[cfg_attr(windows, allow(dead_code))]
const POINTS_PER_INCH: f64 = 72.0;

/// Whether `bytes` are a whole PDF: the header at the start, and the end-of-file marker near the end. A print
/// operation that is still writing leaves a file that fails this.
#[cfg_attr(windows, allow(dead_code))]
pub fn is_whole_pdf(bytes: &[u8]) -> bool {
    let tail = &bytes[bytes.len().saturating_sub(1024)..];
    bytes.starts_with(b"%PDF-") && tail.windows(5).any(|window| window == b"%%EOF")
}

/// Waits until `file` holds a whole PDF whose size has stopped changing, and says so on `tx`; reports a failure
/// when none appears within `limit`.
#[cfg_attr(windows, allow(dead_code))]
pub fn watch_for_pdf(file: &Path, limit: Duration, tx: &mpsc::Sender<Result<bool, String>>) {
    let started = Instant::now();
    let mut last_size = None;
    while started.elapsed() < limit {
        std::thread::sleep(Duration::from_millis(150));
        let Ok(bytes) = std::fs::read(file) else {
            continue;
        };
        if is_whole_pdf(&bytes) && last_size == Some(bytes.len()) {
            let _ = tx.send(Ok(true));
            return;
        }
        last_size = Some(bytes.len());
    }
    let _ = tx.send(Err("The print operation wrote no PDF.".to_owned()));
}

#[cfg(target_os = "linux")]
pub fn start_print(
    window: &WebviewWindow,
    file: PathBuf,
    (width, height): (f64, f64),
    _background: bool,
    tx: mpsc::Sender<Result<bool, String>>,
) -> IpcResult<()> {
    use gtk::{PageSetup, PaperSize, PrintSettings, Unit};
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let uri = url::Url::from_file_path(&file)
        .map_err(|()| IpcError::new(codes::INTERNAL, "The print file's path isn't valid."))?
        .to_string();
    window
        .with_webview(move |webview| {
            let operation = PrintOperation::new(&webview.inner());
            let settings = PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set("output-file-format", Some("pdf"));
            settings.set("output-uri", Some(&uri));
            operation.set_print_settings(&settings);
            let setup = PageSetup::new();
            setup.set_paper_size(&PaperSize::new_custom(
                "opennote",
                "OpenNote",
                width * POINTS_PER_INCH,
                height * POINTS_PER_INCH,
                Unit::Points,
            ));
            setup.set_top_margin(0.0, Unit::Points);
            setup.set_bottom_margin(0.0, Unit::Points);
            setup.set_left_margin(0.0, Unit::Points);
            setup.set_right_margin(0.0, Unit::Points);
            operation.set_page_setup(&setup);
            let failed = tx.clone();
            operation.connect_failed(move |_, error| {
                let _ = failed.send(Err(error.to_string()));
            });
            // A failed print also ends with `finished`; the receiver has taken the failure by then.
            operation.connect_finished(move |_| {
                let _ = tx.send(Ok(true));
            });
            operation.print();
        })
        .map_err(IpcError::from)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_void, CString};

    use objc2::{
        encode::{Encode, Encoding},
        msg_send,
        runtime::{AnyClass, AnyObject, Bool},
        sel,
    };

    /// An `NSSize`, which a method takes by value.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct Size {
        pub width: f64,
        pub height: f64,
    }

    // SAFETY: the layout and the encoding are those of CGSize, which NSSize is on 64-bit macOS.
    unsafe impl Encode for Size {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[Encoding::Double, Encoding::Double]);
    }

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {
        static NSPrintSaveJob: *mut AnyObject;
        static NSPrintJobSavingURL: *mut AnyObject;
    }

    /// Starts an `NSPrintOperation` of `view` that saves a PDF to `path`, with no panel. Returns once it is under
    /// way; the file is finished later.
    ///
    /// # Safety
    /// `view` is a live `WKWebView` and `window` its `NSWindow`, and this runs on the main thread.
    pub unsafe fn save_pdf(
        view: *mut AnyObject,
        window: *mut AnyObject,
        path: &str,
        (width, height): (f64, f64),
    ) -> Result<(), String> {
        let class = |name: &std::ffi::CStr| AnyClass::get(name).ok_or_else(|| format!("{name:?} isn't available."));
        let text = CString::new(path).map_err(|_| "The print file's path isn't valid.".to_owned())?;
        // SAFETY: the receivers are the classes and objects named above, and each selector is the documented AppKit one.
        unsafe {
            let string: *mut AnyObject = msg_send![class(c"NSString")?, stringWithUTF8String: text.as_ptr()];
            let url: *mut AnyObject = msg_send![class(c"NSURL")?, fileURLWithPath: string];
            let shared: *mut AnyObject = msg_send![class(c"NSPrintInfo")?, sharedPrintInfo];
            let info: *mut AnyObject = msg_send![shared, copy];
            let _: () = msg_send![info, setJobDisposition: NSPrintSaveJob];
            let dictionary: *mut AnyObject = msg_send![info, dictionary];
            let _: () = msg_send![dictionary, setObject: url, forKey: NSPrintJobSavingURL];
            let paper = Size {
                width: width * super::POINTS_PER_INCH,
                height: height * super::POINTS_PER_INCH,
            };
            let _: () = msg_send![info, setPaperSize: paper];
            let _: () = msg_send![info, setTopMargin: 0.0f64];
            let _: () = msg_send![info, setBottomMargin: 0.0f64];
            let _: () = msg_send![info, setLeftMargin: 0.0f64];
            let _: () = msg_send![info, setRightMargin: 0.0f64];
            let operation: *mut AnyObject = msg_send![view, printOperationWithPrintInfo: info];
            if operation.is_null() {
                return Err("The web view made no print operation.".to_owned());
            }
            let _: () = msg_send![operation, setShowsPrintPanel: Bool::NO];
            let _: () = msg_send![operation, setShowsProgressPanel: Bool::NO];
            // Run against the window without waiting for it; the delegate is nil, so the selector is never sent.
            let _: () = msg_send![
                operation,
                runOperationModalForWindow: window,
                delegate: std::ptr::null_mut::<AnyObject>(),
                didRunSelector: sel!(description),
                contextInfo: std::ptr::null_mut::<c_void>()
            ];
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn start_print(
    window: &WebviewWindow,
    file: PathBuf,
    size: (f64, f64),
    _background: bool,
    tx: mpsc::Sender<Result<bool, String>>,
) -> IpcResult<()> {
    let path = file.to_string_lossy().into_owned();
    let failed = tx.clone();
    window
        .with_webview(move |webview| {
            let view = webview.inner().cast();
            let window = webview.ns_window().cast();
            // SAFETY: tauri runs this closure on the main thread with the window's live view and NSWindow.
            if let Err(message) = unsafe { mac::save_pdf(view, window, &path, size) } {
                let _ = failed.send(Err(message));
            }
        })
        .map_err(IpcError::from)?;
    std::thread::spawn(move || watch_for_pdf(&file, Duration::from_secs(120), &tx));
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn only_a_finished_pdf_counts() {
        assert!(is_whole_pdf(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"));
        assert!(!is_whole_pdf(b"%PDF-1.4\n1 0 obj\n<<>>\n"), "no end marker yet");
        assert!(!is_whole_pdf(b"<html>%%EOF"), "not a PDF");
        assert!(!is_whole_pdf(b""));
    }

    #[test]
    fn waits_for_the_file_to_stop_growing() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("out.pdf");
        std::fs::write(&file, b"%PDF-1.4\npartial").unwrap();
        let (tx, rx) = mpsc::channel();
        let writer = file.clone();
        let finisher = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            std::fs::write(writer, b"%PDF-1.4\nall of it\n%%EOF\n").unwrap();
        });
        watch_for_pdf(&file, Duration::from_secs(10), &tx);
        finisher.join().unwrap();
        assert_eq!(rx.recv().unwrap(), Ok(true));
    }

    #[test]
    fn gives_up_when_no_pdf_appears() {
        let folder = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        watch_for_pdf(&folder.path().join("never.pdf"), Duration::from_millis(400), &tx);
        assert!(rx.recv().unwrap().is_err());
    }
}
