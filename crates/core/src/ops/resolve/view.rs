//! A page's view settings (spec 5.4) to and from JSON, for `setPage`.
//!
//! Values equal to their defaults are left out, as `page.json` leaves them out, and a missing value reads as
//! its default.

use serde_json::Value;

use crate::id::Id;
use crate::limits::Limits;
use crate::model::{Background, Color, JsonMap, PageView, Paper};
use crate::ops::merge_patch::view::fields::{number, Fields, Out};

const VIEW_KEYS: &[&str] = &["layout", "mode", "paper", "background", "contentWidth"];
const PAPER_KEYS: &[&str] = &["size", "orientation", "width", "height", "margins"];
const BACKGROUND_KEYS: &[&str] = &["pattern", "spacing", "color", "marginLine", "template"];

/// The view as `page.json` writes it.
pub fn view_to_json(view: &PageView) -> Value {
    let defaults = PageView::default();
    let mut out = Out::new(&view.extra);
    out.put_if(view.layout != defaults.layout, "layout", || {
        Value::from(view.layout.as_str())
    });
    out.put_if(view.mode != defaults.mode, "mode", || Value::from(view.mode.as_str()));
    let paper = paper_to_json(&view.paper);
    out.put_if(!paper.is_empty(), "paper", || Value::Object(paper));
    let background = background_to_json(&view.background);
    out.put_if(!background.is_empty(), "background", || Value::Object(background));
    if let Some(width) = view.content_width {
        out.put("contentWidth", number(width));
    }
    Value::Object(out.done())
}

fn paper_to_json(paper: &Paper) -> JsonMap {
    let defaults = Paper::default();
    let mut out = Out::new(&paper.extra);
    out.put_if(paper.size != defaults.size, "size", || Value::from(paper.size.as_str()));
    let turned = paper.orientation != defaults.orientation;
    out.put_if(turned, "orientation", || Value::from(paper.orientation.as_str()));
    out.put_if(paper.width != defaults.width, "width", || number(paper.width));
    out.put_if(paper.height != defaults.height, "height", || number(paper.height));
    out.put_if(paper.margins != defaults.margins, "margins", || {
        Value::Array(paper.margins.iter().map(|m| number(*m)).collect())
    });
    out.done()
}

fn background_to_json(background: &Background) -> JsonMap {
    let defaults = Background::default();
    let mut out = Out::new(&background.extra);
    let b = background;
    out.put_if(b.pattern != defaults.pattern, "pattern", || {
        Value::from(b.pattern.as_str())
    });
    out.put_if(b.spacing != defaults.spacing, "spacing", || number(b.spacing));
    out.put_if(b.color != defaults.color, "color", || Value::from(b.color.to_text()));
    out.put_if(b.margin_line, "marginLine", || Value::Bool(true));
    if let Some(template) = b.template {
        out.put("template", template.to_string());
    }
    out.done()
}

/// Reads a view, checking each size against the limits.
pub fn view_from_json(value: &Value, limits: &Limits) -> Result<PageView, String> {
    let map = value.as_object().ok_or("the view must be an object")?;
    let f = Fields::new(map, "view", VIEW_KEYS);
    let paper = f.object("paper")?.map(|p| paper_from_json(p, limits)).transpose()?;
    let background = f
        .object("background")?
        .map(|b| background_from_json(b, limits))
        .transpose()?;
    let content_width = f.number("contentWidth")?;
    if content_width.is_some_and(|w| !size_ok(w, limits)) {
        return Err("view.contentWidth must be positive and within the limit".to_owned());
    }
    Ok(PageView {
        layout: f.named("layout")?,
        mode: f.named("mode")?,
        paper: paper.unwrap_or_default(),
        background: background.unwrap_or_default(),
        content_width,
        extra: f.extra(),
    })
}

fn size_ok(value: f64, limits: &Limits) -> bool {
    value > 0.0 && value <= limits.geometry_abs
}

fn paper_from_json(map: &JsonMap, limits: &Limits) -> Result<Paper, String> {
    let f = Fields::new(map, "paper", PAPER_KEYS);
    let defaults = Paper::default();
    let width = f.number("width")?.unwrap_or(defaults.width);
    let height = f.number("height")?.unwrap_or(defaults.height);
    if !size_ok(width, limits) || !size_ok(height, limits) {
        return Err("the paper size must be positive and within the limit".to_owned());
    }
    let margins = match f.array("margins")? {
        [] if !map.contains_key("margins") => defaults.margins,
        [top, right, bottom, left] => {
            let read = |v: &Value| v.as_f64().filter(|m| m.is_finite() && m.abs() <= limits.geometry_abs);
            let all = [top, right, bottom, left].map(read);
            match all {
                [Some(t), Some(r), Some(b), Some(l)] => [t, r, b, l],
                _ => return Err("paper.margins must hold finite numbers within the limit".to_owned()),
            }
        }
        _ => return Err("paper.margins must hold 4 numbers".to_owned()),
    };
    Ok(Paper {
        size: f.named("size")?,
        orientation: f.named("orientation")?,
        width,
        height,
        margins,
        extra: f.extra(),
    })
}

fn background_from_json(map: &JsonMap, limits: &Limits) -> Result<Background, String> {
    let f = Fields::new(map, "background", BACKGROUND_KEYS);
    let defaults = Background::default();
    let spacing = f.number("spacing")?.unwrap_or(defaults.spacing);
    if !size_ok(spacing, limits) {
        return Err("background.spacing must be positive and within the limit".to_owned());
    }
    let color = match f.str("color")? {
        None => defaults.color,
        Some(text) => Color::parse(text).map_err(|e| e.to_string())?,
    };
    Ok(Background {
        pattern: f.named("pattern")?,
        spacing,
        color,
        margin_line: f.flag("marginLine")?,
        template: f.id::<Id>("template")?,
        extra: f.extra(),
    })
}
