//! The scan's steps: tree files and their sync-tool copies, Trash, page folders, and clean-up (spec 18.3).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::{has_page_json, is_partial};
use crate::error::CoreError;
use crate::id::{PageId, SectionId};
use crate::model::{PageEntry, PageNodeState, Warning};
use crate::order::OrderKey;
use crate::store::layout::SECTION_JSON;
use crate::store::notebook_store::plain_entry;
use crate::store::notebook_store::{skipped_name, NotebookStore, SectionState};

/// What a scan found and changed.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ScanReport {
    /// Tree files it wrote.
    pub written: Vec<PathBuf>,
    /// Page folders with no entry, which it added to their sections.
    pub added: Vec<PageId>,
    /// Entries it moved to the section where their folder is.
    pub moved: Vec<PageId>,
    /// Entries whose folder is missing.
    pub unavailable: Vec<PageId>,
    /// Entries it dropped after their folder was missing for 30 days.
    pub dropped: Vec<PageId>,
    /// Page folders that hold the same page ID as another folder (spec 14.4).
    pub duplicates: Vec<(PageId, PathBuf)>,
    /// Damaged `section.json` files it rebuilt.
    pub rebuilt: Vec<SectionId>,
    /// Temporary files, partial copies, and leftover purge folders it deleted.
    pub deleted: Vec<PathBuf>,
    /// Notices for the person.
    pub notices: Vec<Warning>,
}

impl ScanReport {
    /// Whether the scan changed any file.
    pub fn changed_files(&self) -> bool {
        !self.written.is_empty() || !self.deleted.is_empty()
    }
}

/// A page folder the scan found.
#[derive(Clone, Debug)]
pub(super) struct Folder {
    section: SectionId,
    path: PathBuf,
    by_id: bool,
}

/// A temporary file or partial folder, by its path in the notebook.
pub(super) struct Partial {
    name: String,
    path: PathBuf,
    is_dir: bool,
}

pub(super) type Found = (HashMap<PageId, Vec<Folder>>, Vec<Partial>);

impl NotebookStore {
    /// Lists every section's page folders (spec 18.3, step 3), with the temporary files and partial copies
    /// found on the way.
    pub(super) fn list_page_folders(&mut self) -> Result<Found, CoreError> {
        let mut folders: HashMap<PageId, Vec<Folder>> = HashMap::new();
        let mut partials = Vec::new();
        self.list_partials_in(&self.layout.root.clone(), &mut partials);
        let sections: Vec<(SectionId, PathBuf)> = self
            .sections
            .values()
            .filter(|s| !self.hidden.contains(&s.file.id.0))
            .map(|s| (s.file.id, s.dir.clone()))
            .collect();
        for (section, dir) in sections {
            let Ok(listing) = self.env.fs.read_dir(&dir) else {
                continue;
            };
            for entry in listing {
                let path = dir.join(&entry.name);
                if is_partial(&entry.name, entry.is_dir) {
                    partials.push(self.partial(&path, entry.is_dir));
                    continue;
                }
                if !entry.is_dir || skipped_name(&entry.name) {
                    continue;
                }
                self.list_page_folder(section, &path, &entry.name, (&mut folders, &mut partials));
            }
        }
        Ok((folders, partials))
    }

    fn list_page_folder(
        &self,
        section: SectionId,
        path: &Path,
        name: &str,
        (folders, partials): (&mut HashMap<PageId, Vec<Folder>>, &mut Vec<Partial>),
    ) {
        let Ok(inner) = self.env.fs.read_dir(path) else { return };
        for entry in inner.iter().filter(|e| is_partial(&e.name, e.is_dir)) {
            partials.push(self.partial(&path.join(&entry.name), entry.is_dir));
        }
        let by_id = PageId::parse(name).ok();
        let id = match (by_id, has_page_json(&inner)) {
            (Some(id), Some(_)) => id,
            (Some(_), None) => {
                let empty = inner.iter().all(|e| is_partial(&e.name, e.is_dir));
                if empty {
                    partials.push(self.partial(path, true));
                }
                return;
            }
            (None, Some(file)) => match self.page_id_in(&path.join(file)) {
                Some(id) => id,
                None => return,
            },
            (None, None) => return,
        };
        folders.entry(id).or_default().push(Folder {
            section,
            path: path.to_path_buf(),
            by_id: by_id.is_some(),
        });
    }

    /// The page ID inside a `page.json`, for a folder whose name is not an ID.
    fn page_id_in(&self, path: &Path) -> Option<PageId> {
        let bytes = self.env.fs.read(path, self.env.limits.page_json_bytes).ok()?;
        self.env
            .codec
            .read_page(&bytes, &self.env.limits)
            .ok()
            .map(|read| read.page.id)
    }

    fn list_partials_in(&self, dir: &Path, partials: &mut Vec<Partial>) {
        let Ok(listing) = self.env.fs.read_dir(dir) else { return };
        for entry in listing.iter().filter(|e| is_partial(&e.name, e.is_dir)) {
            partials.push(self.partial(&dir.join(&entry.name), entry.is_dir));
        }
    }

