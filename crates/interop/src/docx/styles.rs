//! `word/styles.xml` from the notebook's named styles and a page's own style sheet (spec 4.6), over the app's
//! own values.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use super::parts::{xml_escape, NS_W, XML_HEADER};
use super::ppr::ParaProps;
use super::rpr::{run_props, RunContext};
use crate::doc::data::{read_para, LineSpacing, Spacing};
use crate::doc::{values, Marks};

/// Styles by name, each a JSON object of the keys of spec 4.1 and 4.6.
pub type StyleSheet = BTreeMap<String, Map<String, Value>>;

/// The Word style ID of an OpenNote style name. Built-in names map to Word's built-in IDs.
pub fn style_id(name: &str) -> String {
    match name {
        "normal" => "Normal".to_owned(),
        "title" => "Title".to_owned(),
        "subtitle" => "Subtitle".to_owned(),
        "quote" => "Quote".to_owned(),
        "quote2" => "IntenseQuote".to_owned(),
        "code" => "Code".to_owned(),
        "citation" => "Citation".to_owned(),
        _ => match name.strip_prefix('h').and_then(|n| n.parse::<u8>().ok()) {
            Some(level @ 1..=9) => format!("Heading{level}"),
            _ => name.to_owned(),
        },
    }
}

/// The name Word shows for a built-in style, or `None` for a user style.
fn built_in_name(name: &str) -> Option<String> {
    Some(match name {
        "normal" => "Normal".to_owned(),
        "title" => "Title".to_owned(),
        "subtitle" => "Subtitle".to_owned(),
        "quote" => "Quote".to_owned(),
        "quote2" => "Intense Quote".to_owned(),
        "code" => "Code".to_owned(),
        "citation" => "Citation".to_owned(),
        _ => match name.strip_prefix('h').and_then(|n| n.parse::<u8>().ok()) {
            Some(level @ 1..=9) => format!("heading {level}"),
            _ => return None,
        },
    })
}

/// The app's own values of the built-in styles: what a notebook without `styles` shows.
pub fn app_styles() -> StyleSheet {
    let mut sheet = StyleSheet::new();
    let mut put = |name: &str, value: Value| {
        if let Value::Object(map) = value {
            sheet.insert(name.to_owned(), map);
        }
    };
    put("normal", json!({}));
    put(
        "title",
        json!({"font": "+heading", "sizePt": 24, "weight": 700, "before": 12, "after": 6}),
    );
    put(
        "subtitle",
        json!({"font": "+heading", "sizePt": 14, "textColor": "walnut"}),
    );
    for level in 1..=9u32 {
        let half_points = 36 - 3 * level.min(6);
        put(
            &format!("h{level}"),
            json!({
                "font": "+heading",
                "sizePt": f64::from(half_points) / 2.0,
                "weight": 700,
                "keepNext": true,
                "before": 12,
                "after": 4,
                "outline": level,
            }),
        );
    }
    let quote_border = json!({"start": {"style": "single", "width": 2.25, "space": 8, "color": "#c9c2b8"}});
    put(
        "quote",
        json!({"italic": true, "indent": {"start": 28.35}, "border": quote_border}),
    );
    put(
        "quote2",
        json!({"italic": true, "textColor": "theme:accent1", "indent": {"start": 28.35}, "border": quote_border}),
    );
    put(
        "code",
        json!({
            "font": "+mono",
            "sizePt": 10,
            "after": 0,
            "line": {"rule": "multiple", "value": 1},
            "shade": {"fill": "#f4f0ea", "pattern": "clear"},
        }),
    );
    put("citation", json!({"italic": true}));
    sheet
}

/// Version 1 keys and the version 2 keys that say the same thing.
const TWINS: [(&str, &str); 5] = [
    ("size", "sizePt"),
    ("color", "textColor"),
    ("spaceBefore", "before"),
    ("spaceAfter", "after"),
    ("lineHeight", "line"),
];

/// Lays sheets over each other: each later sheet's style takes each of its keys over the earlier one's
/// (`R-STY-7`). At most 64 styles of each sheet count (`R-STY-5`).
pub fn merge(base: StyleSheet, layers: &[&StyleSheet]) -> StyleSheet {
    let mut out = base;
    for layer in layers {
        for (name, style) in layer.iter().take(64) {
            let entry = out.entry(name.clone()).or_default();
            // A version 1 key set without its version 2 twin replaces the twin below it (`R-STY-2`).
            for (v1, v2) in TWINS {
                if style.contains_key(v1) && !style.contains_key(v2) {
                    entry.remove(v2);
                }
            }
            for (key, value) in style {
                entry.insert(key.clone(), value.clone());
            }
        }
    }
    out
}

/// A style sheet from a JSON object of styles, such as `page.json` `styles`.
pub fn sheet_from_json(value: &Value) -> StyleSheet {
    value
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, style)| Some((name.clone(), style.as_object()?.clone())))
        .collect()
}

