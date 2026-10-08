//! A section's flat page list (spec 4.4), and moving pages within and between sections (spec 18.2).
//!
//! The navigation tree shows a section's pages as a flat list with levels, and the notes contract moves and
//! indents pages in those terms. The format stores a parent and an order among siblings instead. The two map
//! one to one: a page's parent is the nearest earlier page one level up. Every page move therefore builds
//! the flat list it asks for, checks it, and then derives each page's parent and order key from it, keeping
//! every key it can.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::edit::node_id;
use super::flat::{check_levels, child_range, derive_parents, flat_parent, shift_subtree, sibling_keys};
use super::{invalid_move, not_found, NotebookStore, Sibling};
use crate::error::CoreError;
use crate::id::{Id, PageId, SectionId};
use crate::model::section::{page_levels, MAX_PAGE_LEVEL};
use crate::model::{Moving, PageEntry};
use crate::order::OrderKey;
use crate::session::journal_thread::TreeOp;
use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};

/// A page in a section's display order, with its level: 0 for a page, 1 for a subpage, and 2 for a
/// sub-subpage.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct FlatPage {
    /// The page.
    pub id: PageId,
    /// Its level.
    pub level: u8,
}

impl NotebookStore {
    /// The pages of a section in display order, with their levels. Pending deletions are left out.
    pub fn flat_pages(&self, section: SectionId) -> Result<Vec<FlatPage>, CoreError> {
        let state = self.section(section)?;
        let shown: Vec<PageEntry> = state
            .file
            .pages
            .iter()
            .filter(|e| !self.hidden.contains(&e.id.0))
            .cloned()
            .collect();
        let flat = page_levels(&shown)
            .into_iter()
            .filter_map(|(i, level)| shown.get(i).map(|e| FlatPage { id: e.id, level }))
            .collect();
        Ok(flat)
    }

    /// A shown page and its subpages, in display order, with the section they are in.
    pub fn subtree(&self, page: PageId) -> Result<(SectionId, Vec<FlatPage>), CoreError> {
        let section = self
            .section_of(page)
            .filter(|_| !self.hidden.contains(&page.0))
            .ok_or_else(|| not_found(format!("page {page}")))?;
        let flat = self.flat_pages(section)?;
        let start = flat
            .iter()
            .position(|f| f.id == page)
            .ok_or_else(|| not_found(format!("page {page}")))?;
        let level = flat.get(start).map_or(0, |f| f.level);
        let rest = flat.iter().skip(start).enumerate();
        let block = rest
            .take_while(|(i, f)| *i == 0 || f.level > level)
            .map(|(_, f)| *f)
            .collect();
        Ok((section, block))
    }

    /// The order key of a new page under `parent` before `before`, or at the end, and siblings that need new
    /// keys. Fails when the new page would be deeper than a sub-subpage.
    pub(crate) fn page_slot(
        &self,
        section: SectionId,
        parent: Option<PageId>,
        before: Option<PageId>,
    ) -> Result<(OrderKey, Vec<(Id, OrderKey)>), CoreError> {
        let flat = self.flat_pages(section)?;
        if let Some(p) = parent {
            let level = flat
                .iter()
                .find(|f| f.id == p)
                .map(|f| f.level)
                .ok_or_else(|| not_found(format!("page {p}")))?;
            if level >= MAX_PAGE_LEVEL {
                return Err(invalid_move("subpages nest at most 2 levels deep"));
            }
        }
        let parents: HashMap<PageId, Option<PageId>> = derive_parents(&flat).into_iter().collect();
        let state = self.section(section)?;
        let mut siblings: Vec<Sibling> = state
            .file
            .pages
            .iter()
            .filter(|e| parents.get(&e.id) == Some(&parent))
            .map(|e| (e.order.clone(), e.id.0))
            .collect();
        siblings.sort();
        let index = match before {
            Some(b) => siblings
                .iter()
                .position(|s| s.1 == b.0)
                .ok_or_else(|| invalid_move("the page to place before isn't in that place"))?,
            None => siblings.len(),
        };
        super::place_key(&siblings, index)
    }

    /// Moves a node within this notebook, with a page's subpages (spec 18.1 and 18.2).
    pub fn move_node(&mut self, node: NodeRef, to: &NodePlacement) -> Result<(), CoreError> {
        match node {
            NodeRef::Group(g) => {
                let parent = super::edit::parent_group(to.parent)?;
                self.move_group(g, parent, to.before.map(node_id))
            }
            NodeRef::Section(s) => {
                let parent = super::edit::parent_group(to.parent)?;
                self.move_section(s, parent, to.before.map(node_id))
            }
            NodeRef::Page(p) => {
                let (section, index, level) = self.page_target(p, to)?;
                self.move_pages(&[p], section, index, level)
            }
        }
    }

