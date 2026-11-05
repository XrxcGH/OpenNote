//! The `view` object of `page.json` (spec 5.4).

use serde_json::Value;

use super::text_v2::{boolean, one_of, points, whole, Check};
use super::values::Step;
use crate::error::FormatError;
use crate::format::json::{Fields, Json, Obj};
use crate::format::tree_json::styles::{read_style, read_theme, style_format};
use crate::limits::Limits;
use crate::model::{
    Background, Color, LineNumbers, Named, NamedValue, Page, PageNumbers, PageStyleSheet, PageView, Paper, TextSettings,
};

/// Reads `view`. Every field has a default.
pub fn read_view(value: Value) -> Result<PageView, FormatError> {
    let mut fields = Fields::new(value, "page.view")?;
    let defaults = PageView::default();
    let paper = match fields.take("paper") {
        Some(paper) => read_paper(paper)?,
        None => defaults.paper,
    };
    let background = match fields.take("background") {
        Some(background) => read_background(background)?,
        None => defaults.background,
    };
    Ok(PageView {
        layout: fields.named("layout")?.unwrap_or(defaults.layout),
        mode: fields.named("mode")?.unwrap_or(defaults.mode),
        content_width: fields.opt_geometry("contentWidth")?,
        reading_order: fields.ids("readingOrder")?,
        paper,
        background,
        extra: fields.rest(),
    })
}

fn read_paper(value: Value) -> Result<Paper, FormatError> {
    let mut fields = Fields::new(value, "page.view.paper")?;
    let defaults = Paper::default();
    let margins = match fields.take("margins") {
        None => defaults.margins,
        Some(Value::Array(items)) if items.len() == 4 => {
            let mut margins = [0.0; 4];
            for (slot, item) in margins.iter_mut().zip(&items) {
                *slot = fields.as_geometry("margins", item)?;
            }
            margins
        }
        Some(_) => return Err(fields.error("margins", "expected 4 numbers")),
    };
    Ok(Paper {
        size: fields.named("size")?.unwrap_or(defaults.size),
        orientation: fields.named("orientation")?.unwrap_or(defaults.orientation),
        width: fields.opt_geometry("width")?.unwrap_or(defaults.width),
        height: fields.opt_geometry("height")?.unwrap_or(defaults.height),
        margins,
        extra: fields.rest(),
    })
}

fn read_background(value: Value) -> Result<Background, FormatError> {
    let mut fields = Fields::new(value, "page.view.background")?;
    let defaults = Background::default();
    Ok(Background {
        pattern: fields.named("pattern")?.unwrap_or(defaults.pattern),
        spacing: fields.opt_geometry("spacing")?.unwrap_or(defaults.spacing),
        color: fields.color("color")?.unwrap_or(defaults.color),
        margin_line: fields.bool_or("marginLine", defaults.margin_line)?,
        template: fields.opt_id("template")?,
        extra: fields.rest(),
    })
}

