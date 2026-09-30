//! Text on a freeform page (spike 2): typing latency with eight Tiptap editors on a zoomable canvas mixed with
//! about 5,000 ink strokes, and the smoothness of zooming and panning that page.
//!
//! Modes:
//!
//! - `keys`: typing latency, with screen timing when capture is available.
//! - `keys-screen`: the same, but screen timing is required. Use it to add screen timing to earlier results.
//! - `zoom`: zoom and pan smoothness.
//! - `sharpness`: whether a compositor layer leaves text blurry after zooming.
//!
//! Without `--mode`, it runs `keys`, `zoom`, and `sharpness`.

mod analysis;
mod input;
mod keys;
mod motion;
mod report;
mod screen_timing;
mod sharpness;

use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use serde_json::{json, Value};

use crate::common::results::machine;
use crate::common::screen::{check_desktop, ScreenLock};
use crate::common::webview::{self, Controller, WindowSpec};
use crate::common::Result;
use crate::options::Options;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Keys,
    KeysScreen,
    Zoom,
    Sharpness,
}

impl Mode {
    /// The results section the mode writes. Both typing modes write `keys`.
    fn section(self) -> &'static str {
        match self {
            Mode::Keys | Mode::KeysScreen => "keys",
            Mode::Zoom => "zoom",
            Mode::Sharpness => "sharpness",
        }
    }
}

fn modes(name: Option<&str>) -> std::result::Result<Vec<Mode>, String> {
    match name {
        None => Ok(vec![Mode::Keys, Mode::Zoom, Mode::Sharpness]),
        Some("keys") => Ok(vec![Mode::Keys]),
        Some("keys-screen") => Ok(vec![Mode::KeysScreen]),
        Some("zoom") => Ok(vec![Mode::Zoom]),
        Some("sharpness") => Ok(vec![Mode::Sharpness]),
        Some(other) => Err(format!(
            "The text spike has no mode \"{other}\". Use keys, keys-screen, zoom, or sharpness."
        )),
    }
}

/// How long to wait for another spike to finish with the screen.
const LOCK_WAIT: Duration = Duration::from_secs(45 * 60);
const DEFAULT_SAMPLES: usize = 100;

fn window(auto: bool) -> WindowSpec {
    WindowSpec {
        title: "OpenNote spike: text on a freeform page".into(),
        page: "text.html".into(),
        query: if auto { "auto=1".into() } else { String::new() },
        width: 1280.0,
        height: 800.0,
    }
}

pub fn run(options: &Options) -> Result<()> {
    let modes = modes(options.mode.as_deref())?;
    if !options.auto {
        return webview::run(window(false), wait_until_closed);
    }
    let path = options.results_path();
    let samples = options.samples.unwrap_or(DEFAULT_SAMPLES).max(1);
    let lock = ScreenLock::acquire(LOCK_WAIT)?;
    if let Err(error) = check_desktop() {
        record_not_run(&path, &modes, &error.to_string())?;
        return Err(error);
    }
    let outcome = webview::run(window(true), move |controller| {
        drive(&controller, &modes, samples, &path)
    });
    drop(lock);
    outcome
}

/// For trying the page by hand: waits until the person closes the window.
fn wait_until_closed(controller: Controller) -> Result<()> {
    loop {
        match controller.next_message(Duration::from_secs(3600)) {
            Ok(Some(message)) if message["type"] == "closed" => return Ok(()),
            Ok(_) => {}
            Err(_) => return Ok(()),
        }
    }
}

fn drive(controller: &Controller, modes: &[Mode], samples: usize, path: &Path) -> Result<()> {
    let page = controller.wait_for("ready", Duration::from_secs(60))?;
    controller.raise(true)?;
    sleep(Duration::from_secs(1));
    let mut sections = vec![("page".to_string(), page_section(controller, page)?)];
    for mode in modes {
        let outcome = match mode {
            Mode::Keys => keys::run(controller, samples, false),
            Mode::KeysScreen => keys::run(controller, samples, true),
            Mode::Zoom => motion::run(controller, machine().refresh_hz),
            Mode::Sharpness => sharpness::run(controller),
        };
        let section = outcome.unwrap_or_else(|error| json!({ "status": format!("failed: {error}") }));
        sections.push((mode.section().to_string(), section));
    }
    controller.raise(false)?;
    report::write(path, sections)
}

/// What the page reported when it loaded (notes, strokes, words, and setup times), plus the window size.
fn page_section(controller: &Controller, mut page: Value) -> Result<Value> {
    let area = controller.client_area()?;
    if let Some(details) = page.as_object_mut() {
        details.remove("type");
        details.insert(
            "window_px".into(),
            json!({ "width": area.width, "height": area.height, "scale": area.scale }),
        );
    }
    Ok(page)
}

/// Records that the measurement couldn't run, but only in sections with no earlier results, so a locked
/// session never erases real data.
fn record_not_run(path: &Path, modes: &[Mode], reason: &str) -> Result<()> {
    let earlier = report::previous(path);
    let sections = modes
        .iter()
        .filter(|mode| !earlier.contains_key(mode.section()))
        .map(|mode| {
            (
                mode.section().to_string(),
                json!({ "status": "not run", "reason": reason }),
            )
        })
        .collect();
    report::write(path, sections)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chooses_modes() {
        assert_eq!(modes(None).unwrap(), vec![Mode::Keys, Mode::Zoom, Mode::Sharpness]);
        assert_eq!(modes(Some("keys-screen")).unwrap(), vec![Mode::KeysScreen]);
        assert_eq!(Mode::KeysScreen.section(), "keys");
        assert!(modes(Some("fast")).is_err());
    }
}
