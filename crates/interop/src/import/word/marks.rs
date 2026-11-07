//! Resolved run properties in OpenNote's terms: the marks of a run (spec 7.10), and the run keys of a style
//! (`R-STY-1`). A run gets tags only where it differs from its paragraph's style, which the page style sheet
//! holds, so the Markdown stays short (DESIGN 9.2).

use serde_json::{Map, Value};

use super::props::ColorRef;
use super::props::{RunProps, Toggle};
use super::theme::{Script as TextScript, Theme};
use super::values::{hex, num, text};
use crate::doc::values as grammar;
use crate::doc::{Marks, Script};
use crate::palette::{highlight_name, pen_name};

/// Fonts that mark text as code.
const CODE_FONTS: &[&str] = &[
    "consolas",
    "courier new",
    "courier",
    "lucida console",
    "monaco",
    "menlo",
    "source code pro",
    "cascadia code",
    "cascadia mono",
    "fira code",
    "roboto mono",
];

/// The 16 `ST_HighlightColor` values of ECMA-376 Part 1, 17.18.40, and their colors.
const HIGHLIGHTS: [(&str, &str); 16] = [
    ("black", "000000"),
    ("blue", "0000ff"),
    ("cyan", "00ffff"),
    ("green", "00ff00"),
    ("magenta", "ff00ff"),
    ("red", "ff0000"),
    ("yellow", "ffff00"),
    ("white", "ffffff"),
    ("darkBlue", "000080"),
    ("darkCyan", "008080"),
    ("darkGreen", "008000"),
    ("darkMagenta", "800080"),
    ("darkRed", "800000"),
    ("darkYellow", "808000"),
    ("darkGray", "808080"),
    ("lightGray", "c0c0c0"),
];

/// The underline styles of Appendix D.5: the `ST_Underline` values besides `single` and `none`.
const UNDERLINES: &[&str] = &[
    "double",
    "words",
    "thick",
    "dotted",
    "dottedHeavy",
    "dash",
    "dashedHeavy",
    "dashLong",
    "dashLongHeavy",
    "dotDash",
    "dashDotHeavy",
    "dotDotDash",
    "dashDotDotHeavy",
    "wave",
    "wavyHeavy",
    "wavyDouble",
];

/// The color of an `ST_HighlightColor` name, as `#rrggbb`.
pub(super) fn highlight_color(name: &str) -> Option<String> {
    HIGHLIGHTS.iter().find(|(n, _)| *n == name).map(|(_, rgb)| hex(rgb))
}

/// Whether a font marks text as code.
pub(super) fn is_code_font(font: &str) -> bool {
    CODE_FONTS.contains(&font.to_lowercase().as_str())
}

