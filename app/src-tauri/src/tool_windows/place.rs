//! Where each tool window was: its size, its place, and the monitor it was on. The tool windows the app opens save
//! these as they move and close, and open there again. The saved place is kept as an offset from the monitor's corner
//! and the monitor's name, so a window comes back to the same monitor even when the monitors were rearranged, and
//! it comes back at the same size when the monitor's scale changed. A monitor that is gone sends the window to the
//! primary monitor, centered. The file is `tool-windows.json`, beside the device state.

use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::window::placement::{fit_into, restored_rect, Edges};

/// The file name, in the folder of the device state.
pub const FILE: &str = "tool-windows.json";

/// Windows are never saved smaller than this, in physical pixels, so a bad drag cannot hide one.
const MIN_SIDE: u32 = 200;

/// A window's saved place.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    /// The name of the monitor it was on, when Windows gave one.
    pub monitor: Option<String>,
    /// How far the window's top left was from the monitor's top left, in physical pixels.
    pub x: i32,
    pub y: i32,
    /// The size of the window's content area, in physical pixels.
    pub width: u32,
    pub height: u32,
    /// The monitor's scale factor when it was saved (1.0 is 100 percent).
    pub scale: f64,
}

/// What a monitor tells us, in physical pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct Monitor {
    pub name: Option<String>,
    /// The whole monitor: left, top, right, bottom.
    pub area: Edges,
    /// The part not covered by the taskbar.
    pub work: Edges,
    pub scale: f64,
    pub primary: bool,
}

/// Where a window is now: its top left, its content size, and the monitor under it.
pub struct Now {
    pub position: (i32, i32),
    pub size: (u32, u32),
}

/// The saved place for a window that is at `now` on `monitor`. `None` when the numbers are not usable.
pub fn capture(now: &Now, monitor: &Monitor) -> Option<Saved> {
    if now.size.0 < MIN_SIDE || now.size.1 < MIN_SIDE || !(monitor.scale > 0.0) {
        return None;
    }
    Some(Saved {
        monitor: monitor.name.clone(),
        x: now.position.0 - monitor.area[0],
        y: now.position.1 - monitor.area[1],
        width: now.size.0,
        height: now.size.1,
        scale: monitor.scale,
    })
}

/// Where to open a window: its top left and content size, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Opening {
    pub position: (i32, i32),
    pub size: (u32, u32),
}

fn scaled(value: u32, ratio: f64) -> u32 {
    // The saved sizes are small positive numbers, so rounding to an integer cannot overflow.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let scaled = (f64::from(value) * ratio).round().max(0.0) as u32;
    scaled
}

fn scaled_offset(value: i32, ratio: f64) -> i32 {
    #[allow(clippy::cast_possible_truncation)]
    let scaled = (f64::from(value) * ratio).round() as i32;
    scaled
}

/// The place to open a window that has a saved place. It goes back to the monitor it was on, at the same size
/// relative to that monitor's scale, and is brought into the work area if it would be out of reach. If that monitor
/// is not there now, it opens centered on the primary monitor at its saved size (or smaller, to fit).
pub fn opening(saved: &Saved, monitors: &[Monitor]) -> Option<Opening> {
    let named = saved
        .monitor
        .as_ref()
        .and_then(|name| monitors.iter().find(|one| one.name.as_ref() == Some(name)));
    let primary = || monitors.iter().find(|one| one.primary).or_else(|| monitors.first());
    let monitor = named.or_else(primary)?;
    let ratio = if saved.scale > 0.0 { monitor.scale / saved.scale } else { 1.0 };
    let (width, height) = (scaled(saved.width, ratio), scaled(saved.height, ratio));
    let (w, h) = (i32::try_from(width).ok()?, i32::try_from(height).ok()?);
    let rect: Edges = if named.is_some() {
        let left = monitor.area[0] + scaled_offset(saved.x, ratio);
        let top = monitor.area[1] + scaled_offset(saved.y, ratio);
        restored_rect([left, top, left + w, top + h], monitor.work)
    } else {
        centered(w, h, monitor.work)
    };
    Some(Opening {
        position: (rect[0], rect[1]),
        size: (u32::try_from(rect[2] - rect[0]).ok()?, u32::try_from(rect[3] - rect[1]).ok()?),
    })
}

/// A rectangle of this size in the middle of `work`, made smaller first when it does not fit.
pub fn centered(width: i32, height: i32, work: Edges) -> Edges {
    let fitted = fit_into([0, 0, width, height], work);
    let (w, h) = (fitted[2] - fitted[0], fitted[3] - fitted[1]);
    let left = work[0] + ((work[2] - work[0]) - w) / 2;
    let top = work[1] + ((work[3] - work[1]) - h) / 2;
    [left, top, left + w, top + h]
}

/// The saved places by tool.
pub type Places = BTreeMap<String, Saved>;

static LOCK: Mutex<()> = Mutex::new(());

/// Reads the saved places. A missing or unreadable file means no saved places, because they are disposable.
pub fn load(path: &Path) -> Places {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Places>(&bytes).ok())
        .unwrap_or_default()
}

