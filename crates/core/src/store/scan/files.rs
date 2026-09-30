//! The scan's steps for tree files: sync-tool copies of `notebook.json` and `section.json`, damaged sections,
//! and Trash (spec 14.3, 12.4, and 18.3).

use std::collections::BTreeMap;
use std::path::Path;

use super::folders::ScanReport;
use crate::error::{CoreError, FormatErrorKind};
use crate::format::names::{conflict_copy_kind, ConflictCopyOf};
use crate::id::{PageId, SectionId, TrashItemId};
use crate::model::{FormatInfo, JsonMap, SectionFile, Warning};
use crate::order::OrderKey;
use crate::store::fs::DirEntry;
use crate::store::layout::{file_time, PartialFolder, NOTEBOOK_JSON, SECTION_JSON};
use crate::store::lock::ensure_dir_all;
use crate::store::notebook_store::plain_entry;
use crate::store::notebook_store::{
    add_section, read_notebook_file, read_section_file, skipped_name, NotebookStore, SectionState,
};

/// The most of a `page.json` read for its title.
const TITLE_PREFIX_BYTES: usize = 64 * 1024;

impl NotebookStore {
    /// Reads `notebook.json` again and merges any sync-tool copies of it into it (spec 14.3).
    pub(super) fn merge_notebook_copies(&mut self, report: &mut ScanReport) -> Result<(), CoreError> {
        let mut merged = read_notebook_file(&self.env, &self.layout)?;
        let mut changed = false;
        for entry in self.env.fs.read_dir(&self.layout.root)? {
            if entry.is_dir || conflict_copy_kind(&entry.name) != Some(ConflictCopyOf::Notebook) {
                continue;
            }
            let path = self.layout.root.join(&entry.name);
            let Ok(bytes) = self.env.fs.read(&path, self.env.limits.page_json_bytes) else {
                continue;
            };
            match self.env.codec.read_notebook(&bytes, &self.env.limits) {
                Ok(copy) if copy.id == merged.id => {
                    merged = self.env.formats.merge_notebooks(&merged, &copy);
                    changed = true;
                    self.keep_tree_copy(&path, &entry.name, &bytes)?;
                    report.deleted.push(path);
                }
                _ => {}
            }
        }
        self.read_only = match &merged.format.access {
            crate::model::Access::ReadOnly(reason) => Some(reason.clone()),
            crate::model::Access::ReadWrite => self
                .read_only
                .clone()
                .filter(|r| *r != crate::model::ReadOnlyReason::NewerFormat),
        };
        self.notebook = merged;
        if changed && self.check_writable().is_ok() {
            self.write_notebook()?;
            report.written.push(self.layout.root.join(NOTEBOOK_JSON));
        }
        Ok(())
    }

    /// Moves a copy of a tree file into `.opennote/conflicts/`, where it stays for 30 days (spec 14.3).
    fn keep_tree_copy(&self, path: &Path, name: &str, bytes: &[u8]) -> Result<(), CoreError> {
        let dir = self.layout.tree_conflicts_dir();
        ensure_dir_all(self.env.fs.as_ref(), &dir)?;
        let kept = dir.join(format!("{}-{name}", file_time(self.now())));
        self.env.fs.replace_durable(&kept, bytes)?;
        self.env.fs.remove_file(path)?;
        Ok(())
    }

    /// Reads every section again (spec 18.3, step 1): merges sync-tool copies of `section.json`, and rebuilds a
    /// damaged one from the section's page folders.
    pub(super) fn rescan_sections(&mut self, report: &mut ScanReport) -> Result<(), CoreError> {
        let entries = self.env.fs.read_dir(&self.layout.root)?;
        let mut sections: BTreeMap<SectionId, SectionState> = BTreeMap::new();
        for entry in entries.iter().filter(|e| e.is_dir && !skipped_name(&e.name)) {
            let dir = self.layout.root.join(&entry.name);
            let Ok(listing) = self.env.fs.read_dir(&dir) else {
                continue;
            };
            if !listing.iter().any(|e| !e.is_dir && e.name == SECTION_JSON) {
                continue;
            }
            let file = match read_section_file(&self.env, &dir) {
                Ok(Some(file)) => self.merge_section_copies(file, &dir, &listing, report)?,
                Ok(None) => continue,
                Err(CoreError::Format(e)) if matches!(e.kind, FormatErrorKind::NewerVersion(_)) => {
                    self.notices
                        .push(Warning::new("tree.newerSection", dir.display().to_string()));
                    continue;
                }
                Err(CoreError::Format(_)) => match self.rebuild_section(&entry.name, &dir, &listing, report)? {
                    Some(file) => file,
                    None => continue,
                },
                Err(e) => {
                    self.notices.push(Warning::new(
                        "tree.sectionUnreadable",
                        format!("{}: {e}", dir.display()),
                    ));
                    continue;
                }
            };
            add_section(
                &mut sections,
                &mut self.notices,
                SectionState { file, dir },
                &entry.name,
            );
        }
        self.sections = sections;
        Ok(())
    }

