//! The theme of a Word file (`theme1.xml`): its major and minor fonts and its color scheme, and how theme fonts,
//! theme colors, tints, and shades resolve.

use std::collections::HashMap;

use super::props::{ColorRef, FontRef, Fonts};
use super::styles::child;
use crate::import::xmltree::{Element, Node};

/// The fonts of one font set of the theme.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct FontSet {
    pub latin: Option<String>,
    pub east_asia: Option<String>,
    pub cs: Option<String>,
}

/// A theme: fonts and colors.
#[derive(Clone, Debug, Default)]
pub(super) struct Theme {
    pub major: FontSet,
    pub minor: FontSet,
    /// Scheme colors by their `a:clrScheme` name (`dk1`, `lt1`, `accent1`, ...), as six lowercase hex digits.
    pub colors: HashMap<String, String>,
    /// The document's `w:clrSchemeMapping` (ECMA-376 Part 1, 17.15.1.20): which scheme color a theme color such as
    /// `text1` stands for, by the mapping's attribute name (`t1`, `bg1`, ...). Empty means the default mapping.
    pub mapping: HashMap<String, String>,
}

/// The script of a run, which picks its font slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Script {
    Latin,
    EastAsian,
    Complex,
}

impl Script {
    /// The script of the first strong character of the text: Latin when there is none.
    pub fn of(text: &str) -> Script {
        for c in text.chars() {
            let n = u32::from(c);
            if matches!(n, 0x0590..=0x08FF | 0x0E00..=0x0E7F | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF) {
                return Script::Complex;
            }
            if matches!(n, 0x1100..=0x11FF | 0x2E80..=0x9FFF | 0xA960..=0xA97F | 0xAC00..=0xD7FF | 0xF900..=0xFAFF
                | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF)
            {
                return Script::EastAsian;
            }
            if c.is_alphanumeric() {
                return Script::Latin;
            }
        }
        Script::Latin
    }
}

fn font_set(e: Option<&Element>) -> FontSet {
    let face = |name: &str| {
        e.and_then(|e| child(e, name))
            .and_then(|f| f.attr("typeface"))
            .map(str::trim)
            .filter(|f| !f.is_empty())
            .map(str::to_owned)
    };
    FontSet {
        latin: face("a:latin"),
        east_asia: face("a:ea"),
        cs: face("a:cs"),
    }
}

impl Theme {
    /// Reads an `a:theme` element.
    pub fn read(root: &Element) -> Theme {
        let elements = child(root, "a:themeelements");
        let fonts = elements.and_then(|e| child(e, "a:fontscheme"));
        let mut colors = HashMap::new();
        if let Some(scheme) = elements.and_then(|e| child(e, "a:clrscheme")) {
            for node in &scheme.children {
                let Node::Element(slot) = node else {
                    continue;
                };
                let name = slot.name.trim_start_matches("a:").to_owned();
                let hex = child(slot, "a:srgbclr")
                    .and_then(|c| c.attr("val"))
                    .or_else(|| child(slot, "a:sysclr").and_then(|c| c.attr("lastclr")));
                if let Some(hex) = hex.filter(|h| h.len() == 6 && h.bytes().all(|b| b.is_ascii_hexdigit())) {
                    colors.insert(name, hex.to_ascii_lowercase());
                }
            }
        }
        Theme {
            major: font_set(fonts.and_then(|f| child(f, "a:majorfont"))),
            minor: font_set(fonts.and_then(|f| child(f, "a:minorfont"))),
            colors,
            mapping: HashMap::new(),
        }
    }

    /// Reads the color mapping of `settings.xml`. Word's default maps `text1` to `dark1` and `background1` to
    /// `light1`; a document can swap them.
    pub fn read_mapping(&mut self, settings: &Element) {
        let Some(map) = child(settings, "w:clrschememapping") else {
            return;
        };
        for (key, value) in &map.attrs {
            if let Some(name) = key.strip_prefix("w:") {
                self.mapping.insert(name.to_ascii_lowercase(), value.clone());
            }
        }
    }

