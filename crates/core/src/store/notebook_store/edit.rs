//! Changes to one tree file (spec 18.1): renaming, recoloring, pinning, and moving groups and sections.

use std::collections::HashSet;

use super::create::check_title;
use super::{invalid_move, not_found, place_key, NotebookStore, Sibling};
use crate::error::CoreError;
use crate::id::{GroupId, Id, PageId, SectionId};
use crate::model::{Color, NotebookStyles, MAX_STYLES, MAX_STYLE_NAME_CHARS};
use crate::order::OrderKey;
use crate::session::notebook::{NodeProps, NodeRef, ParentRef};

/// The group a placement names for a group or section: `None` for the notebook's top level.
pub(crate) fn parent_group(parent: ParentRef) -> Result<Option<GroupId>, CoreError> {
    match parent {
        ParentRef::Notebook => Ok(None),
        ParentRef::Group(g) => Ok(Some(g)),
        ParentRef::Section(_) | ParentRef::Page(_) => {
            Err(invalid_move("groups and sections go into a notebook or a group"))
        }
    }
}

/// The untyped ID of a node.
pub(crate) fn node_id(node: NodeRef) -> Id {
    match node {
        NodeRef::Group(g) => g.0,
        NodeRef::Section(s) => s.0,
        NodeRef::Page(p) => p.0,
    }
}

impl NotebookStore {
    /// The groups and sections under `parent`, in display order, without `except`.
    pub(crate) fn children_of(&self, parent: Option<GroupId>, except: Option<Id>) -> Vec<Sibling> {
        let groups = self.display_groups();
        let known: HashSet<GroupId> = groups.iter().map(|g| g.id).collect();
        let mut out: Vec<Sibling> = groups
            .iter()
            .filter(|g| g.parent == parent)
            .map(|g| (g.order.clone(), g.id.0))
            .collect();
        let sections = self
            .sections
            .values()
            .filter(|s| !self.hidden.contains(&s.file.id.0))
            .filter(|s| s.file.group.filter(|g| known.contains(g)) == parent)
            .map(|s| (s.file.order.clone(), s.file.id.0));
        out.extend(sections);
        out.retain(|s| Some(s.1) != except);
        out.sort();
        out
    }

    /// The order key for a group or section placed under `parent` before `before`, or at the end.
    pub(crate) fn child_key(
        &self,
        parent: Option<GroupId>,
        except: Option<Id>,
        before: Option<Id>,
    ) -> Result<(OrderKey, Vec<(Id, OrderKey)>), CoreError> {
        let siblings = self.children_of(parent, except);
        let index = match before {
            Some(b) => siblings
                .iter()
                .position(|s| s.1 == b)
                .ok_or_else(|| invalid_move("the node to place before isn't in that place"))?,
            None => siblings.len(),
        };
        place_key(&siblings, index)
    }

    /// Gives groups and sections new order keys, and writes the files that changed. `write_notebook` writes
    /// `notebook.json` even when no group changed.
    pub(crate) fn apply_child_rekeys(
        &mut self,
        rekeys: &[(Id, OrderKey)],
        write_notebook: bool,
    ) -> Result<(), CoreError> {
        let now = self.now();
        let mut notebook_changed = write_notebook;
        let mut sections = Vec::new();
        for (id, key) in rekeys {
            if let Some(g) = self.notebook.groups.iter_mut().find(|g| g.id.0 == *id) {
                g.order = key.clone();
                g.changed = now;
                notebook_changed = true;
            } else if let Some(s) = self.sections.get_mut(&SectionId(*id)) {
                s.file.order = key.clone();
                s.file.changed = now;
                sections.push(s.file.id);
            }
        }
        if notebook_changed {
            self.write_notebook()?;
        }
        for section in sections {
            self.write_section(section)?;
        }
        Ok(())
    }