    /// Merges sync-tool copies of a `section.json` into it.
    fn merge_section_copies(
        &self,
        file: SectionFile,
        dir: &Path,
        listing: &[DirEntry],
        report: &mut ScanReport,
    ) -> Result<SectionFile, CoreError> {
        let mut merged = file;
        let mut changed = false;
        for entry in listing {
            if entry.is_dir || conflict_copy_kind(&entry.name) != Some(ConflictCopyOf::Section) {
                continue;
            }
            let path = dir.join(&entry.name);
            let Ok(bytes) = self.env.fs.read(&path, self.env.limits.page_json_bytes) else {
                continue;
            };
            if let Ok(copy) = self.env.codec.read_section(&bytes, &self.env.limits) {
                if copy.id == merged.id && copy.encryption.is_none() && merged.encryption.is_none() {
                    merged = self.env.formats.merge_sections(&merged, &copy);
                    changed = true;
                    self.keep_tree_copy(&path, &entry.name, &bytes)?;
                    report.deleted.push(path);
                }
            }
        }
        if changed {
            let path = dir.join(SECTION_JSON);
            self.env
                .fs
                .replace_durable(&path, &self.env.codec.write_section(&merged))?;
            report.written.push(path);
        }
        Ok(merged)
    }

    /// Rebuilds a damaged `section.json` from the section's page folders, and keeps the damaged file in
    /// `.opennote/conflicts/`. A folder whose name is not a section ID can't be rebuilt.
    fn rebuild_section(
        &mut self,
        name: &str,
        dir: &Path,
        listing: &[DirEntry],
        report: &mut ScanReport,
    ) -> Result<Option<SectionFile>, CoreError> {
        let Ok(id) = SectionId::parse(name) else {
            self.notices
                .push(Warning::new("tree.sectionDamaged", dir.display().to_string()));
            return Ok(None);
        };
        let path = dir.join(SECTION_JSON);
        if let Ok(bytes) = self.env.fs.read(&path, self.env.limits.page_json_bytes) {
            self.keep_tree_copy(&path, &format!("{id}-{SECTION_JSON}"), &bytes)?;
        }
        let now = self.now();
        let mut pages = Vec::new();
        for entry in listing.iter().filter(|e| e.is_dir) {
            let Ok(page) = PageId::parse(&entry.name) else { continue };
            let title = self.read_title(&dir.join(&entry.name)).unwrap_or_default();
            pages.push((page, title));
        }
        let keys = OrderKey::spread(None, None, pages.len()).unwrap_or_default();
        let order = self.children_of(None, None).last().map(|s| s.0.clone());
        let order = OrderKey::between(order.as_ref(), None).or_else(|_| OrderKey::parse("a0"));
        let file = SectionFile {
            id,
            title: "Recovered section".to_owned(),
            color: None,
            group: None,
            order: order.map_err(crate::store::notebook_store::invalid_move)?,
            created: now,
            changed: now,
            defaults: None,
            encryption: None,
            pages: pages
                .into_iter()
                .zip(keys)
                .map(|((page, title), order)| plain_entry(page, title, None, order, now))
                .collect(),
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        };
        self.env
            .fs
            .replace_durable(&path, &self.env.codec.write_section(&file))?;
        report.written.push(path);
        report.rebuilt.push(id);
        self.notices.push(Warning::new("tree.sectionRebuilt", id.to_string()));
        Ok(Some(file))
    }

    /// A page's title from the start of its `page.json`.
    pub(super) fn read_title(&self, page_dir: &Path) -> Option<String> {
        let bytes = self
            .env
            .fs
            .read_prefix(&page_dir.join(crate::store::layout::PAGE_JSON), TITLE_PREFIX_BYTES)
            .ok()?;
        self.env.formats.page_title(&bytes)
    }

    /// Reads every Trash item again, and deletes leftover purge folders (spec 12.4).
    pub(super) fn reread_trash(&mut self, report: &mut ScanReport) {
        let trash = self.layout.trash_dir();
        let Ok(entries) = self.env.fs.read_dir(&trash) else {
            return;
        };
        for entry in entries.iter().filter(|e| e.is_dir) {
            if let Some(PartialFolder::Purge(_)) = PartialFolder::parse(&entry.name) {
                let path = trash.join(&entry.name);
                if self.env.fs.remove_dir_all(&path).is_ok() {
                    report.deleted.push(path);
                }
                continue;
            }
            let Ok(id) = TrashItemId::parse(&entry.name) else {
                continue;
            };
            match self.read_trash_item(id) {
                Ok(item) => {
                    self.trash.insert(id, item);
                }
                Err(e) => self
                    .notices
                    .push(Warning::new("trash.unreadable", format!("{id}: {e}"))),
            }
        }
    }
}