/// The run keys of a style as marks, so they are written as runs are.
fn style_marks(style: &Map<String, Value>) -> Marks {
    let text = |key: &str| style.get(key).and_then(Value::as_str);
    let mut marks = Marks::none();
    marks.font = text("font").filter(|f| values::font_name(f)).map(str::to_owned);
    let size = style
        .get("sizePt")
        .and_then(Value::as_f64)
        .or_else(|| style.get("size").and_then(Value::as_f64).map(|units| units * 0.75));
    marks.size = size
        .filter(|s| (1.0..=1638.0).contains(s))
        .map(|s| ((s * 2.0).round() / 2.0).to_string());
    match style.get("weight").and_then(Value::as_u64) {
        Some(700) => marks.strong = true,
        Some(w @ 100..=900) if w % 100 == 0 && w != 400 => marks.weight = Some(w.to_string()),
        _ => {}
    }
    marks.emphasis = style.get("italic").and_then(Value::as_bool).unwrap_or(false);
    if let Some(line) = text("underline").filter(|u| values::UNDERLINES.contains(u)) {
        marks.underline = true;
        marks.underline_line = (line != "single").then(|| line.to_owned());
    }
    match text("strike") {
        Some("single") => marks.strike = true,
        Some("double") => {
            marks.strike = true;
            marks.strike_double = true;
        }
        _ => {}
    }
    marks.caps = text("caps")
        .filter(|c| matches!(*c, "small" | "all"))
        .map(str::to_owned);
    marks.tracking = style
        .get("tracking")
        .and_then(Value::as_f64)
        .filter(|t| *t != 0.0 && t.abs() <= 1584.0)
        .map(|t| t.to_string());
    marks.color = text("textColor")
        .or_else(|| text("color"))
        .filter(|c| values::color(c))
        .map(str::to_owned);
    marks.highlight = text("highlight").filter(|c| values::color(c)).map(str::to_owned);
    marks.lang = text("lang").filter(|l| values::lang(l)).map(str::to_owned);
    marks.dir = text("dir").filter(|d| matches!(*d, "rtl" | "ltr")).map(str::to_owned);
    marks
}

/// The paragraph keys of a style, with the version 1 keys standing in where the version 2 keys are missing
/// (`R-STY-2`).
fn style_para(style: &Map<String, Value>) -> crate::doc::data::Para {
    let mut para = read_para(style);
    // A style's own `lang` and `dir` go in its run properties.
    para.lang = None;
    para.dir = None;
    let points = |key: &str| style.get(key).and_then(Value::as_f64).map(|units| units * 0.75);
    if para.before.is_none() {
        para.before = points("spaceBefore").map(Spacing::Points);
    }
    if para.after.is_none() {
        para.after = points("spaceAfter").map(Spacing::Points);
    }
    if para.line.is_none() {
        para.line = style
            .get("lineHeight")
            .and_then(Value::as_f64)
            .filter(|v| (0.5..=10.0).contains(v))
            .map(LineSpacing::Multiple);
    }
    para
}

/// What the styles part needs besides the sheet.
pub struct StylesInput<'a> {
    /// The run context, for fonts and faces.
    pub ctx: RunContext<'a>,
    /// The list number of each list ID that a style ties to a level.
    pub list_num: &'a dyn Fn(&str) -> Option<usize>,
}

/// `word/styles.xml`.
pub fn styles_xml(sheet: &StyleSheet, input: &StylesInput<'_>) -> String {
    let mut out = format!("{XML_HEADER}<w:styles xmlns:w=\"{NS_W}\">");
    out.push_str(concat!(
        "<w:docDefaults><w:rPrDefault><w:rPr>",
        "<w:rFonts w:asciiTheme=\"minorHAnsi\" w:hAnsiTheme=\"minorHAnsi\" w:eastAsiaTheme=\"minorEastAsia\" ",
        "w:cstheme=\"minorBidi\"/>",
        "<w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/><w:lang w:val=\"en-US\"/></w:rPr></w:rPrDefault>",
        "<w:pPrDefault><w:pPr>",
        "<w:spacing w:after=\"160\" w:line=\"264\" w:lineRule=\"auto\"/>",
        "</w:pPr></w:pPrDefault></w:docDefaults>",
    ));
    let mut ordered: Vec<(&String, &Map<String, Value>)> = sheet.iter().collect();
    // Normal first, so Word finds the default before the styles based on it.
    ordered.sort_by_key(|(name, _)| name.as_str() != "normal");
    for (name, style) in ordered {
        out.push_str(&style_xml(name, style, sheet, input));
    }
    out.push_str(FIXED_STYLES);
    out.push_str("</w:styles>");
    out
}