    /// Whether `group` is `ancestor` or inside it.
    pub(crate) fn is_inside(&self, group: GroupId, ancestor: GroupId) -> bool {
        let mut seen = HashSet::new();
        let mut current = Some(group);
        while let Some(id) = current {
            if id == ancestor {
                return true;
            }
            if !seen.insert(id) {
                return false;
            }
            current = self.notebook.groups.iter().find(|g| g.id == id).and_then(|g| g.parent);
        }
        false
    }

    /// How many levels a group and the groups inside it take: 1 for a group without subgroups.
    pub(crate) fn group_height(&self, group: GroupId) -> u32 {
        let mut height: u32 = 1;
        let mut level = vec![group];
        let mut seen = HashSet::from([group]);
        loop {
            let next: Vec<GroupId> = self
                .notebook
                .groups
                .iter()
                .filter(|g| g.parent.is_some_and(|p| level.contains(&p)) && seen.insert(g.id))
                .map(|g| g.id)
                .collect();
            if next.is_empty() {
                return height;
            }
            height = height.saturating_add(1);
            level = next;
        }
    }

    /// Whether a group or section is already at the place a move asks for.
    fn already_there(&self, id: Id, parent: Option<GroupId>, current: Option<GroupId>, before: Option<Id>) -> bool {
        if parent != current {
            return false;
        }
        let all = self.children_of(parent, None);
        let position = all.iter().position(|s| s.1 == id);
        let next = position
            .and_then(|i| i.checked_add(1))
            .and_then(|i| all.get(i))
            .map(|s| s.1);
        before == Some(id) || next == before
    }

    /// Moves a section group, with everything in it, under `parent` before `before`. Groups nest at most 4
    /// levels deep, and a group can't go inside itself.
    pub fn move_group(&mut self, group: GroupId, parent: Option<GroupId>, before: Option<Id>) -> Result<(), CoreError> {
        self.check_writable()?;
        let current = self
            .display_groups()
            .into_iter()
            .find(|g| g.id == group)
            .map(|g| g.parent);
        let current = current.ok_or_else(|| not_found(format!("group {group}")))?;
        if let Some(p) = parent {
            self.group(p)?;
            if self.is_inside(p, group) {
                return Err(invalid_move("a group can't go inside itself"));
            }
        }
        let depth = parent.map_or(0, |p| self.group_depth(p));
        if depth.saturating_add(self.group_height(group)) > self.env.policy.group_depth {
            return Err(invalid_move("section groups nest at most 4 levels deep"));
        }
        if self.already_there(group.0, parent, current, before) {
            return Ok(());
        }
        let (order, mut rekeys) = self.child_key(parent, Some(group.0), before)?;
        rekeys.push((group.0, order));
        if let Some(g) = self.notebook.groups.iter_mut().find(|g| g.id == group) {
            g.parent = parent;
        }
        self.apply_child_rekeys(&rekeys, true)
    }

    /// Moves a section under `parent` before `before`. Only its `section.json` changes (spec 4.3).
    pub fn move_section(
        &mut self,
        section: SectionId,
        parent: Option<GroupId>,
        before: Option<Id>,
    ) -> Result<(), CoreError> {
        self.check_section_writable(section)?;
        if let Some(p) = parent {
            self.group(p)?;
        }
        let known: HashSet<GroupId> = self.display_groups().iter().map(|g| g.id).collect();
        let current = self.section(section)?.file.group.filter(|g| known.contains(g));
        if self.already_there(section.0, parent, current, before) {
            return Ok(());
        }
        let (order, mut rekeys) = self.child_key(parent, Some(section.0), before)?;
        rekeys.push((section.0, order));
        if let Some(s) = self.sections.get_mut(&section) {
            s.file.group = parent;
        }
        self.apply_child_rekeys(&rekeys, false)
    }

    /// Renames the notebook in `notebook.json`. The folder keeps its name.
    pub fn rename_notebook(&mut self, title: &str) -> Result<(), CoreError> {
        self.check_writable()?;
        check_title(&self.env, title)?;
        if self.notebook.title == title {
            return Ok(());
        }
        title.clone_into(&mut self.notebook.title);
        self.notebook.changed = self.now();
        self.write_notebook()
    }

