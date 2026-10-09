//! Printing a page to PDF and saving what an export makes (Phase 6; ADR 0006, `docs/adr/0006-pdf-export.md`).
//!
//! A PDF export runs in a second WebView that is never shown. `print_prepare` opens it on `print.html` and hands it
//! the page. The window measures the page, plans the sheets with the paginator the screen uses, shows the print
//! document, and reports the plan through an event. `print_render` then calls WebView2's `PrintToPdf` on that
//! window and returns the file's bytes. `print_close` closes it. Nothing here runs in the main window, so typing
//! and drawing never wait for an export.
//!
//! The interface never names a path. `export_pick_save` shows Windows' Save dialog and remembers the chosen path.
//! `export_write` writes only to a path the person chose that way, plus files inside the same folder.

use std::{
    collections::HashSet,
    fs,
    path::{Component, Path, PathBuf},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    ipc::{InvokeBody, Response},
    AppHandle, Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::{
    images::import::percent_decode,
    ipc::{codes, IpcError, IpcResult},
};

/// The event the print window sends when it has prepared the page, or failed to.
pub const RESULT_EVENT: &str = "print://result";

/// A long page takes seconds to measure; a stuck window takes forever.
const PREPARE_TIMEOUT: Duration = Duration::from_secs(180);
/// A 50-page export takes about six seconds; this leaves room for a slow machine.
const RENDER_TIMEOUT: Duration = Duration::from_secs(600);
/// Most an export writes in one go.
pub const MAX_EXPORT_BYTES: usize = 512 * 1024 * 1024;
/// The sides of a sheet, in inches (the layout model's 1 to 200).
const MIN_SIDE: f64 = 0.5;
const MAX_SIDE: f64 = 220.0;

/// The paths the person chose in the Save dialog and has not saved to yet.
#[derive(Default)]
pub struct ExportGrants {
    chosen: Mutex<HashSet<PathBuf>>,
    written: Mutex<HashSet<PathBuf>>,
}

impl ExportGrants {
    fn grant(&self, path: PathBuf) {
        if let Ok(mut set) = self.chosen.lock() {
            set.insert(path);
        }
    }

    pub(crate) fn take(&self, path: &Path) -> bool {
        self.chosen.lock().map(|mut set| set.remove(path)).unwrap_or(false)
    }

    pub(crate) fn mark_written(&self, path: PathBuf) {
        if let Ok(mut set) = self.written.lock() {
            set.insert(path);
        }
    }

    fn was_written(&self, path: &Path) -> bool {
        self.written.lock().map(|set| set.contains(path)).unwrap_or(false)
    }
}

/// The label of a job's window. A job ID is letters, digits, `-`, and `_`, so it can't name another window.
fn job_label(job: &str) -> IpcResult<String> {
    let valid =
        !job.is_empty() && job.len() <= 48 && job.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(format!("print-{job}"))
    } else {
        Err(IpcError::invalid("job", "The export job's name isn't valid."))
    }
}

fn not_found(what: &str) -> IpcError {
    IpcError::new("notFound", format!("{what} isn't open."))
}

fn close_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

/// Waits for the print window's report for `job`, and returns its result.
fn wait_for_report(rx: &mpsc::Receiver<String>, job: &str, limit: Duration) -> IpcResult<Value> {
    let deadline = Instant::now() + limit;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let payload = rx
            .recv_timeout(left)
            .map_err(|_| IpcError::new("timeout", "The print window took too long to prepare the page."))?;
        // The payload is the JSON text of what the window emitted: an object, or a string holding one.
        let value: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
        let value = match value {
            Value::String(text) => serde_json::from_str(&text).unwrap_or(Value::Null),
            other => other,
        };
        if value["job"].as_str() != Some(job) {
            continue;
        }
        return if value["ok"].as_bool() == Some(true) {
            Ok(value["result"].clone())
        } else {
            let message = value["message"].as_str().unwrap_or("The page couldn't be prepared.");
            Err(IpcError::new(codes::INTERNAL, message.to_owned()))
        };
    }
}

