//! Resolving the edits that change page fields and the asset table: `setPage`, `addAsset`, and `removeAsset`.

use std::collections::HashSet;

use serde_json::Value;

use super::view::{view_from_json, view_to_json};
use super::{invalid, not_found, EditCtx};
use crate::error::EditError;
use crate::format::names::check_asset_file_name;
use crate::id::AssetId;
use crate::limits::Limits;
use crate::model::{Page, PageView};
use crate::ops::apply::checks::{asset_user, check_tags};
use crate::ops::merge_patch::apply_patch;
use crate::ops::{Op, PageFields};

/// The fields `setPage` asks for.
pub(super) struct PageEdit<'a> {
    pub title: Option<&'a str>,
    pub tags: Option<&'a [String]>,
    pub view: Option<&'a Value>,
}

/// `setPage`: only the fields that change, with their values before.
pub(super) fn set_page(c: &EditCtx<'_>, edit: &PageEdit<'_>) -> Result<Vec<Op>, EditError> {
    let page = c.page;
    let limits = c.ctx.limits;
    let mut before = PageFields::default();
    let mut after = PageFields::default();
    if let Some(title) = edit.title {
        if title.chars().count() as u64 > u64::from(limits.title_chars) {
            return Err(invalid("the title is too long"));
        }
        if title != page.title {
            before.title = Some(page.title.clone());
            after.title = Some(title.to_owned());
        }
    }
    if let Some(tags) = edit.tags {
        check_tags(tags, limits).map_err(invalid)?;
        if tags != page.tags.as_slice() {
            before.tags = Some(page.tags.clone());
            after.tags = Some(tags.to_vec());
        }
    }
    if let Some(patch) = edit.view {
        let mut view = patched_view(page, patch, limits)?;
        let mut seen = HashSet::new();
        view.reading_order
            .retain(|id| page.blocks.contains(*id) && seen.insert(*id));
        if view != page.view {
            before.view = Some(Box::new(page.view.clone()));
            after.view = Some(Box::new(view));
        }
    }
    if after == PageFields::default() {
        return Ok(Vec::new());
    }
    Ok(vec![Op::SetPage { before, after }])
}

/// The page's view with a merge patch (RFC 7396) applied, as `page.json` writes it: `null` puts a member back
/// to its default, objects patch the object there, and an array such as `readingOrder` replaces the old one.
fn patched_view(page: &Page, patch: &Value, limits: &Limits) -> Result<PageView, EditError> {
    let Value::Object(patch) = patch else {
        return Err(invalid("the view patch must be an object"));
    };
    let Value::Object(mut current) = view_to_json(&page.view) else {
        return Err(invalid("the view can't be written"));
    };
    apply_patch(&mut current, patch);
    view_from_json(&Value::Object(current), limits).map_err(invalid)
}

/// `addAsset`: the table entry of an asset that was already imported. An asset already in the table is left
/// as it is.
pub(super) fn add_asset(c: &EditCtx<'_>, id: AssetId) -> Result<Vec<Op>, EditError> {
    if c.page.assets.contains_key(&id) {
        return Ok(Vec::new());
    }
    let asset = (c.ctx.imported)(id).ok_or_else(|| not_found(format!("imported asset {id}")))?;
    if asset.id != id || !check_asset_file_name(id, &asset.file) {
        return Err(invalid(format!("the imported asset {id} has a bad table entry")));
    }
    Ok(vec![Op::AddAsset { asset }])
}

/// `removeAsset`: the table entry, once no block refers to the asset.
pub(super) fn remove_asset(c: &EditCtx<'_>, id: AssetId) -> Result<Vec<Op>, EditError> {
    let asset = c.page.assets.get(&id).ok_or_else(|| not_found(format!("asset {id}")))?;
    if let Some(user) = asset_user(c.page, id) {
        return Err(invalid(format!("the asset {id} is still used by block {user}")));
    }
    Ok(vec![Op::RemoveAsset { asset: asset.clone() }])
}
