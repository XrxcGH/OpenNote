//! Moves a beta 1 profile into real notebooks, once, at the first start of a later build.
//!
//! Beta 1 kept the tree in the Phase 2 snapshot, `%LOCALAPPDATA%\OpenNote\phase2-notes.json`, and page content in
//! one notebook of its own, `Pages`, in the notes folder (or under `phase4` for an older profile), with a map from
//! the tree's page IDs to that notebook's pages in `phase4\pages.json`. The migration makes a notebook folder in
//! the notes folder for each notebook of the snapshot, with its section groups, sections, and pages in order, moves
//! each page's content, history, and images from `Pages` into its new place, and rebuilds the snapshot's Trash.
//!
//! First it copies the old files to `%LOCALAPPDATA%\OpenNote\beta-1-backup` and moves the snapshot and the map
//! there, so a migration that fails part way never runs twice. Then it removes the old `Pages` notebook.

use std::{
    collections::{BTreeMap, HashMap},
    fs, io,
    path::{Path, PathBuf},
};

use opennote_core::{
    session::{
        notebook::{NodePlacement, NodeProps, NodeRef, NotebookHandle, ParentRef},
        notes::check_title,
    },
    CoreError, PageId, SectionId,
};
use serde::{Deserialize, Serialize};

use super::{change::pen, NOTEBOOK_FILE};
use crate::core_bridge::Bridge;

/// The Phase 2 snapshot's file, in this device's files.
pub const SNAPSHOT_FILE: &str = "phase2-notes.json";

/// Where the migration keeps the old files.
pub const BACKUP_DIR: &str = "beta-1-backup";

/// The bridge notebook of beta 1.
const OLD_NOTEBOOK: &str = "Pages";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(default)]
    folder: String,
    #[serde(default)]
    notebooks: Vec<SnapNode>,
    #[serde(default)]
    trash: Vec<SnapTrash>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapNode {
    id: String,
    kind: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    page_level: Option<u8>,
    #[serde(default)]
    children: Vec<SnapNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapTrash {
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    nodes: Vec<SnapNode>,
}

/// What a migration did, written beside the backup.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub notebooks: u32,
    pub sections: u32,
    pub pages: u32,
    /// Pages whose content moved from the old `Pages` notebook.
    pub pages_with_content: u32,
    pub trash_items: u32,
    pub problems: Vec<String>,
}

/// Where a node of the snapshot went: its notebook, and what its children go into.
#[derive(Clone)]
struct Made {
    notebook: NotebookHandle,
    parent: ParentRef,
}

struct Migration<'a> {
    bridge: &'a mut Bridge,
    folder: PathBuf,
    old: Option<NotebookHandle>,
    map: BTreeMap<String, String>,
    made: HashMap<String, Made>,
    report: Report,
}

fn count(n: &mut u32) {
    *n = n.saturating_add(1);
}

fn clean_title(title: &str, fallback: &str) -> String {
    check_title(title).unwrap_or_else(|_| fallback.to_owned())
}

/// Copies a folder with everything in it.
pub(crate) fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// A backup folder that isn't there yet.
fn fresh_backup(root: &Path) -> PathBuf {
    let first = root.join(BACKUP_DIR);
    if !first.exists() {
        return first;
    }
    (2..1000)
        .map(|n| root.join(format!("{BACKUP_DIR} ({n})")))
        .find(|path| !path.exists())
        .unwrap_or_else(|| root.join(format!("{BACKUP_DIR} (last)")))
}

/// Migrates a beta 1 profile under `bridge.root`, if there is one, into notebooks in `folder` (or the snapshot's
/// folder). Problems go to the log and the report; the notes that could move have moved.
pub(crate) fn run(bridge: &mut Bridge, folder: Option<&Path>) -> Option<Report> {
    let root = bridge.root.clone();
    if !root.join(SNAPSHOT_FILE).is_file() {
        return None;
    }
    match migrate(bridge, &root, folder) {
        Ok(report) => {
            ::log::info!("Moved the beta 1 notes into notebooks: {report:?}");
            Some(report)
        }
        Err(error) => {
            ::log::error!("Couldn't move the beta 1 notes into notebooks: {error}");
            None
        }
    }
}