    /// Where a page move goes: the target section, the index in its flat list without the moved pages, and
    /// the level of the moved page.
    fn page_target(&self, page: PageId, to: &NodePlacement) -> Result<(SectionId, usize, u8), CoreError> {
        let moved: HashSet<PageId> = self.subtree(page)?.1.iter().map(|f| f.id).collect();
        self.placement_index(to, &moved)
    }

    /// Where a placement puts a page: the target section, the index in its flat list without the pages in
    /// `moved`, and the level of the placed page.
    pub(crate) fn placement_index(
        &self,
        to: &NodePlacement,
        moved: &HashSet<PageId>,
    ) -> Result<(SectionId, usize, u8), CoreError> {
        let (section, parent) = match to.parent {
            ParentRef::Section(s) => (s, None),
            ParentRef::Page(q) => {
                let section = self.section_of(q).ok_or_else(|| not_found(format!("page {q}")))?;
                (section, Some(q))
            }
            ParentRef::Notebook | ParentRef::Group(_) => {
                return Err(invalid_move("pages go into a section or under a page"));
            }
        };
        if parent.is_some_and(|q| moved.contains(&q)) {
            return Err(invalid_move("a page can't go under itself"));
        }
        let flat: Vec<FlatPage> = self
            .flat_pages(section)?
            .into_iter()
            .filter(|f| !moved.contains(&f.id))
            .collect();
        let (level, end) = child_range(&flat, parent)?;
        let index = match to.before {
            None => end,
            Some(NodeRef::Page(b)) => {
                let j = flat
                    .iter()
                    .position(|f| f.id == b)
                    .ok_or_else(|| invalid_move("the page to place before isn't in that place"))?;
                if flat_parent(&flat, j) != parent || flat.get(j).map(|f| f.level) != Some(level) {
                    return Err(invalid_move("the page to place before isn't in that place"));
                }
                j
            }
            Some(_) => return Err(invalid_move("pages go before pages")),
        };
        Ok((section, index, level))
    }

    /// Moves pages, each with its subpages, into `target` at `index` of its flat list without the moved
    /// pages, with each moved page at `level`. The pages keep their order, and a page listed inside another
    /// listed page's subtree moves with that page.
    pub fn move_pages(
        &mut self,
        roots: &[PageId],
        target: SectionId,
        index: usize,
        level: u8,
    ) -> Result<(), CoreError> {
        let leveled: Vec<(PageId, u8)> = roots.iter().map(|&root| (root, level)).collect();
        self.move_page_blocks(&leveled, target, index)
    }

    /// Moves pages as [`NotebookStore::move_pages`] does, with each moved page at its own level, so a move of
    /// several page blocks can fit each block after the one before it, as the notes contract's move does.
    pub fn move_page_blocks(
        &mut self,
        roots: &[(PageId, u8)],
        target: SectionId,
        index: usize,
    ) -> Result<(), CoreError> {
        self.check_section_writable(target)?;
        let blocks = self.moved_blocks(roots)?;
        let moved: HashSet<PageId> = blocks.iter().flat_map(|(_, b)| b.iter().map(|f| f.id)).collect();
        let mut flat: Vec<FlatPage> = self
            .flat_pages(target)?
            .into_iter()
            .filter(|f| !moved.contains(&f.id))
            .collect();
        let tail = flat.split_off(index.min(flat.len()));
        flat.extend(blocks.iter().flat_map(|(_, b)| b.iter().copied()));
        flat.extend(tail);
        check_levels(&flat)?;
        let incoming: Vec<(SectionId, Vec<PageId>)> = blocks
            .into_iter()
            .filter(|(s, _)| *s != target)
            .map(|(s, b)| (s, b.iter().map(|f| f.id).collect()))
            .collect();
        if incoming.is_empty() {
            if self.arrange(target, &flat)? {
                self.write_section(target)?;
            }
            return Ok(());
        }
        self.move_across(target, &flat, &incoming)
    }

    /// The contract's "set page level": gives each page, with its subpages, a new level in place.
    pub fn set_page_level(&mut self, pages: &[PageId], level: u8) -> Result<(), CoreError> {
        let mut by_section: HashMap<SectionId, Vec<PageId>> = HashMap::new();
        for &page in pages {
            let (section, _) = self.subtree(page)?;
            by_section.entry(section).or_default().push(page);
        }
        for (section, pages) in by_section {
            self.check_section_writable(section)?;
            let mut flat = self.flat_pages(section)?;
            for page in pages {
                shift_subtree(&mut flat, page, level)?;
            }
            check_levels(&flat)?;
            if self.arrange(section, &flat)? {
                self.write_section(section)?;
            }
        }
        Ok(())
    }