/// The marks of a run with these properties, as if nothing else styled it.
pub(super) fn marks_of(props: &RunProps, theme: &Theme, script: TextScript) -> Marks {
    let mut marks = Marks::none();
    marks.strong = props.toggle(Toggle::Bold);
    marks.emphasis = props.toggle(Toggle::Italic);
    marks.strike = props.toggle(Toggle::Strike) || props.toggle(Toggle::DStrike);
    marks.strike_double = props.toggle(Toggle::DStrike);
    if let Some((style, color)) = &props.underline {
        if style != "none" {
            marks.underline = true;
            marks.underline_line = UNDERLINES.contains(&style.as_str()).then(|| style.clone());
            marks.underline_color = color.as_ref().and_then(|c| theme.color(c)).map(|c| pen_name(&c));
        }
    }
    marks.highlight = props.highlight.as_deref().and_then(highlight_color);
    if let Some(fill) = props.shade.as_deref().filter(|f| !f.is_empty()) {
        match highlight_name(fill) {
            // OpenNote's own exports draw the brand highlighters as shading.
            Some(name) if marks.highlight.is_none() => marks.highlight = Some(name.to_owned()),
            _ => marks.shade = Some(hex(fill)),
        }
    }
    marks.color = props.color.as_ref().and_then(|c| theme.color(c)).map(|c| pen_name(&c));
    if let Some(font) = theme.run_font(&props.fonts, script) {
        if is_code_font(&font) {
            marks.code = true;
        } else if grammar::font_name(&font) {
            marks.font = Some(font);
        }
    }
    marks.size = props.size.and_then(size_mark);
    marks.caps = if props.toggle(Toggle::Caps) {
        Some("all".to_owned())
    } else if props.toggle(Toggle::SmallCaps) {
        Some("small".to_owned())
    } else {
        None
    };
    marks.tracking = props
        .tracking
        .map(|t| text(f64::from(t) / 20.0))
        .filter(|t| grammar::number_text(t, -158_400, 158_400, 5, &[0]));
    marks.scale = props
        .scale
        .map(|s| s.to_string())
        .filter(|s| grammar::number_text(s, 100, 60_000, 100, &[10_000]));
    marks.shift = props
        .shift
        .map(|s| text(f64::from(s) / 2.0))
        .filter(|s| grammar::number_text(s, -158_400, 158_400, 50, &[0]));
    marks.kern = props
        .kern
        .filter(|k| *k > 0)
        .map(|k| text(f64::from(k) / 2.0))
        .filter(|k| grammar::number_text(k, 100, 163_800, 50, &[]));
    marks.otf = otf(props);
    marks.effect = effect(props);
    if let Some((style, color)) = &props.border {
        if !matches!(style.as_str(), "none" | "nil") {
            let style = match style.as_str() {
                "double" | "dotted" | "dashed" | "thick" => style.as_str(),
                _ => "single",
            };
            marks.text_box = Some(style.to_owned());
            marks.box_color = color.as_ref().and_then(|c| theme.color(c)).map(|c| pen_name(&c));
        }
    }
    marks.script = match props.script.as_deref() {
        Some("superscript") => Some(Script::Sup),
        Some("subscript") => Some(Script::Sub),
        _ => None,
    };
    marks.lang = if props.no_proof == Some(true) {
        Some("zxx".to_owned())
    } else {
        props.lang.clone().filter(|l| grammar::lang(l))
    };
    marks.dir = props.rtl.map(|rtl| if rtl { "rtl" } else { "ltr" }.to_owned());
    theme_colors(props, theme, &mut marks);
    marks
}

/// Plain theme colors stay theme colors (`theme:accent1`), so they follow the page theme as they follow the
/// document theme in Word. The page theme holds the document's theme colors (R-THM-1).
fn theme_colors(props: &RunProps, theme: &Theme, marks: &mut Marks) {
    let slot = |color: Option<&ColorRef>| color.and_then(|c| theme.theme_slot(c));
    if let Some(color) = slot(props.color.as_ref()) {
        marks.color = Some(color);
    }
    if marks.underline {
        if let Some(color) = slot(props.underline.as_ref().and_then(|(_, c)| c.as_ref())) {
            marks.underline_color = Some(color);
        }
    }
    if marks.text_box.is_some() {
        if let Some(color) = slot(props.border.as_ref().and_then(|(_, c)| c.as_ref())) {
            marks.box_color = Some(color);
        }
    }
}

/// A size in half-points as a mark. 10, 15, and 18 points keep the names of version 1, so OpenNote's own
/// exports read back as they were written.
fn size_mark(half_points: u32) -> Option<String> {
    let named = match half_points {
        20 => Some("small"),
        30 => Some("large"),
        36 => Some("xlarge"),
        _ => None,
    };
    if let Some(name) = named {
        return Some(name.to_owned());
    }
    Some(text(f64::from(half_points) / 2.0)).filter(|s| grammar::size_points_text(s))
}

fn otf(props: &RunProps) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    if let Some(lig) = props.ligatures.as_deref() {
        // ST_Ligatures ([MS-DOCX] 2.6.1.3) names the kinds that are on, such as `standardContextual`, or `all`
        // or `none`. Standard and contextual ligatures are on by default in OpenNote, so a value without them
        // turns them off.
        let lower = lig.to_ascii_lowercase();
        let all = lower == "all";
        let has = |kind: &str| all || lower.contains(kind);
        for (kind, off) in [("standard", "liga-none"), ("contextual", "clig-none")] {
            if !has(kind) {
                tokens.push(off.to_owned());
            }
        }
        if has("historical") {
            tokens.push("hlig".to_owned());
        }
        if has("discretional") {
            tokens.push("dlig".to_owned());
        }
    }
    match props.num_form.as_deref() {
        Some("lining") => tokens.push("lnum".to_owned()),
        Some("oldStyle") => tokens.push("onum".to_owned()),
        _ => {}
    }
    match props.num_spacing.as_deref() {
        Some("proportional") => tokens.push("pnum".to_owned()),
        Some("tabular") => tokens.push("tnum".to_owned()),
        _ => {}
    }
    for set in props.style_sets.iter().flatten() {
        if (1..=20).contains(set) {
            tokens.push(format!("ss{set:02}"));
        }
    }
    tokens.sort();
    tokens.dedup();
    Some(tokens.join(" ")).filter(|t| !t.is_empty() && grammar::otf(t))
}

