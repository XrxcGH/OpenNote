//! Moving the pictures an Office or OpenDocument reader found into a page's assets.
//!
//! A reader writes `Inline::Image` with a destination like `odt:Pictures/a.png` while it walks the document. After
//! the blocks are done, [`place`] loads each picture once, adds it to the page, and points the image at the asset.

use std::collections::HashMap;

use crate::assets::{is_image, is_metafile_extension, metafile_to_svg, mime_from_extension};
use crate::doc::{visit_inlines_mut, Block, Inline, Marks};
use crate::page_builder::PageBuilder;

/// Places the pictures whose destination starts with `prefix`. `load` returns a picture's bytes by its path inside
/// the file. Returns how many images were placed and how many could not be: a picture of a kind that screens
/// cannot show, or one that is missing or past the file's size budget becomes its description in brackets.
pub(super) fn place(
    blocks: &mut [Block],
    builder: &mut PageBuilder<'_>,
    prefix: &str,
    load: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
) -> (usize, usize) {
    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    let (mut placed, mut lost) = (0, 0);
    visit_inlines_mut(blocks, &mut |inlines| {
        for inline in inlines.iter_mut() {
            let Inline::Image { dest, alt } = inline else {
                continue;
            };
            let Some(target) = dest.strip_prefix(prefix).map(str::to_owned) else {
                continue;
            };
            let resolved = cache
                .entry(target.clone())
                .or_insert_with(|| picture(builder, &target, load))
                .clone();
            match resolved {
                Some(asset) => {
                    placed += 1;
                    *dest = format!("asset:{asset}");
                }
                None => {
                    lost += 1;
                    let label = if alt.is_empty() { "image" } else { alt.as_str() };
                    *inline = Inline::marked(format!("[{label}]"), Marks::none());
                }
            }
        }
    });
    (placed, lost)
}

/// Adds one picture to the page. Returns the asset ID, or `None` when it cannot be shown. A Windows metafile
/// (EMF or WMF, as Office keeps charts and clip art) is drawn into an SVG picture, and `None` means it could not be
/// read as one.
pub(super) fn picture(
    builder: &mut PageBuilder<'_>,
    path: &str,
    load: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
) -> Option<String> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let extension = name.rsplit_once('.').map_or("", |(_, ext)| ext);
    if is_metafile_extension(extension) {
        let svg = metafile_to_svg(&load(path)?)?;
        let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
        return Some(builder.add_asset(&format!("{stem}.svg"), Some("image/svg+xml"), svg).to_string());
    }
    let mime = mime_from_extension(extension);
    if !is_image(mime) {
        return None;
    }
    let bytes = load(path)?;
    Some(builder.add_asset(name, Some(mime), bytes).to_string())
}
