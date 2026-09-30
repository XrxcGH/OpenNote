//! Duplicating pages, and moving pages, sections, and groups to another notebook (spec 18.2).

use std::collections::HashSet;
use std::path::Path;

use super::arrange::FlatPage;
use super::pages::{read_page_files, write_page_files};
use super::{invalid_move, not_found, NotebookStore, SectionState};
use crate::error::{CoreError, FsErrorKind};
use crate::id::{GroupId, PageId, RevisionId, SectionId, TrashItemId};
use crate::model::{FormatInfo, Group, Ink, InkRecord, JsonMap, Page, PageEntry, Revision, TrashReason};
use crate::session::journal_thread::TreeOp;
use crate::session::notebook::{NodePlacement, NodeRef};
use crate::store::cache::CachedPage;
use crate::store::fs::Fs;
use crate::store::layout::{NotebookLayout, PartialFolder, SECTION_JSON};
use crate::store::page_store::LoadError;
use crate::store::PageFiles;

/// What a move to another notebook did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transfer {
    /// The moved root in the target notebook.
    pub moved: Vec<NodeRef>,
    /// The Trash items in the source notebook that keep the originals for 30 days.
    pub originals: Vec<TrashItemId>,
}

/// A load error as a core error.
pub(crate) fn load_failed(page: PageId, e: LoadError) -> CoreError {
    match e {
        LoadError::Missing => not_found(format!("page {page}")),
        LoadError::Damaged(e) => CoreError::Format(e),
        LoadError::NewerFormat(_) => CoreError::ReadOnly(crate::model::ReadOnlyReason::NewerFormat),
        LoadError::Unavailable(e) => CoreError::Fs(e),
    }
}

impl NotebookStore {
    /// Duplicates a page, without its subpages, as a new page right after it (spec 18.2).
    ///
    /// The copy gets a new page ID and a first revision. Its live ink is written as one new segment instead of
    /// copying the segment files, because each segment's header names its page (spec 9.1). Assets are copied.
    pub fn duplicate(&mut self, page: PageId) -> Result<PageId, CoreError> {
        let src = self.page_dir(page).ok_or_else(|| not_found(format!("page {page}")))?;
        let fs = self.env.fs.as_ref();
        let loaded =
            read_page_files(fs, self.env.codec.as_ref(), &src, &self.env.limits).map_err(|e| load_failed(page, e))?;
        if let crate::model::Access::ReadOnly(reason) = &loaded.page.format.access {
            return Err(CoreError::ReadOnly(reason.clone()));
        }
        self.add_copy(page, &loaded.page)
    }

    /// Adds a new page with `content` right after the page `after`, in the same section and under the same
    /// parent, with a new page ID. `content` holds its live ink, and its assets are in `after`'s folder. This
    /// serves duplicates, versions restored as copies, and conflicts kept as separate pages.
    pub fn add_copy(&mut self, after: PageId, content: &Page) -> Result<PageId, CoreError> {
        self.add_copy_from(after, content, None)
    }

    /// [`NotebookStore::add_copy`] with the assets taken from `assets`, such as a copied folder.
    pub fn add_copy_from(&mut self, after: PageId, content: &Page, assets: Option<&Path>) -> Result<PageId, CoreError> {
        let (section, _) = self.subtree(after)?;
        self.check_section_writable(section)?;
        let src = match assets {
            Some(dir) => dir.to_path_buf(),
            None => self.page_dir(after).ok_or_else(|| not_found(format!("page {after}")))?,
        };
        let entry = self
            .section(section)?
            .entry(after)
            .cloned()
            .ok_or_else(|| not_found(format!("page {after}")))?;
        let new = PageId::generate(self.env.clock.as_ref());
        let intent = self.begin(TreeOp::DuplicatePage {
            from: after,
            section,
            new,
        });
        let dir = self.section(section)?.dir.clone();
        let written = self.write_copy(content, &src, (&dir, new))?;
        self.log.step_done(intent, 2);
        self.env.fs.rename_dir(
            &dir.join(PartialFolder::Copying(new.0).name()),
            &dir.join(new.to_string()),
        )?;
        self.log.step_done(intent, 3);
        let before = self.next_sibling(section, after)?;
        let (order, rekeys) = self.page_slot(section, entry.parent, before)?;
        let copy = PageEntry {
            id: new,
            title: content.title.clone(),
            order,
            changed: self.now(),
            moving: None,
            pinned: false,
            extra: JsonMap::new(),
            ..entry
        };
        self.add_entry(section, copy, &rekeys)?;
        self.log.step_done(intent, 4);
        self.log.done(intent);
        self.cache.record(new, written);
        Ok(new)
    }

