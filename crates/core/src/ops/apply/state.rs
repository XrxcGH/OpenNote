//! A transaction being applied. It keeps every change it makes to the page, so a failed check can put the
//! page back exactly. It also keeps the ink records it queues for the next save.

use std::collections::HashSet;
use std::hash::Hash;
use std::sync::Arc;

use crate::id::{AssetId, BlockId, StrokeId};
use crate::model::{Asset, Block, BlockData, InkRecord, Page, PageView, Stroke};
use crate::ops::AppliedChanges;
use crate::time::Timestamp;

/// A failed check: its name and a description for logs.
#[derive(Debug)]
pub(crate) struct Fail {
    pub check: &'static str,
    pub detail: String,
}

/// A failed check named `check`.
pub(crate) fn fail(check: &'static str, detail: impl ToString) -> Fail {
    Fail {
        check,
        detail: detail.to_string(),
    }
}

/// A value as it was before the transaction changed it.
enum Prior {
    Block(BlockId, Option<Arc<Block>>),
    Stroke(StrokeId, Option<Arc<Stroke>>),
    Asset(AssetId, Option<Asset>),
    Title(String),
    Tags(Vec<String>),
    View(Box<PageView>),
}

/// The page while a transaction applies to it.
pub(crate) struct Applying<'p> {
    pub page: &'p mut Page,
    priors: Vec<Prior>,
    records: Vec<InkRecord>,
    pub changes: AppliedChanges,
}

impl<'p> Applying<'p> {
    pub fn new(page: &'p mut Page) -> Applying<'p> {
        Applying {
            page,
            priors: Vec::new(),
            records: Vec::new(),
            changes: AppliedChanges::default(),
        }
    }

    /// Sets or removes the block with this ID.
    pub fn set_block(&mut self, id: BlockId, block: Option<Arc<Block>>) {
        let old = self.page.blocks.remove(id);
        if let Some(block) = block {
            // The ID was just removed, so the insert can't fail.
            let _ = self.page.blocks.insert(block);
        }
        self.priors.push(Prior::Block(id, old));
    }

    /// Sets or removes the live stroke with this ID. Records for the next save are queued separately.
    pub fn set_stroke(&mut self, id: StrokeId, stroke: Option<Arc<Stroke>>) {
        let old = self.page.ink.remove(id);
        if let Some(stroke) = stroke {
            self.page.ink.insert(stroke);
        }
        self.priors.push(Prior::Stroke(id, old));
    }

    /// Sets or removes an asset table entry.
    pub fn set_asset(&mut self, id: AssetId, asset: Option<Asset>) {
        let old = match asset {
            Some(asset) => self.page.assets.insert(id, asset),
            None => self.page.assets.remove(&id),
        };
        self.priors.push(Prior::Asset(id, old));
    }

    /// Sets the title.
    pub fn set_title(&mut self, title: String) {
        let old = std::mem::replace(&mut self.page.title, title);
        self.priors.push(Prior::Title(old));
    }

    /// Sets the tags.
    pub fn set_tags(&mut self, tags: Vec<String>) {
        let old = std::mem::replace(&mut self.page.tags, tags);
        self.priors.push(Prior::Tags(old));
    }

    /// Sets the view.
    pub fn set_view(&mut self, view: PageView) {
        let old = std::mem::replace(&mut self.page.view, view);
        self.priors.push(Prior::View(Box::new(old)));
    }

    /// Queues an ink record for the next save.
    pub fn record(&mut self, record: InkRecord) {
        self.records.push(record);
    }

    /// Sets the `strokeCount` of each of these ink blocks to its live strokes.
    pub fn recount(&mut self, blocks: &[BlockId]) {
        let mut seen = HashSet::new();
        for &id in blocks {
            if !seen.insert(id) {
                continue;
            }
            let count = self.page.ink.count_in_block(id);
            let Some(block) = self.page.blocks.get(id) else {
                continue;
            };
            if let BlockData::Ink(ink) = &block.data {
                if ink.stroke_count != count {
                    let mut updated = Block::clone(block);
                    if let BlockData::Ink(ink) = &mut updated.data {
                        ink.stroke_count = count;
                    }
                    self.set_block(id, Some(Arc::new(updated)));
                }
            }
        }
    }

    /// Puts back every value the transaction changed, newest first. Queued records are dropped.
    pub fn rollback(self) {
        let page = self.page;
        for prior in self.priors.into_iter().rev() {
            match prior {
                Prior::Block(id, old) => {
                    page.blocks.remove(id);
                    if let Some(old) = old {
                        let _ = page.blocks.insert(old);
                    }
                }
                Prior::Stroke(id, old) => {
                    page.ink.remove(id);
                    if let Some(old) = old {
                        page.ink.insert(old);
                    }
                }
                Prior::Asset(id, old) => {
                    match old {
                        Some(old) => page.assets.insert(id, old),
                        None => page.assets.remove(&id),
                    };
                }
                Prior::Title(old) => page.title = old,
                Prior::Tags(old) => page.tags = old,
                Prior::View(old) => page.view = *old,
            }
        }
    }

    /// Keeps the changes: queues the ink records, sets the page's `modified`, and reports what changed.
    pub fn commit(self, at: Timestamp) -> AppliedChanges {
        let page = self.page;
        for record in self.records {
            page.ink.push_pending(record);
        }
        page.modified = at;
        let mut changes = self.changes;
        dedupe(&mut changes.blocks_changed);
        changes.blocks_changed.retain(|id| page.blocks.contains(*id));
        dedupe(&mut changes.blocks_removed);
        changes.blocks_removed.retain(|id| !page.blocks.contains(*id));
        let live = |id: &StrokeId| page.ink.stroke(*id).is_some();
        dedupe(&mut changes.strokes_added);
        changes.strokes_added.retain(live);
        dedupe(&mut changes.strokes_removed);
        changes.strokes_removed.retain(|id| !live(id));
        dedupe(&mut changes.strokes_changed);
        let added: HashSet<StrokeId> = changes.strokes_added.iter().copied().collect();
        changes.strokes_changed.retain(|id| live(id) && !added.contains(id));
        dedupe(&mut changes.assets_changed);
        changes
    }
}

/// Keeps the first of each value, in order.
fn dedupe<T: Copy + Eq + Hash>(values: &mut Vec<T>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(*value));
}
