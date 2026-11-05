//! Word's units and colors (ECMA-376 Part 1): points to twips, half-points, and eighths of a point, and the
//! colors of `w:color`, `w:highlight`, and `w:shd`.

use crate::palette::color_hex;

/// Rounds a number of Word units, first to three decimals so that a value such as 793.7 x 15 counts as the
/// 11905.5 it stands for, then to a whole number, halves away from zero.
fn whole(value: f64) -> i64 {
    ((value * 1_000.0).round() / 1_000.0).round() as i64
}

/// Points as twentieths of a point (twips), the unit of indents, spacing, and tab stops.
pub fn twips(points: f64) -> i64 {
    whole(points * 20.0)
}

/// Points as half-points, the unit of `w:sz`, `w:kern`, and `w:position`.
pub fn half_points(points: f64) -> i64 {
    whole(points * 2.0)
}

/// Points as eighths of a point, the unit of border widths.
pub fn eighths(points: f64) -> i64 {
    whole(points * 8.0)
}

/// Page units (1/96 inch, spec 2.6) as twips: 1/96 inch is 15 twips.
pub fn page_twips(units: f64) -> i64 {
    whole(units * 15.0)
}

/// A line multiple as 240ths of a line, the unit of `w:spacing w:line` when `w:lineRule` is `auto`.
pub fn line_240ths(multiple: f64) -> i64 {
    whole(multiple * 240.0)
}

/// The 16 values of `ST_HighlightColor` with the colors ECMA-376 Part 1 (17.18.40) gives them.
pub const HIGHLIGHTS: [(&str, &str); 16] = [
    ("black", "000000"),
    ("blue", "0000FF"),
    ("cyan", "00FFFF"),
    ("green", "00FF00"),
    ("magenta", "FF00FF"),
    ("red", "FF0000"),
    ("yellow", "FFFF00"),
    ("white", "FFFFFF"),
    ("darkBlue", "000080"),
    ("darkCyan", "008080"),
    ("darkGreen", "008000"),
    ("darkMagenta", "800080"),
    ("darkRed", "800000"),
    ("darkYellow", "808000"),
    ("darkGray", "808080"),
    ("lightGray", "C0C0C0"),
];

/// The `ST_HighlightColor` name of a `#rrggbb` color, when it is exactly one of the 16.
pub fn highlight_name(color: &str) -> Option<&'static str> {
    let hex = color.strip_prefix('#')?;
    HIGHLIGHTS
        .iter()
        .find(|(_, value)| value.eq_ignore_ascii_case(hex))
        .map(|(name, _)| *name)
}

/// The Word theme color that an OpenNote theme color stands for (`w:themeColor`).
pub fn theme_color(color: &str) -> Option<&'static str> {
    Some(match color.strip_prefix("theme:")? {
        "accent1" => "accent1",
        "accent2" => "accent2",
        "accent3" => "accent3",
        "accent4" => "accent4",
        "accent5" => "accent5",
        "accent6" => "accent6",
        "text" => "text1",
        "background" => "background1",
        _ => return None,
    })
}

/// The attributes of a color: `w:val="RRGGBB"`, with `w:themeColor` for a theme color. `attr` is the name of
/// the hex attribute, such as `w:val` or `w:color`.
pub fn color_attrs(attr: &str, color: &str) -> Option<String> {
    let hex = color_hex(color)?;
    Some(match theme_color(color) {
        Some(theme) => format!("{attr}=\"{hex}\" w:themeColor=\"{theme}\""),
        None => format!("{attr}=\"{hex}\""),
    })
}