    /// Writes a copy of `content` with a new ID into `<dir>/~<new ID>.copying`, with the assets from `src`.
    fn write_copy(&self, content: &Page, src: &Path, (dir, new): (&Path, PageId)) -> Result<CachedPage, CoreError> {
        let fs = self.env.fs.as_ref();
        let partial = dir.join(PartialFolder::Copying(new.0).name());
        fs.create_dir_durable(&partial)?;
        copy_assets(fs, src, &partial, content)?;
        let revision = Revision::new(
            RevisionId::generate(self.env.clock.as_ref()),
            self.now(),
            self.env.device.clone(),
            self.env.writer.clone(),
        );
        let copy = fresh_copy(content, new, revision);
        let files = PageFiles {
            fs,
            codec: self.env.codec.as_ref(),
            dir: &partial,
        };
        let written = write_page_files(&files, self.env.clock.as_ref(), &copy, copy.revision.clone())?;
        Ok(CachedPage {
            title: copy.title,
            created: copy.created,
            modified: copy.modified,
            revision: Some(written.revision.id),
        })
    }

    /// The sibling right after a page, if any.
    fn next_sibling(&self, section: SectionId, page: PageId) -> Result<Option<PageId>, CoreError> {
        let flat = self.flat_pages(section)?;
        let (_, block) = self.subtree(page)?;
        let start = flat.iter().position(|f| f.id == page).unwrap_or(0);
        let level = block.first().map_or(0, |f| f.level);
        let next = flat.get(start.saturating_add(block.len()));
        Ok(next.filter(|f| f.level == level).map(|f| f.id))
    }

    /// Moves a page with its subpages to another notebook (spec 18.2). The folders are copied into the target,
    /// and the originals go to this notebook's Trash with the reason `moved`, where they stay for 30 days.
    pub fn move_page_to(
        &mut self,
        page: PageId,
        target: &mut NotebookStore,
        to: &NodePlacement,
    ) -> Result<Transfer, CoreError> {
        let (section, block) = self.subtree(page)?;
        self.check_section_writable(section)?;
        let (t_section, index, level) = target.placement_index(to, &HashSet::new())?;
        target.check_section_writable(t_section)?;
        let shifted = shift_block(&block, level)?;
        if shifted.iter().any(|f| target.section_of(f.id).is_some()) {
            return Err(CoreError::Conflict(format!("page {page} is already in that notebook")));
        }
        let intent = self.begin(TreeOp::MovePageToNotebook {
            page,
            to_notebook: target.layout.root.clone(),
            to_section: t_section,
        });
        let t_dir = target.section(t_section)?.dir.clone();
        let fs = self.env.fs.as_ref();
        for f in &shifted {
            let src = self.page_dir(f.id).ok_or_else(|| not_found(format!("page {}", f.id)))?;
            copy_tree(fs, &src, &t_dir.join(PartialFolder::Moving(f.id.0).name()))?;
        }
        self.log.step_done(intent, 1);
        for f in &shifted {
            let partial = t_dir.join(PartialFolder::Moving(f.id.0).name());
            fs.rename_dir(&partial, &t_dir.join(f.id.to_string()))?;
        }
        let entries: Vec<PageEntry> = shifted
            .iter()
            .filter_map(|f| self.section(section).ok()?.entry(f.id).cloned())
            .collect();
        target.receive_pages(t_section, entries, index, &shifted)?;
        for f in &shifted {
            if let Some(cached) = self.cache.page(f.id).cloned() {
                target.cache.record(f.id, cached);
            }
        }
        self.log.step_done(intent, 2);
        let originals = self.delete(&[NodeRef::Page(page)], TrashReason::Moved)?;
        self.log.step_done(intent, 3);
        self.log.done(intent);
        Ok(Transfer {
            moved: vec![NodeRef::Page(page)],
            originals,
        })
    }

