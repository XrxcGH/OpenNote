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

/// Points as the shortest decimal text, when the value lies on the grammar's step (hundredths).
fn points_text(points: f64) -> String {
    let hundredths = (points * 100.0).round() as i64;
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
    pub(super) fn read(element: &Element, direct: bool) -> Props {
        let attr = |name: &str| element.attr(name).map(str::trim);
        let not_none = |v: Option<&str>| v.map(|v| !v.is_empty() && v != "none");
        let underline_style = attr("style:text-underline-style");
        let wide = |w: Option<&str>| {
            w.is_some_and(|w| {
                matches!(w, "bold" | "thick") || w.trim_end_matches('%').parse::<f64>().is_ok_and(|n| n >= 150.0)
            })
        };
        Props {
            font: direct.then(|| {
                attr("fo:font-family")
                    .or(attr("style:font-name"))
                    .map(|f| f.trim_matches(['\'', '"']))
                    .filter(|f| crate::doc::values::font_name(f))
                    .map(str::to_owned)
            }),
            size: attr("fo:font-size").filter(|_| direct).map(|s| {
                let points = length_points(s).map(|p| (p * 2.0).round() / 2.0);
                points
                    .map(points_text)
                    .filter(|t| crate::doc::values::size_points_text(t))
            }),
            underline_line: underline_style.map(|style| {
                let double = attr("style:text-underline-type") == Some("double");
                underline_name(style, double, wide(attr("style:text-underline-width"))).map(str::to_owned)
            }),
            underline_color: attr("style:text-underline-color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
                    .then(|| format!("#{}", hex.to_ascii_lowercase()))
            }),
            strike_double: attr("style:text-line-through-type").map(|t| t == "double"),
            caps: attr("fo:text-transform")
                .map(|t| (t == "uppercase").then(|| "all".to_owned()))
                .or_else(|| attr("fo:font-variant").map(|v| (v == "small-caps").then(|| "small".to_owned()))),
            tracking: attr("fo:letter-spacing").map(|s| {
                length_points(s)
                    .map(points_text)
                    .filter(|t| crate::doc::values::number_text(t, -158_400, 158_400, 5, &[0]))
            }),
            bold: attr("fo:font-weight").map(|w| w == "bold" || w.parse::<u32>().is_ok_and(|n| n >= 600)),
            italic: attr("fo:font-style").map(|s| s == "italic" || s == "oblique"),
            underline: not_none(attr("style:text-underline-style")),
            strike: not_none(attr("style:text-line-through-style")),
            script: attr("style:text-position").map(|p| {
                let first = p.split_whitespace().next().unwrap_or("");
                if first == "super" || first.starts_with('+') || first.parse::<f64>().is_ok_and(|n| n > 0.0) {
                    Some(Script::Sup)
                } else if first == "sub" || first.starts_with('-') {
                    Some(Script::Sub)
                } else {
                    None
                }
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
            code: attr("style:font-name")
                .or(attr("fo:font-family"))
                .map(|f| f.to_lowercase())
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
        Props::read(&element, direct).apply(&mut marks);
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
    fn paragraph_styles_keep_their_size_and_font_out_of_runs() {
        let p = marks(r#"fo:font-size="18pt" fo:font-family="Georgia""#, false);
        assert!(p.size.is_none() && p.font.is_none(), "{p:?}");
    }
}