    fn partial(&self, path: &Path, is_dir: bool) -> Partial {
        let name = path
            .strip_prefix(&self.layout.root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        Partial {
            name,
            path: path.to_path_buf(),
            is_dir,
        }
    }

    /// Matches page lists with folders, as steps 4 and 5 of spec 18.3 say.
    pub(super) fn match_entries(&mut self, found: &Found, report: &mut ScanReport) -> Result<(), CoreError> {
        self.reset_page_states();
        let (folders, _) = found;
        let mut dirty: HashSet<SectionId> = HashSet::new();
        let listed = self.match_listed(folders, &mut dirty, report);
        self.add_unlisted(folders, &listed, &mut dirty, report);
        for section in dirty {
            if self.check_section_writable(section).is_ok() {
                self.write_section(section)?;
                if let Some(state) = self.sections.get(&section) {
                    report.written.push(state.dir.join(SECTION_JSON));
                }
            }
        }
        Ok(())
    }

    /// Checks each entry against the folders: an entry whose folder is in another section moves there, and an
    /// entry without a folder is marked unavailable, then dropped after 30 days. Returns every listed page.
    fn match_listed(
        &mut self,
        folders: &HashMap<PageId, Vec<Folder>>,
        dirty: &mut HashSet<SectionId>,
        report: &mut ScanReport,
    ) -> HashSet<PageId> {
        let now = self.now();
        let mut listed = HashSet::new();
        let entries: Vec<(SectionId, PageId, bool)> = self
            .sections
            .values()
            .filter(|s| !self.hidden.contains(&s.file.id.0))
            .flat_map(|s| s.file.pages.iter().map(move |e| (s.file.id, e.id, e.moving.is_some())))
            .collect();
        for (section, page, marked) in entries {
            if !listed.insert(page) {
                self.drop_entry(section, page, dirty);
                continue;
            }
            if self.hidden.contains(&page.0) {
                continue;
            }
            if marked {
                self.settle_marked(section, page, folders, (dirty, report));
                continue;
            }
            match folders.get(&page).and_then(|list| primary(list, Some(section))) {
                Some(folder) => self.place_listed(section, page, folder, folders, (dirty, report)),
                None => self.mark_missing(section, page, now, (dirty, report)),
            }
        }
        listed
    }

    /// A pending move or restore whose folder wasn't where the mark says: it may have been renamed or moved
    /// by hand on its way. The move finishes from wherever the folder is, and an entry whose folder is
    /// nowhere is unavailable.
    fn settle_marked(
        &mut self,
        section: SectionId,
        page: PageId,
        folders: &HashMap<PageId, Vec<Folder>>,
        (dirty, report): (&mut HashSet<SectionId>, &mut ScanReport),
    ) {
        let fs = self.env.fs.as_ref();
        let found = folders
            .get(&page)
            .and_then(|list| primary(list, Some(section)))
            .cloned();
        let Some(folder) = found else {
            if !self.places.get(&page).is_some_and(|p| fs.metadata(p).is_ok()) {
                self.mark_missing(section, page, self.now(), (dirty, report));
            }
            return;
        };
        let Some(target) = self.sections.get(&section).map(|s| s.dir.join(page.to_string())) else {
            return;
        };
        if folder.path == target || self.move_folder(page.0, &folder.path, &target) {
            let moving = self
                .sections
                .get(&section)
                .and_then(|s| s.entry(page))
                .and_then(|e| e.moving);
            if let Some(crate::model::Moving::FromTrash(item)) = moving {
                if self.forget_item(item).is_err() || self.trash.contains_key(&item) {
                    return;
                }
            }
            if let Some(entry) = self
                .sections
                .get_mut(&section)
                .and_then(|s| s.file.pages.iter_mut().find(|e| e.id == page))
            {
                entry.moving = None;
            }
            self.states.remove(&page);
            dirty.insert(section);
        }
    }

    fn place_listed(
        &mut self,
        section: SectionId,
        page: PageId,
        folder: &Folder,
        folders: &HashMap<PageId, Vec<Folder>>,
        (dirty, report): (&mut HashSet<SectionId>, &mut ScanReport),
    ) {
        if folder.section != section {
            self.move_entry(section, folder.section, page);
            dirty.insert(section);
            dirty.insert(folder.section);
            report.moved.push(page);
        }
        if folder.by_id {
            self.places.remove(&page);
        } else {
            self.places.insert(page, folder.path.clone());
        }
        self.note_duplicates(page, folder, folders, report);
        let encrypted = self.sections.get(&folder.section).is_some_and(SectionState::encrypted);
        if encrypted {
            self.cache.forget(page);
        } else {
            let title = self
                .sections
                .get(&folder.section)
                .and_then(|s| s.entry(page))
                .map(|e| e.title.clone());
            self.cache.seen(page, &title.unwrap_or_default(), self.now());
        }
    }

    fn note_duplicates(
        &mut self,
        page: PageId,
        folder: &Folder,
        folders: &HashMap<PageId, Vec<Folder>>,
        report: &mut ScanReport,
    ) {
        let Some(list) = folders.get(&page) else { return };
        for other in list.iter().filter(|f| f.path != folder.path) {
            self.states.insert(page, PageNodeState::Duplicate);
            self.notices
                .push(Warning::new("tree.duplicatePage", other.path.display().to_string()));
            report.duplicates.push((page, other.path.clone()));
        }
    }

    fn mark_missing(
        &mut self,
        section: SectionId,
        page: PageId,
        now: crate::time::Timestamp,
        (dirty, report): (&mut HashSet<SectionId>, &mut ScanReport),
    ) {
        let since = self.cache.missing_since(page, now);
        if now.since(since) >= self.env.timings.unavailable_age {
            self.drop_entry(section, page, dirty);
            report.dropped.push(page);
            return;
        }
        let maybe_syncing = self.sync_managed || !self.cache.was_seen(page);
        self.states.insert(page, PageNodeState::Unavailable { maybe_syncing });
        report.unavailable.push(page);
    }

    fn drop_entry(&mut self, section: SectionId, page: PageId, dirty: &mut HashSet<SectionId>) {
        if let Some(state) = self.sections.get_mut(&section) {
            if let Some(i) = state.file.pages.iter().rposition(|e| e.id == page) {
                state.file.pages.remove(i);
                dirty.insert(section);
            }
        }
    }

    /// Moves an entry to the section its folder is in, keeping its parent only if the parent is there too.
    fn move_entry(&mut self, from: SectionId, to: SectionId, page: PageId) {
        let Some(entry) = self.sections.get_mut(&from).and_then(|s| {
            let i = s.file.pages.iter().position(|e| e.id == page)?;
            Some(s.file.pages.remove(i))
        }) else {
            return;
        };
        let now = self.now();
        if let Some(target) = self.sections.get_mut(&to) {
            let parent = entry.parent.filter(|p| target.file.pages.iter().any(|e| e.id == *p));
            target.file.pages.push(PageEntry {
                parent,
                changed: now,
                ..entry
            });
        }
    }

    /// Adds each page folder with no entry anywhere at the end of its section.
    fn add_unlisted(
        &mut self,
        folders: &HashMap<PageId, Vec<Folder>>,
        listed: &HashSet<PageId>,
        dirty: &mut HashSet<SectionId>,
        report: &mut ScanReport,
    ) {
        let mut unlisted: Vec<(&PageId, &Vec<Folder>)> = folders
            .iter()
            .filter(|(p, _)| !listed.contains(p) && !self.hidden.contains(&p.0))
            .collect();
        unlisted.sort_by_key(|(p, _)| **p);
        let now = self.now();
        for (&page, list) in unlisted {
            let Some(folder) = primary(list, None) else { continue };
            let title = self.read_title(&folder.path).unwrap_or_default();
            let last = self.sections.get(&folder.section).and_then(|s| {
                s.file
                    .pages
                    .iter()
                    .filter(|e| e.parent.is_none())
                    .map(|e| e.order.clone())
                    .max()
            });
            let Ok(order) = OrderKey::between(last.as_ref(), None).or_else(|_| OrderKey::parse("zz")) else {
                continue;
            };
            if let Some(state) = self.sections.get_mut(&folder.section) {
                state
                    .file
                    .pages
                    .push(plain_entry(page, title.clone(), None, order, now));
            }
            if !folder.by_id {
                self.places.insert(page, folder.path.clone());
            }
            dirty.insert(folder.section);
            report.added.push(page);
            self.note_duplicates(page, folder, folders, report);
            if !self.sections.get(&folder.section).is_some_and(SectionState::encrypted) {
                self.cache.seen(page, &title, now);
            }
        }
    }

    /// Deletes temporary files, partial copies, and empty folders once this device has seen them for longer
    /// than 24 hours (spec 18.3, step 6, and spec 19).
    pub(super) fn clean_partials(&mut self, found: &Found, report: &mut ScanReport) {
        let (_, partials) = found;
        let now = self.now();
        let mut present = HashSet::new();
        for partial in partials {
            present.insert(partial.name.clone());
            let first = self.cache.first_seen(&partial.name, now);
            if now.since(first) < self.env.timings.temp_age {
                continue;
            }
            let fs = self.env.fs.as_ref();
            let deleted = if partial.is_dir {
                fs.remove_dir_all(&partial.path)
            } else {
                fs.remove_file(&partial.path)
            };
            if deleted.is_ok() {
                report.deleted.push(partial.path.clone());
                present.remove(&partial.name);
            }
        }
        self.cache.keep_seen(&present);
    }
}

/// The folder that is the page: the one named by the ID, in the entry's section if it can be.
fn primary(list: &[Folder], section: Option<SectionId>) -> Option<&Folder> {
    list.iter()
        .find(|f| f.by_id && Some(f.section) == section)
        .or_else(|| list.iter().find(|f| f.by_id))
        .or_else(|| list.iter().find(|f| Some(f.section) == section))
        .or_else(|| list.first())
}
