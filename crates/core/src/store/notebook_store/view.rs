//! The navigation tree as the interface shows it, built from the tree files.

use std::collections::{HashMap, HashSet};

use super::{NotebookStore, SectionState};
use crate::id::GroupId;
use crate::model::{Access, Group, NotebookTree, PageEntry, PageNode, PageNodeState, ReadOnlyReason, SectionNode};
use crate::store::cache::created_from_id;

impl NotebookStore {
    /// The navigation tree.
    pub fn tree(&self) -> NotebookTree {
        let groups = self.display_groups();
        let known: HashSet<GroupId> = groups.iter().map(|g| g.id).collect();
        let sections = self
            .sections
            .values()
            .filter(|s| !self.hidden.contains(&s.file.id.0))
            .map(|s| self.section_node(s, &known))
            .collect();
        NotebookTree {
            notebook: self.notebook.id,
            title: self.notebook.title.clone(),
            color: self.notebook.color.clone(),
            created: self.notebook.created,
            changed: self.notebook.changed,
            styles: self.notebook.styles.clone(),
            groups,
            sections,
            access: self.access(),
            notices: self.notices.clone(),
            archived: crate::model::is_archived(&self.notebook.extra),
        }
    }

    /// Whether the notebook's own files may change.
    pub fn access(&self) -> Access {
        match &self.read_only {
            Some(reason) => Access::ReadOnly(reason.clone()),
            None => Access::ReadWrite,
        }
    }

    /// Groups as shown: a group whose parent is missing, or that is part of a loop, shows at the top level.
    pub(crate) fn display_groups(&self) -> Vec<Group> {
        let ids: HashSet<GroupId> = self.notebook.groups.iter().map(|g| g.id).collect();
        let mut groups = self.notebook.groups.clone();
        for group in &mut groups {
            if group.parent.is_some_and(|p| !ids.contains(&p)) {
                group.parent = None;
            }
        }
        break_group_loops(&mut groups);
        groups
    }

    pub(crate) fn section_node(&self, state: &SectionState, groups: &HashSet<GroupId>) -> SectionNode {
        let file = &state.file;
        let shown: Vec<PageEntry> = file
            .pages
            .iter()
            .filter(|e| !self.hidden.contains(&e.id.0))
            .cloned()
            .collect();
        let pages = crate::model::section::page_levels(&shown)
            .into_iter()
            .filter_map(|(i, level)| shown.get(i).map(|e| self.page_node(e, level)))
            .collect();
        let access = if state.encrypted() {
            Access::ReadOnly(ReadOnlyReason::Encrypted)
        } else {
            match (&self.read_only, &file.format.access) {
                (Some(reason), _) => Access::ReadOnly(reason.clone()),
                (None, access) => access.clone(),
            }
        };
        SectionNode {
            id: file.id,
            title: file.title.clone(),
            color: file.color.clone(),
            group: file.group.filter(|g| groups.contains(g)),
            order: file.order.clone(),
            created: file.created,
            changed: file.changed,
            pages,
            access,
            encrypted: state.encrypted(),
            archived: crate::model::is_archived(&file.extra),
            pinned: crate::model::is_pinned(&file.extra),
        }
    }

    pub(crate) fn page_node(&self, entry: &PageEntry, level: u8) -> PageNode {
        let cached = self.cache.page(entry.id);
        let created = cached
            .map(|c| c.created)
            .or_else(|| created_from_id(entry.id))
            .unwrap_or(entry.changed);
        PageNode {
            id: entry.id,
            title: entry.title.clone(),
            parent: entry.parent,
            order: entry.order.clone(),
            level,
            pinned: entry.pinned,
            archived: crate::model::is_archived(&entry.extra),
            color: entry.color.clone(),
            created,
            modified: cached.map(|c| c.modified),
            state: self.states.get(&entry.id).cloned().unwrap_or(PageNodeState::Normal),
        }
    }
}

/// Moves each group that is part of a loop of parents to the top level, the first in order first.
fn break_group_loops(groups: &mut [Group]) {
    let index: HashMap<GroupId, usize> = groups.iter().enumerate().map(|(i, g)| (g.id, i)).collect();
    let mut order: Vec<usize> = (0..groups.len()).collect();
    order.sort_by(|&a, &b| {
        let key = |i: usize| groups.get(i).map(|g| (g.order.clone(), g.id));
        key(a).cmp(&key(b))
    });
    for start in order {
        let mut seen = HashSet::new();
        let mut current = Some(start);
        while let Some(i) = current {
            if !seen.insert(i) {
                if let Some(group) = groups.get_mut(i) {
                    group.parent = None;
                }
                break;
            }
            current = groups
                .get(i)
                .and_then(|g| g.parent)
                .and_then(|p| index.get(&p).copied());
        }
    }
}
