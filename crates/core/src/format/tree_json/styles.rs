//! The `styles` object of `notebook.json` (spec 4.1): how a notebook shows each named style.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{expect_object, fixed_value, geometry, write_document, Fields, Json, Obj};
use crate::format::page_json::text_v2::{self, boolean, color, one_of, points, token, whole, Check};
use crate::format::page_json::values::{
    is_font_name, is_hex, is_number, is_style_name, is_v1_color, Step, THEME_COLORS,
};
use crate::limits::Limits;
use crate::model::{
    Color, JsonMap, LineRule, NotebookStyles, ParaFormat, Spacing, StyleFormat, StyleSpec, StyleType, TextFormatting,
    Theme, Warning, STYLES_CHANGED, STYLE_NAMES,
};
use crate::time::Timestamp;

/// The underline values of a style: `none`, or a style of Appendix D.5.
const STYLE_UNDERLINES: [&str; 18] = [
    "none",
    "single",
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

/// The paragraph keys a style may hold (`R-STY-1`).
const STYLE_PARA_KEYS: [&str; 15] = [
    "align",
    "indent",
    "before",
    "after",
    "line",
    "contextual",
    "keepNext",
    "keepLines",
    "widows",
    "tabs",
    "border",
    "shade",
    "outline",
    "dir",
    "lang",
];

/// Reads `styles`. Style names and keys a version 1 reader doesn't know are kept (spec 2.9).
pub(super) fn read_styles(value: Value, warnings: &mut Vec<Warning>) -> Result<NotebookStyles, FormatError> {
    let map = expect_object(value, "notebook.styles")?;
    let styles = map
        .into_iter()
        .map(|(name, style)| {
            let style = read_style(style, &format!("notebook.styles.{name}"))?;
            Ok((name, style))
        })
        .collect::<Result<NotebookStyles, FormatError>>()?;
    let mut problems = Vec::new();
    for (name, style) in &styles {
        style_format(style, &format!("styles.{name}"), &mut problems);
    }
    warnings.extend(problems.into_iter().map(|p| Warning::new("styles.invalid", p)));
    Ok(styles)
}

/// Reads one style. Each number is rounded as [`write_style`] writes it (sizes and spacing to 0.01, the line
/// height to two decimals). A style in memory is then the style its bytes read back as, whether it came from
/// the file or from an edit. [`crate::store::notebook_store::NotebookStore::set_notebook_styles`] compares the
/// two to tell a change from a repeat.
pub(crate) fn read_style(value: Value, context: &str) -> Result<StyleSpec, FormatError> {
    let mut fields = Fields::new(value, context)?;
    // A color version 1 can't hold, such as a theme color, reads as missing, and is kept (R-COL-1, R-STY-2).
    let raw_color = fields.take("color");
    let color = match &raw_color {
        Some(Value::String(text)) => Color::parse(text).ok(),
        _ => None,
    };
    let mut style = StyleSpec {
        font: fields.opt_str("font")?,
        size: fields.opt_geometry("size")?,
        color: color.clone(),
        space_before: fields.opt_geometry("spaceBefore")?,
        space_after: fields.opt_geometry("spaceAfter")?,
        line_height: fields.opt_f64("lineHeight")?.map(|v| fixed_value(v, 2)),
        extra: fields.rest(),
    };
    if let (Some(raw), None) = (raw_color, color) {
        style.extra.insert("color".to_owned(), raw);
    }
    Ok(style)
}

/// Writes `styles`: the names of version 1 in the order of the spec, then the others in code point order.
pub(super) fn write_styles(styles: &NotebookStyles) -> Json<'_> {
    let known = STYLE_NAMES.iter().filter_map(|name| styles.get_key_value(*name));
    let unknown = styles.iter().filter(|(name, _)| !STYLE_NAMES.contains(&name.as_str()));
    Json::keyed(
        known
            .chain(unknown)
            .map(|(name, style)| (name.clone(), write_style(style))),
    )
}

