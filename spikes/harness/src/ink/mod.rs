//! Ink latency: how long a pen stroke takes to reach the screen in WebView2 (spike 1).
//!
//! The automated run opens the ink page in a fresh window for each renderer mode. First it draws a
//! continuous stroke to record frame pacing. Then it times single pen moves. For each move it watches
//! a small square of the screen where the ink will appear, and sends the move. The latency ends at the
//! present time of the first frame in which the square changes.
//!
//! Moves go in two ways: through the Windows pointer stack from a synthetic pen, and through the Chrome
//! DevTools Protocol, which skips Windows. The page records its own event timestamps, so the harness
//! can split each latency into input, drawing, and presentation.
//!
//! Last, a native window that draws with GDI gets the same synthetic pen moves (see `native.rs`). It
//! shows the floor that any windowed app meets, whatever its interface toolkit.
//!
//! Without `--auto`, the page opens for a person to draw on, with a panel to switch modes and save
//! the page's own timings.

mod cdp;
mod measure;
mod native;
mod page;
mod pen;
mod plan;
mod report;

use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tao::dpi::PhysicalPosition;
use tao::platform::windows::WindowExtWindows;

use crate::common::capture::{ChangeWatcher, Region};
use crate::common::screen::{check_desktop, ScreenLock};
use crate::common::webview::{self, Controller, WindowSpec};
use crate::common::{results, Result};
use crate::options::Options;
use measure::Rig;
use pen::Target;

/// The renderer modes, in the order the automated run measures them (see spikes/web/ink-input.ts).
pub const MODES: [&str; 10] = [
    "canvas2d",
    "canvas2d-raf",
    "desync",
    "raw",
    "webgl-desync",
    "delegated",
    "trail-only",
    "predicted",
    "desync-busy",
    "delegated-busy",
];
const MANUAL_MODE: &str = "desync";
const DEFAULT_SAMPLES: usize = 200;
/// The window's inner size in logical pixels.
pub const WINDOW_SIZE: (f64, f64) = (1200.0, 800.0);
/// Stop starting new modes after this long, so the screen lock is never held for much over 15 minutes.
const RUN_BUDGET: Duration = Duration::from_secs(13 * 60);
const LOCK_WAIT: Duration = Duration::from_secs(45 * 60);
/// Seeds for the pseudo-random delays, so every run waits the same way.
pub const SEED: u64 = 0x5EED_1A7E;

/// Sends pen input to the page, in CSS pixels.
pub trait Injector {
    fn down(&mut self, point: &plan::PenPoint) -> Result<()>;
    fn move_to(&mut self, point: &plan::PenPoint) -> Result<()>;
    fn up(&mut self, point: &plan::PenPoint) -> Result<()>;
}

pub fn run(options: &Options) -> Result<()> {
    let modes = selected_modes(options.mode.as_deref())?;
    if options.auto {
        run_auto(options, modes)
    } else if modes == [native::MODE] {
        Err("The native baseline runs only with --auto.".into())
    } else {
        run_manual(options, options.mode.as_deref().unwrap_or(MANUAL_MODE))
    }
}

/// Every mode the automated run measures: the page modes, then the native baseline.
fn all_modes() -> Vec<&'static str> {
    MODES.into_iter().chain([native::MODE]).collect()
}

fn selected_modes(mode: Option<&str>) -> Result<Vec<&'static str>> {
    let all = all_modes();
    let Some(name) = mode else {
        return Ok(all);
    };
    match all.iter().find(|candidate| **candidate == name) {
        Some(found) => Ok(vec![*found]),
        None => Err(format!(
            "There is no ink mode named \"{name}\". The modes are {}.",
            all.join(", ")
        )
        .into()),
    }
}

fn window_spec(mode: &str, auto: bool) -> WindowSpec {
    WindowSpec {
        title: "OpenNote spike: ink latency".into(),
        page: "ink.html".into(),
        query: format!("mode={mode}{}", if auto { "&auto=1" } else { "" }),
        width: WINDOW_SIZE.0,
        height: WINDOW_SIZE.1,
    }
}

/// Opens the page for a person to draw on. "Save results" in the page writes its timings to a file.
fn run_manual(options: &Options, mode: &str) -> Result<()> {
    let path = options
        .out
        .clone()
        .unwrap_or_else(|| options.results_path().with_file_name("ink-manual.json"));
    println!("Draw on the page. Press \"Save results\" to write {}.", path.display());
    webview::run(window_spec(mode, false), move |controller| loop {
        let Some(message) = controller.next_message(Duration::from_secs(3600))? else {
            continue;
        };
        match message["type"].as_str() {
            Some("result") => results::write(&path, "ink-manual", message)?,
            Some("closed") => return Ok(()),
            _ => {}
        }
    })
}