    /// The `a:clrScheme` slot (`dk1`, `lt1`, `accent1`, ...) that a theme color name stands for.
    fn scheme_slot(&self, name: &str) -> String {
        let mapped = match name {
            "text1" => self.mapping.get("t1"),
            "background1" => self.mapping.get("bg1"),
            "text2" => self.mapping.get("t2"),
            "background2" => self.mapping.get("bg2"),
            _ => None,
        };
        let index = mapped.map_or(name, String::as_str);
        match index {
            "text1" | "dark1" => "dk1",
            "background1" | "light1" => "lt1",
            "text2" | "dark2" => "dk2",
            "background2" | "light2" => "lt2",
            "hyperlink" => "hlink",
            "followedHyperlink" => "folhlink",
            other => other,
        }
        .to_ascii_lowercase()
    }

    /// The OpenNote theme color (R-THM-2) that a Word theme color stands for, such as `theme:accent1`. Only a
    /// plain theme color the theme defines has one: a tint or shade makes a color of its own.
    pub fn theme_slot(&self, color: &ColorRef) -> Option<String> {
        if color.tint.is_some() || color.shade.is_some() {
            return None;
        }
        let slot = self.scheme_slot(color.theme.as_deref()?);
        if !self.colors.contains_key(&slot) {
            return None;
        }
        let name = match slot.as_str() {
            "dk1" => "text",
            "lt1" => "background",
            accent if accent.starts_with("accent") && accent.len() == 7 => accent,
            _ => return None,
        };
        crate::doc::values::THEME_COLORS
            .contains(&name)
            .then(|| format!("theme:{name}"))
    }

    /// The font a theme font name such as `minorHAnsi` stands for.
    pub fn font(&self, token: &str) -> Option<&str> {
        let lower = token.to_ascii_lowercase();
        let set = if lower.starts_with("major") {
            &self.major
        } else {
            &self.minor
        };
        let face = if lower.ends_with("eastasia") {
            &set.east_asia
        } else if lower.ends_with("bidi") {
            &set.cs
        } else {
            &set.latin
        };
        face.as_deref()
    }

    /// The font of a run in a script, from its font slots.
    pub fn run_font(&self, fonts: &Fonts, script: Script) -> Option<String> {
        let slots = match script {
            Script::Latin => [&fonts.ascii, &fonts.h_ansi],
            Script::EastAsian => [&fonts.east_asia, &fonts.east_asia],
            Script::Complex => [&fonts.cs, &fonts.cs],
        };
        slots.into_iter().flatten().find_map(|slot| self.slot(slot))
    }

    fn slot(&self, slot: &FontRef) -> Option<String> {
        match slot {
            FontRef::Name(name) => Some(name.clone()),
            FontRef::Theme(token) => self.font(token).map(str::to_owned),
        }
    }

    /// Whether a run's Latin, East Asian, and complex script fonts name different faces.
    pub fn fonts_differ(&self, fonts: &Fonts) -> bool {
        let faces: Vec<String> = [&fonts.ascii, &fonts.east_asia, &fonts.cs]
            .into_iter()
            .flatten()
            .filter_map(|s| self.slot(s))
            .collect();
        faces.windows(2).any(|w| w[0] != w[1])
    }

    /// A color as six lowercase hex digits, or `None` for automatic. A theme color wins over the RGB value that
    /// Word writes next to it, and a tint or shade changes its lightness.
    pub fn color(&self, color: &ColorRef) -> Option<String> {
        let from_theme = color
            .theme
            .as_deref()
            .and_then(|name| self.colors.get(&self.scheme_slot(name)).cloned());
        let base = from_theme.clone().or_else(|| color.rgb.clone())?;
        if from_theme.is_none() {
            return Some(base);
        }
        Some(match (color.tint, color.shade) {
            (Some(tint), _) => tint_shade(&base, |l| l * f64::from(tint) / 255.0 + (1.0 - f64::from(tint) / 255.0)),
            (None, Some(shade)) => tint_shade(&base, |l| l * f64::from(shade) / 255.0),
            (None, None) => base,
        })
    }
}