fn write(path: &Path, places: &Places) -> io::Result<()> {
    let text = serde_json::to_vec_pretty(places).map_err(io::Error::other)?;
    let temporary: PathBuf = path.with_extension("json.tmp");
    fs::write(&temporary, text)?;
    fs::rename(&temporary, path)
}

/// Saves one tool's place, keeping the others.
pub fn save(path: &Path, tool: &str, saved: Saved) -> io::Result<()> {
    let _guard = LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut places = load(path);
    places.insert(tool.to_owned(), saved);
    write(path, &places)
}

/// Forgets every saved place, so each tool opens where it first does.
pub fn clear(path: &Path) -> io::Result<()> {
    let _guard = LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(name: &str, left: i32, primary: bool, scale: f64) -> Monitor {
        Monitor {
            name: Some(name.to_owned()),
            area: [left, 0, left + 1920, 1080],
            work: [left, 0, left + 1920, 1040],
            scale,
            primary,
        }
    }

    fn two() -> Vec<Monitor> {
        vec![monitor("main", 0, true, 1.0), monitor("side", 1920, false, 1.0)]
    }

    #[test]
    fn captures_the_place_as_an_offset_from_its_monitor() {
        let now = Now {
            position: (2120, 100),
            size: (420, 560),
        };
        let saved = capture(&now, &two()[1]).expect("usable");
        assert_eq!((saved.x, saved.y, saved.width, saved.height), (200, 100, 420, 560));
        assert_eq!(saved.monitor.as_deref(), Some("side"));
    }

    #[test]
    fn refuses_a_window_too_small_to_find_again() {
        let now = Now {
            position: (0, 0),
            size: (40, 40),
        };
        assert!(capture(&now, &two()[0]).is_none());
    }

    #[test]
    fn opens_on_the_monitor_it_was_on_even_when_the_monitors_swapped_places() {
        let saved = Saved {
            monitor: Some("side".into()),
            x: 200,
            y: 100,
            width: 420,
            height: 560,
            scale: 1.0,
        };
        // The side monitor is now on the left of the main one.
        let moved = vec![monitor("main", 0, true, 1.0), monitor("side", -1920, false, 1.0)];
        let open = opening(&saved, &moved).expect("a place");
        assert_eq!(open.position, (-1720, 100));
        assert_eq!(open.size, (420, 560));
    }

    #[test]
    fn opens_centered_on_the_primary_monitor_when_its_monitor_is_gone() {
        let saved = Saved {
            monitor: Some("projector".into()),
            x: 200,
            y: 100,
            width: 420,
            height: 560,
            scale: 1.0,
        };
        let open = opening(&saved, &two()).expect("a place");
        assert_eq!(open.size, (420, 560));
        assert_eq!(open.position, ((1920 - 420) / 2, (1040 - 560) / 2));
    }

    #[test]
    fn keeps_the_size_in_step_with_the_monitor_scale() {
        let saved = Saved {
            monitor: Some("main".into()),
            x: 100,
            y: 100,
            width: 400,
            height: 500,
            scale: 1.0,
        };
        let sharper = vec![monitor("main", 0, true, 1.5)];
        let open = opening(&saved, &sharper).expect("a place");
        assert_eq!(open.size, (600, 750));
        assert_eq!(open.position, (150, 150));
    }

    #[test]
    fn brings_a_window_back_whose_title_bar_would_be_out_of_reach() {
        let saved = Saved {
            monitor: Some("main".into()),
            x: 1900,
            y: 900,
            width: 420,
            height: 560,
            scale: 1.0,
        };
        let open = opening(&saved, &two()).expect("a place");
        let right = open.position.0 + i32::try_from(open.size.0).unwrap();
        let bottom = open.position.1 + i32::try_from(open.size.1).unwrap();
        assert!(open.position.0 >= 0 && right <= 1920);
        assert!(open.position.1 >= 0 && bottom <= 1040);
    }

    #[test]
    fn has_nowhere_to_open_with_no_monitors() {
        let saved = Saved {
            monitor: None,
            x: 0,
            y: 0,
            width: 420,
            height: 560,
            scale: 1.0,
        };
        assert!(opening(&saved, &[]).is_none());
    }

    #[test]
    fn saves_loads_and_forgets_places_on_disk() {
        let dir = std::env::temp_dir().join(format!("opennote-tool-places-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        let timers = Saved {
            monitor: Some("main".into()),
            x: 10,
            y: 20,
            width: 380,
            height: 560,
            scale: 1.25,
        };
        save(&path, "timers", timers.clone()).unwrap();
        save(&path, "calculator", Saved { x: 30, ..timers.clone() }).unwrap();
        let places = load(&path);
        assert_eq!(places.get("timers"), Some(&timers));
        assert_eq!(places.get("calculator").map(|one| one.x), Some(30));
        clear(&path).unwrap();
        assert!(load(&path).is_empty());
        // Forgetting twice is fine.
        clear(&path).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_damaged_file_as_nothing_saved() {
        let dir = std::env::temp_dir().join(format!("opennote-tool-places-bad-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        fs::write(&path, b"{ not json").unwrap();
        assert!(load(&path).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
