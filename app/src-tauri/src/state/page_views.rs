//! Per-page view state (Phase 4's change P2-9): each page reopens at its scroll, zoom, folds, view, and caret.
//! It depends on this device's screens, so it lives in the device state, trimmed to the 500 pages used most
//! recently.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::settings::validate::Check;

/// The most pages whose view state is kept.
pub const MAX_PAGE_VIEWS: usize = 500;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct PageViewState {
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub zoom: f64,
    /// Canvas or Reading, or `None` for the page's own default.
    pub view: Option<PageViewMode>,
    pub folds: Vec<FoldKey>,
    /// Remembered block heights in page units, by block id.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub heights: Option<BTreeMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub caret: Option<UiSelection>,
    /// When the page was last shown, in epoch milliseconds, for trimming.
    pub at: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PageViewMode {
    Canvas,
    Reading,
}

/// A folded heading or list item, found again by its block, its text, and which occurrence it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct FoldKey {
    pub block: String,
    #[cfg_attr(test, ts(inline))]
    pub kind: FoldKind,
    pub text: String,
    pub occurrence: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum FoldKind {
    Heading,
    Item,
}

/// Where the caret or selection was: text in a block, whole objects, or the page title.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum UiSelection {
    Text { block: String, anchor: u32, head: u32 },
    Objects { blocks: Vec<String> },
    Title { anchor: u32, head: u32 },
}

impl PageViewState {
    pub fn check(&self, check: &mut Check) {
        check.range("pageViews", self.zoom, (0.1, 10.0));
        check.that(
            "pageViews",
            self.scroll_x.is_finite() && self.scroll_y.is_finite(),
            "The scroll isn't a number.",
        );
        check.that("pageViews", self.at.is_finite(), "The time isn't a number.");
        check.that("pageViews", self.folds.len() <= 2_000, "Too many folds are remembered.");
        for fold in &self.folds {
            check.chars("pageViews", &fold.text, (0, 400));
        }
    }
}

/// Removes the least recently used pages from the raw `pageViews` object until at most `keep` remain.
pub fn trim(page_views: &mut Value, keep: usize) {
    let Value::Object(pages) = page_views else {
        return;
    };
    if pages.len() <= keep {
        return;
    }
    let mut by_age: Vec<(f64, String)> = pages
        .iter()
        .map(|(id, view)| (view.get("at").and_then(Value::as_f64).unwrap_or(0.0), id.clone()))
        .collect();
    by_age.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let excess = pages.len() - keep;
    for (_, id) in by_age.into_iter().take(excess) {
        pages.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_phase_4s_shape() {
        let view: PageViewState = serde_json::from_value(json!({
            "scrollX": 0, "scrollY": 840.5, "zoom": 1.25, "view": "reading",
            "folds": [{ "block": "b1", "kind": "heading", "text": "Cells", "occurrence": 0 }],
            "caret": { "kind": "text", "block": "b2", "anchor": 3, "head": 7 },
            "at": 1_790_845_512_000.0_f64
        }))
        .expect("parses");
        assert_eq!(view.view, Some(PageViewMode::Reading));
        assert_eq!(
            view.caret,
            Some(UiSelection::Text {
                block: "b2".into(),
                anchor: 3,
                head: 7
            })
        );
        assert_eq!(serde_json::to_value(&view).expect("serializes").get("heights"), None);
    }

    #[test]
    fn keeps_the_most_recently_used_pages() {
        let mut views = json!({ "old": { "at": 1.0 }, "new": { "at": 3.0 }, "mid": { "at": 2.0 } });
        trim(&mut views, 2);
        let mut kept: Vec<&str> = views
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        kept.sort_unstable();
        assert_eq!(kept, ["mid", "new"]);
    }
}
