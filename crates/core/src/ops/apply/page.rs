//! Applying the operations that change page fields and the asset table.

use super::checks::asset_user;
use super::state::{fail, Applying, Fail};
use crate::format::names::check_asset_file_name;
use crate::model::{Asset, PageView};
use crate::ops::PageFields;

/// `AddAsset`: the ID is unused and the file name is valid. The session checked that the file exists.
pub(super) fn add_asset(a: &mut Applying<'_>, asset: &Asset) -> Result<(), Fail> {
    if a.page.assets.contains_key(&asset.id) {
        return Err(fail("assetIdUnused", asset.id));
    }
    if !check_asset_file_name(asset.id, &asset.file) {
        return Err(fail("assetFileName", &asset.file));
    }
    a.set_asset(asset.id, Some(asset.clone()));
    a.changes.assets_changed.push(asset.id);
    Ok(())
}

/// `RemoveAsset`: the entry is as stored, and no block refers to it.
pub(super) fn remove_asset(a: &mut Applying<'_>, asset: &Asset) -> Result<(), Fail> {
    if a.page.assets.get(&asset.id) != Some(asset) {
        return Err(fail("assetEquals", asset.id));
    }
    if let Some(user) = asset_user(a.page, asset.id) {
        return Err(fail("assetUnused", format!("{} is used by {user}", asset.id)));
    }
    a.set_asset(asset.id, None);
    a.changes.assets_changed.push(asset.id);
    Ok(())
}

/// `SetPage`: `before` and `after` name the same fields, and the page's values equal `before`.
pub(super) fn set_page(a: &mut Applying<'_>, before: &PageFields, after: &PageFields) -> Result<(), Fail> {
    let paired = before.title.is_some() == after.title.is_some()
        && before.tags.is_some() == after.tags.is_some()
        && before.view.is_some() == after.view.is_some();
    if !paired {
        return Err(fail("fieldsPaired", "before and after name different fields"));
    }
    let page = &*a.page;
    let equal = before.title.as_ref().is_none_or(|t| *t == page.title)
        && before.tags.as_ref().is_none_or(|t| *t == page.tags)
        && before.view.as_ref().is_none_or(|v| **v == page.view);
    if !equal {
        return Err(fail("pageFieldsEqual", "the page fields differ from before"));
    }
    if let Some(title) = &after.title {
        a.set_title(title.clone());
    }
    if let Some(tags) = &after.tags {
        a.set_tags(tags.clone());
    }
    if let Some(view) = &after.view {
        a.set_view(PageView::clone(view));
    }
    a.changes.page_fields = true;
    Ok(())
}
