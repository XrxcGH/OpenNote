//! PDF export: WebView2 print-to-PDF of a paginated page, compared with the screen (spike 3).
//!
//! The page shows lecture notes as paper sheets. With `--auto`, the harness captures each sheet at a fixed
//! resolution. It exports the page with WebView2's PrintToPdf and with the DevTools Protocol. Then it renders
//! each PDF page with Windows.Data.Pdf at the same resolution and compares them. It also checks with lopdf
//! that ink stays vector and fonts are embedded, and times exports of 1, 10, and 50 pages.
//!
//! Modes: `fidelity` (the comparison) and `timing` (the export times). Both run by default.

mod analyze;
mod background;
mod compare;
mod drive;
mod encoding;
mod export;
mod inspect;
mod raster;
mod summary;
mod timing;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::Duration;

use serde_json::json;
use windows::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};

use crate::common::screen::{check_desktop, ScreenLock};
use crate::common::webview::{self, WindowSpec};
use crate::common::{results, Result};
use crate::options::Options;

/// 144 pixels per inch is this screen's own density at 150% scaling (96 × 1.5), so screenshots are the
/// page exactly as the screen draws it, with no resampling.
const DEFAULT_DPI: f64 = 144.0;
const DEFAULT_SAMPLES: usize = 5;
/// Document lengths for the export timing, in sheets.
const TIMING_SIZES: [usize; 3] = [1, 10, 50];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Paper {
    Letter,
    A4,
}

impl Paper {
    pub const ALL: [Paper; 2] = [Paper::Letter, Paper::A4];

    pub fn name(self) -> &'static str {
        match self {
            Paper::Letter => "letter",
            Paper::A4 => "a4",
        }
    }

    /// Width and height in inches.
    pub fn inches(self) -> (f64, f64) {
        match self {
            Paper::Letter => (8.5, 11.0),
            Paper::A4 => (210.0 / 25.4, 297.0 / 25.4),
        }
    }

    /// Width and height in PDF points, 72 to the inch.
    pub fn points(self) -> (f64, f64) {
        let (width, height) = self.inches();
        (width * 72.0, height * 72.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// ICoreWebView2_7::PrintToPdf, as a Tauri app would call it.
    WebView2,
    /// The DevTools Protocol's Page.printToPDF.
    DevTools,
}

impl Route {
    pub const ALL: [Route; 2] = [Route::WebView2, Route::DevTools];

    pub fn name(self) -> &'static str {
        match self {
            Route::WebView2 => "webview2_print_to_pdf",
            Route::DevTools => "cdp_page_print_to_pdf",
        }
    }

    pub fn short(self) -> &'static str {
        match self {
            Route::WebView2 => "webview2",
            Route::DevTools => "cdp",
        }
    }
}

/// What an automated run measures, and where it puts the PDFs and images.
#[derive(Clone, Debug)]
pub struct Plan {
    pub dpi: f64,
    pub samples: usize,
    pub fidelity: bool,
    pub timing: bool,
    pub sizes: Vec<usize>,
    pub out_dir: PathBuf,
}

impl Plan {
    fn new(options: &Options) -> Result<Plan> {
        let mode = options.mode.as_deref();
        if !matches!(mode, None | Some("fidelity") | Some("timing")) {
            return Err(format!(
                "The pdf spike has the modes fidelity and timing, not \"{}\".",
                mode.unwrap_or("")
            )
            .into());
        }
        let results = options.results_path();
        let folder = results.parent().unwrap_or(Path::new(".")).join("pdf");
        std::fs::create_dir_all(&folder)?;
        Ok(Plan {
            dpi: DEFAULT_DPI,
            samples: options.samples.unwrap_or(DEFAULT_SAMPLES).max(1),
            fidelity: mode != Some("timing"),
            timing: mode != Some("fidelity"),
            sizes: TIMING_SIZES.to_vec(),
            out_dir: plain_absolute(&folder)?,
        })
    }
}

/// An absolute path without the `\\?\` prefix, which WebView2 and StorageFile don't accept.
fn plain_absolute(folder: &Path) -> Result<PathBuf> {
    let canonical = std::fs::canonicalize(folder)?;
    let text = canonical.to_string_lossy();
    Ok(PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text)))
}

fn window(auto: bool) -> WindowSpec {
    WindowSpec {
        title: "OpenNote spike: PDF export".into(),
        page: "pdf.html".into(),
        query: if auto { "auto=1".into() } else { String::new() },
        width: 1000.0,
        height: 860.0,
    }
}

pub fn run(options: &Options) -> Result<()> {
    if !options.auto {
        println!("Switch the paper in the panel, and use Print to try the browser's own print preview.");
        return webview::run(window(false), |controller| loop {
            if controller
                .next_message(Duration::from_secs(3600))?
                .is_some_and(|m| m["type"] == "closed")
            {
                return Ok(());
            }
        });
    }
    let plan = Plan::new(options)?;
    // The window takes the screen, so hold the shared lock until it closes.
    let lock = ScreenLock::acquire(Duration::from_secs(45 * 60))?;
    if let Err(error) = check_desktop() {
        let reason = format!("The measurement could not run: {error}");
        results::write(
            &options.results_path(),
            "pdf",
            json!({ "status": "not run", "reason": reason }),
        )?;
        return Err(error);
    }
    let (sender, receiver) = channel();
    let driver_plan = plan.clone();
    webview::run(window(true), move |controller| {
        let captured = drive::drive(&controller, &driver_plan)?;
        let _ = sender.send(captured);
        Ok(())
    })?;
    drop(lock);
    let captured = receiver
        .recv()
        .map_err(|_| "The measurement thread ended without results.")?;
    println!("The window has closed. Comparing the PDFs with the screen...");
    let outcome =
        analyze::results(&plan, &captured).and_then(|results| results::write(&options.results_path(), "pdf", results));
    end_now(outcome)
}

/// Ends the process at once. After Windows.Data.Pdf has rendered pages, the normal shutdown spun one core
/// for about 20 minutes on the test machine before the process exited. Everything is written by now.
fn end_now(outcome: Result<()>) -> ! {
    let code = match outcome {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("The pdf spike failed: {error}");
            1
        }
    };
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    unsafe {
        let _ = TerminateProcess(GetCurrentProcess(), code);
    }
    std::process::exit(code as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_sizes_match_the_standards() {
        assert_eq!(Paper::Letter.points(), (612.0, 792.0));
        let (width, height) = Paper::A4.points();
        assert!((width - 595.28).abs() < 0.01 && (height - 841.89).abs() < 0.01);
    }

    #[test]
    fn strips_the_verbatim_prefix() {
        let folder = std::env::temp_dir();
        let plain = plain_absolute(&folder).unwrap();
        assert!(!plain.to_string_lossy().starts_with(r"\\?\"));
        assert!(plain.is_absolute());
    }
}
