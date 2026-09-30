//! Requests for the stroke, page, and asset edits.

use super::{editable, pick, Ctx};
use crate::format::names::asset_file_name;
use crate::id::{AssetId, StrokeId};
use crate::model::{Asset, JsonMap, NamedValue, Pattern, ViewMode};
use crate::ops::apply::checks::asset_user;
use crate::ops::resolve::view::view_to_json;
use crate::ops::resolve::{Edit, StyleEdit};
use crate::testing::edits::{AbstractEdit, Action};
use crate::time::Timestamp;

/// The request for a stroke, page, or asset edit, or `None` if it has no valid target.
pub(super) fn action(c: &Ctx<'_>, edit: &AbstractEdit) -> Option<Action> {
    match edit {
        AbstractEdit::EraseStrokes { stroke, count } => {
            let strokes = strokes(c, *stroke, *count)?;
            c.one(Edit::RemoveStrokes { strokes })
        }
        AbstractEdit::TransformStrokes {
            stroke,
            count,
            dx,
            dy,
            scale,
        } => {
            let s = 0.5 + f64::from(*scale) / 128.0;
            let matrix = [s, 0.0, 0.0, s, f64::from(*dx), f64::from(*dy)];
            let strokes = strokes(c, *stroke, *count)?;
            c.one(Edit::TransformStrokes { strokes, matrix })
        }
        AbstractEdit::RestyleStrokes {
            stroke,
            count,
            palette,
            width,
        } => {
            let style = StyleEdit {
                palette: Some(*palette),
                width: Some(0.5 + f32::from(*width) / 8.0),
                ..StyleEdit::default()
            };
            let strokes = strokes(c, *stroke, *count)?;
            c.one(Edit::RestyleStrokes { strokes, style })
        }
        AbstractEdit::MoveStrokes { stroke, count, block } => {
            let block = pick(&super::ink_blocks(c.page), *block)?;
            let strokes = strokes(c, *stroke, *count)?;
            c.one(Edit::MoveStrokesToBlock { strokes, block })
        }
        _ => page_action(c, edit),
    }
}

/// Up to 4 strokes from the `first`, by ID order, in blocks that aren't locked.
fn strokes(c: &Ctx<'_>, first: usize, count: usize) -> Option<Vec<StrokeId>> {
    let live: Vec<StrokeId> = c
        .page
        .ink
        .strokes()
        .filter(|s| c.page.blocks.get(s.block).is_some_and(|b| editable(b)))
        .map(|s| s.id)
        .collect();
    let start = first.checked_rem(live.len())?;
    Some(
        live.iter()
            .cycle()
            .skip(start)
            .take((count % 4 + 1).min(live.len()))
            .copied()
            .collect(),
    )
}

fn page_action(c: &Ctx<'_>, edit: &AbstractEdit) -> Option<Action> {
    let set_page = |title, tags, view, reading_order| Edit::SetPage {
        title,
        tags,
        view,
        reading_order,
    };
    match edit {
        AbstractEdit::SetTitle { title } => c.one(set_page(Some(title.clone()), None, None, None)),
        AbstractEdit::SetTags { tags } => c.one(set_page(None, Some(tags.clone()), None, None)),
        AbstractEdit::SetView {
            pattern,
            paginated,
            spacing,
        } => {
            let mut view = c.page.view.clone();
            view.background.pattern = pick(Pattern::ALL, usize::from(*pattern))?.into();
            view.background.spacing = 10.0 + f64::from(*spacing);
            view.mode = if *paginated {
                ViewMode::Paginated
            } else {
                ViewMode::Infinite
            }
            .into();
            c.one(set_page(None, None, Some(view_to_json(&view)), None))
        }
        AbstractEdit::SetReadingOrder { blocks } => {
            let all: Vec<_> = c.page.blocks.iter().map(|b| b.id).collect();
            let order = blocks.iter().filter_map(|&i| pick(&all, i)).collect();
            c.one(set_page(None, None, None, Some(order)))
        }
        AbstractEdit::AddAsset { name, salt } => add_asset(c, name, *salt),
        AbstractEdit::RemoveAsset { asset } => {
            let unused: Vec<AssetId> = c
                .page
                .assets
                .keys()
                .copied()
                .filter(|id| asset_user(c.page, *id).is_none())
                .collect();
            c.one(Edit::RemoveAsset {
                asset: pick(&unused, *asset)?,
            })
        }
        _ => None,
    }
}

fn add_asset(c: &Ctx<'_>, name: &str, salt: u64) -> Option<Action> {
    let id = AssetId(c.fresh(salt, |id| c.page.assets.contains_key(&AssetId(id))));
    let mut sha256 = [0u8; 32];
    sha256[..8].copy_from_slice(&salt.to_le_bytes());
    let asset = Asset {
        id,
        file: asset_file_name(id, name, "image/png"),
        mime: "image/png".to_owned(),
        bytes: salt % 1_000_000,
        sha256,
        name: name.to_owned(),
        width: Some(640),
        height: Some(480),
        created: Timestamp::from_unix_ms(1_800_000_000_000 + c.seq as i64),
        extra: JsonMap::new(),
    };
    let request = c.request(vec![Edit::AddAsset { asset: id }], None);
    Some(Action::Import { asset, request })
}