fn write_style(style: &StyleSpec) -> Json<'_> {
    let mut obj = Obj::new();
    obj.opt("font", style.font.as_deref().map(Json::str))
        .opt("size", style.size.map(Json::Geometry))
        .opt("color", style.color.as_ref().map(|c| Json::string(c.to_text())))
        .opt("spaceBefore", style.space_before.map(Json::Geometry))
        .opt("spaceAfter", style.space_after.map(Json::Geometry))
        .opt("lineHeight", style.line_height.map(|v| Json::Fixed(v, 2)));
    obj.finish(&style.extra)
}

/// The version 2 keys of a style object (`R-STY-1`), read from its unknown keys. A key whose value is invalid
/// reads as missing and is reported as a problem (`R-NUM-1`); the JSON keeps it.
pub fn style_format(style: &StyleSpec, path: &str, problems: &mut Vec<String>) -> StyleFormat {
    let map = &style.extra;
    let mut c = Check::new(problems);
    let name = |v: &Value| v.as_str().filter(|n| is_style_name(n)).map(str::to_owned);
    let flag = "true or false";
    let format = StyleFormat {
        kind: c.key(map, path, "type", "paragraph or character", token::<StyleType>),
        label: c.key(map, path, "label", "1 to 60 characters", |v| {
            v.as_str()
                .filter(|l| (1..=60).contains(&l.chars().count()))
                .map(str::to_owned)
        }),
        based_on: c.key(map, path, "basedOn", "a style name", name),
        next: c.key(map, path, "next", "a style name", name),
        order: c.key(map, path, "order", "a whole number from 0 to 9999", whole(0, 9_999)),
        hidden: c.key(map, path, "hidden", flag, boolean),
        size_pt: c.key(
            map,
            path,
            "sizePt",
            "points from 1 to 1638, step 0.5",
            points(1.0, 1638.0, Step::Half),
        ),
        weight: c.key(map, path, "weight", "100 to 900, step 100", |v| {
            v.as_f64()
                .filter(|w| is_number(*w, 100.0, 900.0, Step::Hundred))
                .map(|w| w as u32)
        }),
        italic: c.key(map, path, "italic", flag, boolean),
        underline: c.key(
            map,
            path,
            "underline",
            "an underline style or none",
            one_of(&STYLE_UNDERLINES),
        ),
        strike: c.key(
            map,
            path,
            "strike",
            "single, double, or none",
            one_of(&["single", "double", "none"]),
        ),
        caps: c.key(
            map,
            path,
            "caps",
            "small, all, or none",
            one_of(&["small", "all", "none"]),
        ),
        tracking: c.key(
            map,
            path,
            "tracking",
            "points from -1584 to 1584, step 0.05",
            points(-1584.0, 1584.0, Step::Twentieth),
        ),
        text_color: c.key(map, path, "textColor", "a color", color),
        highlight: c.key(map, path, "highlight", "a color or none", |v| {
            (v.as_str() == Some("none"))
                .then(|| "none".to_owned())
                .or_else(|| color(v))
        }),
        list: c.key(map, path, "list", "{id, level 1 to 9}", |v| {
            let map = v.as_object()?;
            let id = map.get("id")?.as_str().filter(|id| {
                (1..=16).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })?;
            let level = whole(1, 9)(map.get("level")?)?;
            Some((id.to_owned(), u8::try_from(level).ok()?))
        }),
        para: {
            // A style holds the paragraph keys of `data.paras` except those that only an element has.
            let only: JsonMap = map
                .iter()
                .filter(|(k, _)| STYLE_PARA_KEYS.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let mut out = TextFormatting::default();
            let para = text_v2::para(&only, path, &Limits::default(), &mut out);
            problems.extend(out.problems);
            problems.extend(out.over_limits);
            ParaFormat {
                extra: JsonMap::new(),
                ..para
            }
        },
    };
    check_v1_keys(style, &format, path, problems);
    format
}

/// `R-STY-2`: a version 1 key that says what a valid version 2 key says must hold the value version 1 can hold.
fn check_v1_keys(style: &StyleSpec, format: &StyleFormat, path: &str, problems: &mut Vec<String>) {
    if let Some(size_pt) = format.size_pt {
        let size = geometry(size_pt * 4.0 / 3.0);
        if style.size != Some(size) {
            problems.push(format!(
                "{path}.size: {size:.1}, the value of sizePt in page units (R-STY-2)"
            ));
        }
    }
    if style.extra.get("color").is_some() {
        problems.push(format!(
            "{path}.color: a pen name, a highlighter name, or #rrggbb (R-COL-1)"
        ));
    }
}

/// The version 1 keys of a style that a version 2 key decides, as a writer writes them (`R-STY-2`): `size` from
/// `sizePt`, `color` from `textColor`, `spaceBefore` and `spaceAfter` from `before` and `after`, and
/// `lineHeight` from `line`. A version 1 key whose value version 1 can't hold is left out.
pub fn with_v1_keys(style: &StyleSpec) -> StyleSpec {
    let mut problems = Vec::new();
    let format = style_format(style, "style", &mut problems);
    let mut out = style.clone();
    if let Some(size_pt) = format.size_pt {
        out.size = Some(geometry(size_pt * 4.0 / 3.0));
    }
    if let Some(text_color) = &format.text_color {
        out.color = Color::parse(text_color).ok().filter(|_| is_v1_color(text_color));
    }
    let space = |spacing: Option<Spacing>, old: Option<f64>| match spacing {
        Some(Spacing::Points(p)) => Some(geometry(p * 4.0 / 3.0)),
        Some(Spacing::Auto) => None,
        None => old,
    };
    out.space_before = space(format.para.before, style.space_before);
    out.space_after = space(format.para.after, style.space_after);
    if let Some(line) = format.para.line {
        out.line_height =
            (line.rule == LineRule::Multiple && (0.5..=10.0).contains(&line.value)).then(|| fixed_value(line.value, 2));
    }
    out
}

/// A theme (`R-THM-1`), with the problems of its values.
pub fn read_theme(value: &Value, path: &str, problems: &mut Vec<String>) -> Theme {
    let mut theme = Theme::default();
    let Some(map) = value.as_object() else {
        problems.push(format!("{path}: an object"));
        return theme;
    };
    if let Some(fonts) = map.get("fonts").and_then(Value::as_object) {
        let mut c = Check::new(problems);
        let font = |v: &Value| {
            v.as_str()
                .filter(|f| is_font_name(f) && !f.starts_with('+'))
                .map(str::to_owned)
        };
        let fpath = format!("{path}.fonts");
        theme.fonts.heading = c.key(fonts, &fpath, "heading", "a font name", font);
        theme.fonts.body = c.key(fonts, &fpath, "body", "a font name", font);
        theme.fonts.mono = c.key(fonts, &fpath, "mono", "a font name", font);
    }
    if let Some(colors) = map.get("colors").and_then(Value::as_object) {
        for (name, value) in colors {
            match value.as_str().filter(|c| is_hex(c)) {
                Some(hex) if THEME_COLORS.contains(&name.as_str()) => {
                    theme.colors.insert(name.clone(), hex.to_owned());
                }
                _ => problems.push(format!("{path}.colors.{name}: #rrggbb under a theme color name")),
            }
        }
    }
    theme
}

/// `stylesChanged` (`R-STY-9`): when each style last changed. A value that is not a timestamp reads as missing.
pub fn styles_changed(extra: &JsonMap) -> BTreeMap<String, Timestamp> {
    extra
        .get(STYLES_CHANGED)
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(name, time)| Some((name.clone(), Timestamp::parse(time.as_str()?).ok()?)))
                .collect()
        })
        .unwrap_or_default()
}