/// Opens the hidden print window on `input` (a `PrepareInput`) and returns what the window planned: the sheets,
/// the breaks, the print plan, and the warnings. The window stays open for `print_render`.
#[tauri::command]
pub async fn print_prepare(app: AppHandle, job: String, input: Value) -> IpcResult<Value> {
    let label = job_label(&job)?;
    close_window(&app, &label);
    let setup = serde_json::to_string(&json!({ "job": job, "input": input }))
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    let (tx, rx) = mpsc::channel::<String>();
    let listener = app.listen_any(RESULT_EVENT, move |event| {
        let _ = tx.send(event.payload().to_owned());
    });
    let built = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("print.html".into()))
        .title("OpenNote print")
        .inner_size(1280.0, 960.0)
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .focused(false)
        .initialization_script(format!("window.__OPENNOTE_PRINT__ = {setup};"))
        .on_navigation(crate::window::is_app_url)
        .build();
    if let Err(error) = built {
        app.unlisten(listener);
        return Err(error.into());
    }
    let wanted = job.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || wait_for_report(&rx, &wanted, PREPARE_TIMEOUT)).await;
    app.unlisten(listener);
    let outcome = outcome.map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    if outcome.is_err() {
        close_window(&app, &label);
    }
    outcome
}

/// The sheet size in inches: both sides in range.
fn check_sheet(width: f64, height: f64) -> IpcResult<()> {
    let fits = |side: f64| side.is_finite() && (MIN_SIDE..=MAX_SIDE).contains(&side);
    if fits(width) && fits(height) {
        Ok(())
    } else {
        Err(IpcError::invalid("size", "The sheet size is out of range."))
    }
}

/// Prints the shown document of a job's window to PDF with WebView2's `PrintToPdf`, and returns the file's bytes.
/// The sheet size is the box of the first sheet in inches; the document's own `@page` rule sizes every page.
#[tauri::command]
pub async fn print_render(
    app: AppHandle,
    job: String,
    width: f64,
    height: f64,
    background: bool,
    tagged: Option<bool>,
    outline: Option<bool>,
) -> IpcResult<Response> {
    check_sheet(width, height)?;
    let label = job_label(&job)?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| not_found("The print window"))?;
    let (tagged, outline) = (tagged.unwrap_or(false), outline.unwrap_or(false));
    if tagged || outline {
        // The DevTools route writes structure tags, a language, and bookmarks. If it fails, the plain route below
        // still makes the PDF, and the export's check tells the person it has no tags.
        match render_with_devtools(&window, (width, height), background, tagged, outline).await {
            Ok(bytes) => return Ok(Response::new(bytes)),
            Err(error) => log::warn!("Tagged PDF failed, printing without tags: {error:?}"),
        }
    }
    let file = std::env::temp_dir().join(format!("opennote-print-{}-{job}.pdf", std::process::id()));
    let (tx, rx) = mpsc::channel::<Result<bool, String>>();
    start_print(&window, file.clone(), (width, height), background, tx)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(RENDER_TIMEOUT))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    let bytes = match outcome {
        Ok(Ok(true)) => fs::read(&file).map_err(IpcError::from),
        Ok(Ok(false)) => Err(IpcError::new(codes::INTERNAL, "WebView2 didn't write the PDF.")),
        Ok(Err(message)) => Err(IpcError::new(codes::INTERNAL, format!("PrintToPdf failed: {message}"))),
        Err(_) => Err(IpcError::new("timeout", "Printing to PDF took too long.")),
    };
    let _ = fs::remove_file(&file);
    Ok(Response::new(bytes?))
}

/// The parameters of the DevTools `Page.printToPDF` call for a sheet of `width` by `height` inches. The document's
/// own `@page` rule still sizes each page (`preferCSSPageSize`), as it does for `PrintToPdf`.
fn devtools_params(width: f64, height: f64, background: bool, tagged: bool, outline: bool) -> Value {
    json!({
        "landscape": false,
        "displayHeaderFooter": false,
        "printBackground": background,
        "scale": 1,
        "paperWidth": width,
        "paperHeight": height,
        "marginTop": 0,
        "marginBottom": 0,
        "marginLeft": 0,
        "marginRight": 0,
        "preferCSSPageSize": true,
        "generateTaggedPDF": tagged,
        "generateDocumentOutline": outline,
    })
}

/// Decodes standard base64 (with or without padding), or `None` when the text holds anything else.
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut bits, mut count) = (0u32, 0u8);
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(out)
}

