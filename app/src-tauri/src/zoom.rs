//! The effective zoom and the minimum window width (ARCHITECTURE.md section 10.4). Text size is WebView2 zoom,
//! so the whole interface scales together. The zoom is capped so the page is never narrower than 320 CSS pixels,
//! and the minimum window width grows with it.
//!
//! [`apply`] sets the zoom and the minimum size on the main window. `appearance::refresh` calls it whenever the
//! text size, Windows' text scale, or the monitor changes.

use tauri::{LogicalSize, WebviewWindow};

/// The narrowest the page may get, in CSS pixels (WCAG 1.4.10 reflow).
pub const CONTENT_MIN_CSS_PX: f64 = 320.0;

/// The narrowest the window may get at 100%, in device-independent pixels (DIPs).
pub const WINDOW_MIN_DIPS: f64 = 400.0;

/// The zoom factor for a text size in percent and Windows' text scale, capped for the monitor's work area.
pub fn effective_zoom(text_size_percent: u16, text_scale: f64, work_area_width_dips: f64) -> f64 {
    let zoom = f64::from(text_size_percent) / 100.0 * text_scale;
    zoom.min(work_area_width_dips / CONTENT_MIN_CSS_PX)
}

/// The minimum window width in DIPs for a zoom: 400, or 320 CSS pixels of content, capped at the work area.
pub fn min_window_width(zoom: f64, work_area_width_dips: f64) -> f64 {
    WINDOW_MIN_DIPS
        .max((CONTENT_MIN_CSS_PX * zoom).ceil())
        .min(work_area_width_dips)
}

/// The shortest the window may get, in DIPs.
pub const WINDOW_MIN_HEIGHT_DIPS: f64 = 480.0;

/// The width of the work area of the monitor the window is on, in DIPs. A large value when it can't be read, so
/// the cap doesn't bite.
fn work_area_width_dips(window: &WebviewWindow) -> f64 {
    match window.current_monitor() {
        Ok(Some(monitor)) => f64::from(monitor.work_area().size.width) / monitor.scale_factor().max(1.0),
        _ => f64::MAX,
    }
}

/// Applies the effective zoom and the minimum window size to `window`, and returns the zoom.
pub fn apply(window: &WebviewWindow, text_size_percent: u16, text_scale: f64) -> f64 {
    let work_width = work_area_width_dips(window);
    let zoom = effective_zoom(text_size_percent, text_scale, work_width);
    if let Err(error) = window.set_zoom(zoom) {
        log::warn!("Couldn't set the zoom to {zoom}: {error}");
    }
    let min = LogicalSize::new(min_window_width(zoom, work_width), WINDOW_MIN_HEIGHT_DIPS);
    if let Err(error) = window.set_min_size(Some(min)) {
        log::warn!("Couldn't set the minimum window size: {error}");
    }
    zoom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiplies_the_text_size_by_windows_text_scale() {
        assert_eq!(effective_zoom(100, 1.0, 1920.0), 1.0);
        assert_eq!(effective_zoom(150, 1.0, 1920.0), 1.5);
        assert_eq!(effective_zoom(200, 1.25, 1920.0), 2.5);
    }

    #[test]
    fn caps_the_zoom_so_the_page_keeps_320_css_pixels() {
        assert_eq!(effective_zoom(200, 1.5, 800.0), 2.5);
        assert_eq!(effective_zoom(200, 1.0, 480.0), 1.5);
    }

    #[test]
    fn grows_the_minimum_width_with_the_zoom() {
        assert_eq!(min_window_width(1.0, 1920.0), 400.0);
        assert_eq!(min_window_width(1.25, 1920.0), 400.0);
        assert_eq!(min_window_width(2.0, 1920.0), 640.0);
        assert_eq!(min_window_width(1.33, 1920.0), 426.0);
        assert_eq!(min_window_width(2.0, 600.0), 600.0);
    }
}