fn migrate(bridge: &mut Bridge, root: &Path, folder: Option<&Path>) -> Result<Report, String> {
    let snapshot_file = root.join(SNAPSHOT_FILE);
    let text = fs::read_to_string(&snapshot_file).map_err(|e| format!("reading the snapshot: {e}"))?;
    let snapshot: Snapshot = serde_json::from_str(&text).map_err(|e| format!("reading the snapshot: {e}"))?;
    let folder = folder
        .map(Path::to_path_buf)
        .or_else(|| (!snapshot.folder.is_empty()).then(|| PathBuf::from(&snapshot.folder)))
        .ok_or("there is no notes folder yet")?;
    let map_file = root.join("phase4").join("pages.json");
    let map: BTreeMap<String, String> = match fs::read_to_string(&map_file) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("reading the page map: {e}"))?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => BTreeMap::new(),
        Err(error) => return Err(format!("reading the page map: {error}")),
    };
    let old_dir = [folder.join(OLD_NOTEBOOK), root.join("phase4").join(OLD_NOTEBOOK)]
        .into_iter()
        .find(|dir| dir.join(NOTEBOOK_FILE).is_file());

    // The backup first. The snapshot and the map move into it, so this runs once.
    let backup = fresh_backup(root);
    fs::create_dir_all(&backup).map_err(|e| format!("making the backup folder: {e}"))?;
    if let Some(dir) = &old_dir {
        copy_dir(dir, &backup.join(OLD_NOTEBOOK)).map_err(|e| format!("backing up the Pages notebook: {e}"))?;
    }
    if map_file.is_file() {
        fs::copy(&map_file, backup.join("pages.json")).map_err(|e| format!("backing up the page map: {e}"))?;
    }
    fs::rename(&snapshot_file, backup.join(SNAPSHOT_FILE)).map_err(|e| format!("moving the snapshot: {e}"))?;
    let _ = fs::remove_file(&map_file);

    fs::create_dir_all(&folder).map_err(|e| format!("making the notes folder: {e}"))?;
    let old = match &old_dir {
        Some(dir) => Some(
            bridge
                .core
                .open_notebook(dir)
                .map_err(|e| format!("opening the Pages notebook: {e}"))?,
        ),
        None => None,
    };
    let mut migration = Migration {
        bridge,
        folder,
        old,
        map,
        made: HashMap::new(),
        report: Report::default(),
    };
    for notebook in &snapshot.notebooks {
        if let Err(error) = migration.notebook(notebook) {
            migration
                .report
                .problems
                .push(format!("notebook {}: {error}", notebook.title));
        }
    }
    for item in &snapshot.trash {
        if let Err(error) = migration.trash_item(item) {
            migration.report.problems.push(format!("a Trash item: {error}"));
        }
    }
    migration.remove_old();
    let report = migration.report;
    if let Ok(json) = serde_json::to_vec_pretty(&report) {
        let _ = fs::write(backup.join("migration.json"), json);
    }
    Ok(report)
}

/// The sample library of development and test builds (app/src/services/notes/fixtures.ts, `sample`).
pub(crate) const SAMPLE: &str = include_str!("sample.json");

/// The environment variable that asks a development or test build to start an empty library with the samples.
pub const SEED_VARIABLE: &str = "OPENNOTE_NOTES_SEED";

/// Makes the sample library in `folder` when a development or end-to-end test build asks for it with
/// `OPENNOTE_NOTES_SEED=sample` and the library is empty, as the in-memory service's dev channel did.
pub(crate) fn seed_sample(bridge: &mut Bridge, folder: &Path) {
    if !seeding() || !bridge.core.library().notebooks.is_empty() {
        return;
    }
    if let Err(error) = make_library(bridge, folder, SAMPLE) {
        ::log::warn!("Couldn't make the sample library: {error}");
    }
}