/// The PDF bytes in a `Page.printToPDF` reply (`{"data": "<base64>"}`).
fn pdf_from_reply(reply: &str) -> Result<Vec<u8>, String> {
    let value: Value = serde_json::from_str(reply).map_err(|error| error.to_string())?;
    let data = value["data"].as_str().ok_or("The reply holds no PDF.")?;
    decode_base64(data).ok_or_else(|| "The PDF in the reply isn't valid base64.".to_owned())
}

/// Prints the window's document with Chromium's `Page.printToPDF`, which can write structure tags and bookmarks.
async fn render_with_devtools(
    window: &WebviewWindow,
    (width, height): (f64, f64),
    background: bool,
    tagged: bool,
    outline: bool,
) -> IpcResult<Vec<u8>> {
    let params = devtools_params(width, height, background, tagged, outline).to_string();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    start_devtools_print(window, params, tx)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(RENDER_TIMEOUT))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?;
    match outcome {
        Ok(Ok(reply)) => pdf_from_reply(&reply).map_err(|message| IpcError::new(codes::INTERNAL, message)),
        Ok(Err(message)) => Err(IpcError::new(
            codes::INTERNAL,
            format!("Page.printToPDF failed: {message}"),
        )),
        Err(_) => Err(IpcError::new("timeout", "Printing to PDF took too long.")),
    }
}

#[cfg(windows)]
fn start_devtools_print(
    window: &WebviewWindow,
    params: String,
    tx: mpsc::Sender<Result<String, String>>,
) -> IpcResult<()> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;

    window
        .with_webview(move |webview| {
            // SAFETY: the controller is a live COM object, and this closure runs on the main thread that owns the
            // window. The completion handler sends the reply and nothing else.
            let started = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = webview.controller().CoreWebView2()?;
                    let done = tx.clone();
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, reply| {
                        let _ = done.send(result.map(|()| reply).map_err(|error| error.to_string()));
                        Ok(())
                    }));
                    core.CallDevToolsProtocolMethod(
                        &HSTRING::from("Page.printToPDF"),
                        &HSTRING::from(params.as_str()),
                        &handler,
                    )
                })()
            };
            if let Err(error) = started {
                let _ = tx.send(Err(error.to_string()));
            }
        })
        .map_err(IpcError::from)
}

#[cfg(not(windows))]
fn start_devtools_print(
    _window: &WebviewWindow,
    _params: String,
    _tx: mpsc::Sender<Result<String, String>>,
) -> IpcResult<()> {
    Err(IpcError::not_implemented("print_render"))
}

#[cfg(windows)]
fn start_print(
    window: &WebviewWindow,
    file: PathBuf,
    (width, height): (f64, f64),
    background: bool,
    tx: mpsc::Sender<Result<bool, String>>,
) -> IpcResult<()> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        },
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};

    window
        .with_webview(move |webview| {
            // SAFETY: the controller and the print settings are live COM objects, and this closure runs on the
            // main thread that owns the window. The completion handler sends the outcome and nothing else.
            let started = unsafe {
                (|| -> windows::core::Result<()> {
                    let core = webview.controller().CoreWebView2()?;
                    let environment: ICoreWebView2Environment6 =
                        core.cast::<ICoreWebView2_2>()?.Environment()?.cast()?;
                    let settings = environment.CreatePrintSettings()?;
                    settings.SetOrientation(if width > height {
                        COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                    } else {
                        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                    })?;
                    settings.SetScaleFactor(1.0)?;
                    // The orientation turns the page, so the sides go in the way round the paper has them.
                    settings.SetPageWidth(width.min(height))?;
                    settings.SetPageHeight(width.max(height))?;
                    settings.SetMarginTop(0.0)?;
                    settings.SetMarginBottom(0.0)?;
                    settings.SetMarginLeft(0.0)?;
                    settings.SetMarginRight(0.0)?;
                    settings.SetShouldPrintBackgrounds(background)?;
                    settings.SetShouldPrintHeaderAndFooter(false)?;
                    settings.SetShouldPrintSelectionOnly(false)?;
                    let done = tx.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
                        let _ = done.send(result.map(|()| succeeded).map_err(|error| error.to_string()));
                        Ok(())
                    }));
                    core.cast::<ICoreWebView2_7>()?
                        .PrintToPdf(&HSTRING::from(file.as_path()), &settings, &handler)
                })()
            };
            if let Err(error) = started {
                let _ = tx.send(Err(error.to_string()));
            }
        })
        .map_err(IpcError::from)
}

