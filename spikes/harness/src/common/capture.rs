//! Screen capture with the Desktop Duplication API: watches a small region of the screen and reports
//! the present time of the first frame in which it changes. Frame times use the performance counter
//! (see [`super::clock`]), so the time from injected input to a visible change needs no conversion.
//!
//! The ink spike writes this module; the text spike uses it to time key presses the same way.

use std::time::Duration;

use super::Result;

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
}

/// Watches one region of the screen for changes.
pub struct ChangeWatcher {
    region: Region,
}

impl ChangeWatcher {
    /// Starts watching `region` on the monitor that contains it.
    pub fn new(region: Region) -> Result<ChangeWatcher> {
        Err(format!("Screen capture isn't written yet (region {region:?}).").into())
    }

    /// The region being watched.
    pub fn region(&self) -> Region {
        self.region
    }

    /// Moves the watched region, keeping the same monitor.
    pub fn set_region(&mut self, region: Region) {
        self.region = region;
    }

    /// Takes the region's current contents as the baseline that later frames are compared with.
    pub fn reset_baseline(&mut self) -> Result<()> {
        Err("Screen capture isn't written yet.".into())
    }

    /// Waits for a frame in which any pixel of the region differs from the baseline by more than
    /// `threshold` in any color channel. Returns that frame's present time in performance counter
    /// ticks, or None if nothing changed within `timeout`.
    pub fn wait_for_change(&mut self, threshold: u8, timeout: Duration) -> Result<Option<i64>> {
        let _ = (threshold, timeout);
        Err("Screen capture isn't written yet.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }
}