fn effect(props: &RunProps) -> Option<String> {
    let mut tokens = Vec::new();
    if props.toggle(Toggle::Emboss) {
        tokens.push("emboss");
    } else if props.toggle(Toggle::Imprint) {
        tokens.push("engrave");
    }
    if props.toggle(Toggle::Outline) {
        tokens.push("outline");
    }
    if props.toggle(Toggle::Shadow) {
        tokens.push("shadow");
    }
    tokens.sort_unstable();
    Some(tokens.join(" ")).filter(|t| !t.is_empty())
}

/// What a run turns off that its paragraph's style turns on: bits of [`OFF_LETTERS`].
pub(super) const OFF_BOLD: u8 = 1;
pub(super) const OFF_ITALIC: u8 = 2;
pub(super) const OFF_UNDERLINE: u8 = 4;
pub(super) const OFF_STRIKE: u8 = 8;
pub(super) const OFF_CAPS: u8 = 16;

/// The letters that name each bit in a plain style's name.
const OFF_LETTERS: [(u8, char); 5] = [
    (OFF_BOLD, 'b'),
    (OFF_ITALIC, 'i'),
    (OFF_UNDERLINE, 'u'),
    (OFF_STRIKE, 's'),
    (OFF_CAPS, 'c'),
];

/// The name of the character style that turns off these bits, such as `u-plain-bi` for bold and italics.
/// Markdown has no tag that turns bold off, but a character style can (`R-STY-8`).
pub(super) fn plain_style_name(bits: u8) -> String {
    let letters: String = OFF_LETTERS
        .iter()
        .filter(|(bit, _)| bits & bit != 0)
        .map(|(_, c)| *c)
        .collect();
    format!("u-plain-{letters}")
}

/// The character style that turns off these bits.
pub(super) fn plain_style(bits: u8) -> Value {
    let mut out = Map::new();
    out.insert("type".to_owned(), Value::from("character"));
    let names: Vec<&str> = [
        (OFF_BOLD, "bold"),
        (OFF_ITALIC, "italics"),
        (OFF_UNDERLINE, "underline"),
        (OFF_STRIKE, "strikethrough"),
        (OFF_CAPS, "capitals"),
    ]
    .iter()
    .filter(|(bit, _)| bits & bit != 0)
    .map(|(_, name)| *name)
    .collect();
    out.insert("label".to_owned(), Value::from(format!("No {}", names.join(", "))));
    if bits & OFF_BOLD != 0 {
        out.insert("weight".to_owned(), Value::from(400));
    }
    if bits & OFF_ITALIC != 0 {
        out.insert("italic".to_owned(), Value::from(false));
    }
    if bits & OFF_UNDERLINE != 0 {
        out.insert("underline".to_owned(), Value::from("none"));
    }
    if bits & OFF_STRIKE != 0 {
        out.insert("strike".to_owned(), Value::from("none"));
    }
    if bits & OFF_CAPS != 0 {
        out.insert("caps".to_owned(), Value::from("none"));
    }
    Value::Object(out)
}

/// What a run needs over its paragraph's style, and what it turns off that the style turns on.
#[derive(Debug, PartialEq)]
pub(super) struct OverStyle {
    /// The marks whose values differ from the style's.
    pub marks: Marks,
    /// The style's toggles the run turns off: `OFF_*` bits, which a plain character style can say.
    pub off: u8,
    /// Whether the run drops a value of another kind, such as the style's color, which nothing can say.
    pub lost: bool,
}