fn style_xml(name: &str, style: &Map<String, Value>, sheet: &StyleSheet, input: &StylesInput<'_>) -> String {
    let text = |key: &str| style.get(key).and_then(Value::as_str);
    let character = text("type") == Some("character");
    let kind = if character { "character" } else { "paragraph" };
    let id = xml_escape(&style_id(name));
    let mut out = format!("<w:style w:type=\"{kind}\"");
    if name == "normal" {
        out.push_str(" w:default=\"1\"");
    }
    let shown = match built_in_name(name) {
        Some(shown) => shown,
        None => {
            out.push_str(" w:customStyle=\"1\"");
            text("label").unwrap_or(name).to_owned()
        }
    };
    out.push_str(&format!(
        " w:styleId=\"{id}\"><w:name w:val=\"{}\"/>",
        xml_escape(&shown)
    ));
    // A style is based only on a style of its own type (`R-STY-4`).
    let same_type = |other: &str| {
        sheet
            .get(other)
            .is_some_and(|s| (s.get("type").and_then(Value::as_str) == Some("character")) == character)
    };
    let based = match text("basedOn") {
        Some(base) if base != name && same_type(base) => Some(base.to_owned()),
        Some(_) => None,
        None if !character && name != "normal" => Some("normal".to_owned()),
        None => None,
    };
    if let Some(base) = based {
        out.push_str(&format!("<w:basedOn w:val=\"{}\"/>", xml_escape(&style_id(&base))));
    }
    let heading_like = name == "title" || name == "subtitle" || name.starts_with('h');
    let next = match text("next") {
        Some(next) if sheet.contains_key(next) => Some(next),
        Some(_) => None,
        None if heading_like && !character => Some("normal"),
        None => None,
    };
    if let Some(next) = next {
        out.push_str(&format!("<w:next w:val=\"{}\"/>", xml_escape(&style_id(next))));
    }
    if let Some(order) = style.get("order").and_then(Value::as_u64).filter(|o| *o <= 9_999) {
        out.push_str(&format!("<w:uiPriority w:val=\"{order}\"/>"));
    }
    if style.get("hidden").and_then(Value::as_bool) == Some(true) {
        out.push_str("<w:semiHidden/>");
    } else {
        out.push_str("<w:qFormat/>");
    }
    if !character {
        let para = style_para(style);
        let num = style.get("list").and_then(Value::as_object).and_then(|list| {
            let id = list.get("id")?.as_str()?;
            let level = list.get("level")?.as_u64().filter(|l| (1..=9).contains(l))?;
            Some(((input.list_num)(id)?, level as u32 - 1))
        });
        let props = ParaProps {
            para: Some(&para),
            num,
            ..ParaProps::default()
        };
        out.push_str(&props.xml());
    }
    out.push_str(&run_props(&style_marks(style), &input.ctx, ""));
    out.push_str("</w:style>");
    out
}

/// Styles every export has: list paragraphs, links, notes, comments, headers, and footers.
const FIXED_STYLES: &str = concat!(
    "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/>",
    "<w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:spacing w:after=\"60\"/></w:pPr></w:style>",
    "<w:style w:type=\"character\" w:styleId=\"Hyperlink\"><w:name w:val=\"Hyperlink\"/>",
    "<w:rPr><w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/></w:rPr></w:style>",
    "<w:style w:type=\"paragraph\" w:styleId=\"FootnoteText\"><w:name w:val=\"footnote text\"/>",
    "<w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>",
    "<w:rPr><w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:style>",
    "<w:style w:type=\"character\" w:styleId=\"FootnoteReference\"><w:name w:val=\"footnote reference\"/>",
    "<w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr></w:style>",
    "<w:style w:type=\"paragraph\" w:styleId=\"EndnoteText\"><w:name w:val=\"endnote text\"/>",
    "<w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>",
    "<w:rPr><w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:style>",
    "<w:style w:type=\"character\" w:styleId=\"EndnoteReference\"><w:name w:val=\"endnote reference\"/>",
    "<w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr></w:style>",
    "<w:style w:type=\"paragraph\" w:styleId=\"CommentText\"><w:name w:val=\"annotation text\"/>",
    "<w:basedOn w:val=\"Normal\"/><w:rPr><w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:style>",
    "<w:style w:type=\"character\" w:styleId=\"CommentReference\"><w:name w:val=\"annotation reference\"/>",
    "<w:rPr><w:sz w:val=\"16\"/><w:szCs w:val=\"16\"/></w:rPr></w:style>",
    "<w:style w:type=\"paragraph\" w:styleId=\"Header\"><w:name w:val=\"header\"/><w:basedOn w:val=\"Normal\"/>",
    "<w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>",
    "<w:rPr><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style>",
    "<w:style w:type=\"paragraph\" w:styleId=\"Footer\"><w:name w:val=\"footer\"/><w:basedOn w:val=\"Normal\"/>",
    "<w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>",
    "<w:rPr><w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/></w:rPr></w:style>",
);