/// Sets `stylesChanged` to `now` for every style that differs between `before` and `after`, and keeps the
/// times of the styles that `after` still has, so the map holds at most as many names as `styles` (`R-STY-9`).
pub fn touch_styles_changed(extra: &mut JsonMap, before: &NotebookStyles, after: &NotebookStyles, now: Timestamp) {
    let mut times: JsonMap = extra
        .get(STYLES_CHANGED)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for name in before.keys().chain(after.keys()) {
        if before.get(name) != after.get(name) {
            times.insert(name.clone(), Value::from(now.to_rfc3339()));
        }
    }
    times.retain(|name, _| after.contains_key(name));
    if times.is_empty() {
        extra.remove(STYLES_CHANGED);
    } else {
        extra.insert(STYLES_CHANGED.to_owned(), Value::Object(times));
    }
}

/// A style's canonical JSON in compact form, which breaks ties when two copies merge (`R-STY-9`).
fn compact(style: &StyleSpec) -> String {
    let bytes = write_document(&write_style(style));
    serde_json::from_slice::<Value>(&bytes)
        .map(|value| value.to_string())
        .unwrap_or_default()
}

/// Merges two copies of a notebook's `styles` style by style (`R-STY-9`). The result has every name of both
/// copies. A style that differs comes from the copy with the later `stylesChanged` time, and a missing time is
/// earlier than any. When the times are equal, the style whose compact canonical JSON is greater wins. The
/// merged times keep the later time of each name.
pub fn merge_styles(
    (ours, our_times): (&NotebookStyles, &JsonMap),
    (theirs, their_times): (&NotebookStyles, &JsonMap),
) -> (NotebookStyles, JsonMap) {
    let time = |times: &JsonMap, name: &str| {
        times
            .get(STYLES_CHANGED)
            .and_then(|t| t.get(name))
            .and_then(Value::as_str)
            .and_then(|t| Timestamp::parse(t).ok())
    };
    let mut styles = NotebookStyles::new();
    for name in ours.keys().chain(theirs.keys()) {
        let chosen = match (ours.get(name), theirs.get(name)) {
            (Some(a), Some(b)) if a != b => match time(our_times, name).cmp(&time(their_times, name)) {
                Ordering::Greater => a,
                Ordering::Less => b,
                Ordering::Equal if compact(b) > compact(a) => b,
                Ordering::Equal => a,
            },
            (Some(a), _) => a,
            (None, Some(b)) => b,
            (None, None) => continue,
        };
        styles.insert(name.clone(), chosen.clone());
    }
    let mut times = JsonMap::new();
    let names = [our_times, their_times]
        .iter()
        .filter_map(|t| t.get(STYLES_CHANGED).and_then(Value::as_object))
        .flat_map(|map| map.keys().cloned())
        .collect::<std::collections::BTreeSet<_>>();
    for name in names {
        let later = [our_times, their_times]
            .iter()
            .filter_map(|t| t.get(STYLES_CHANGED)?.get(&name)?.as_str())
            .max()
            .map(str::to_owned);
        if let Some(later) = later {
            times.insert(name, Value::from(later));
        }
    }
    (styles, times)
}

/// A style and the styles it is based on, toward the root (`R-STY-4`): it stops at a name already seen, at a
/// name that is not defined, and after 16 steps. A paragraph style other than `normal` with no `basedOn` is
/// based on `normal`, and a style is based only on a style of its own type.
pub fn style_chain(styles: &NotebookStyles, name: &str) -> Vec<String> {
    let kind = |style: &StyleSpec| {
        style
            .extra
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("paragraph")
            .to_owned()
    };
    let mut chain: Vec<String> = Vec::new();
    let mut name = Some(name.to_owned());
    while let Some(current) = name {
        let Some(style) = styles.get(&current) else { break };
        if chain.contains(&current) || chain.len() > 16 {
            break;
        }
        chain.push(current.clone());
        let mut parent = style.extra.get("basedOn").and_then(Value::as_str).map(str::to_owned);
        if parent.is_none() && current != "normal" && kind(style) == "paragraph" {
            parent = Some("normal".to_owned());
        }
        if parent
            .as_ref()
            .and_then(|p| styles.get(p))
            .is_some_and(|p| kind(p) != kind(style))
        {
            break;
        }
        name = parent;
    }
    chain
}

#[cfg(test)]
mod tests;
