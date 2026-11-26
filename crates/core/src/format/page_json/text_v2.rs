//! Reading the version 2 data of a text block (spec 6.8 to 6.11) into [`TextFormatting`].
//!
//! The reader never changes the JSON. A key whose value is invalid reads as missing and is reported as a
//! problem (`R-NUM-1`), so the page still opens and the value is kept. A value past a limit of spec 16, such as
//! a 65th tab stop, is reported as over the limit, which makes the page damaged.

use std::collections::HashSet;

use serde_json::Value;

use super::values::{is_color, is_font_name, is_lang, is_number, Step};
use crate::id::ElementId;
use crate::limits::Limits;
use crate::model::{
    Align, BorderLine, Direction, DropCap, DropCapMode, Indent, JsonMap, LineRule, LineSpacing, ListAlign, ListDef,
    ListLevel, ListRef, NamedValue, ParaBorders, ParaFormat, Shade, Spacing, TabAlign, TabLeader, TabStop,
    TextFormatting, TextLayout,
};

/// The keys of `data` that version 2 adds to a text block.
pub const TEXT_V2_KEYS: [&str; 6] = ["paras", "lists", "notes", "comments", "suggestions", "layout"];

const BORDER_STYLES: [&str; 15] = [
    "single",
    "double",
    "dotted",
    "dashed",
    "thick",
    "triple",
    "thinThickSmallGap",
    "thickThinSmallGap",
    "wave",
    "doubleWave",
    "dashDotStroked",
    "threeDEmboss",
    "threeDEngrave",
    "inset",
    "outset",
];
const SHADE_PATTERNS: [&str; 15] = [
    "clear",
    "solid",
    "horzStripe",
    "vertStripe",
    "reverseDiagStripe",
    "diagStripe",
    "horzCross",
    "diagCross",
    "thinHorzStripe",
    "thinVertStripe",
    "thinReverseDiagStripe",
    "thinDiagStripe",
    "thinHorzCross",
    "thinDiagCross",
    "pct5",
];
const SHADE_PERCENTS: [u32; 22] = [
    10, 12, 15, 20, 25, 30, 35, 37, 40, 45, 50, 55, 60, 62, 65, 70, 75, 80, 85, 87, 90, 95,
];
const NUMBER_FORMATS: [&str; 20] = [
    "decimal",
    "decimalZero",
    "lowerLetter",
    "upperLetter",
    "lowerRoman",
    "upperRoman",
    "ordinal",
    "cardinalText",
    "ordinalText",
    "bullet",
    "none",
    "hebrew1",
    "hebrew2",
    "arabicAlpha",
    "arabicAbjad",
    "hindiNumbers",
    "thaiNumbers",
    "chineseCounting",
    "japaneseCounting",
    "koreanCounting",
];

/// Collects problems by path while a value is read.
pub struct Check<'a> {
    problems: &'a mut Vec<String>,
}