/// Measures every selected mode while holding the screen, and writes the results. Each mode gets a
/// fresh window and WebView, because some page features change how later pages in the same WebView
/// handle input.
fn run_auto(options: &Options, modes: Vec<&'static str>) -> Result<()> {
    let path = options.results_path();
    let _screen = ScreenLock::acquire(LOCK_WAIT)?;
    if let Err(error) = check_desktop() {
        let reason = error.to_string();
        results::write(&path, "ink", json!({ "status": "not run", "reason": reason }))?;
        return Err(error);
    }
    let samples = options.samples.unwrap_or(DEFAULT_SAMPLES).max(1);
    let (started, nominal_hz) = (Instant::now(), results::machine().refresh_hz);
    let mut done = Vec::new();
    let mut outcome = Ok(());
    for mode in modes {
        if started.elapsed() > RUN_BUDGET {
            done.push(json!({ "mode": mode, "skipped": "The run reached its time limit." }));
            continue;
        }
        println!("Measuring {mode}...");
        let measured = if mode == native::MODE {
            native::measure(samples, nominal_hz).inspect(|result| print_summary(&result["latency"]))
        } else {
            measure_in_window(mode, samples, nominal_hz)
        };
        match measured {
            Ok(result) => done.push(result),
            Err(error) => {
                outcome = Err(error);
                break;
            }
        }
    }
    let status = match &outcome {
        Ok(()) => json!("measured"),
        Err(error) => json!(format!("stopped: {error}")),
    };
    let document = json!({ "status": status, "settings": settings(samples), "modes": done });
    results::write(&path, "ink", document)?;
    outcome
}

fn settings(samples: usize) -> Value {
    json!({
        "samples_per_method": samples,
        "window_css_px": [WINDOW_SIZE.0, WINDOW_SIZE.1],
        "stroke_width_css_px": 10,
        "move_step_css_px": plan::STEP,
        "moves_per_stroke": plan::MOVES_PER_STROKE,
        "region_px": measure::REGION_PX,
        "change_threshold": measure::THRESHOLD,
        "timeout_ms": measure::TIMEOUT.as_millis() as u64,
        "delay_between_moves": "0 to 2 frames, pseudo-random",
        "pacing_moves": measure::PACING_MOVES,
        "pacing_rate_hz": 240,
    })
}

/// Opens a window for one mode, measures it, and closes the window.
fn measure_in_window(mode: &'static str, samples: usize, nominal_hz: u32) -> Result<Value> {
    let (send, receive) = channel();
    webview::run(window_spec(mode, true), move |controller| {
        let ready = page::wait_ready(&controller)?;
        let target = place_window(&controller)?;
        check_page(&ready, &target)?;
        let (x, y) = target.area.to_screen(WINDOW_SIZE.0 / 2.0, WINDOW_SIZE.1 / 2.0);
        let mut watcher = ChangeWatcher::new(Region::around(x, y, measure::REGION_PX))?;
        let surface = page::PageSurface(&controller);
        let mut rig = Rig {
            surface: &surface,
            watcher: &mut watcher,
            target,
            page: (
                ready["width"].as_f64().unwrap_or(0.0),
                ready["height"].as_f64().unwrap_or(0.0),
            ),
            frame_ms: 1000.0 / f64::from(nominal_hz.max(1)),
        };
        let _ = send.send(measure_mode(&mut rig, &controller, &ready, (samples, nominal_hz))?);
        Ok(())
    })?;
    receive
        .try_recv()
        .map_err(|_| format!("The {mode} window closed without results.").into())
}

/// Centers the window on its monitor, keeps it above other windows, and returns where it is.
fn place_window(controller: &Controller) -> Result<Target> {
    controller.on_ui(|_, window| {
        if let Some(monitor) = window.current_monitor() {
            let (screen, size) = (monitor.position(), monitor.size());
            let outer = window.outer_size();
            let x = screen.x + (size.width as i32 - outer.width as i32) / 2;
            let y = screen.y + (size.height as i32 - outer.height as i32) / 2;
            window.set_outer_position(PhysicalPosition::new(x, y.max(screen.y)));
        }
    })?;
    controller.raise(true)?;
    std::thread::sleep(Duration::from_millis(500));
    window_target(controller)
}

fn window_target(controller: &Controller) -> Result<Target> {
    let hwnd = controller.on_ui(|_, window| window.hwnd())?;
    Ok(Target {
        hwnd,
        area: controller.client_area()?,
    })
}

/// Checks that the page fills the window at 100% zoom, so CSS pixels map to the screen as expected.
fn check_page(ready: &Value, target: &Target) -> Result<()> {
    let dpr = ready["dpr"].as_f64().unwrap_or(0.0);
    let width = ready["width"].as_f64().unwrap_or(0.0) * dpr;
    if (dpr - target.area.scale).abs() > 0.01 || (width - f64::from(target.area.width)).abs() > 2.0 {
        return Err(format!(
            "The page ({width} px at scale {dpr}) doesn't match the window ({} px at scale {}).",
            target.area.width, target.area.scale
        )
        .into());
    }
    Ok(())
}