    /// Sets or removes the notebook's color.
    pub fn set_notebook_color(&mut self, color: Option<Color>) -> Result<(), CoreError> {
        self.check_writable()?;
        if self.notebook.color == color {
            return Ok(());
        }
        self.notebook.color = color;
        self.notebook.changed = self.now();
        self.write_notebook()
    }

    /// Sets the notebook's named styles (spec 4.1). An empty map removes them.
    pub fn set_notebook_styles(&mut self, styles: NotebookStyles) -> Result<(), CoreError> {
        self.check_writable()?;
        if styles.len() > MAX_STYLES {
            return Err(invalid_move(format!("a notebook keeps at most {MAX_STYLES} styles")));
        }
        for (name, style) in &styles {
            if name.is_empty() || name.chars().count() > MAX_STYLE_NAME_CHARS {
                return Err(invalid_move("a style name is 1 to 64 characters"));
            }
            if let Some(problem) = style.problem() {
                return Err(invalid_move(format!("style {name}: {problem}")));
            }
        }
        if self.notebook.styles == styles {
            return Ok(());
        }
        self.notebook.styles = styles;
        self.notebook.changed = self.now();
        self.write_notebook()
    }

    /// Renames a group or section. Page titles live in `page.json`, so a page is renamed through its session,
    /// and [`NotebookStore::set_title_copy`] refreshes the copy after the save (spec 18.1).
    pub fn rename(&mut self, node: NodeRef, title: &str) -> Result<(), CoreError> {
        check_title(&self.env, title)?;
        let now = self.now();
        match node {
            NodeRef::Group(id) => {
                self.check_writable()?;
                let group = self.notebook.groups.iter_mut().find(|g| g.id == id);
                let group = group.ok_or_else(|| not_found(format!("group {id}")))?;
                if group.title != title {
                    title.clone_into(&mut group.title);
                    group.changed = now;
                    self.write_notebook()?;
                }
                Ok(())
            }
            NodeRef::Section(id) => {
                self.check_section_writable(id)?;
                let changed = self.sections.get_mut(&id).is_some_and(|s| {
                    let differs = s.file.title != title;
                    if differs {
                        title.clone_into(&mut s.file.title);
                        s.file.changed = now;
                    }
                    differs
                });
                if changed {
                    self.write_section(id)?;
                }
                Ok(())
            }
            NodeRef::Page(id) => self.set_title_copy(id, title),
        }
    }

    /// Refreshes the title copy in a page's entry, if it differs (spec 4.2).
    pub fn set_title_copy(&mut self, page: PageId, title: &str) -> Result<(), CoreError> {
        let section = self.section_of(page).ok_or_else(|| not_found(format!("page {page}")))?;
        self.check_section_writable(section)?;
        let now = self.now();
        let changed = self.sections.get_mut(&section).is_some_and(|s| {
            let entry = s.file.pages.iter_mut().find(|e| e.id == page);
            entry.is_some_and(|e| {
                let differs = e.title != title;
                if differs {
                    title.clone_into(&mut e.title);
                    e.changed = now;
                }
                differs
            })
        });
        if changed {
            self.write_section(section)?;
        }
        Ok(())
    }