impl<'a> Check<'a> {
    /// A check that adds to `problems`.
    pub fn new(problems: &'a mut Vec<String>) -> Check<'a> {
        Check { problems }
    }

    /// Reads `map[key]` with `parse`, or reports `path.key: expected` and gives `None`.
    pub fn key<T>(
        &mut self,
        map: &JsonMap,
        path: &str,
        key: &str,
        expected: &str,
        parse: impl FnOnce(&Value) -> Option<T>,
    ) -> Option<T> {
        let value = map.get(key)?;
        let parsed = parse(value);
        if parsed.is_none() {
            self.problems.push(format!("{path}.{key}: {expected}"));
        }
        parsed
    }
}

/// Points in a range on a step (`R-NUM-1`).
pub fn points(low: f64, high: f64, step: Step) -> impl Fn(&Value) -> Option<f64> {
    move |v| v.as_f64().filter(|n| is_number(*n, low, high, step))
}

/// A whole number in a range.
pub fn whole(low: u64, high: u64) -> impl Fn(&Value) -> Option<u32> {
    move |v| {
        v.as_u64()
            .filter(|n| (low..=high).contains(n))
            .and_then(|n| u32::try_from(n).ok())
    }
}

/// A boolean.
pub fn boolean(v: &Value) -> Option<bool> {
    v.as_bool()
}

/// A name of a [`NamedValue`].
pub fn token<T: NamedValue>(v: &Value) -> Option<T> {
    v.as_str().and_then(T::from_name)
}

/// One of a list of names.
pub fn one_of<'n>(names: &'n [&'n str]) -> impl Fn(&Value) -> Option<String> + 'n {
    move |v| v.as_str().filter(|s| names.contains(s)).map(str::to_owned)
}

/// A color of Appendix D.7.
pub fn color(v: &Value) -> Option<String> {
    v.as_str().filter(|s| is_color(s)).map(str::to_owned)
}

/// A language tag of Appendix D.8.
pub fn lang(v: &Value) -> Option<String> {
    v.as_str().filter(|s| is_lang(s)).map(str::to_owned)
}

/// The keys of `map` that are not in `known`.
pub fn unknown(map: &JsonMap, known: &[&str]) -> JsonMap {
    map.iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn spacing(v: &Value) -> Option<Spacing> {
    if v.as_str() == Some("auto") {
        return Some(Spacing::Auto);
    }
    points(0.0, 1584.0, Step::Twentieth)(v).map(Spacing::Points)
}

fn indent(v: &Value) -> Option<Indent> {
    let map = v.as_object()?;
    let side = |key: &str| match map.get(key) {
        None => Some(0.0),
        Some(v) => points(-1584.0, 1584.0, Step::Twentieth)(v),
    };
    let known = ["start", "end", "first"];
    map.keys().all(|k| known.contains(&k.as_str())).then_some(())?;
    Some(Indent {
        start: side("start")?,
        end: side("end")?,
        first: side("first")?,
    })
}

fn line(v: &Value) -> Option<LineSpacing> {
    let map = v.as_object()?;
    let rule: LineRule = token(map.get("rule")?)?;
    let value = map.get("value")?;
    let value = match rule {
        LineRule::Multiple => points(0.06, 132.0, Step::Hundredth)(value)?,
        LineRule::Exact | LineRule::AtLeast => points(0.7, 1584.0, Step::Twentieth)(value)?,
    };
    Some(LineSpacing { rule, value })
}

fn tab(v: &Value) -> Option<TabStop> {
    let map = v.as_object()?;
    let pos = points(0.0, 1584.0, Step::Twentieth)(map.get("pos")?)?;
    let align = map.get("align").map_or(Some(TabAlign::Start), token)?;
    let leader = map.get("leader").map_or(Some(TabLeader::None), token)?;
    Some(TabStop { pos, align, leader })
}

/// Tab stops: sorted by `pos`, each `pos` once. The count limit is checked apart.
fn tabs(v: &Value) -> Option<Vec<TabStop>> {
    let stops = v.as_array()?.iter().map(tab).collect::<Option<Vec<_>>>()?;
    stops
        .windows(2)
        .all(|w| matches!(w, [a, b] if a.pos < b.pos))
        .then_some(stops)
}

fn border_line(v: &Value) -> Option<BorderLine> {
    let map = v.as_object()?;
    let style = one_of(&BORDER_STYLES)(map.get("style")?)?;
    let width = map
        .get("width")
        .map_or(Some(0.5), |w| points(0.25, 6.0, Step::Eighth)(w))?;
    let space = map.get("space").map_or(Some(1), |s| whole(0, 31)(s))?;
    let color = match map.get("color") {
        None => None,
        Some(c) => Some(color(c)?),
    };
    Some(BorderLine {
        style,
        width,
        space,
        color,
    })
}

fn borders(v: &Value) -> Option<ParaBorders> {
    let map = v.as_object()?;
    let side = |key: &str| map.get(key).map(border_line);
    let sides = ["top", "bottom", "start", "end", "between"];
    if !map.keys().all(|k| sides.contains(&k.as_str())) {
        return None;
    }
    let (top, bottom, start, end, between) = (side("top"), side("bottom"), side("start"), side("end"), side("between"));
    let ok = |s: &Option<Option<BorderLine>>| !matches!(s, Some(None));
    if ![&top, &bottom, &start, &end, &between].iter().all(|s| ok(s)) {
        return None;
    }
    Some(ParaBorders {
        top: top.flatten(),
        bottom: bottom.flatten(),
        start: start.flatten(),
        end: end.flatten(),
        between: between.flatten(),
    })
}

fn is_pattern(name: &str) -> bool {
    SHADE_PATTERNS.contains(&name)
        || name
            .strip_prefix("pct")
            .and_then(|n| n.parse::<u32>().ok())
            .is_some_and(|n| SHADE_PERCENTS.contains(&n) && name == format!("pct{n}"))
}

fn shade(v: &Value) -> Option<Shade> {
    let map = v.as_object()?;
    let pattern = match map.get("pattern") {
        None => "clear".to_owned(),
        Some(p) => p.as_str().filter(|p| is_pattern(p))?.to_owned(),
    };
    let fill = match map.get("fill") {
        None => None,
        Some(f) => Some(color(f)?),
    };
    let tint = match map.get("color") {
        None => None,
        Some(c) => Some(color(c)?),
    };
    Some(Shade {
        fill,
        pattern,
        color: tint,
    })
}

fn drop_cap(v: &Value) -> Option<DropCap> {
    let map = v.as_object()?;
    Some(DropCap {
        mode: token::<DropCapMode>(map.get("mode")?)?,
        lines: map.get("lines").map_or(Some(3), |l| whole(1, 10)(l))?,
        distance: map
            .get("distance")
            .map_or(Some(0.0), |d| points(0.0, 1584.0, Step::Twentieth)(d))?,
    })
}

fn is_list_id(id: &str) -> bool {
    (1..=16).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn list_ref(v: &Value) -> Option<ListRef> {
    let map = v.as_object()?;
    let id = match map.get("id") {
        None => None,
        Some(id) => Some(id.as_str().filter(|id| is_list_id(id))?.to_owned()),
    };
    Some(ListRef {
        id,
        restart: map.get("restart").map_or(Some(false), boolean)?,
    })
}

const PARA_KEYS: [&str; 19] = [
    "align",
    "indent",
    "before",
    "after",
    "contextual",
    "line",
    "keepNext",
    "keepLines",
    "breakBefore",
    "widows",
    "tabs",
    "border",
    "shade",
    "dir",
    "lang",
    "outline",
    "dropCap",
    "list",
    "hyphenate",
];

/// One entry of `paras`. A 65th tab stop is over the limit, not merely invalid.
pub fn para(map: &JsonMap, path: &str, limits: &Limits, out: &mut TextFormatting) -> ParaFormat {
    if let Some(stops) = map.get("tabs").and_then(Value::as_array) {
        if stops.len() > limits.tab_stops as usize {
            out.over_limits.push(format!(
                "{path}.tabs: {} tab stops, at most {}",
                stops.len(),
                limits.tab_stops
            ));
        }
    }
    let mut c = Check::new(&mut out.problems);
    let flag = "true or false";
    ParaFormat {
        align: c.key(
            map,
            path,
            "align",
            "start, center, end, justify, or distribute",
            token::<Align>,
        ),
        indent: c.key(
            map,
            path,
            "indent",
            "{start, end, first} in points from -1584 to 1584, step 0.05",
            indent,
        ),
        before: c.key(
            map,
            path,
            "before",
            "points from 0 to 1584, step 0.05, or \"auto\"",
            spacing,
        ),
        after: c.key(
            map,
            path,
            "after",
            "points from 0 to 1584, step 0.05, or \"auto\"",
            spacing,
        ),
        contextual: c.key(map, path, "contextual", flag, boolean),
        line: c.key(map, path, "line", "a line rule and a value in its range", line),
        keep_next: c.key(map, path, "keepNext", flag, boolean),
        keep_lines: c.key(map, path, "keepLines", flag, boolean),
        break_before: c.key(map, path, "breakBefore", flag, boolean),
        widows: c.key(map, path, "widows", flag, boolean),
        tabs: c.key(map, path, "tabs", "tab stops sorted by pos, each pos once", tabs),
        border: c.key(map, path, "border", "borders of spec 6.8", borders),
        shade: c.key(map, path, "shade", "shading of spec 6.8", shade),
        dir: c.key(map, path, "dir", "rtl or ltr", token::<Direction>),
        lang: c.key(map, path, "lang", "a language tag", lang),
        outline: c.key(map, path, "outline", "a whole number from 1 to 9", |v| {
            whole(1, 9)(v).and_then(|n| u8::try_from(n).ok())
        }),
        drop_cap: c.key(map, path, "dropCap", "a drop cap of spec 6.8", drop_cap),
        list: c.key(map, path, "list", "{id, restart} with a list ID", list_ref),
        hyphenate: c.key(map, path, "hyphenate", flag, boolean),
        extra: unknown(map, &PARA_KEYS),
    }
}

fn symbol(v: &Value) -> Option<char> {
    let text = v.as_str()?;
    let mut chars = text.chars();
    let first = chars.next()?;
    (chars.next().is_none() && !first.is_control()).then_some(first)
}

fn list_level(map: &JsonMap, path: &str, check: &mut Check<'_>) -> ListLevel {
    let pts = points(0.0, 1584.0, Step::Twentieth);
    ListLevel {
        format: check.key(map, path, "format", "an ST_NumberFormat name", one_of(&NUMBER_FORMATS)),
        text: check.key(map, path, "text", "0 to 64 characters", |v| {
            v.as_str().filter(|t| t.chars().count() <= 64).map(str::to_owned)
        }),
        start: check.key(map, path, "start", "a whole number from 0 to 32767", whole(0, 32_767)),
        indent: check.key(map, path, "indent", "points from 0 to 1584, step 0.05", &pts),
        hanging: check.key(map, path, "hanging", "points from 0 to 1584, step 0.05", &pts),
        symbol: check.key(map, path, "symbol", "one code point", symbol),
        font: check.key(map, path, "font", "a font name or token", |v| {
            v.as_str().filter(|f| is_font_name(f)).map(str::to_owned)
        }),
        align: check.key(map, path, "align", "start, center, or end", token::<ListAlign>),
        extra: unknown(
            map,
            &[
                "format", "text", "start", "indent", "hanging", "symbol", "font", "align",
            ],
        ),
    }
}

/// Reads a text block's version 2 data. Entries of `paras` that name no element of `ids` are ignored
/// (`R-PARA-2`).
pub fn read_formatting(data: &JsonMap, ids: &[ElementId], limits: &Limits) -> TextFormatting {
    let mut out = TextFormatting::default();
    read_paras(data, ids, limits, &mut out);
    read_lists(data, limits, &mut out);
    records::read_records(data, limits, &mut out);
    let mut check = Check::new(&mut out.problems);
    out.layout = check.key(data, "data", "layout", "{columns 1 to 4, gap in points, rule}", layout);
    out
}

fn layout(v: &Value) -> Option<TextLayout> {
    let map = v.as_object()?;
    Some(TextLayout {
        columns: map.get("columns").map_or(Some(1), |c| whole(1, 4)(c))?,
        gap: map
            .get("gap")
            .map_or(Some(36.0), |g| points(0.0, 1584.0, Step::Twentieth)(g))?,
        rule: map.get("rule").map_or(Some(false), boolean)?,
    })
}

fn read_paras(data: &JsonMap, ids: &[ElementId], limits: &Limits, out: &mut TextFormatting) {
    let Some(value) = data.get("paras") else { return };
    let Some(map) = value.as_object() else {
        out.problems.push("paras: a map from element IDs to objects".to_owned());
        return;
    };
    let live: HashSet<String> = ids.iter().map(ToString::to_string).collect();
    for (key, entry) in map.iter().filter(|(key, _)| live.contains(*key)) {
        let path = format!("paras.{key}");
        match (entry.as_object(), key.parse::<ElementId>()) {
            (Some(entry), Ok(id)) => {
                let parsed = para(entry, &path, limits, out);
                out.paras.insert(id, parsed);
            }
            _ => out.problems.push(format!("{path}: an object")),
        }
    }
}

fn read_lists(data: &JsonMap, limits: &Limits, out: &mut TextFormatting) {
    let Some(value) = data.get("lists") else { return };
    let Some(map) = value.as_object() else {
        out.problems
            .push("lists: a map from list IDs to definitions".to_owned());
        return;
    };
    if map.len() > limits.lists_per_block as usize {
        out.over_limits.push(format!(
            "lists: {} definitions, at most {}",
            map.len(),
            limits.lists_per_block
        ));
    }
    for (id, def) in map {
        let path = format!("lists.{id}");
        let levels = def.get("levels").and_then(Value::as_array);
        let (Some(def), Some(levels), true) = (def.as_object(), levels, is_list_id(id)) else {
            out.problems
                .push(format!("{path}: {{\"levels\": [...]}} under a list ID"));
            continue;
        };
        if levels.len() > limits.list_levels as usize {
            out.over_limits.push(format!(
                "{path}.levels: {} levels, at most {}",
                levels.len(),
                limits.list_levels
            ));
        }
        let mut check = Check::new(&mut out.problems);
        let levels = levels
            .iter()
            .enumerate()
            .filter_map(|(at, level)| {
                let lpath = format!("{path}.levels[{at}]");
                level.as_object().map(|level| list_level(level, &lpath, &mut check))
            })
            .collect();
        out.lists.insert(
            id.clone(),
            ListDef {
                levels,
                extra: unknown(def, &["levels"]),
            },
        );
    }
}

/// Removes the entries of `paras` that name no element of `ids` (`R-PARA-2`). Returns whether any went.
pub fn drop_stale_paras(data: &mut JsonMap, ids: &[ElementId]) -> bool {
    let Some(Value::Object(paras)) = data.get_mut("paras") else {
        return false;
    };
    let live: HashSet<String> = ids.iter().map(ToString::to_string).collect();
    let before = paras.len();
    paras.retain(|key, _| live.contains(key));
    let changed = paras.len() != before;
    if paras.is_empty() && changed {
        data.remove("paras");
    }
    changed
}

mod records;

#[cfg(test)]
mod tests;
