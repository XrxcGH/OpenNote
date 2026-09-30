//! Where the spike window and the caret are on screen. Screen timing watches a caret region only when it lies
//! inside both the webview's client area and the monitor. Otherwise the key is skipped with the reason, because
//! the watcher can't read pixels off the monitor, and pixels outside the window belong to other apps.

use std::thread::sleep;
use std::time::Duration;

use serde_json::{json, Value};
use tao::dpi::PhysicalPosition;

use crate::common::capture::Region;
use crate::common::webview::{ClientArea, Controller};
use crate::common::Result;

/// The webview's client area and the monitor that shows it, in physical screen pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub area: ClientArea,
    pub monitor: Region,
}

impl Placement {
    /// Why `region` can't be timed on screen, or None when it lies inside the client area and the monitor.
    pub fn check(&self, region: Region) -> Option<&'static str> {
        if region.width == 0 || region.height == 0 {
            Some("the caret region is empty")
        } else if !contains(self.monitor, region) {
            Some("the caret region isn't inside the monitor")
        } else if !contains(area_region(self.area), region) {
            Some("the caret region isn't inside the window's client area")
        } else {
            None
        }
    }

    /// True when `region` is on the monitor and at least `margin` pixels inside the client area, so the next few
    /// characters stay in view too.
    pub fn well_inside(&self, region: Region, margin: u32) -> bool {
        contains(self.monitor, region) && contains(inset(area_region(self.area), margin), region)
    }

    /// True when the whole client area is on the monitor.
    pub fn window_fits(&self) -> bool {
        contains(self.monitor, area_region(self.area))
    }

    pub fn to_json(self) -> Value {
        let (area, monitor) = (self.area, self.monitor);
        json!({
            "window_px": { "x": area.x, "y": area.y, "width": area.width, "height": area.height, "scale": area.scale },
            "monitor_px": { "x": monitor.x, "y": monitor.y, "width": monitor.width, "height": monitor.height },
            "window_fits": self.window_fits(),
        })
    }
}

fn area_region(area: ClientArea) -> Region {
    Region {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
    }
}

/// True when `inner` lies wholly inside `outer`. An empty region lies nowhere.
fn contains(outer: Region, inner: Region) -> bool {
    let right = |region: Region| i64::from(region.x) + i64::from(region.width);
    let bottom = |region: Region| i64::from(region.y) + i64::from(region.height);
    inner.width > 0
        && inner.height > 0
        && inner.x >= outer.x
        && inner.y >= outer.y
        && right(inner) <= right(outer)
        && bottom(inner) <= bottom(outer)
}

/// `region` shrunk by `margin` pixels on every side.
fn inset(region: Region, margin: u32) -> Region {
    let shift = i32::try_from(margin).unwrap_or(i32::MAX);
    Region {
        x: region.x.saturating_add(shift),
        y: region.y.saturating_add(shift),
        width: region.width.saturating_sub(margin.saturating_mul(2)),
        height: region.height.saturating_sub(margin.saturating_mul(2)),
    }
}

/// Centers the window on its monitor, keeps it above other windows with focus, and returns where it is. Windows
/// cascades new windows down and to the right, so without this the window's bottom can end up near or past the
/// screen's edge.
pub fn place_window(controller: &Controller) -> Result<Placement> {
    controller.on_ui(|_, window| {
        if let Some(monitor) = window.current_monitor() {
            let (screen, size) = (monitor.position(), monitor.size());
            let outer = window.outer_size();
            let x = screen.x + (size.width as i32 - outer.width as i32) / 2;
            let y = screen.y + (size.height as i32 - outer.height as i32) / 2;
            window.set_outer_position(PhysicalPosition::new(x.max(screen.x), y.max(screen.y)));
        }
    })?;
    controller.raise(true)?;
    sleep(Duration::from_millis(500));
    placement(controller)
}

/// Where the window's client area and its monitor are now.
pub fn placement(controller: &Controller) -> Result<Placement> {
    let area = controller.client_area()?;
    let monitor = controller.on_ui(|_, window| {
        window.current_monitor().map(|monitor| {
            let (position, size) = (monitor.position(), monitor.size());
            Region {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
    })?;
    let monitor = monitor.ok_or("The spike window isn't on any monitor.")?;
    Ok(Placement { area, monitor })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The screen from the failed run: 2400 by 1600 pixels at 150%, with the window cascaded down and right.
    const PLACEMENT: Placement = Placement {
        area: ClientArea {
            x: 277,
            y: 311,
            width: 1920,
            height: 1200,
            scale: 1.5,
        },
        monitor: Region {
            x: 0,
            y: 0,
            width: 2400,
            height: 1600,
        },
    };

    fn region(x: i32, y: i32, width: u32, height: u32) -> Region {
        Region { x, y, width, height }
    }

    #[test]
    fn times_a_region_inside_the_window_and_the_monitor() {
        assert_eq!(PLACEMENT.check(region(1000, 700, 20, 32)), None);
        // The client area's corners are inside; one more pixel isn't.
        assert_eq!(PLACEMENT.check(region(277, 311, 20, 32)), None);
        assert_eq!(PLACEMENT.check(region(2177, 1479, 20, 32)), None);
        assert!(PLACEMENT.check(region(2178, 1479, 20, 32)).is_some());
        assert!(PLACEMENT.window_fits());
    }

    #[test]
    fn skips_a_caret_below_the_window() {
        // The region that failed the whole run: the caret sat 1,000 CSS pixels below the viewport.
        let reason = PLACEMENT.check(region(1608, 2540, 20, 32));
        assert_eq!(reason, Some("the caret region isn't inside the monitor"));
        let reason = PLACEMENT.check(region(1608, 1520, 20, 32));
        assert_eq!(reason, Some("the caret region isn't inside the window's client area"));
        assert!(PLACEMENT.check(region(200, 700, 20, 32)).is_some());
        assert_eq!(
            PLACEMENT.check(region(1000, 700, 0, 32)),
            Some("the caret region is empty")
        );
    }

    #[test]
    fn skips_a_region_in_the_window_but_off_the_monitor() {
        let low = Placement {
            area: ClientArea {
                y: 700,
                ..PLACEMENT.area
            },
            ..PLACEMENT
        };
        assert!(!low.window_fits());
        assert_eq!(low.check(region(1000, 800, 20, 32)), None);
        assert_eq!(
            low.check(region(1000, 1590, 20, 32)),
            Some("the caret region isn't inside the monitor")
        );
    }

    #[test]
    fn asks_for_a_margin_before_timing() {
        let near_edge = region(1000, 1470, 20, 32);
        assert_eq!(PLACEMENT.check(near_edge), None);
        assert!(!PLACEMENT.well_inside(near_edge, 72));
        assert!(PLACEMENT.well_inside(region(1000, 700, 20, 32), 72));
        assert!(!PLACEMENT.well_inside(region(1000, 700, 20, 32), 2000));
    }

    #[test]
    fn describes_the_placement() {
        let described = PLACEMENT.to_json();
        assert_eq!(described["window_px"]["y"], 311);
        assert_eq!(described["monitor_px"]["width"], 2400);
        assert_eq!(described["window_fits"], true);
    }
}
