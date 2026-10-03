//! Pins, archive, duplicate, and Copy to for the notes tree, on the core's own operations. Each call answers with
//! the summaries of the nodes it changed or made, and the notes events tell the tree to re-list.

use opennote_core::{
    session::notebook::{NodeProps, NodeRef},
    PageId,
};
use serde_json::Value;
use tauri::AppHandle;

use super::{arg, out};
use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    ipc::{IpcError, IpcResult},
    notes::{from_core, invalid_move, not_found, tree::Found, CreateInput, NodeSummary, Placement},
};

pub fn call(app: &AppHandle, bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    run_notes(app, bridge, |b| match name {
        "notes.setPinned" => out(b.set_pinned(&arg::<String>(args, "id")?, arg(args, "pinned")?)?),
        "notes.setArchived" => out(b.set_archived(&arg::<String>(args, "id")?, arg(args, "archived")?)?),
        "notes.duplicate" => out(b.duplicate_node(&arg::<String>(args, "id")?)?),
        "notes.copyTo" => out(b.copy_to(&arg::<Vec<String>>(args, "ids")?, &arg::<String>(args, "parentId")?)?),
        _ => Err(IpcError::invalid("name", "isn't a notes call")),
    })
}

fn page_of(found: &Found) -> Option<(opennote_core::session::notebook::NotebookHandle, PageId)> {
    match found {
        Found::Node(notebook, NodeRef::Page(page)) => Some((notebook.clone(), *page)),
        _ => None,
    }
}

impl Bridge {
    /// Pins or unpins a page.
    pub(crate) fn set_pinned(&mut self, id: &str, pinned: bool) -> IpcResult<NodeSummary> {
        let found = self.find(id)?;
        let Some((notebook, page)) = page_of(&found) else {
            return Err(invalid_move("Only pages can be pinned."));
        };
        let props = NodeProps {
            pinned: Some(pinned),
            ..NodeProps::default()
        };
        notebook.set_props(NodeRef::Page(page), props).map_err(from_core)?;
        self.summary_of(&found)
    }

    /// Archives or restores a notebook, section group, section, or page.
    pub(crate) fn set_archived(&mut self, id: &str, archived: bool) -> IpcResult<NodeSummary> {
        let found = self.find(id)?;
        match &found {
            Found::Notebook(notebook) => notebook.set_notebook_archived(archived).map_err(from_core)?,
            Found::Node(notebook, node) => notebook.set_archived(*node, archived).map_err(from_core)?,
        }
        self.summary_of(&found)
    }

    /// Duplicates a page, which lands right after the original, or a section, which lands at the end of its parent
    /// as "<title> copy".
    pub(crate) fn duplicate_node(&mut self, id: &str) -> IpcResult<Vec<NodeSummary>> {
        let found = self.find(id)?;
        if let Some((notebook, page)) = page_of(&found) {
            let copy = notebook.duplicate(page).map_err(from_core)?;
            return Ok(vec![self.summary_of(&self.find(&copy.to_string())?)?]);
        }
        let summary = self.summary_of(&found)?;
        match found {
            Found::Node(_, NodeRef::Section(_)) => {
                let parent = summary.parent_id.clone().ok_or_else(|| not_found(id))?;
                Ok(vec![self.copy_section(id, &parent, true)?])
            }
            _ => Err(invalid_move("Only pages and sections can be duplicated.")),
        }
    }

    /// Copies pages (a page and its subpages, in order) into a section, or sections into a notebook or group.
    pub(crate) fn copy_to(&mut self, ids: &[String], parent_id: &str) -> IpcResult<Vec<NodeSummary>> {
        let parent = self.find(parent_id)?;
        let mut made = Vec::new();
        if matches!(parent, Found::Node(_, NodeRef::Section(_))) {
            made.extend(self.copy_pages(ids, parent_id)?);
        } else {
            for id in ids {
                made.push(self.copy_section(id, parent_id, false)?);
            }
        }
        Ok(made)
    }

    fn copy_pages(&mut self, ids: &[String], section_id: &str) -> IpcResult<Vec<NodeSummary>> {
        let mut made = Vec::new();
        let mut shift = None;
        for id in ids {
            let found = self.find(id)?;
            let Some((notebook, page)) = page_of(&found) else {
                return Err(invalid_move("Only pages go into a section."));
            };
            let level = notebook.tree().find_page(page).map_or(0, |(_, node)| node.level);
            let base = *shift.get_or_insert(level);
            let copy = notebook.duplicate(page).map_err(from_core)?.to_string();
            let placement = Placement {
                parent_id: Some(section_id.to_owned()),
                before_id: None,
            };
            self.move_nodes(std::slice::from_ref(&copy), &placement)?;
            let level = level.saturating_sub(base);
            if level > 0 {
                self.set_page_level(std::slice::from_ref(&copy), level)?;
            }
            made.push(self.summary_of(&self.find(&copy)?)?);
        }
        Ok(made)
    }

    fn copy_section(&mut self, id: &str, parent_id: &str, same_parent: bool) -> IpcResult<NodeSummary> {
        let found = self.find(id)?;
        let Found::Node(notebook, NodeRef::Section(section)) = &found else {
            return Err(invalid_move("Only sections copy into a notebook or a section group."));
        };
        let source = self.summary_of(&found)?;
        let title = if same_parent {
            format!("{} copy", source.title)
        } else {
            source.title.clone()
        };
        let created = self.create(CreateInput {
            kind: "section".to_owned(),
            placement: Placement {
                parent_id: Some(parent_id.to_owned()),
                before_id: None,
            },
            title: Some(title),
            color: source.color.clone(),
            page_level: None,
        })?;
        let pages: Vec<String> = notebook
            .tree()
            .section(*section)
            .map(|node| node.pages.iter().map(|page| page.id.to_string()).collect())
            .unwrap_or_default();
        self.copy_pages(&pages, &created.id)?;
        self.summary_of(&self.find(&created.id)?)
    }
}
