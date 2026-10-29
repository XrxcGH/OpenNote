//! The `view` object of `page.json` (spec 5.4).

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{Fields, Json, Obj};
use crate::model::{Background, Color, Named, NamedValue, PageView, Paper};

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
