//! The measurement thread's work while the window is open: lay out the page, capture each sheet, export
//! PDFs both ways, and time exports of longer documents. Analysis happens after the window closes.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use super::background::Hidden;
use super::export::{self, View};
use super::{Paper, Plan, Route};
use crate::common::webview::Controller;
use crate::common::Result;

const READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Laying out 50 sheets and decoding their images takes a moment.
const LAYOUT_TIMEOUT: Duration = Duration::from_secs(60);
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

pub struct ExportRun {
    pub route: Route,
    pub file: PathBuf,
    pub ms: f64,
    /// Frame gaps and long tasks in the page while the export ran.
    pub frames: Value,
}

/// The page's two styles: plain CSS, and one adjusted to avoid the screen and print differences found.
pub const VARIANTS: [&str; 2] = ["baseline", "adjusted"];

/// One paper size and variant of the sample notes: the page's layout report, a screenshot of each
/// sheet, and one export per route.
pub struct PaperCapture {
    pub paper: Paper,
    pub variant: &'static str,
    pub layout: Value,
    pub screens: Vec<PathBuf>,
    pub exports: Vec<ExportRun>,
}

pub struct RouteRuns {
    pub route: Route,
    /// The first export of this document, which may include one-time setup.
    pub cold: ExportRun,
    pub samples: Vec<ExportRun>,
}

pub struct TimingCapture {
    pub paper: Paper,
    pub sheets: usize,
    pub layout: Value,
    pub routes: Vec<RouteRuns>,
}

/// Exports from a hidden WebView while the visible page draws frames. `runs[0]` is the first export.
pub struct BackgroundCapture {
    pub sheets: usize,
    pub layout: Value,
    pub runs: Vec<ExportRun>,
}

pub struct Captured {
    pub fidelity: Vec<PaperCapture>,
    pub timing: Vec<TimingCapture>,
    pub background: Option<BackgroundCapture>,
}

/// The longest document in the timing runs, which blocks the visible page the most.
const BACKGROUND_SHEETS: usize = 50;

pub fn drive(controller: &Controller, plan: &Plan) -> Result<Captured> {
    let ready = controller.wait_for("ready", READY_TIMEOUT)?;
    println!("The page is ready: {} sheets on Letter paper.", ready["sheets"]);
    controller.raise(false)?;
    let mut captured = Captured {
        fidelity: Vec::new(),
        timing: Vec::new(),
        background: None,
    };
    if plan.fidelity {
        for variant in VARIANTS {
            controller.call("setVariant", json!(variant), LAYOUT_TIMEOUT)?;
            for paper in Paper::ALL {
                captured.fidelity.push(capture_paper(controller, plan, paper, variant)?);
            }
        }
    }
    if plan.timing {
        controller.call("setVariant", json!("adjusted"), LAYOUT_TIMEOUT)?;
        for paper in Paper::ALL {
            for &sheets in &plan.sizes {
                captured.timing.push(time_exports(controller, plan, paper, sheets)?);
            }
        }
        captured.background = Some(background_export(controller, plan)?);
    }
    Ok(captured)
}

fn capture_paper(controller: &Controller, plan: &Plan, paper: Paper, variant: &'static str) -> Result<PaperCapture> {
    let layout = controller.call("setPaper", json!(paper.name()), LAYOUT_TIMEOUT)?;
    controller.eval("window.scrollTo(0, 0)")?;
    let rects = controller.call("sheetRects", Value::Null, CALL_TIMEOUT)?;
    let rects = rects.as_array().ok_or("sheetRects didn't return a list.")?;
    let ratio = layout["devicePixelRatio"].as_f64().unwrap_or(1.0);
    let scale = plan.dpi / 96.0 / ratio;
    let prefix = format!("{variant}-{}", paper.name());
    let mut screens = Vec::new();
    for (index, rect) in rects.iter().enumerate() {
        let png = export::screenshot(controller, rect, scale)?;
        let path = plan.out_dir.join(format!("{prefix}-screen-page{}.png", index + 1));
        std::fs::write(&path, png)?;
        screens.push(path);
    }
    let mut exports = Vec::new();
    for route in Route::ALL {
        let file = plan.out_dir.join(format!("{prefix}-{}.pdf", route.short()));
        exports.push(export_once(controller, route, paper, file)?);
    }
    println!(
        "Captured {} sheets and exported both PDFs: {variant}, {} paper.",
        rects.len(),
        paper.name()
    );
    Ok(PaperCapture {
        paper,
        variant,
        layout,
        screens,
        exports,
    })
}

fn export_once(controller: &Controller, route: Route, paper: Paper, file: PathBuf) -> Result<ExportRun> {
    controller.call("watchFrames", Value::Null, CALL_TIMEOUT)?;
    let ms = match route {
        Route::WebView2 => export::print_to_pdf(controller, &file, paper, View::Visible)?,
        Route::DevTools => export::cdp_print_to_pdf(controller, &file, paper)?,
    };
    let frames = controller.call("frameReport", Value::Null, CALL_TIMEOUT)?;
    Ok(ExportRun {
        route,
        file,
        ms,
        frames,
    })
}

fn time_exports(controller: &Controller, plan: &Plan, paper: Paper, sheets: usize) -> Result<TimingCapture> {
    let arguments = json!({ "paper": paper.name(), "sheets": sheets });
    let layout = controller.call("setDocument", arguments, LAYOUT_TIMEOUT)?;
    let mut routes = Vec::new();
    for route in Route::ALL {
        let file = plan
            .out_dir
            .join(format!("timing-{}-{sheets}-{}.pdf", paper.name(), route.short()));
        let cold = export_once(controller, route, paper, file.clone())?;
        let samples = (0..plan.samples)
            .map(|_| export_once(controller, route, paper, file.clone()))
            .collect::<Result<Vec<_>>>()?;
        routes.push(RouteRuns { route, cold, samples });
    }
    println!("Timed exports of {sheets} {} sheets.", paper.name());
    Ok(TimingCapture {
        paper,
        sheets,
        layout,
        routes,
    })
}

/// Prints a long document from a hidden WebView while the visible page shows the sample notes, and
/// records the visible page's frames. The first run is the cold one.
fn background_export(controller: &Controller, plan: &Plan) -> Result<BackgroundCapture> {
    controller.call("setPaper", json!(Paper::Letter.name()), LAYOUT_TIMEOUT)?;
    let hidden = Hidden::open(controller, READY_TIMEOUT)?;
    hidden.call(controller, "setVariant", json!("adjusted"), LAYOUT_TIMEOUT)?;
    let arguments = json!({ "paper": Paper::Letter.name(), "sheets": BACKGROUND_SHEETS });
    let layout = hidden.call(controller, "setDocument", arguments, LAYOUT_TIMEOUT)?;
    let file = plan.out_dir.join(format!("background-letter-{BACKGROUND_SHEETS}.pdf"));
    let mut runs = Vec::new();
    for _ in 0..=plan.samples {
        controller.call("watchFrames", Value::Null, CALL_TIMEOUT)?;
        let ms = export::print_to_pdf(controller, &file, Paper::Letter, View::Hidden)?;
        let frames = controller.call("frameReport", Value::Null, CALL_TIMEOUT)?;
        runs.push(ExportRun {
            route: Route::WebView2,
            file: file.clone(),
            ms,
            frames,
        });
    }
    hidden.close(controller)?;
    println!("Timed exports of {BACKGROUND_SHEETS} sheets from a hidden WebView.");
    Ok(BackgroundCapture {
        sheets: BACKGROUND_SHEETS,
        layout,
        runs,
    })
}