#[cfg(not(windows))]
fn start_print(
    _window: &WebviewWindow,
    _file: PathBuf,
    _size: (f64, f64),
    _background: bool,
    _tx: mpsc::Sender<Result<bool, String>>,
) -> IpcResult<()> {
    Err(IpcError::not_implemented("print_render"))
}

/// Closes a job's print window. A window that is already gone is not an error.
#[tauri::command]
pub async fn print_close(app: AppHandle, job: String) -> IpcResult<()> {
    close_window(&app, &job_label(&job)?);
    Ok(())
}

/// Shows Windows' Save dialog and returns the chosen path, or `None` when the person cancels. The path is
/// remembered, so `export_write` accepts it once.
#[tauri::command]
pub async fn export_pick_save(
    window: WebviewWindow,
    suggested: String,
    label: String,
    extension: String,
) -> IpcResult<Option<String>> {
    if extension.is_empty() || !extension.chars().all(|c| c.is_ascii_alphanumeric()) || extension.len() > 12 {
        return Err(IpcError::invalid("extension", "The file type isn't valid."));
    }
    let owner = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let picked = tauri::async_runtime::spawn_blocking(move || save_dialog(owner, &suggested, &label, &extension))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))??;
    Ok(picked.map(|path| {
        window.app_handle().state::<ExportGrants>().grant(path.clone());
        path.display().to_string()
    }))
}

#[cfg(windows)]
fn save_dialog(owner: isize, suggested: &str, label: &str, extension: &str) -> IpcResult<Option<PathBuf>> {
    use windows::{
        core::{HSTRING, PCWSTR},
        Win32::{
            Foundation::{ERROR_CANCELLED, HWND},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog, FOS_FORCEFILESYSTEM, FOS_OVERWRITEPROMPT,
                FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
            },
        },
    };

    // SAFETY: COM is initialized for this thread and released before it returns, and every object below lives
    // within that span. The owner handle names the main window, or is null for none.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<PathBuf>> {
            let dialog: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_OVERWRITEPROMPT | FOS_PATHMUSTEXIST)?;
            let name = HSTRING::from(format!("{label} (*.{extension})"));
            let spec = HSTRING::from(format!("*.{extension}"));
            let types = [COMDLG_FILTERSPEC {
                pszName: PCWSTR(name.as_ptr()),
                pszSpec: PCWSTR(spec.as_ptr()),
            }];
            dialog.SetFileTypes(&types)?;
            dialog.SetFileTypeIndex(1)?;
            dialog.SetDefaultExtension(&HSTRING::from(extension))?;
            dialog.SetFileName(&HSTRING::from(suggested))?;
            let parent = (owner != 0).then_some(HWND(owner as *mut _));
            if let Err(error) = dialog.Show(parent) {
                return if error.code() == ERROR_CANCELLED.to_hresult() {
                    Ok(None)
                } else {
                    Err(error)
                };
            }
            let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(name.0.cast_const().cast()));
            Ok(path)
        })();
        if apartment.is_ok() {
            CoUninitialize();
        }
        Ok(result?)
    }
}

#[cfg(not(windows))]
fn save_dialog(_owner: isize, _suggested: &str, _label: &str, _extension: &str) -> IpcResult<Option<PathBuf>> {
    Err(IpcError::not_implemented("export_pick_save"))
}

/// The header of `export_write` (percent-encoded JSON). It holds the path the Save dialog returned, and the files in
/// the body, one after the other. The first part is the file at `path`. Each later part is a path relative to that
/// file's folder.
#[derive(Debug, Deserialize)]
struct WriteHeader {
    path: String,
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
struct Part {
    /// Relative to the main file's folder; empty for the main file itself.
    #[serde(default)]
    path: String,
    length: usize,
}

/// A sibling's path: relative, no `..`, no drive, and no empty or reserved parts.
fn sibling_path(folder: &Path, relative: &str) -> IpcResult<PathBuf> {
    let bad = || IpcError::invalid("parts", "A file's path isn't valid.");
    if relative.is_empty() || relative.len() > 240 || relative.contains(['\\', ':', '\0']) {
        return Err(bad());
    }
    let mut path = folder.to_path_buf();
    for part in relative.split('/') {
        let clean = !part.is_empty()
            && part != "."
            && part != ".."
            && !part.ends_with(['.', ' '])
            && !part.contains(['<', '>', '"', '|', '?', '*']);
        if !clean || Path::new(part).components().any(|c| !matches!(c, Component::Normal(_))) {
            return Err(bad());
        }
        path.push(part);
    }
    Ok(path)
}

/// Writes `bytes` to `path` through a temporary file next to it, so a failed write never leaves half a file.
fn write_safely(path: &Path, bytes: &[u8]) -> IpcResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}.part",
        path.extension().and_then(|e| e.to_str()).unwrap_or("tmp")
    ));
    let written = fs::write(&temp, bytes).and_then(|()| fs::rename(&temp, path));
    if written.is_err() {
        let _ = fs::remove_file(&temp);
    }
    Ok(written?)
}