/// Whether this is a development or test build that was asked for the sample library.
pub(crate) fn seeding() -> bool {
    let asked = std::env::var(SEED_VARIABLE).is_ok_and(|seed| seed == "sample");
    asked && (cfg!(debug_assertions) || cfg!(feature = "test-endpoints"))
}

/// Makes the notebooks of snapshot-shaped JSON in `folder`.
pub(crate) fn make_library(bridge: &mut Bridge, folder: &Path, json: &str) -> Result<Report, String> {
    let snapshot: Snapshot = serde_json::from_str(json).map_err(|e| e.to_string())?;
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let mut migration = Migration {
        bridge,
        folder: folder.to_path_buf(),
        old: None,
        map: BTreeMap::new(),
        made: HashMap::new(),
        report: Report::default(),
    };
    for notebook in &snapshot.notebooks {
        migration.notebook(notebook).map_err(|e| e.to_string())?;
    }
    Ok(migration.report)
}

impl Migration<'_> {
    fn notebook(&mut self, node: &SnapNode) -> Result<NotebookHandle, CoreError> {
        let title = clean_title(&node.title, "Untitled notebook");
        let notebook = self.bridge.core.create_notebook(&self.folder, &title)?;
        if let Some(color) = pen(node.color.as_deref()) {
            notebook.set_notebook_color(Some(color))?;
        }
        count(&mut self.report.notebooks);
        self.made.insert(
            node.id.clone(),
            Made {
                notebook: notebook.clone(),
                parent: ParentRef::Notebook,
            },
        );
        for child in &node.children {
            self.child(&notebook, ParentRef::Notebook, child)?;
        }
        Ok(notebook)
    }

    /// A section group or section, at the end of `parent`.
    fn child(&mut self, notebook: &NotebookHandle, parent: ParentRef, node: &SnapNode) -> Result<NodeRef, CoreError> {
        let at = NodePlacement { parent, before: None };
        let made = if node.kind == "sectionGroup" {
            let group = notebook.create_group(&clean_title(&node.title, "Untitled section group"), at)?;
            for child in &node.children {
                self.child(notebook, ParentRef::Group(group), child)?;
            }
            NodeRef::Group(group)
        } else {
            let section = notebook.create_section(&clean_title(&node.title, "Untitled section"), at)?;
            count(&mut self.report.sections);
            self.pages(notebook, section, &node.children)?;
            NodeRef::Section(section)
        };
        if let Some(color) = pen(node.color.as_deref()) {
            let props = NodeProps {
                color: Some(Some(color)),
                ..NodeProps::default()
            };
            notebook.set_props(made, props)?;
        }
        let parent = match made {
            NodeRef::Group(group) => ParentRef::Group(group),
            NodeRef::Section(section) => ParentRef::Section(section),
            NodeRef::Page(page) => ParentRef::Page(page),
        };
        self.made.insert(
            node.id.clone(),
            Made {
                notebook: notebook.clone(),
                parent,
            },
        );
        Ok(made)
    }

    /// Pages at the end of a section, in order, then their levels. Returns the first page.
    fn pages(
        &mut self,
        notebook: &NotebookHandle,
        section: SectionId,
        pages: &[SnapNode],
    ) -> Result<Option<PageId>, CoreError> {
        let mut made = Vec::new();
        for page in pages.iter().filter(|p| p.kind == "page") {
            made.push((self.page(notebook, section, page)?, page.page_level.unwrap_or(0)));
        }
        // Each page in order: the pages after it are still at level 0, so none moves with it.
        for (page, level) in &made {
            if *level > 0 {
                if let Err(error) = notebook.set_page_level(&[*page], *level) {
                    self.report.problems.push(format!("a page level: {error}"));
                }
            }
        }
        Ok(made.first().map(|(page, _)| *page))
    }

    /// One page at the end of a section: the old page with its content when beta 1 kept one, else a new page.
    /// The heading typed on the page is the title, else the name in the list.
    fn page(&mut self, notebook: &NotebookHandle, section: SectionId, node: &SnapNode) -> Result<PageId, CoreError> {
        let title = clean_title(&node.title, "Untitled page");
        let at = NodePlacement {
            parent: ParentRef::Section(section),
            before: None,
        };
        count(&mut self.report.pages);
        let old_page = self.map.get(&node.id).and_then(|id| PageId::parse(id).ok());
        if let (Some(old), Some(page)) = (&self.old, old_page) {
            let moved = match old.tree().find_page(page) {
                Some(_) => old.move_to_notebook(page, notebook, at).map(|_| true),
                None => Ok(false),
            };
            if let Err(error) = &moved {
                // The content stays in the backup; the page still gets its place and name.
                self.report
                    .problems
                    .push(format!("the content of {}: {error}", node.title));
            }
            if moved.unwrap_or(false) {
                count(&mut self.report.pages_with_content);
                let heading = notebook
                    .tree()
                    .find_page(page)
                    .map(|(_, p)| p.title.clone())
                    .unwrap_or_default();
                if heading.trim().is_empty() {
                    notebook.rename(NodeRef::Page(page), &title)?;
                }
                self.made.insert(
                    node.id.clone(),
                    Made {
                        notebook: notebook.clone(),
                        parent: ParentRef::Page(page),
                    },
                );
                return Ok(page);
            }
        }
        let page = notebook.create_page_titled(section, at, &title)?;
        self.made.insert(
            node.id.clone(),
            Made {
                notebook: notebook.clone(),
                parent: ParentRef::Page(page),
            },
        );
        Ok(page)
    }

    /// A Trash item of the snapshot: made again where it was, then moved to Trash.
    fn trash_item(&mut self, item: &SnapTrash) -> Result<(), String> {
        let Some(root) = item.nodes.first() else {
            return Ok(());
        };
        if root.kind == "notebook" {
            let notebook = self.notebook(root).map_err(|e| e.to_string())?;
            let path = notebook.path().to_path_buf();
            self.bridge.core.remove_notebook(&path).map_err(|e| e.to_string())?;
            count(&mut self.report.trash_items);
            return Ok(());
        }
        let parent = item.parent_id.as_ref().and_then(|id| self.made.get(id)).cloned();
        let Some(Made { notebook, parent }) = parent else {
            self.report.problems.push(format!("{}: its place is gone", root.title));
            return Ok(());
        };
        let made = match (root.kind.as_str(), parent) {
            ("page", ParentRef::Section(section)) => {
                let pages = self.pages(&notebook, section, &item.nodes).map_err(|e| e.to_string())?;
                pages.map(NodeRef::Page)
            }
            ("page", _) => None,
            (_, parent) => Some(self.child(&notebook, parent, root).map_err(|e| e.to_string())?),
        };
        if let Some(made) = made {
            notebook.delete(&[made]).map_err(|e| e.to_string())?;
            count(&mut self.report.trash_items);
        }
        Ok(())
    }

    /// Takes the old `Pages` notebook out of the library and deletes its folder, which the backup keeps.
    fn remove_old(&mut self) {
        let Some(old) = self.old.take() else {
            return;
        };
        let path = old.path().to_path_buf();
        if let Err(error) = self.bridge.core.remove_notebook(&path) {
            self.report
                .problems
                .push(format!("closing the Pages notebook: {error}"));
            return;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => {
                if let Err(error) = self.bridge.core.forget_notebook(&path) {
                    self.report
                        .problems
                        .push(format!("forgetting the Pages notebook: {error}"));
                }
            }
            // It stays in Trash on this device, so it doesn't show as a notebook.
            Err(error) => self
                .report
                .problems
                .push(format!("deleting the Pages notebook: {error}")),
        }
    }
}
