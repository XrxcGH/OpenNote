//! Run properties (`w:rPr`, ECMA-376 Part 1, 17.3.2): every run mark of DESIGN 2.2, in the order the schema's
//! sequence wants them.

use super::parts::xml_escape;
use super::styles::style_id;
use super::units::{color_attrs, half_points, highlight_name, twips};
use crate::doc::{size_points, Marks, Script};
use crate::palette::{color_hex, highlight_hex};

/// What run properties need beyond the marks: the faces the device has, and the theme's code font.
#[derive(Clone, Copy, Debug)]
pub struct RunContext<'a> {
    /// The full names of the faces the device lists, such as `Segoe UI Semibold`. Empty when unknown.
    pub faces: &'a [String],
    /// The font that `+mono` resolves to.
    pub mono: &'a str,
}

impl Default for RunContext<'_> {
    fn default() -> Self {
        RunContext {
            faces: &[],
            mono: super::fonts::APP_MONO,
        }
    }
}

/// The names a face of each weight goes by, after the family name. Word names a family's faces this way, such as
/// "Segoe UI Semibold" or "Segoe UI Light". The comparison ignores case.
fn weight_names(weight: u16) -> &'static [&'static str] {
    match weight {
        100 => &["Thin", "Hairline"],
        200 => &["ExtraLight", "Extra Light", "UltraLight", "Ultra Light"],
        300 => &["Light", "Semilight", "SemiLight"],
        500 => &["Medium"],
        600 => &["Semibold", "Semi Bold", "Demibold", "Demi Bold"],
        800 => &["ExtraBold", "Extra Bold", "UltraBold", "Ultra Bold"],
        900 => &["Black", "Heavy"],
        _ => &[],
    }
}

/// The device's face of `family` at `weight`, as the device spells it, when it lists one.
pub fn weight_face<'a>(family: &str, weight: u16, faces: &'a [String]) -> Option<&'a str> {
    weight_names(weight).iter().find_map(|name| {
        let wanted = format!("{family} {name}");
        faces
            .iter()
            .find(|face| face.eq_ignore_ascii_case(&wanted))
            .map(String::as_str)
    })
}

/// The family and weight of a face name such as "Segoe UI Semibold", the inverse of [`weight_face`]. `None`
/// when the name does not end in a weight's name after a family.
pub fn split_weight_face(face: &str) -> Option<(&str, u16)> {
    [100u16, 200, 300, 500, 600, 800, 900].into_iter().find_map(|weight| {
        weight_names(weight).iter().find_map(|name| {
            let cut = face.len().checked_sub(name.len() + 1)?;
            let (family, tail) = (face.get(..cut)?, face.get(cut..)?);
            (tail.starts_with(' ') && tail[1..].eq_ignore_ascii_case(name) && !family.trim().is_empty())
                .then_some((family, weight))
        })
    })
}

/// `w:rFonts` for a font name or a theme token.
pub fn fonts_xml(font: &str, mono: &str) -> String {
    match font {
        "+body" => "<w:rFonts w:asciiTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" \
                    w:eastAsiaTheme=\"minorEastAsia\" w:cstheme=\"minorBidi\"/>"
            .to_owned(),
        "+heading" => "<w:rFonts w:asciiTheme=\"majorHAnsi\" w:hAnsiTheme=\"majorHAnsi\" \
                       w:eastAsiaTheme=\"majorEastAsia\" w:cstheme=\"majorBidi\"/>"
            .to_owned(),
        "+mono" => named_fonts(mono),
        name => named_fonts(name),
    }
}

fn named_fonts(name: &str) -> String {
    let name = xml_escape(name);
    format!("<w:rFonts w:ascii=\"{name}\" w:hAnsi=\"{name}\" w:cs=\"{name}\" w:eastAsia=\"{name}\"/>")
}

/// The font a run's marks name, after a weight face replaces the family. `None` when the run names none.
fn run_font(marks: &Marks, ctx: &RunContext<'_>) -> Option<String> {
    let family = match marks.font.as_deref() {
        Some("+mono") => Some(ctx.mono),
        Some(token) if token.starts_with('+') => return Some(token.to_owned()),
        other => other,
    };
    let weight = marks.weight.as_deref().and_then(|w| w.parse::<u16>().ok());
    if let (Some(family), Some(weight)) = (family, weight) {
        if !marks.strong {
            if let Some(face) = weight_face(family, weight, ctx.faces) {
                return Some(face.to_owned());
            }
        }
    }
    family.map(str::to_owned)
}