    /// The flat blocks of the moved pages, by source section, with levels shifted so each root is at its level.
    fn moved_blocks(&self, roots: &[(PageId, u8)]) -> Result<Vec<(SectionId, Vec<FlatPage>)>, CoreError> {
        let mut subtrees = Vec::with_capacity(roots.len());
        for &(root, level) in roots {
            let (section, block) = self.subtree(root)?;
            self.check_section_writable(section)?;
            subtrees.push((root, level, section, block));
        }
        let inside = |root: PageId| {
            subtrees
                .iter()
                .any(|(other, _, _, block)| *other != root && block.iter().any(|f| f.id == root))
        };
        let mut blocks = Vec::new();
        let mut seen = HashSet::new();
        for &(root, level, section, ref block) in &subtrees {
            if inside(root) || !seen.insert(root) {
                continue;
            }
            let base = block.first().map_or(0, |f| f.level);
            let mut shifted = Vec::with_capacity(block.len());
            for f in block {
                let depth = f.level.saturating_sub(base);
                let level = level.checked_add(depth).filter(|l| *l <= MAX_PAGE_LEVEL);
                let level = level.ok_or_else(|| invalid_move("subpages nest at most 2 levels deep"))?;
                shifted.push(FlatPage { id: f.id, level });
            }
            blocks.push((section, shifted));
        }
        Ok(blocks)
    }

    /// Gives a section's entries the parents and order keys that `flat` implies. Returns whether any entry
    /// changed. The caller writes `section.json`.
    pub(crate) fn arrange(&mut self, section: SectionId, flat: &[FlatPage]) -> Result<bool, CoreError> {
        let now = self.now();
        let state = self
            .sections
            .get_mut(&section)
            .ok_or_else(|| not_found(format!("section {section}")))?;
        let index: HashMap<PageId, usize> = state.file.pages.iter().enumerate().map(|(i, e)| (e.id, i)).collect();
        let mut changed = false;
        let mut lists: Vec<(Option<PageId>, Vec<usize>)> = Vec::new();
        for (page, parent) in derive_parents(flat) {
            let Some(&i) = index.get(&page) else { continue };
            if let Some(entry) = state.file.pages.get_mut(i) {
                if entry.parent != parent {
                    entry.parent = parent;
                    entry.changed = now;
                    changed = true;
                }
            }
            match lists.iter_mut().find(|(p, _)| *p == parent) {
                Some((_, list)) => list.push(i),
                None => lists.push((parent, vec![i])),
            }
        }
        for (_, list) in lists {
            let current: Vec<Sibling> = list
                .iter()
                .filter_map(|&i| state.file.pages.get(i).map(|e| (e.order.clone(), e.id.0)))
                .collect();
            for (&i, key) in list.iter().zip(sibling_keys(&current)?) {
                if let (Some(key), Some(entry)) = (key, state.file.pages.get_mut(i)) {
                    entry.order = key;
                    entry.changed = now;
                    changed = true;
                }
            }
        }
        Ok(changed)
    }

    /// Moves pages from other sections into `target` (spec 18.2): the entries go into the target marked as
    /// moving, leave their sections, and then the folders move and the marks clear.
    fn move_across(
        &mut self,
        target: SectionId,
        flat: &[FlatPage],
        incoming: &[(SectionId, Vec<PageId>)],
    ) -> Result<(), CoreError> {
        let mut intents = Vec::new();
        for (from, pages) in incoming {
            for &page in pages {
                intents.push(self.begin(TreeOp::MovePage {
                    page,
                    from: *from,
                    to: target,
                }));
            }
        }
        for (from, pages) in incoming {
            let entries: Vec<PageEntry> = self
                .section(*from)?
                .file
                .pages
                .iter()
                .filter(|e| pages.contains(&e.id))
                .cloned()
                .collect();
            if let Some(state) = self.sections.get_mut(&target) {
                state.file.pages.extend(entries.into_iter().map(|mut e| {
                    e.moving = Some(Moving::From(*from));
                    e
                }));
            }
        }
        self.arrange(target, flat)?;
        self.write_section(target)?;
        self.step_all(&intents, 1);
        for (from, pages) in incoming {
            if let Some(state) = self.sections.get_mut(from) {
                state.file.pages.retain(|e| !pages.contains(&e.id));
            }
            self.write_section(*from)?;
        }
        self.step_all(&intents, 2);
        self.mark_pending();
        self.finish_pending()?;
        for intent in intents {
            self.log.done(intent);
        }
        Ok(())
    }

    fn step_all(&self, intents: &[crate::id::IntentId], step: u8) {
        for &intent in intents {
            self.log.step_done(intent, step);
        }
    }
}
