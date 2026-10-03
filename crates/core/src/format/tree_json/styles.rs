//! The `styles` object of `notebook.json` (spec 4.1): how a notebook shows each named style.

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{expect_object, Fields, Json, Obj};
use crate::model::{NotebookStyles, StyleSpec, STYLE_NAMES};

/// Reads `styles`. Style names and keys a version 1 reader doesn't know are kept (spec 2.9).
pub(super) fn read_styles(value: Value) -> Result<NotebookStyles, FormatError> {
    let map = expect_object(value, "notebook.styles")?;
    map.into_iter()
        .map(|(name, style)| {
            let style = read_style(style, &format!("notebook.styles.{name}"))?;
            Ok((name, style))
        })
        .collect()
}

fn read_style(value: Value, context: &str) -> Result<StyleSpec, FormatError> {
    let mut fields = Fields::new(value, context)?;
    Ok(StyleSpec {
        font: fields.opt_str("font")?,
        size: fields.opt_f64("size")?,
        color: fields.color("color")?,
        space_before: fields.opt_f64("spaceBefore")?,
        space_after: fields.opt_f64("spaceAfter")?,
        line_height: fields.opt_f64("lineHeight")?,
        extra: fields.rest(),
    })
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