    /// Archives or restores a group, section, or page. The mark is the unknown key `archived` in its tree file
    /// entry, so versions that don't know it keep it.
    pub fn set_archived(&mut self, node: NodeRef, archived: bool) -> Result<(), CoreError> {
        let now = self.now();
        match node {
            NodeRef::Group(id) => {
                self.check_writable()?;
                let group = self.notebook.groups.iter_mut().find(|g| g.id == id);
                let group = group.ok_or_else(|| not_found(format!("group {id}")))?;
                if crate::model::set_archived(&mut group.extra, archived) {
                    group.changed = now;
                    self.write_notebook()?;
                }
            }
            NodeRef::Section(id) => {
                self.check_section_writable(id)?;
                let changed = self.sections.get_mut(&id).is_some_and(|s| {
                    let changed = crate::model::set_archived(&mut s.file.extra, archived);
                    if changed {
                        s.file.changed = now;
                    }
                    changed
                });
                if changed {
                    self.write_section(id)?;
                }
            }
            NodeRef::Page(id) => {
                let section = self.section_of(id).ok_or_else(|| not_found(format!("page {id}")))?;
                self.check_section_writable(section)?;
                let changed = self.sections.get_mut(&section).is_some_and(|s| {
                    let Some(entry) = s.file.pages.iter_mut().find(|e| e.id == id) else {
                        return false;
                    };
                    let changed = crate::model::set_archived(&mut entry.extra, archived);
                    if changed {
                        entry.changed = now;
                    }
                    changed
                });
                if changed {
                    self.write_section(section)?;
                }
            }
        }
        Ok(())
    }

    /// Archives or restores the notebook itself.
    pub fn set_notebook_archived(&mut self, archived: bool) -> Result<(), CoreError> {
        self.check_writable()?;
        if crate::model::set_archived(&mut self.notebook.extra, archived) {
            self.notebook.changed = self.now();
            self.write_notebook()?;
        }
        Ok(())
    }

    /// Changes a node's color, or the pin of a page or section. Colors of groups and sections change their tree
    /// file, as does the pin of a section; colors and pins of pages change their entry.
    pub fn set_props(&mut self, node: NodeRef, props: &NodeProps) -> Result<(), CoreError> {
        if props.styles.is_some() {
            return Err(invalid_move("only the notebook has styles"));
        }
        let now = self.now();
        match node {
            NodeRef::Group(id) => {
                self.check_writable()?;
                if props.pinned.is_some() {
                    return Err(invalid_move("only pages can be pinned"));
                }
                let group = self.notebook.groups.iter_mut().find(|g| g.id == id);
                let group = group.ok_or_else(|| not_found(format!("group {id}")))?;
                match &props.color {
                    Some(color) if group.color != *color => {
                        group.color.clone_from(color);
                        group.changed = now;
                        self.write_notebook()
                    }
                    _ => Ok(()),
                }
            }
            NodeRef::Section(id) => self.set_section_props(id, props),
            NodeRef::Page(id) => self.set_page_props(id, props),
        }
    }

    fn set_section_props(&mut self, id: SectionId, props: &NodeProps) -> Result<(), CoreError> {
        self.check_section_writable(id)?;
        let now = self.now();
        let changed = self.sections.get_mut(&id).is_some_and(|s| {
            let mut changed = false;
            if let Some(color) = props.color.as_ref().filter(|c| **c != s.file.color) {
                s.file.color.clone_from(color);
                changed = true;
            }
            // A section's pin is the unknown key `pinned`, so versions that don't know it keep it.
            if let Some(pinned) = props.pinned {
                changed |= crate::model::set_pinned(&mut s.file.extra, pinned);
            }
            if changed {
                s.file.changed = now;
            }
            changed
        });
        if changed {
            self.write_section(id)?;
        }
        Ok(())
    }

    fn set_page_props(&mut self, id: PageId, props: &NodeProps) -> Result<(), CoreError> {
        let section = self.section_of(id).ok_or_else(|| not_found(format!("page {id}")))?;
        self.check_section_writable(section)?;
        let now = self.now();
        let changed = self.sections.get_mut(&section).is_some_and(|s| {
            let Some(entry) = s.file.pages.iter_mut().find(|e| e.id == id) else {
                return false;
            };
            let mut changed = false;
            if let Some(color) = props.color.as_ref().filter(|c| **c != entry.color) {
                entry.color.clone_from(color);
                changed = true;
            }
            if let Some(pinned) = props.pinned.filter(|p| *p != entry.pinned) {
                entry.pinned = pinned;
                changed = true;
            }
            if changed {
                entry.changed = now;
            }
            changed
        });
        if changed {
            self.write_section(section)?;
        }
        Ok(())
    }
}
