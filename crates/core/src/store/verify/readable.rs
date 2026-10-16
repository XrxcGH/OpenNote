//! The second pass of the check (A2-2), once every page of the notebook is known: links in a page's text that
//! lead to no page, section, or file of the notebook, and `page.md` files that don't match their page. A `page.md`
//! that OpenNote wrote for an older revision is stale, and one changed in another app is edited; both are
//! repaired by writing it again, which keeps an edited copy aside first. A missing `page.md` is not a problem,
//! because it is written a moment after each save.

use std::collections::HashSet;
use std::path::Path;

use super::Verifier;
use crate::error::FsErrorKind;
use crate::format::markdown::{outgoing_links, LinkTarget};
use crate::format::ReadableState;
use crate::id::PageId;
use crate::model::BlockData;
use crate::store::layout::{NotebookLayout, PAGE_MD};

/// The largest `page.md` the check reads, as a save does.
const READABLE_LIMIT: u64 = 64 * 1024 * 1024;

impl Verifier<'_> {
    pub(super) fn links_and_readable(&mut self) {
        let live = std::mem::take(&mut self.live);
        let known: HashSet<PageId> = self
            .pages
            .iter()
            .filter(|(_, dir)| live.contains(dir))
            .map(|(id, _)| *id)
            .collect();
        for dir in &live {
            self.page_links_and_readable(dir, &known);
        }
    }

    fn page_links_and_readable(&mut self, dir: &Path, known: &HashSet<PageId>) {
        let path = NotebookLayout::page_json(dir);
        let Ok(bytes) = self.fs.read(&path, self.limits.page_json_bytes) else {
            return;
        };
        let Ok(read) = self.codec.read_page(&bytes, self.limits) else {
            return;
        };
        let page = read.page;
        if page.encryption.is_some() {
            return;
        }
        for block in page.blocks.iter() {
            let BlockData::Text(text) = &block.data else {
                continue;
            };
            for target in outgoing_links(&text.markdown) {
                let broken = match &target {
                    LinkTarget::Page { page: to, .. } => (!known.contains(to)).then(|| format!("page {to}")),
                    LinkTarget::Section(to) => (!self.sections.contains_key(to)).then(|| format!("section {to}")),
                    LinkTarget::Asset(asset) => (!page.assets.contains_key(asset)).then(|| format!("file {asset}")),
                    _ => None,
                };
                if let Some(detail) = broken {
                    self.problem(&path, "link.broken", detail);
                }
            }
        }
        let md = dir.join(PAGE_MD);
        let existing = match self.fs.read(&md, READABLE_LIMIT) {
            Ok(existing) => existing,
            Err(err) if matches!(err.kind, FsErrorKind::NotFound | FsErrorKind::TooLarge) => return,
            Err(err) => return self.problem(&md, "file.unreadable", format!("{:?}", err.kind)),
        };
        self.counted();
        let detail = match self.codec.classify_readable(&existing) {
            ReadableState::Ours { revision } if revision == page.revision.id => return,
            ReadableState::Ours { .. } => "stale",
            ReadableState::Edited => "edited",
            ReadableState::Missing => return,
            _ => "damaged",
        };
        self.problem(&md, "page.mdMismatch", detail);
    }
}