/// Changes the lightness of a color in HSL, as ECMA-376 Part 1, 17.3.2.41 (`themeTint`) and 17.3.2.40
/// (`themeShade`) describe.
fn tint_shade(hex: &str, lightness: impl Fn(f64) -> f64) -> String {
    let byte = |i: usize| f64::from(u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0)) / 255.0;
    let (r, g, b) = (byte(0), byte(2), byte(4));
    let (h, s, l) = to_hsl(r, g, b);
    let (r, g, b) = from_hsl(h, s, lightness(l).clamp(0.0, 1.0));
    let to = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
    format!("{:02x}{:02x}{:02x}", to(r), to(g), to(b))
}

fn to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if (max - r).abs() < f64::EPSILON {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h / 6.0, s, l)
}

fn from_hsl(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let hue = |mut t: f64| {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (hue(h + 1.0 / 3.0), hue(h), hue(h - 1.0 / 3.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    const THEME: &str = r#"<a:theme><a:themeElements>
        <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
          <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
          <a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme>
        <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/></a:majorFont>
          <a:minorFont><a:latin typeface="Calibri"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme>
        </a:themeElements></a:theme>"#;

    fn theme_color(theme: &str, tint: Option<u8>, shade: Option<u8>) -> ColorRef {
        ColorRef {
            rgb: Some("ff0000".to_owned()),
            theme: Some(theme.to_owned()),
            tint,
            shade,
        }
    }

    #[test]
    fn theme_fonts_resolve_by_set_and_script() {
        let theme = Theme::read(&parse(THEME));
        assert_eq!(theme.font("minorHAnsi"), Some("Calibri"));
        assert_eq!(theme.font("majorAscii"), Some("Calibri Light"));
        assert_eq!(theme.font("minorBidi"), Some("Arial"));
        assert_eq!(theme.font("majorEastAsia"), None, "an empty typeface is no font");
    }

    #[test]
    fn tints_and_shades_change_lightness_as_ecma_376_says() {
        let theme = Theme::read(&parse(THEME));
        // Black at tint 0x80: L = 0 * 128/255 + (1 - 128/255) = 127/255, so gray 7f.
        assert_eq!(
            theme.color(&theme_color("text1", Some(0x80), None)).as_deref(),
            Some("7f7f7f")
        );
        // White at shade 0x80: L = 1 * 128/255, so gray 80.
        assert_eq!(
            theme.color(&theme_color("background1", None, Some(0x80))).as_deref(),
            Some("808080")
        );
        // A theme color wins over the RGB value next to it.
        assert_eq!(
            theme.color(&theme_color("accent1", None, None)).as_deref(),
            Some("4472c4")
        );
        let plain = ColorRef {
            rgb: Some("00ff00".to_owned()),
            ..ColorRef::default()
        };
        assert_eq!(theme.color(&plain).as_deref(), Some("00ff00"));
    }

    #[test]
    fn plain_theme_colors_keep_their_slot_and_follow_the_mapping() {
        let mut theme = Theme::read(&parse(THEME));
        let slot = |theme: &Theme, name: &str, shade: Option<u8>| theme.theme_slot(&theme_color(name, None, shade));
        assert_eq!(slot(&theme, "accent1", None).as_deref(), Some("theme:accent1"));
        assert_eq!(slot(&theme, "text1", None).as_deref(), Some("theme:text"));
        assert_eq!(
            slot(&theme, "accent1", Some(0xbf)),
            None,
            "a shade is a color of its own"
        );
        assert_eq!(slot(&theme, "accent2", None), None, "the theme does not define accent2");
        // ECMA-376 Part 1, 17.15.1.20: the mapping can make text1 the light color.
        theme.read_mapping(&parse(
            r#"<w:settings><w:clrSchemeMapping w:t1="light1" w:bg1="dark1"/></w:settings>"#,
        ));
        assert_eq!(slot(&theme, "text1", None).as_deref(), Some("theme:background"));
        assert_eq!(
            theme.color(&theme_color("background1", None, None)).as_deref(),
            Some("000000")
        );
    }
}
