//! The `styles` object of `notebook.json` (spec 4.1): how a notebook shows each named style.

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{expect_object, fixed_value, Fields, Json, Obj};
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

/// Reads one style. Each number is rounded as [`write_style`] writes it (sizes and spacing to 0.01, the line
/// height to two decimals), so a style in memory is the style its bytes read back as, whether it came from the
/// file or from an edit: [`crate::store::notebook_store::NotebookStore::set_notebook_styles`] compares the two
/// to tell a change from a repeat.
fn read_style(value: Value, context: &str) -> Result<StyleSpec, FormatError> {
    let mut fields = Fields::new(value, context)?;
    Ok(StyleSpec {
        font: fields.opt_str("font")?,
        size: fields.opt_geometry("size")?,
        color: fields.color("color")?,
        space_before: fields.opt_geometry("spaceBefore")?,
        space_after: fields.opt_geometry("spaceAfter")?,
        line_height: fields.opt_f64("lineHeight")?.map(|v| fixed_value(v, 2)),
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
