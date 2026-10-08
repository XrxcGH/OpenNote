//! Checking one page folder: `page.json`, its segments and strokes, its assets, its history, and its conflicts.

use std::collections::HashSet;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::Verifier;
use crate::id::PageId;
use crate::model::{Access, BlockData, InkRecord, Page, ReadOnlyReason, SegmentRef};
use crate::store::layout::{NotebookLayout, ASSETS_DIR, CONFLICTS_DIR};

impl Verifier<'_> {
    /// Checks a page folder and returns the page's ID, if `page.json` reads.
    pub(super) fn page(&mut self, dir: &Path) -> Option<PageId> {
        let path = NotebookLayout::page_json(dir);
        let bytes = self.read(&path, self.limits.page_json_bytes)?;
        let page = match self.codec.read_page(&bytes, self.limits) {
            Ok(read) => read.page,
            Err(err) => {
                self.problem(&path, "page.invalid", err.to_string());
                return None;
            }
        };
        if page.format.access == Access::ReadOnly(ReadOnlyReason::Damaged) {
            self.problem(&path, "page.invalid", "the page fails a structural check");
        }
        if let Some(other) = self.pages.insert(page.id, dir.to_path_buf()) {
            let detail = format!("{} is also in {}", page.id, other.display());
            self.problem(dir, "tree.duplicatePage", detail);
        }
        let records = self.segments(dir, &page);
        self.strokes(dir, &page, records);
        self.assets(dir, &page);
        self.history(dir);
        self.conflicts(dir);
        Some(page.id)
    }

    /// Every listed segment exists, passes its checksums, and decodes without damage. Returns the records.
    fn segments(&mut self, dir: &Path, page: &Page) -> Vec<Vec<InkRecord>> {
        let mut all = Vec::new();
        for segment in page.ink.segments() {
            all.push(self.segment(dir, page, segment).unwrap_or_default());
        }
        all
    }

    fn segment(&mut self, dir: &Path, page: &Page, segment: &SegmentRef) -> Option<Vec<InkRecord>> {
        let path = NotebookLayout::segment_path(dir, segment.id);
        let bytes = self.read(&path, self.limits.segment_bytes)?;
        match self.codec.decode_segment(&bytes, segment, page.id, self.limits) {
            Ok(decoded) if decoded.damaged.is_empty() && decoded.footer_ok => Some(decoded.records),
            Ok(decoded) => {
                let detail = format!("{} damaged records", decoded.damaged.len());
                self.problem(&path, "segment.damaged", detail);
                Some(decoded.records)
            }
            Err(err) => {
                self.problem(&path, "segment.invalid", err.to_string());
                None
            }
        }
    }

    /// Every live stroke belongs to an ink block of the page.
    fn strokes(&mut self, dir: &Path, page: &Page, records: Vec<Vec<InkRecord>>) {
        let (ink, _) = crate::model::Ink::replay(page.ink.segments().to_vec(), records);
        for stroke in ink.strokes() {
            let in_ink_block = page
                .blocks
                .get(stroke.block)
                .is_some_and(|b| matches!(b.data, BlockData::Ink(_)));
            if !in_ink_block {
                self.problem(dir, "stroke.block", stroke.id.to_string());
            }
        }
    }

    /// Every asset file has its checked name, its size, and its hash. A recording that is still being
    /// written has neither a final size nor a hash yet, so only its name is checked.
    fn assets(&mut self, dir: &Path, page: &Page) {
        for asset in page.assets.values() {
            let Ok(path) = NotebookLayout::asset_path(dir, asset) else {
                self.problem(&dir.join(ASSETS_DIR), "asset.name", asset.file.clone());
                continue;
            };
            if asset.is_recording() {
                continue;
            }
            let Some(bytes) = self.read(&path, asset.bytes) else {
                continue;
            };
            let hash: [u8; 32] = Sha256::digest(&bytes).into();
            if bytes.len() as u64 != asset.bytes || hash != asset.sha256 {
                self.problem(&path, "asset.checksum", asset.id.to_string());
            }
        }
    }

    /// `versions.json` reads, and every segment and asset a version lists exists.
    fn history(&mut self, dir: &Path) {
        let path = NotebookLayout::versions_json(dir);
        if self.fs.metadata(&path).is_err() {
            return;
        }
        let Some(bytes) = self.read(&path, self.limits.page_json_bytes) else {
            return;
        };
        let versions = match self.codec.read_versions(&bytes, self.limits) {
            Ok(versions) => versions,
            Err(err) => return self.problem(&path, "history.invalid", err.to_string()),
        };
        let assets: HashSet<String> = self
            .list(&dir.join(ASSETS_DIR))
            .into_iter()
            .map(|e| e.name.get(..crate::id::Id::TEXT_LEN).unwrap_or("").to_owned())
            .collect();
        for version in &versions.versions {
            for segment in &version.segments {
                if self.fs.metadata(&NotebookLayout::segment_path(dir, *segment)).is_err() {
                    self.problem(&path, "history.segmentMissing", segment.to_string());
                }
            }
            for asset in version.assets.iter().filter(|a| !assets.contains(&a.to_string())) {
                self.problem(&path, "history.assetMissing", asset.to_string());
            }
            if self
                .fs
                .metadata(&NotebookLayout::version_path(dir, version.revision))
                .is_err()
            {
                self.problem(&path, "history.snapshotMissing", version.revision.to_string());
            }
        }
    }

    /// Every version kept after a conflict reads as a page.
    fn conflicts(&mut self, dir: &Path) {
        let folder = dir.join(CONFLICTS_DIR);
        for entry in self
            .list(&folder)
            .into_iter()
            .filter(|e| !e.is_dir && e.name.ends_with(".json"))
        {
            let path = folder.join(&entry.name);
            let Some(bytes) = self.read(&path, self.limits.page_json_bytes) else {
                continue;
            };
            if let Err(err) = self.codec.read_page(&bytes, self.limits) {
                self.problem(&path, "conflict.invalid", err.to_string());
            }
        }
    }
}
