//! The template of a new page (spec 4.5).

use super::TreeEnv;
use crate::id::{PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{JsonMap, Page, PageView, Revision};
use crate::seams::Codec;

/// A new, empty page with the view defaults of spec 4.5: the section's `defaults.view`, then the notebook's,
/// then the app's, field by field.
pub(crate) fn template_page(env: &TreeEnv, id: PageId, title: &str, defaults: [Option<&JsonMap>; 2]) -> Page {
    let now = env.clock.now();
    let revision = Revision::new(
        RevisionId::generate(env.clock.as_ref()),
        now,
        env.device.clone(),
        env.writer.clone(),
    );
    let mut page = Page::new(id, now, revision);
    title.clone_into(&mut page.title);
    if let Some(view) = template_view(env.codec.as_ref(), &page, defaults) {
        page.view = view;
    }
    page
}

/// Merges the default `view` objects into the page's own through the codec, so a reader reads the view
/// exactly. `None` when there are no defaults, or when the codec doesn't write JSON.
pub(crate) fn template_view(codec: &dyn Codec, page: &Page, defaults: [Option<&JsonMap>; 2]) -> Option<PageView> {
    let views: Vec<&serde_json::Value> = defaults
        .iter()
        .rev()
        .filter_map(|d| d.and_then(|d| d.get("view")))
        .collect();
    if views.is_empty() {
        return None;
    }
    let mut json: serde_json::Value = serde_json::from_slice(&codec.write_page(page)).ok()?;
    let target = json
        .as_object_mut()?
        .entry("view")
        .or_insert_with(|| serde_json::json!({}));
    for view in views {
        merge_objects(target, view);
    }
    let bytes = serde_json::to_vec(&json).ok()?;
    let mut view = codec.read_page(&bytes, &Limits::default()).ok()?.page.view;
    // A new page has no blocks yet, so it has nothing to put in a reading order.
    view.reading_order.clear();
    Some(view)
}

/// Merges `from` into `into`, object by object. Other values replace.
pub(crate) fn merge_objects(into: &mut serde_json::Value, from: &serde_json::Value) {
    let (serde_json::Value::Object(target), serde_json::Value::Object(source)) = (&mut *into, from) else {
        *into = from.clone();
        return;
    };
    for (key, value) in source {
        match target.get_mut(key) {
            Some(existing) => merge_objects(existing, value),
            None => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}