/// The marks a run needs over its paragraph's style: each mark whose value differs from the style's.
pub(super) fn over_style(run: Marks, style: &Marks) -> OverStyle {
    let mut lost = false;
    let mut off = 0;
    let mut out = run;
    let mut flag = |value: &mut bool, base: bool, bit: u8| {
        if base {
            if !*value {
                off |= bit;
            }
            *value = false;
        }
    };
    flag(&mut out.strong, style.strong, OFF_BOLD);
    flag(&mut out.emphasis, style.emphasis, OFF_ITALIC);
    flag(&mut out.underline, style.underline, OFF_UNDERLINE);
    flag(&mut out.code, style.code, 0);
    if style.strike {
        if !out.strike {
            off |= OFF_STRIKE;
        }
        if out.strike_double == style.strike_double {
            out.strike = false;
            out.strike_double = false;
        }
    }
    if style.caps.is_some() && out.caps.is_none() {
        off |= OFF_CAPS;
    }
    fn same<T: PartialEq>(value: &mut Option<T>, base: &Option<T>, lost: &mut bool) {
        if base.is_some() {
            if value.is_none() {
                *lost = true;
            }
            if value == base {
                *value = None;
            }
        }
    }
    if !out.underline {
        out.underline_line = None;
        out.underline_color = None;
    } else if style.underline {
        // The style already underlines: the run says its own line style and color only when they differ.
        same(&mut out.underline_line, &style.underline_line, &mut lost);
        same(&mut out.underline_color, &style.underline_color, &mut lost);
    }
    same(&mut out.highlight, &style.highlight, &mut lost);
    same(&mut out.shade, &style.shade, &mut lost);
    same(&mut out.color, &style.color, &mut lost);
    same(&mut out.font, &style.font, &mut lost);
    same(&mut out.size, &style.size, &mut lost);
    let mut caps_lost = false;
    same(&mut out.caps, &style.caps, &mut caps_lost);
    same(&mut out.tracking, &style.tracking, &mut lost);
    same(&mut out.scale, &style.scale, &mut lost);
    same(&mut out.shift, &style.shift, &mut lost);
    same(&mut out.kern, &style.kern, &mut lost);
    same(&mut out.otf, &style.otf, &mut lost);
    same(&mut out.effect, &style.effect, &mut lost);
    if out.text_box == style.text_box && out.box_color == style.box_color {
        out.text_box = None;
        out.box_color = None;
    }
    same(&mut out.script, &style.script, &mut lost);
    same(&mut out.lang, &style.lang, &mut lost);
    same(&mut out.dir, &style.dir, &mut lost);
    OverStyle { marks: out, off, lost }
}