/// The properties of a run. `change` is a `w:rPrChange` element, which goes last.
pub fn run_props(marks: &Marks, ctx: &RunContext<'_>, change: &str) -> String {
    let mut out = style_and_font(marks, ctx);
    out.push_str(&toggles(marks));
    out.push_str(&measures(marks));
    out.push_str(&decorations(marks));
    out.push_str(&script_and_language(marks));
    if let Some(otf) = &marks.otf {
        out.push_str(&open_type(otf));
    }
    out.push_str(change);
    if out.is_empty() {
        out
    } else {
        format!("<w:rPr>{out}</w:rPr>")
    }
}

/// The character style and the fonts.
fn style_and_font(marks: &Marks, ctx: &RunContext<'_>) -> String {
    let mut out = String::new();
    if let Some(style) = &marks.char_style {
        out.push_str(&format!("<w:rStyle w:val=\"{}\"/>", xml_escape(&style_id(style))));
    } else if marks.link.is_some() {
        out.push_str("<w:rStyle w:val=\"Hyperlink\"/>");
    }
    if marks.code {
        out.push_str("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/>");
    } else if let Some(font) = run_font(marks, ctx) {
        out.push_str(&fonts_xml(&font, ctx.mono));
    }
    out
}

/// Bold, italic, capitals, strikethrough, effects, and "do not check spelling", in the schema's order.
fn toggles(marks: &Marks) -> String {
    let mut out = String::new();
    let weight = marks.weight.as_deref().and_then(|w| w.parse::<u16>().ok());
    if marks.strong || weight.is_some_and(|w| w >= 600) {
        out.push_str("<w:b/><w:bCs/>");
    }
    if marks.emphasis {
        out.push_str("<w:i/><w:iCs/>");
    }
    match marks.caps.as_deref() {
        Some("all") => out.push_str("<w:caps/>"),
        Some("small") => out.push_str("<w:smallCaps/>"),
        _ => {}
    }
    match (marks.strike, marks.strike_double) {
        (true, true) => out.push_str("<w:dstrike/>"),
        (true, false) => out.push_str("<w:strike/>"),
        _ => {}
    }
    let effects: Vec<&str> = marks.effect.as_deref().map_or(Vec::new(), |e| e.split(' ').collect());
    let elements = [
        ("outline", "outline"),
        ("shadow", "shadow"),
        ("emboss", "emboss"),
        ("engrave", "imprint"),
    ];
    for (token, element) in elements {
        if effects.contains(&token) {
            out.push_str(&format!("<w:{element}/>"));
        }
    }
    if marks.lang.as_deref() == Some("zxx") {
        out.push_str("<w:noProof/>");
    }
    out
}

/// The color, spacing, width, kerning, position, and size.
fn measures(marks: &Marks) -> String {
    let mut out = String::new();
    if let Some(attrs) = marks.color.as_deref().and_then(|c| color_attrs("w:val", c)) {
        out.push_str(&format!("<w:color {attrs}/>"));
    }
    if let Some(points) = number(marks.tracking.as_deref()) {
        out.push_str(&format!("<w:spacing w:val=\"{}\"/>", twips(points)));
    }
    if let Some(percent) = marks.scale.as_deref() {
        out.push_str(&format!("<w:w w:val=\"{percent}\"/>"));
    }
    // 0 turns kerning off, which a run under a style that kerns must say; only a missing mark is left out.
    if let Some(points) = number(marks.kern.as_deref()).filter(|k| *k >= 0.0) {
        out.push_str(&format!("<w:kern w:val=\"{}\"/>", half_points(points)));
    }
    if let Some(points) = number(marks.shift.as_deref()) {
        out.push_str(&format!("<w:position w:val=\"{}\"/>", half_points(points)));
    }
    if let Some(points) = marks.size.as_deref().and_then(size_points) {
        let half = half_points(points);
        out.push_str(&format!("<w:sz w:val=\"{half}\"/><w:szCs w:val=\"{half}\"/>"));
    }
    out
}

/// The highlight, underline, box, and shading. A highlight that is not one of the 16 is drawn as shading, on top
/// of any shade.
fn decorations(marks: &Marks) -> String {
    let mut out = String::new();
    let highlight = marks.highlight.as_deref().map(highlight_props);
    if let Some(Highlight::Named(name)) = highlight {
        out.push_str(&format!("<w:highlight w:val=\"{name}\"/>"));
    }
    if marks.underline {
        out.push_str(&underline(marks));
    }
    if let Some(style) = &marks.text_box {
        let color = marks.box_color.as_deref().and_then(color_hex);
        let color = color.unwrap_or_else(|| "auto".to_owned());
        // ST_Border "thick" is a single line; 12 eighths make it 1.5 pt, so readers that go by either the
        // value or the width see a thick box.
        let size = if style == "thick" { 12 } else { 4 };
        let val = style.as_str();
        out.push_str(&format!(
            "<w:bdr w:val=\"{val}\" w:sz=\"{size}\" w:space=\"0\" w:color=\"{color}\"/>"
        ));
    }
    let fill = match highlight {
        Some(Highlight::Fill(hex)) => Some(hex),
        _ => marks.shade.as_deref().and_then(color_hex),
    };
    if let Some(fill) = fill {
        out.push_str(&format!("<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"{fill}\"/>"));
    }
    out
}