/// What a reader makes of `view.text` (`R-VIEW-1` to `R-VIEW-4`). Invalid values read as missing and are
/// added to `problems`.
pub fn text_settings(view: &PageView, problems: &mut Vec<String>) -> TextSettings {
    let mut settings = TextSettings::default();
    let Some(value) = view.extra.get("text") else {
        return settings;
    };
    let Some(map) = value.as_object() else {
        problems.push("view.text: an object".to_owned());
        return settings;
    };
    let mut c = Check::new(problems);
    let path = "view.text";
    let tab = points(1.0, 1584.0, Step::Twentieth);
    if let Some(tab) = c.key(map, path, "defaultTab", "a number from 1 to 1584, step 0.05", tab) {
        settings.default_tab = tab;
    }
    settings.hyphenate = c.key(map, path, "hyphenate", "true or false", boolean).unwrap_or(false);
    settings.line_numbers = c.key(map, path, "lineNumbers", "{start, countBy, restart}", |v| {
        let m = v.as_object()?;
        Some(LineNumbers {
            start: m.get("start").map_or(Some(1), |s| whole(1, 32_767)(s))?,
            count_by: m.get("countBy").map_or(Some(1), |s| whole(1, 100)(s))?,
            restart: m
                .get("restart")
                .map_or(Some("page".to_owned()), one_of(&["page", "continuous"]))?,
        })
    });
    settings.page_numbers = c.key(map, path, "pageNumbers", "{format, start}", |v| {
        let m = v.as_object()?;
        let formats = ["decimal", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter"];
        Some(PageNumbers {
            format: m.get("format").map_or(Some("decimal".to_owned()), one_of(&formats))?,
            start: m.get("start").map_or(Some(1), |s| whole(0, 32_767)(s))?,
        })
    });
    settings
}

/// What a reader makes of a page's style sheet and theme (`R-STY-7`, `R-THM-1`). More than
/// [`Limits::styles_per_page`] styles is over the limit.
pub fn style_sheet(page: &Page, limits: &Limits) -> PageStyleSheet {
    let mut sheet = PageStyleSheet::default();
    if let Some(value) = page.extra.get("styles") {
        match value.as_object() {
            None => sheet
                .problems
                .push("styles: a map from style names to styles".to_owned()),
            Some(map) => {
                if map.len() > limits.styles_per_page as usize {
                    let count = map.len();
                    let most = limits.styles_per_page;
                    sheet
                        .over_limits
                        .push(format!("styles: {count} styles, at most {most}"));
                }
                for (name, style) in map {
                    let path = format!("styles.{name}");
                    match read_style(style.clone(), &path) {
                        Ok(spec) => {
                            let format = style_format(&spec, &path, &mut sheet.problems);
                            sheet.styles.insert(name.clone(), (spec, format));
                        }
                        Err(err) => sheet.problems.push(format!("{path}: {}", err.detail)),
                    }
                }
            }
        }
    }
    sheet.theme = page
        .extra
        .get("theme")
        .map(|theme| read_theme(theme, "theme", &mut sheet.problems));
    sheet
}

/// A known or unknown enum value as written.
pub fn named<T: NamedValue>(value: &Named<T>) -> Json<'_> {
    Json::str(value.as_str())
}

/// Writes `view`, leaving out every value that equals its default. `reading_order` is the view's reading order
/// without the IDs that name no block, and without repeats (spec 6.2).
pub fn write_view<'a>(view: &'a PageView, reading_order: &[&'a crate::id::BlockId]) -> Json<'a> {
    let defaults = PageView::default();
    let mut obj = Obj::new();
    obj.unless("layout", view.layout == defaults.layout, || named(&view.layout))
        .unless("mode", view.mode == defaults.mode, || named(&view.mode));
    let paper = write_paper(&view.paper);
    obj.unless("paper", is_empty_object(&paper), || paper);
    let background = write_background(&view.background);
    obj.unless("background", is_empty_object(&background), || background)
        .opt("contentWidth", view.content_width.map(Json::Geometry))
        .unless("readingOrder", reading_order.is_empty(), || {
            Json::strings(reading_order.iter().copied())
        });
    obj.finish(&view.extra)
}

fn is_empty_object(json: &Json<'_>) -> bool {
    matches!(json, Json::Object(fields) if fields.is_empty())
}

fn write_paper(paper: &Paper) -> Json<'_> {
    let defaults = Paper::default();
    let mut obj = Obj::new();
    obj.unless("size", paper.size == defaults.size, || named(&paper.size))
        .unless("orientation", paper.orientation == defaults.orientation, || {
            named(&paper.orientation)
        })
        .unless("width", same_geometry(paper.width, defaults.width), || {
            Json::Geometry(paper.width)
        })
        .unless("height", same_geometry(paper.height, defaults.height), || {
            Json::Geometry(paper.height)
        });
    let default_margins = paper
        .margins
        .iter()
        .zip(defaults.margins)
        .all(|(&a, b)| same_geometry(a, b));
    obj.unless("margins", default_margins, || {
        Json::Array(paper.margins.iter().map(|&m| Json::Geometry(m)).collect())
    });
    obj.finish(&paper.extra)
}

fn write_background(background: &Background) -> Json<'_> {
    let defaults = Background::default();
    let mut obj = Obj::new();
    obj.unless("pattern", background.pattern == defaults.pattern, || {
        named(&background.pattern)
    })
    .unless("spacing", same_geometry(background.spacing, defaults.spacing), || {
        Json::Geometry(background.spacing)
    })
    .unless("color", background.color == Color::Rule, || {
        Json::string(background.color.to_text())
    })
    .unless("marginLine", !background.margin_line, || Json::Bool(true))
    .opt("template", background.template.map(|id| Json::string(id.to_string())));
    obj.finish(&background.extra)
}

/// Whether two geometry values are written the same way.
fn same_geometry(a: f64, b: f64) -> bool {
    crate::format::json::fixed(a, 2) == crate::format::json::fixed(b, 2)
}