/// Runs one mode: clocks, frame pacing, then latency with the synthetic pen and with CDP.
fn measure_mode(rig: &mut Rig, controller: &Controller, ready: &Value, counts: (usize, u32)) -> Result<Value> {
    let (samples, nominal_hz) = counts;
    let clock_start = page::clock_offset(controller)?;
    let idle_raf = page::frame_intervals(controller, 60)?;
    rig.frame_ms = report::refresh_ms(&idle_raf, nominal_hz);
    let (pacing, pacing_events) = measure_pacing(rig, controller)?;
    let from = (pacing_events, clock_start.offset_ms);
    let (latency, pen_state) = measure_latency(rig, controller, samples, from)?;
    let clock_end = page::clock_offset(controller)?;
    print_summary(&latency);
    Ok(json!({
        "mode": ready["mode"],
        "page": {
            "desynchronized": ready["desynchronized"],
            "delegated_ink": ready["delegated"],
            "busy_main_thread": ready["busy"],
            "predicted_events_api": ready["predictedEvents"],
            "pointerrawupdate_api": ready["rawUpdate"],
            "last_synthetic_pen_event": pen_state,
        },
        "clock": {
            "offset_uncertainty_ms": report::round(clock_start.uncertainty_ms, 3),
            "drift_ms": report::round(clock_end.offset_ms - clock_start.offset_ms, 3),
        },
        "refresh": {
            "frame_ms": report::round(rig.frame_ms, 3),
            "idle_raf_interval_ms": report::summary(&idle_raf),
        },
        "pacing": pacing,
        "latency": latency,
    }))
}

/// Frame pacing during a continuous stroke from each input path. Returns the report and how many page
/// events the strokes produced.
fn measure_pacing(rig: &mut Rig, controller: &Controller) -> Result<(Value, usize)> {
    let pen = measure::continuous_stroke(rig, controller)?;
    let pen_events = page::events(controller, 0)?;
    let cdp = measure::continuous_stroke_cdp(rig, controller)?;
    let cdp_events = page::events(controller, pen_events.len())?;
    let report = json!({
        "synthetic_pen": report::pacing_report(&pen, &pen_events, rig.frame_ms),
        "cdp_pen": report::pacing_report(&cdp, &cdp_events, rig.frame_ms),
    });
    Ok((report, pen_events.len() + cdp_events.len()))
}

/// Latency samples from each input path, matched with the page events after index `from.0`, whose
/// clock is `from.1` behind the performance counter. Also returns the last synthetic pen event the
/// page saw, to show that pressure and tilt arrive.
fn measure_latency(
    rig: &mut Rig,
    controller: &Controller,
    samples: usize,
    from: (usize, f64),
) -> Result<(Value, Value)> {
    let (first_event, offset_ms) = from;
    let pen_samples = {
        let mut pen = pen::Pen::new(rig.target)?;
        measure::latency_samples(rig, &mut pen, samples, SEED)?
    };
    let pen_state = page::call(controller, "lastPen", Value::Null)?;
    let mut cdp = cdp::CdpPen::new(controller);
    let cdp_samples = measure::latency_samples(rig, &mut cdp, samples, SEED + 1)?;
    std::thread::sleep(Duration::from_millis(200));
    let events = page::events(controller, first_event)?;
    let report = json!({
        "synthetic_pen": report::latency_report(&pen_samples, &events, offset_ms, rig.frame_ms),
        "cdp_pen": report::latency_report(&cdp_samples, &events, offset_ms, rig.frame_ms),
    });
    Ok((report, pen_state))
}

/// Prints the median and 95th percentile latency of each input path, for the person running the spike.
fn print_summary(latency: &Value) {
    for method in ["synthetic_pen", "cdp_pen"]
        .into_iter()
        .filter(|method| latency.get(method).is_some())
    {
        let ms = &latency[method]["latency_ms"];
        match (ms["p50"].as_f64(), ms["p95"].as_f64()) {
            (Some(p50), Some(p95)) => println!("  {method}: {p50:.1} ms median, {p95:.1} ms at p95"),
            _ => println!("  {method}: no ink appeared ({} timeouts)", latency[method]["timeouts"]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_modes() {
        assert_eq!(selected_modes(None).unwrap().len(), MODES.len() + 1);
        assert_eq!(selected_modes(Some("native-gdi")).unwrap(), vec![native::MODE]);
        assert_eq!(selected_modes(Some("delegated")).unwrap(), vec!["delegated"]);
        assert!(selected_modes(Some("flutter")).is_err());
        assert_eq!(window_spec("raw", true).query, "mode=raw&auto=1");
        assert_eq!(window_spec("raw", false).query, "mode=raw");
    }
}