/// Subscript or superscript, the direction, and the language.
fn script_and_language(marks: &Marks) -> String {
    let mut out = String::new();
    match marks.script {
        Some(Script::Sub) => out.push_str("<w:vertAlign w:val=\"subscript\"/>"),
        Some(Script::Sup) => out.push_str("<w:vertAlign w:val=\"superscript\"/>"),
        None => {}
    }
    match marks.dir.as_deref() {
        Some("rtl") => out.push_str("<w:rtl/>"),
        Some("ltr") => out.push_str("<w:rtl w:val=\"0\"/>"),
        _ => {}
    }
    if let Some(lang) = marks.lang.as_deref().filter(|l| *l != "zxx") {
        out.push_str(&format!("<w:lang w:val=\"{}\"/>", xml_escape(lang)));
    }
    out
}

fn number(value: Option<&str>) -> Option<f64> {
    value?.parse::<f64>().ok().filter(|v| v.is_finite())
}

enum Highlight {
    /// One of the 16 `ST_HighlightColor` values.
    Named(&'static str),
    /// Any other color, drawn as shading.
    Fill(String),
}

/// How a highlight is written: one of Word's 16 names when the color is exactly one, else a shading fill. The
/// brand highlighters keep their own colors, as version 1 exports did.
fn highlight_props(color: &str) -> Highlight {
    if let Some(name) = highlight_name(color) {
        return Highlight::Named(name);
    }
    let hex = color_hex(color).unwrap_or_else(|| highlight_hex(color).to_owned());
    Highlight::Fill(hex)
}

fn underline(marks: &Marks) -> String {
    // The 17 underline styles have the names of `ST_Underline` (spec Appendix D.5).
    let val = marks.underline_line.as_deref().unwrap_or("single");
    match marks.underline_color.as_deref().and_then(|c| color_attrs("w:color", c)) {
        Some(color) => format!("<w:u w:val=\"{val}\" {color}/>"),
        None => format!("<w:u w:val=\"{val}\"/>"),
    }
}

/// The OpenType features of the `otf` mark as Word 2010's `w14` elements ([MS-DOCX] 2.6). `zero` has no Word
/// equivalent.
fn open_type(tokens: &str) -> String {
    let tokens: Vec<&str> = tokens.split(' ').collect();
    let has = |t: &str| tokens.contains(&t);
    let mut out = String::new();
    if ["liga-none", "clig-none", "dlig", "hlig"].iter().any(|t| has(t)) {
        let parts = [
            (!has("liga-none"), "standard"),
            (!has("clig-none"), "contextual"),
            (has("hlig"), "historical"),
            (has("dlig"), "discretional"),
        ];
        let on: Vec<&str> = parts.iter().filter(|(on, _)| *on).map(|(_, name)| *name).collect();
        let value = match on.len() {
            0 => "none".to_owned(),
            4 => "all".to_owned(),
            _ => camel(&on),
        };
        out.push_str(&format!("<w14:ligatures w14:val=\"{value}\"/>"));
    }
    if has("lnum") {
        out.push_str("<w14:numForm w14:val=\"lining\"/>");
    } else if has("onum") {
        out.push_str("<w14:numForm w14:val=\"oldStyle\"/>");
    }
    if has("pnum") {
        out.push_str("<w14:numSpacing w14:val=\"proportional\"/>");
    } else if has("tnum") {
        out.push_str("<w14:numSpacing w14:val=\"tabular\"/>");
    }
    let sets: Vec<&str> = tokens.iter().filter_map(|t| t.strip_prefix("ss")).collect();
    if !sets.is_empty() {
        out.push_str("<w14:stylisticSets>");
        for set in sets {
            let id = set.trim_start_matches('0');
            out.push_str(&format!("<w14:styleSet w14:id=\"{id}\"/>"));
        }
        out.push_str("</w14:stylisticSets>");
    }
    out
}

/// Joins words in camel case: `standard`, `contextual` is `standardContextual`.
fn camel(words: &[&str]) -> String {
    let mut out = String::new();
    for (i, word) in words.iter().enumerate() {
        if i == 0 {
            out.push_str(word);
        } else {
            let mut chars = word.chars();
            if let Some(first) = chars.next() {
                out.extend(first.to_uppercase());
                out.push_str(chars.as_str());
            }
        }
    }
    out
}