    /// Adds page entries whose folders are already in `section`, at `index` of its flat list.
    fn receive_pages(
        &mut self,
        section: SectionId,
        entries: Vec<PageEntry>,
        index: usize,
        block: &[FlatPage],
    ) -> Result<(), CoreError> {
        let mut flat = self.flat_pages(section)?;
        let tail = flat.split_off(index.min(flat.len()));
        flat.extend(block.iter().copied());
        flat.extend(tail);
        super::flat::check_levels(&flat)?;
        let now = self.now();
        if let Some(state) = self.sections.get_mut(&section) {
            state.file.pages.extend(entries.into_iter().map(|e| PageEntry {
                moving: None,
                changed: now,
                ..e
            }));
        }
        self.arrange(section, &flat)?;
        self.write_section(section)
    }

    /// Moves a section, or a group with everything in it, to another notebook (spec 18.2). The originals go
    /// to this notebook's Trash with the reason `moved`.
    pub fn move_section_to(
        &mut self,
        node: NodeRef,
        target: &mut NotebookStore,
        to: &NodePlacement,
    ) -> Result<Transfer, CoreError> {
        target.check_writable()?;
        let parent = super::edit::parent_group(to.parent)?;
        if let Some(p) = parent {
            target.group(p)?;
        }
        let (sections, groups) = self.moved_containers(node)?;
        let height = match node {
            NodeRef::Group(g) => self.group_height(g),
            _ => 0,
        };
        let depth = parent.map_or(0, |p| target.group_depth(p));
        if depth.saturating_add(height) > target.env.policy.group_depth {
            return Err(invalid_move("section groups nest at most 4 levels deep"));
        }
        if sections.iter().any(|s| target.sections.contains_key(s)) {
            return Err(CoreError::Conflict("the section is already in that notebook".into()));
        }
        let (order, rekeys) = target.child_key(parent, None, to.before.map(super::edit::node_id))?;
        let intent = self.begin(TreeOp::MoveSectionToNotebook {
            sections: sections.clone(),
            to_notebook: target.layout.root.clone(),
        });
        let fs = self.env.fs.as_ref();
        for s in &sections {
            let src = self.section(*s)?.dir.clone();
            copy_tree(fs, &src, &target.layout.root.join(PartialFolder::Moving(s.0).name()))?;
        }
        self.log.step_done(intent, 1);
        target.receive_groups(groups, parent, &order)?;
        self.log.step_done(intent, 2);
        let root_section = match node {
            NodeRef::Section(s) => Some((s, parent, order)),
            _ => None,
        };
        for s in &sections {
            target.receive_section(self, *s, root_section.as_ref())?;
        }
        target.apply_child_rekeys(&rekeys, false)?;
        self.log.step_done(intent, 3);
        let originals = self.delete(&[node], TrashReason::Moved)?;
        self.log.step_done(intent, 4);
        self.log.done(intent);
        Ok(Transfer {
            moved: vec![node],
            originals,
        })
    }

    /// The sections and groups a section or group move takes: the group first, then the groups inside it.
    fn moved_containers(&self, node: NodeRef) -> Result<(Vec<SectionId>, Vec<Group>), CoreError> {
        self.check_writable()?;
        let (sections, groups) = match node {
            NodeRef::Section(s) => {
                self.section(s)?;
                (vec![s], Vec::new())
            }
            NodeRef::Group(g) => {
                self.group(g)?;
                let groups: Vec<Group> = self.groups_inside(g);
                let ids: HashSet<GroupId> = groups.iter().map(|g| g.id).collect();
                let sections = self
                    .sections
                    .values()
                    .filter(|s| !self.hidden.contains(&s.file.id.0) && s.file.group.is_some_and(|g| ids.contains(&g)))
                    .map(|s| s.file.id)
                    .collect();
                (sections, groups)
            }
            NodeRef::Page(_) => return Err(invalid_move("use a page move for pages")),
        };
        for s in &sections {
            self.check_section_writable(*s)?;
        }
        Ok((sections, groups))
    }

    /// A group and every group inside it, the group first.
    pub(crate) fn groups_inside(&self, group: GroupId) -> Vec<Group> {
        let mut out: Vec<Group> = self.notebook.groups.iter().filter(|g| g.id == group).cloned().collect();
        let mut i = 0usize;
        while let Some(parent) = out.get(i).map(|g| g.id) {
            let children: Vec<Group> = self
                .notebook
                .groups
                .iter()
                .filter(|g| g.parent == Some(parent) && !out.iter().any(|o| o.id == g.id))
                .cloned()
                .collect();
            out.extend(children);
            i = i.saturating_add(1);
        }
        out
    }

