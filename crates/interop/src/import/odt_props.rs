//! The run formats of an OpenDocument text style: what `style:text-properties` sets, in the units of the format.

use super::xmltree::Element;
use crate::doc::{Marks, Script};
use crate::palette::{highlight_name, pen_name};

/// The text properties a style sets. `None` leaves what the parent style gave.
#[derive(Clone, Default)]
pub(super) struct Props {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    script: Option<Option<Script>>,
    shift: Option<Option<String>>,
    color: Option<Option<String>>,
    highlight: Option<Option<String>>,
    code: Option<bool>,
    font: Option<Option<String>>,
    size: Option<Option<String>>,
    underline_line: Option<Option<String>>,
    underline_color: Option<Option<String>>,
    strike_double: Option<bool>,
    caps: Option<Option<String>>,
    tracking: Option<Option<String>>,
}

/// The font families that `style:font-face` declarations name: a declaration name to its `svg:font-family`.
pub(super) type Faces = std::collections::HashMap<String, String>;

/// The first family of a font list, without quotes: `'Liberation Serif', serif` is `Liberation Serif`.
fn first_family(list: &str) -> &str {
    list.split(',')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(['\'', '"'])
        .trim()
}

/// A length such as `10.5pt`, `0.1in`, `2mm`, `1cm`, or `13px`, in points.
fn length_points(text: &str) -> Option<f64> {
    let text = text.trim();
    let end = text.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == '+'))?;
    let number: f64 = text[..end].parse().ok()?;
    let factor = match &text[end..] {
        "pt" => 1.0,
        "in" => 72.0,
        "cm" => 72.0 / 2.54,
        "mm" => 72.0 / 25.4,
        "px" => 0.75,
        "pc" => 12.0,
        _ => return None,
    };
    Some(number * factor)
}

/// Points rounded to the nearest `step` (in hundredths of a point), as the shortest decimal text.
fn points_text(points: f64, step: i64) -> String {
    let hundredths = ((points * 100.0 / step as f64).round() as i64) * step;
    let text = format!("{:.2}", hundredths as f64 / 100.0);
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// The underline style of the Markdown grammar for the OpenDocument style, type, and width (ODF 1.3, 20.376).
fn underline_name(style: &str, double: bool, bold: bool) -> Option<&'static str> {
    Some(match (style, double, bold) {
        ("solid", true, _) => "double",
        ("solid", false, true) => "thick",
        ("solid", false, false) => return None,
        ("dotted", _, true) => "dottedHeavy",
        ("dotted", _, false) => "dotted",
        ("dash", _, true) => "dashedHeavy",
        ("dash", _, false) => "dash",
        ("long-dash", _, true) => "dashLongHeavy",
        ("long-dash", _, false) => "dashLong",
        ("dot-dash", _, true) => "dashDotHeavy",
        ("dot-dash", _, false) => "dotDash",
        ("dot-dot-dash", _, true) => "dashDotDotHeavy",
        ("dot-dot-dash", _, false) => "dotDotDash",
        ("wave", true, _) => "wavyDouble",
        ("wave", false, true) => "wavyHeavy",
        ("wave", false, false) => "wave",
        _ => return None,
    })
}

