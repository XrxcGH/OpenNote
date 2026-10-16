//! How the person set up closed captions in Windows (A2-25): the text size, font style, and colors. The live caption
//! strip follows them, so captions look the way the person has already chosen for everything else. Read-only: this
//! changes no system setting.

use serde::Serialize;

use crate::ipc::IpcResult;

/// The look of captions. Colors are `#rrggbb`, opacities run from 0 to 1, and `scale` is the size against normal.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionStyle {
    pub font_color: String,
    pub font_opacity: f32,
    pub scale: f32,
    /// `serif`, `sans`, `mono`, `casual`, `cursive`, or `small-caps`.
    pub family: &'static str,
    pub background_color: String,
    pub background_opacity: f32,
    pub region_color: String,
    pub region_opacity: f32,
}

fn opacity(value: i32, default: f32) -> f32 {
    match value {
        1 => 1.0,
        2 => 0.75,
        3 => 0.25,
        4 => 0.0,
        _ => default,
    }
}

fn scale(value: i32) -> f32 {
    match value {
        1 => 0.5,
        3 => 1.5,
        4 => 2.0,
        _ => 1.0,
    }
}

fn family(value: i32) -> &'static str {
    match value {
        1 | 2 => "serif",
        3 => "mono",
        4 => "sans",
        5 => "casual",
        6 => "cursive",
        7 => "small-caps",
        _ => "sans",
    }
}

fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(windows)]
fn read() -> Option<CaptionStyle> {
    use windows::Media::ClosedCaptioning::ClosedCaptionProperties as Props;
    let font = Props::ComputedFontColor().ok()?;
    let background = Props::ComputedBackgroundColor().ok()?;
    let region = Props::ComputedRegionColor().ok()?;
    Some(CaptionStyle {
        font_color: hex(font.R, font.G, font.B),
        font_opacity: opacity(Props::FontOpacity().ok()?.0, 1.0),
        scale: scale(Props::FontSize().ok()?.0),
        family: family(Props::FontStyle().ok()?.0),
        background_color: hex(background.R, background.G, background.B),
        background_opacity: opacity(Props::BackgroundOpacity().ok()?.0, 0.75),
        region_color: hex(region.R, region.G, region.B),
        region_opacity: opacity(Props::RegionOpacity().ok()?.0, 0.0),
    })
}

#[cfg(not(windows))]
fn read() -> Option<CaptionStyle> {
    None
}

/// The caption look chosen in Windows, or none where Windows has no such setting.
#[tauri::command]
pub async fn intel_caption_style() -> IpcResult<Option<CaptionStyle>> {
    Ok(read())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_choices_become_css_numbers() {
        assert_eq!(opacity(1, 0.5), 1.0);
        assert_eq!(opacity(4, 0.5), 0.0);
        assert_eq!(opacity(0, 0.5), 0.5);
        assert_eq!(scale(4), 2.0);
        assert_eq!(scale(0), 1.0);
        assert_eq!(family(3), "mono");
        assert_eq!(hex(255, 0, 16), "#ff0010");
    }
}
