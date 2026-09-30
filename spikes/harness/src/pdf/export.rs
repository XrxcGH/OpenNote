//! The two ways to turn the page into a PDF, and screenshots of the sheets to compare them with.
//!
//! WebView2's own PrintToPdf is what a Tauri app would call. The DevTools Protocol's Page.printToPDF is the
//! same Chromium printing code reached another way, and serves as a cross-check.

use std::path::Path;
use std::sync::mpsc::Sender;
use std::time::Duration;

use serde_json::{json, Value};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows::core::{Interface, HSTRING};
use windows::Win32::Foundation::E_FAIL;
use wry::{WebView, WebViewExtWindows};

use super::background::with_hidden;
use super::encoding::decode_base64;
use super::Paper;
use crate::common::webview::Controller;
use crate::common::{clock, Result};

/// A 50-page export can take a while on a slow machine.
const EXPORT_TIMEOUT: Duration = Duration::from_secs(180);

type PrintOutcome = std::result::Result<bool, String>;

/// Which WebView prints: the one on screen, or the hidden one from [`super::background`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    Visible,
    Hidden,
}

/// Prints the page with ICoreWebView2_7::PrintToPdf. Returns the time until WebView2 reported completion, in
/// milliseconds.
pub fn print_to_pdf(controller: &Controller, file: &Path, paper: Paper, view: View) -> Result<f64> {
    let target = HSTRING::from(file);
    let inches = paper.inches();
    let started = clock::now();
    let outcome: PrintOutcome = controller.on_ui_async(EXPORT_TIMEOUT, move |webview, _, done| {
        let print = |printer: &WebView| unsafe { start_print(printer, &target, inches, done.clone()) };
        let begun = match view {
            View::Visible => print(webview),
            View::Hidden => with_hidden(print).unwrap_or_else(|| Err(E_FAIL.into())),
        };
        if let Err(error) = begun {
            let _ = done.send(Err(error.to_string()));
        }
    })?;
    let elapsed = clock::elapsed_ms(started, clock::now());
    match outcome {
        Ok(true) => Ok(elapsed),
        Ok(false) => Err("WebView2 reported that printing to PDF didn't succeed.".into()),
        Err(error) => Err(format!("PrintToPdf failed: {error}").into()),
    }
}

/// Builds print settings the way a Tauri app would: the paper size, no margins, backgrounds on, no header or
/// footer, and no scaling. Then starts the print; the handler sends the outcome.
unsafe fn start_print(
    webview: &WebView,
    target: &HSTRING,
    (width, height): (f64, f64),
    done: Sender<PrintOutcome>,
) -> windows::core::Result<()> {
    let core = webview.webview();
    let environment: ICoreWebView2Environment6 = core.cast::<ICoreWebView2_2>()?.Environment()?.cast()?;
    let settings = environment.CreatePrintSettings()?;
    settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
    settings.SetScaleFactor(1.0)?;
    settings.SetPageWidth(width)?;
    settings.SetPageHeight(height)?;
    settings.SetMarginTop(0.0)?;
    settings.SetMarginBottom(0.0)?;
    settings.SetMarginLeft(0.0)?;
    settings.SetMarginRight(0.0)?;
    settings.SetShouldPrintBackgrounds(true)?;
    settings.SetShouldPrintHeaderAndFooter(false)?;
    settings.SetShouldPrintSelectionOnly(false)?;
    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
        let _ = done.send(result.map(|()| succeeded).map_err(|error| error.to_string()));
        Ok(())
    }));
    core.cast::<ICoreWebView2_7>()?.PrintToPdf(target, &settings, &handler)
}

/// Prints the page with the DevTools Protocol and writes the PDF. Returns the time for the call, including
/// the base64 transfer, in milliseconds.
pub fn cdp_print_to_pdf(controller: &Controller, file: &Path, paper: Paper) -> Result<f64> {
    let (width, height) = paper.inches();
    let params = json!({
        "printBackground": true,
        "preferCSSPageSize": true,
        "paperWidth": width,
        "paperHeight": height,
        "marginTop": 0,
        "marginBottom": 0,
        "marginLeft": 0,
        "marginRight": 0,
        "scale": 1,
        "displayHeaderFooter": false,
    });
    let started = clock::now();
    let reply = controller.cdp("Page.printToPDF", params)?;
    let bytes = decode_base64(reply["data"].as_str().ok_or("Page.printToPDF returned no data.")?)?;
    let elapsed = clock::elapsed_ms(started, clock::now());
    std::fs::write(file, bytes)?;
    Ok(elapsed)
}

/// Captures one sheet as a PNG. `rect` is the sheet in CSS pixels in document coordinates; `scale` multiplies
/// the device pixel ratio to reach the chosen resolution. Sheets below the window are rendered too.
pub fn screenshot(controller: &Controller, rect: &Value, scale: f64) -> Result<Vec<u8>> {
    let clip = json!({
        "x": rect["x"],
        "y": rect["y"],
        "width": rect["width"],
        "height": rect["height"],
        "scale": scale,
    });
    let params = json!({ "format": "png", "clip": clip, "captureBeyondViewport": true, "fromSurface": true });
    let reply = controller.cdp("Page.captureScreenshot", params)?;
    Ok(decode_base64(
        reply["data"]
            .as_str()
            .ok_or("Page.captureScreenshot returned no data.")?,
    )?)
}
