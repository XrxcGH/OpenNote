//! The Windows text cursor settings (Settings, then Accessibility, then Text cursor): its width and how fast it
//! blinks. The interface draws a thicker or steady caret from these, so a caret set up in Windows looks the same
//! in a note.

use serde::Serialize;

use crate::ipc::IpcResult;

/// The widest caret Windows offers.
const MAX_WIDTH: u32 = 20;
/// The blink time Windows reports when the caret does not blink.
const NO_BLINK: u32 = u32::MAX;
/// The blink time when Windows can't say: its default.
const DEFAULT_BLINK_MS: u32 = 530;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaretMetrics {
    /// The caret's width in device pixels, from 1 to 20.
    pub width_px: u32,
    /// How long the caret shows before it hides, or `None` when it does not blink.
    pub blink_ms: Option<u32>,
    /// The Windows text cursor indicator color as `#rrggbb`, or `None` when none is set.
    pub color: Option<String>,
}

/// A Windows color value (`0x00BBGGRR`) as `#rrggbb`.
pub fn hex_from_colorref(value: u32) -> String {
    let (r, g, b) = (value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Metrics from the raw values Windows reports.
pub fn metrics_from(width: u32, blink: u32, color: Option<u32>) -> CaretMetrics {
    CaretMetrics {
        color: color.map(hex_from_colorref),
        width_px: width.clamp(1, MAX_WIDTH),
        blink_ms: match blink {
            NO_BLINK => None,
            0 => Some(DEFAULT_BLINK_MS),
            time => Some(time),
        },
    }
}

#[cfg(windows)]
fn read() -> CaretMetrics {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCaretBlinkTime, SystemParametersInfoW, SPI_GETCARETWIDTH, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    let mut width: u32 = 1;
    // SAFETY: `width` outlives the call, and SPI_GETCARETWIDTH writes one u32 through the pointer.
    let read = unsafe {
        SystemParametersInfoW(
            SPI_GETCARETWIDTH,
            0,
            Some(std::ptr::addr_of_mut!(width).cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    if read.is_err() {
        width = 1;
    }
    // SAFETY: the call takes no pointers.
    let blink = unsafe { GetCaretBlinkTime() };
    metrics_from(width, blink, indicator_color())
}

/// The color of the text cursor indicator (Settings, then Accessibility, then Text cursor), when it is turned on.
/// Windows keeps it among the accessibility values of the current user; where it isn't there, the caret keeps the
/// text color.
#[cfg(windows)]
fn indicator_color() -> Option<u32> {
    use crate::appearance::registry_dword;

    registry_dword(r"Software\Microsoft\Accessibility\CursorIndicator", "IndicatorColor")
        .or_else(|| registry_dword(r"Software\Microsoft\Accessibility", "CursorIndicatorColor"))
}

#[cfg(not(windows))]
fn read() -> CaretMetrics {
    metrics_from(1, DEFAULT_BLINK_MS, None)
}

#[tauri::command]
pub async fn page_extras_caret() -> IpcResult<CaretMetrics> {
    Ok(read())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_width_stays_in_windows_range() {
        assert_eq!(metrics_from(0, 530, None).width_px, 1);
        assert_eq!(metrics_from(6, 530, None).width_px, 6);
        assert_eq!(metrics_from(99, 530, None).width_px, 20);
    }

    #[test]
    fn a_caret_that_never_blinks_has_no_time() {
        assert_eq!(metrics_from(1, NO_BLINK, None).blink_ms, None);
        assert_eq!(metrics_from(1, 400, None).blink_ms, Some(400));
        assert_eq!(metrics_from(1, 0, None).blink_ms, Some(DEFAULT_BLINK_MS));
    }

    #[test]
    fn the_indicator_color_reads_as_hex() {
        // Windows keeps colors as 0x00BBGGRR, so red is the low byte.
        assert_eq!(hex_from_colorref(0x0000_00ff), "#ff0000");
        assert_eq!(hex_from_colorref(0x00ff_8000), "#0080ff");
        assert_eq!(metrics_from(1, 530, Some(0x0000_ff00)).color.as_deref(), Some("#00ff00"));
        assert_eq!(metrics_from(1, 530, None).color, None);
    }
}
