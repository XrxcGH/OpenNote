//! Screen rectangles for the watcher: the watched region and the monitor that contains it, in
//! physical pixels.

use windows::Win32::Foundation::RECT;

/// A rectangle on the screen in physical pixels, in virtual-screen coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Region {
    /// A square of `size` pixels centered on a point.
    pub fn around(x: i32, y: i32, size: u32) -> Region {
        let half = (size / 2) as i32;
        Region {
            x: x - half,
            y: y - half,
            width: size,
            height: size,
        }
    }

    pub(super) fn center(self) -> (i32, i32) {
        (self.x + (self.width / 2) as i32, self.y + (self.height / 2) as i32)
    }

    /// The region relative to a monitor's top-left corner, or None if it doesn't fit inside the monitor.
    pub(super) fn relative_to(self, monitor: Bounds) -> Option<Region> {
        let right = i64::from(self.x) + i64::from(self.width);
        let bottom = i64::from(self.y) + i64::from(self.height);
        let inside = self.width > 0
            && self.height > 0
            && self.x >= monitor.left
            && self.y >= monitor.top
            && right <= i64::from(monitor.right)
            && bottom <= i64::from(monitor.bottom);
        inside.then(|| Region {
            x: self.x - monitor.left,
            y: self.y - monitor.top,
            ..self
        })
    }
}

/// A monitor's rectangle in virtual-screen coordinates, from its output description.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Bounds {
    pub(super) left: i32,
    pub(super) top: i32,
    pub(super) right: i32,
    pub(super) bottom: i32,
}

impl Bounds {
    pub(super) fn contains(self, x: i32, y: i32) -> bool {
        (self.left..self.right).contains(&x) && (self.top..self.bottom).contains(&y)
    }
}

impl From<RECT> for Bounds {
    fn from(rect: RECT) -> Bounds {
        Bounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Bounds = Bounds {
        left: -2400,
        top: 0,
        right: 0,
        bottom: 1600,
    };

    #[test]
    fn centers_a_region_on_a_point() {
        assert_eq!(
            Region::around(100, 50, 16),
            Region {
                x: 92,
                y: 42,
                width: 16,
                height: 16
            }
        );
        assert_eq!(Region::around(100, 50, 16).center(), (100, 50));
    }

    #[test]
    fn converts_regions_to_monitor_coordinates() {
        let region = Region::around(-1200, 800, 24);
        let local = region.relative_to(MONITOR).unwrap();
        assert_eq!((local.x, local.y, local.width, local.height), (1188, 788, 24, 24));
        let corner = Region {
            x: -24,
            y: 1576,
            width: 24,
            height: 24,
        };
        assert_eq!(corner.relative_to(MONITOR).map(|r| (r.x, r.y)), Some((2376, 1576)));
    }

    #[test]
    fn rejects_regions_outside_the_monitor() {
        assert!(Region::around(-2, 800, 24).relative_to(MONITOR).is_none());
        assert!(Region::around(-1200, 1595, 24).relative_to(MONITOR).is_none());
        let empty = Region {
            x: -100,
            y: 100,
            width: 0,
            height: 10,
        };
        assert!(empty.relative_to(MONITOR).is_none());
        assert!(MONITOR.contains(-2400, 0));
        assert!(!MONITOR.contains(0, 0));
    }

    #[test]
    fn reads_monitor_bounds() {
        let bounds = Bounds::from(RECT {
            left: -2400,
            top: 0,
            right: 0,
            bottom: 1600,
        });
        assert!(bounds.contains(-2400, 0));
        assert!(bounds.contains(-1, 1599));
        assert!(!bounds.contains(0, 0));
        assert!(!bounds.contains(-100, 1600));
    }
}