/// Writes the files of an export. The body holds the parts' bytes in order, and the `x-opennote-export` header
/// (JSON) names the chosen path and each part's length. Only a path from `export_pick_save` is written, once.
#[tauri::command]
pub async fn export_write(app: AppHandle, request: tauri::ipc::Request<'_>) -> IpcResult<()> {
    let header = request
        .headers()
        .get("x-opennote-export")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-export", "The export header is missing."))?;
    // The header is percent-encoded, because a header holds ASCII only and a path may hold any letter.
    let header: WriteHeader = serde_json::from_str(&percent_decode(header))
        .map_err(|_| IpcError::invalid("x-opennote-export", "The export header isn't valid JSON."))?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The files must come as raw bytes.")),
    };
    let granted = PathBuf::from(&header.path);
    if !app.state::<ExportGrants>().take(&granted) {
        return Err(IpcError::invalid("path", "Choose where to save before writing."));
    }
    let main = granted.clone();
    tauri::async_runtime::spawn_blocking(move || write_parts(&granted, &header.parts, &body))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))??;
    app.state::<ExportGrants>().mark_written(main);
    Ok(())
}

/// Opens a file this session exported in its default app, or shows it in File Explorer. Any other path is refused.
#[tauri::command]
pub async fn export_open(app: AppHandle, path: String, reveal: bool) -> IpcResult<()> {
    let file = PathBuf::from(&path);
    if !app.state::<ExportGrants>().was_written(&file) {
        return Err(IpcError::invalid(
            "path",
            "Only a file this export saved can be opened.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || open_file(&file, reveal))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}

#[cfg(windows)]
fn open_file(file: &Path, reveal: bool) -> IpcResult<()> {
    use windows::{
        core::{w, HSTRING},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    // SAFETY: both strings outlive the call, and ShellExecuteW takes no other pointers.
    let result = unsafe {
        if reveal {
            let argument = HSTRING::from(format!("/select,\"{}\"", file.display()));
            ShellExecuteW(None, w!("open"), w!("explorer.exe"), &argument, None, SW_SHOWNORMAL)
        } else {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(file.as_os_str()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        }
    };
    // ShellExecute reports success with a value above 32.
    if (result.0 as isize) > 32 {
        Ok(())
    } else {
        Err(IpcError::new(codes::INTERNAL, "Windows couldn't open the file."))
    }
}

#[cfg(not(windows))]
fn open_file(_file: &Path, _reveal: bool) -> IpcResult<()> {
    Err(IpcError::not_implemented("export_open"))
}

fn write_parts(main: &Path, parts: &[Part], body: &[u8]) -> IpcResult<()> {
    let total = parts.iter().try_fold(0usize, |sum, part| sum.checked_add(part.length));
    if total != Some(body.len()) || body.len() > MAX_EXPORT_BYTES || parts.is_empty() {
        return Err(IpcError::invalid("parts", "The files don't add up to the data sent."));
    }
    let folder = main.parent().unwrap_or(Path::new(""));
    let mut offset = 0;
    for (index, part) in parts.iter().enumerate() {
        let target = if index == 0 {
            main.to_path_buf()
        } else {
            sibling_path(folder, &part.path)?
        };
        write_safely(&target, &body[offset..offset + part.length])?;
        offset += part.length;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devtools_params_ask_for_tags_and_bookmarks() {
        let params = devtools_params(8.5, 11.0, true, true, false);
        assert_eq!(params["generateTaggedPDF"], true);
        assert_eq!(params["generateDocumentOutline"], false);
        assert_eq!(params["preferCSSPageSize"], true);
        assert_eq!(params["paperWidth"], 8.5);
        assert_eq!(params["printBackground"], true);
    }

    #[test]
    fn base64_decodes_with_and_without_padding() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        assert_eq!(decode_base64("TWE=").unwrap(), b"Ma");
        assert_eq!(decode_base64("TQ==").unwrap(), b"M");
        assert_eq!(decode_base64("TQ").unwrap(), b"M");
        assert_eq!(decode_base64("+/8=").unwrap(), [0xfb, 0xff]);
        assert!(decode_base64("T*Q=").is_none());
    }

    #[test]
    fn the_pdf_comes_out_of_the_devtools_reply() {
        assert_eq!(pdf_from_reply(r#"{"data":"JVBERg=="}"#).unwrap(), b"%PDF");
        assert!(pdf_from_reply("{}").is_err());
        assert!(pdf_from_reply("not json").is_err());
        assert!(pdf_from_reply(r#"{"data":"%%"}"#).is_err());
    }

    #[test]
    fn job_labels_hold_only_safe_characters() {
        assert_eq!(job_label("a1-b_2").unwrap(), "print-a1-b_2");
        for bad in ["", "a b", "../x", "x/y", "é", &"a".repeat(49)] {
            assert!(job_label(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn sheet_sizes_stay_in_range() {
        assert!(check_sheet(8.5, 11.0).is_ok());
        assert!(check_sheet(0.0, 11.0).is_err());
        assert!(check_sheet(f64::NAN, 11.0).is_err());
        assert!(check_sheet(8.5, 500.0).is_err());
    }

    #[test]
    fn siblings_stay_inside_the_folder() {
        let folder = Path::new("C:/Notes");
        assert!(sibling_path(folder, "Title_files/a.png").is_ok());
        for bad in [
            "", "../a.png", "a/../b", "/abs.png", "C:/x.png", "a\\b", "a//b", "con?.png", "a.", "./a",
        ] {
            assert!(sibling_path(folder, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_granted_path_is_good_once() {
        let grants = ExportGrants::default();
        let path = PathBuf::from("C:/Notes/Page.pdf");
        assert!(!grants.take(&path));
        grants.grant(path.clone());
        assert!(grants.take(&path));
        assert!(!grants.take(&path));
    }

    #[test]
    fn writes_the_main_file_and_its_siblings() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("Page.md");
        let parts = [
            Part {
                path: String::new(),
                length: 3,
            },
            Part {
                path: "Page_files/a.png".into(),
                length: 2,
            },
        ];
        write_parts(&main, &parts, b"abcde").unwrap();
        assert_eq!(fs::read(&main).unwrap(), b"abc");
        assert_eq!(fs::read(dir.path().join("Page_files/a.png")).unwrap(), b"de");
        assert!(!dir.path().join("Page.md.part").exists());
    }

    #[test]
    fn refuses_parts_that_do_not_match_the_body() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("Page.md");
        let short = [Part {
            path: String::new(),
            length: 9,
        }];
        assert!(write_parts(&main, &short, b"abc").is_err());
        assert!(write_parts(&main, &[], b"").is_err());
        assert!(!main.exists());
        let escape = [
            Part {
                path: String::new(),
                length: 1,
            },
            Part {
                path: "../evil".into(),
                length: 1,
            },
        ];
        assert!(write_parts(&main, &escape, b"ab").is_err());
        assert!(!dir.path().parent().unwrap().join("evil").exists());
    }

    #[test]
    fn reads_the_report_for_its_own_job_only() {
        let (tx, rx) = mpsc::channel();
        tx.send(r#"{"job":"other","ok":true,"result":1}"#.to_owned()).unwrap();
        tx.send(r#"{"job":"mine","ok":true,"result":{"sheets":2}}"#.to_owned())
            .unwrap();
        let result = wait_for_report(&rx, "mine", Duration::from_secs(1)).unwrap();
        assert_eq!(result["sheets"], 2);
    }

    #[test]
    fn a_failed_report_becomes_an_error_and_a_silent_window_times_out() {
        let (tx, rx) = mpsc::channel();
        tx.send(r#""{\"job\":\"j\",\"ok\":false,\"message\":\"no fonts\"}""#.to_owned())
            .unwrap();
        let error = wait_for_report(&rx, "j", Duration::from_secs(1)).unwrap_err();
        assert_eq!(error.message, "no fonts");
        let error = wait_for_report(&rx, "j", Duration::from_millis(20)).unwrap_err();
        assert_eq!(error.code, "timeout");
    }
}