    /// Adds groups moved from another notebook, the first under `parent` with `order`.
    fn receive_groups(
        &mut self,
        groups: Vec<Group>,
        parent: Option<GroupId>,
        order: &crate::order::OrderKey,
    ) -> Result<(), CoreError> {
        if groups.is_empty() {
            return Ok(());
        }
        let now = self.now();
        for (i, mut group) in groups.into_iter().enumerate() {
            if i == 0 {
                group.parent = parent;
                group.order = order.clone();
            }
            group.changed = now;
            self.notebook.groups.retain(|g| g.id != group.id);
            self.notebook.groups.push(group);
        }
        self.write_notebook()
    }

    /// Gives a copied section its new group and order, renames it into place, and adds it (spec 18.2, step 3).
    fn receive_section(
        &mut self,
        source: &NotebookStore,
        section: SectionId,
        root: Option<&(SectionId, Option<GroupId>, crate::order::OrderKey)>,
    ) -> Result<(), CoreError> {
        let mut file = source.section(section)?.file.clone();
        if let Some((_, parent, order)) = root.filter(|r| r.0 == section) {
            file.group = *parent;
            file.order = order.clone();
        }
        file.changed = self.now();
        let partial = self.layout.root.join(PartialFolder::Moving(section.0).name());
        let bytes = self.env.codec.write_section(&file);
        self.env.fs.replace_durable(&partial.join(SECTION_JSON), &bytes)?;
        let dir = self.layout.section_dir(section);
        self.env.fs.rename_dir(&partial, &dir)?;
        for entry in &file.pages {
            if let Some(cached) = source.cache.page(entry.id).cloned() {
                self.cache.record(entry.id, cached);
            }
        }
        self.sections.insert(section, SectionState { file, dir });
        Ok(())
    }
}

/// Shifts a page block so its first page is at `level`.
fn shift_block(block: &[FlatPage], level: u8) -> Result<Vec<FlatPage>, CoreError> {
    let base = block.first().map_or(0, |f| f.level);
    block
        .iter()
        .map(|f| {
            let level = level
                .checked_add(f.level.saturating_sub(base))
                .filter(|l| *l <= crate::model::section::MAX_PAGE_LEVEL)
                .ok_or_else(|| invalid_move("subpages nest at most 2 levels deep"))?;
            Ok(FlatPage { id: f.id, level })
        })
        .collect()
}

/// A copy of a page with a new ID and revision, whose live strokes are pending, so the next write puts them
/// in one new segment.
fn fresh_copy(page: &Page, id: PageId, revision: Revision) -> Page {
    let mut copy = page.clone();
    copy.id = id;
    copy.revision = revision;
    let mut ink = Ink::default();
    for stroke in page.ink.strokes() {
        ink.insert(stroke.clone());
        ink.push_pending(InkRecord::Stroke(stroke.clone()));
    }
    copy.ink = ink;
    copy.format = FormatInfo::default();
    copy
}

/// Copies a page's asset files durably into another page folder.
fn copy_assets(fs: &dyn Fs, src: &Path, dst: &Path, page: &Page) -> Result<(), CoreError> {
    for asset in page.assets.values() {
        let from = NotebookLayout::asset_path(src, asset)?;
        let to = NotebookLayout::asset_path(dst, asset)?;
        let bytes = fs.read(&from, asset.bytes.saturating_add(1))?;
        if let Some(dir) = to.parent() {
            crate::store::lock::ensure_dir_all(fs, dir)?;
        }
        fs.create_durable(&to, &bytes)?;
    }
    Ok(())
}

/// Copies a folder and everything in it, every file durably. Temporary files and partial folders are left
/// out. A target that already holds a file with the same bytes counts as copied, so a retry after a crash
/// works (spec 17.2).
pub(crate) fn copy_tree(fs: &dyn Fs, src: &Path, dst: &Path) -> Result<(), CoreError> {
    let mut pending = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((from, to)) = pending.pop() {
        match fs.create_dir_durable(&to) {
            Ok(_) => {}
            Err(e) if e.kind == FsErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
        for entry in fs.read_dir(&from)? {
            if entry.name.starts_with('~') {
                continue;
            }
            let (a, b) = (from.join(&entry.name), to.join(&entry.name));
            if entry.is_dir {
                pending.push((a, b));
            } else {
                let bytes = fs.read(&a, u64::MAX)?;
                fs.create_durable(&b, &bytes)?;
            }
        }
    }
    Ok(())
}