impl Props {
    /// Reads the text properties. `direct` is true for automatic styles and text styles, whose size and font are
    /// direct formatting; the font and size of a paragraph style are the page's style sheet and stay out of runs.
    pub(super) fn read(element: &Element, direct: bool, faces: &Faces) -> Props {
        let attr = |name: &str| element.attr(name).map(str::trim);
        let not_none = |v: Option<&str>| v.map(|v| !v.is_empty() && v != "none");
        let underline_style = attr("style:text-underline-style");
        let wide = |w: Option<&str>| {
            w.is_some_and(|w| {
                matches!(w, "bold" | "thick")
                    || w.trim_end_matches('%').parse::<f64>().is_ok_and(|n| n >= 150.0)
                    || length_points(w).is_some_and(|p| p >= 1.5)
            })
        };
        let family = |css: Option<&str>, face: Option<&str>| {
            css.map(first_family)
                .or_else(|| face.map(|n| faces.get(n).map_or(n, |f| first_family(f))))
                .map(str::to_owned)
        };
        let family_text = family(attr("fo:font-family"), attr("style:font-name"));
        Props {
            // A style without a family leaves the font alone, as one without a size leaves the size.
            font: family_text
                .clone()
                .filter(|_| direct)
                .map(|f| Some(f).filter(|f| crate::doc::values::font_name(f))),
            size: attr("fo:font-size").filter(|_| direct).and_then(|s| {
                // A relative size such as 120% is not a length: it leaves the size of the parent style alone.
                let points = length_points(s).map(|p| (p * 2.0).round() / 2.0)?;
                Some(Some(points_text(points, 50)).filter(|t| crate::doc::values::size_points_text(t)))
            }),
            underline_line: underline_style.map(|style| {
                let double = attr("style:text-underline-type") == Some("double");
                let name = underline_name(style, double, wide(attr("style:text-underline-width")));
                // Skipping white space underlines words only (ODF 1.3, 20.375).
                let name = match (name, attr("style:text-underline-mode")) {
                    (None, Some("skip-white-space")) if style == "solid" => Some("words"),
                    (name, _) => name,
                };
                name.map(str::to_owned)
            }),
            underline_color: attr("style:text-underline-color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
                    .then(|| format!("#{}", hex.to_ascii_lowercase()))
            }),
            strike_double: attr("style:text-line-through-type").map(|t| t == "double"),
            caps: match attr("fo:text-transform") {
                Some("uppercase") => Some(Some("all".to_owned())),
                Some("capitalize" | "lowercase") => Some(None),
                // `none` leaves the small-caps variant in charge (ODF 1.3, 20.236).
                _ => attr("fo:font-variant").map(|v| (v == "small-caps").then(|| "small".to_owned())),
            },
            tracking: attr("fo:letter-spacing").map(|s| {
                length_points(s)
                    .map(|p| points_text(p, 5))
                    .filter(|t| crate::doc::values::number_text(t, -158_400, 158_400, 5, &[0]))
            }),
            bold: attr("fo:font-weight").map(|w| w == "bold" || w.parse::<u32>().is_ok_and(|n| n >= 600)),
            italic: attr("fo:font-style").map(|s| s == "italic" || s == "oblique"),
            underline: not_none(attr("style:text-underline-style")),
            strike: not_none(attr("style:text-line-through-style")),
            script: attr("style:text-position").map(|p| {
                let first = p.split_whitespace().next().unwrap_or("");
                let percent = first.trim_end_matches('%').parse::<f64>().ok();
                match (first, percent) {
                    ("super", _) => Some(Script::Sup),
                    ("sub", _) => Some(Script::Sub),
                    // ODF 1.3, 20.384: a percentage raises or lowers by that share of the font height. The usual
                    // 33% and -33% are the super and subscript of the office suites. Other values are a shift.
                    (_, Some(n)) if (n - 33.0).abs() < 1.0 => Some(Script::Sup),
                    (_, Some(n)) if (n + 33.0).abs() < 1.0 => Some(Script::Sub),
                    _ => None,
                }
            }),
            shift: attr("style:text-position").map(|p| {
                let first = p.split_whitespace().next().unwrap_or("");
                let percent = first.trim_end_matches('%').parse::<f64>().ok()?;
                if (percent.abs() - 33.0).abs() < 1.0 {
                    return None;
                }
                let body = attr("fo:font-size").and_then(length_points).unwrap_or(12.0);
                Some(points_text(percent / 100.0 * body, 50))
                    .filter(|t| crate::doc::values::number_text(t, -158_400, 158_400, 50, &[0]))
            }),
            color: attr("fo:color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && !hex.eq_ignore_ascii_case("000000")).then(|| pen_name(hex))
            }),
            highlight: attr("fo:background-color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && !hex.eq_ignore_ascii_case("ffffff"))
                    .then(|| highlight_name(hex).map_or_else(|| "honey".to_owned(), str::to_owned))
            }),
            code: family_text
                .as_deref()
                .map(str::to_lowercase)
                .map(|f| f.contains("courier") || f.contains("mono") || f.contains("consolas")),
        }
    }

    pub(super) fn apply(&self, marks: &mut Marks) {
        if let Some(v) = self.bold {
            marks.strong = v;
        }
        if let Some(v) = self.italic {
            marks.emphasis = v;
        }
        if let Some(v) = self.underline {
            marks.underline = v;
        }
        if let Some(v) = self.strike {
            marks.strike = v;
        }
        if let Some(v) = self.script {
            marks.script = v;
        }
        if let Some(v) = &self.shift {
            marks.shift.clone_from(v);
        }
        if let Some(v) = &self.color {
            marks.color.clone_from(v);
        }
        if let Some(v) = &self.highlight {
            marks.highlight.clone_from(v);
        }
        if let Some(v) = self.code {
            marks.code = v;
        }
        if let Some(v) = &self.font {
            marks.font.clone_from(v);
        }
        if let Some(v) = &self.size {
            marks.size.clone_from(v);
        }
        if let Some(v) = &self.underline_line {
            marks.underline_line.clone_from(v);
        }
        if let Some(v) = &self.underline_color {
            marks.underline_color.clone_from(v);
        }
        if let Some(v) = self.strike_double {
            marks.strike_double = v;
        }
        if let Some(v) = &self.caps {
            marks.caps.clone_from(v);
        }
        if let Some(v) = &self.tracking {
            marks.tracking.clone_from(v);
        }
        // The grammar allows these only with their mark.
        if !marks.underline {
            marks.underline_line = None;
            marks.underline_color = None;
        }
        if !marks.strike {
            marks.strike_double = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The marks that a `style:text-properties` element gives plain text.
    fn marks(attrs: &str, direct: bool) -> Marks {
        let xml = format!("<style:text-properties {attrs}/>");
        let element = super::super::xmltree::parse(&xml);
        let mut marks = Marks::default();
        Props::read(&element, direct, &Faces::new()).apply(&mut marks);
        marks
    }

    #[test]
    fn sizes_fonts_and_underline_styles_import_with_their_units() {
        // ODF 1.3: fo:font-size is a length, so 10.5pt is 10.5; the underline style names the line.
        let a = marks(r#"fo:font-size="10.5pt" fo:font-family="Georgia""#, true);
        assert_eq!((a.size.as_deref(), a.font.as_deref()), (Some("10.5"), Some("Georgia")));
        let b = marks(
            r##"style:text-underline-style="wave" style:text-underline-color="#FF0000""##,
            true,
        );
        assert!(b.underline && b.underline_line.as_deref() == Some("wave"), "{b:?}");
        assert_eq!(b.underline_color.as_deref(), Some("#ff0000"));
    }

    #[test]
    fn a_relative_size_leaves_the_size_of_the_parent_alone() {
        let element = super::super::xmltree::parse(r#"<style:text-properties fo:font-size="120%"/>"#);
        let props = Props::read(&element, true, &Faces::new());
        assert_eq!(props.size, None);
        let mut marks = Marks {
            size: Some("14".to_owned()),
            ..Marks::default()
        };
        props.apply(&mut marks);
        assert_eq!(marks.size.as_deref(), Some("14"));
    }

    #[test]
    fn caps_spacing_and_double_lines_import() {
        let c = marks(
            concat!(
                r#"fo:font-variant="small-caps" fo:letter-spacing="0.1in" "#,
                r#"style:text-underline-style="solid" style:text-underline-type="double" "#,
                r#"style:text-line-through-style="solid" style:text-line-through-type="double""#
            ),
            true,
        );
        assert_eq!(c.caps.as_deref(), Some("small"));
        // 0.1 inch is 7.2 points.
        assert_eq!(c.tracking.as_deref(), Some("7.2"));
        assert!(
            c.underline_line.as_deref() == Some("double") && c.strike_double,
            "{c:?}"
        );
    }

    #[test]
    fn small_caps_survive_a_none_transform_and_underline_modes_and_positions_map() {
        let c = marks(r#"fo:text-transform="none" fo:font-variant="small-caps""#, true);
        assert_eq!(c.caps.as_deref(), Some("small"));
        let u = marks(
            r#"style:text-underline-style="solid" style:text-underline-mode="skip-white-space""#,
            true,
        );
        assert!(u.underline && u.underline_line.as_deref() == Some("words"), "{u:?}");
        // ODF 1.3, 20.384: 33% is the office suites' superscript; 58% of a 10 pt font is 5.8 pt, on the 0.5 step.
        assert_eq!(
            marks(r#"style:text-position="33% 58%""#, true).script,
            Some(Script::Sup)
        );
        let s = marks(r#"style:text-position="50%" fo:font-size="10pt""#, true);
        assert_eq!((s.script, s.shift.as_deref()), (None, Some("5")));
    }

    #[test]
    fn paragraph_styles_keep_their_size_and_font_out_of_runs() {
        let p = marks(r#"fo:font-size="18pt" fo:font-family="Georgia""#, false);
        assert!(p.size.is_none() && p.font.is_none(), "{p:?}");
    }
}