/// The run keys of a style (`R-STY-1`), with the version 1 keys that `R-STY-2` asks writers to add.
pub(super) fn style_keys(props: &RunProps, theme: &Theme, out: &mut Map<String, Value>) {
    if let Some(font) = theme
        .run_font(&props.fonts, TextScript::Latin)
        .filter(|f| (1..=200).contains(&f.chars().count()))
    {
        out.insert("font".to_owned(), Value::from(font));
    }
    if let Some(size) = props.size.filter(|s| (2..=3276).contains(s)) {
        let points = f64::from(size) / 2.0;
        out.insert("sizePt".to_owned(), num(points));
        let units = (points * 4.0 / 3.0 * 100.0).round() / 100.0;
        if (1.0..=1000.0).contains(&units) {
            out.insert("size".to_owned(), num(units));
        }
    }
    out.insert(
        "weight".to_owned(),
        Value::from(if props.toggle(Toggle::Bold) { 700 } else { 400 }),
    );
    out.insert("italic".to_owned(), Value::from(props.toggle(Toggle::Italic)));
    if let Some((style, _)) = &props.underline {
        let value = if style == "single" || style == "none" || UNDERLINES.contains(&style.as_str()) {
            style.as_str()
        } else {
            "single"
        };
        out.insert("underline".to_owned(), Value::from(value));
    }
    if props.toggle(Toggle::DStrike) {
        out.insert("strike".to_owned(), Value::from("double"));
    } else if props.toggle(Toggle::Strike) {
        out.insert("strike".to_owned(), Value::from("single"));
    }
    if props.toggle(Toggle::Caps) {
        out.insert("caps".to_owned(), Value::from("all"));
    } else if props.toggle(Toggle::SmallCaps) {
        out.insert("caps".to_owned(), Value::from("small"));
    }
    if let Some(t) = props
        .tracking
        .map(|t| f64::from(t) / 20.0)
        .filter(|t| t.abs() <= 1584.0)
    {
        out.insert("tracking".to_owned(), num(t));
    }
    let theme_color = props.color.as_ref().and_then(|c| theme.theme_slot(c));
    if let Some(color) = theme_color.or_else(|| props.color.as_ref().and_then(|c| theme.color(c)).map(|c| pen_name(&c)))
    {
        out.insert("textColor".to_owned(), Value::from(color.clone()));
        if grammar::v1_text_color(&color) {
            out.insert("color".to_owned(), Value::from(color));
        }
    }
    if let Some(highlight) = props.highlight.as_deref().and_then(highlight_color) {
        out.insert("highlight".to_owned(), Value::from(highlight));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    fn marks(xml: &str) -> Marks {
        marks_of(&RunProps::read(&parse(xml)), &Theme::default(), TextScript::Latin)
    }

    #[test]
    fn every_highlight_keeps_its_exact_color() {
        // ECMA-376 Part 1, 17.18.40: darkYellow is 808000 and lightGray is C0C0C0.
        let dark_yellow = marks(r#"<w:rPr><w:highlight w:val="darkYellow"/></w:rPr>"#);
        assert_eq!(dark_yellow.highlight.as_deref(), Some("#808000"));
        let light_gray = marks(r#"<w:rPr><w:highlight w:val="lightGray"/></w:rPr>"#);
        assert_eq!(light_gray.highlight.as_deref(), Some("#c0c0c0"));
        assert_eq!(highlight_color("yellow").as_deref(), Some("#ffff00"));
        assert!(marks(r#"<w:rPr><w:highlight w:val="none"/></w:rPr>"#)
            .highlight
            .is_none());
    }

    #[test]
    fn sizes_spacing_and_scale_become_points() {
        let m = marks(
            r#"<w:rPr><w:sz w:val="21"/><w:spacing w:val="30"/><w:position w:val="6"/><w:w w:val="150"/></w:rPr>"#,
        );
        // 21 half-points are 10.5 points; 30 twips are 1.5 points; 6 half-points are 3 points.
        assert_eq!(m.size.as_deref(), Some("10.5"));
        assert_eq!(m.tracking.as_deref(), Some("1.5"));
        assert_eq!(m.shift.as_deref(), Some("3"));
        assert_eq!(m.scale.as_deref(), Some("150"));
    }

    #[test]
    fn a_run_gets_only_the_marks_its_style_does_not_give() {
        let style = marks(r#"<w:rPr><w:b/><w:sz w:val="28"/></w:rPr>"#);
        let run = marks(r#"<w:rPr><w:b/><w:i/><w:sz w:val="28"/></w:rPr>"#);
        let over = over_style(run, &style);
        assert!(!over.marks.strong && over.marks.emphasis && over.marks.size.is_none());
        assert_eq!((over.off, over.lost), (0, false));
        let plain = marks(r#"<w:rPr><w:sz w:val="28"/></w:rPr>"#);
        let over = over_style(plain, &style);
        assert_eq!(
            over.off, OFF_BOLD,
            "a run that is not bold in a bold style turns bold off"
        );
        assert_eq!(plain_style_name(OFF_BOLD | OFF_ITALIC), "u-plain-bi");
    }

    #[test]
    fn ligature_values_turn_the_default_ligatures_off() {
        let otf = |value: &str| marks(&format!(r#"<w:rPr><w14:ligatures w14:val="{value}"/></w:rPr>"#)).otf;
        // [MS-DOCX] 2.6.1.3: the value lists the kinds that are on.
        assert_eq!(otf("none").as_deref(), Some("clig-none liga-none"));
        assert_eq!(otf("standard").as_deref(), Some("clig-none"));
        assert_eq!(otf("standardContextual"), None, "the defaults are on");
        assert_eq!(otf("all").as_deref(), Some("dlig hlig"));
        assert_eq!(otf("contextualHistorical").as_deref(), Some("hlig liga-none"));
    }

    #[test]
    fn rtl_off_is_left_to_right() {
        assert_eq!(
            marks(r#"<w:rPr><w:rtl w:val="0"/></w:rPr>"#).dir.as_deref(),
            Some("ltr")
        );
        assert_eq!(marks(r#"<w:rPr><w:rtl/></w:rPr>"#).dir.as_deref(), Some("rtl"));
        assert_eq!(marks("<w:rPr/>").dir, None);
    }
}
