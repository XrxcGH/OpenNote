//! The notes commands: the Phase 2 notes contract (app/src/services/notes/types.ts, ADR 0014) served by the core,
//! in the notes folder that setup chose. Each notebook is a folder there in the note format, with its sections,
//! pages, Trash, and history inside it, so the notes folder holds everything that is part of the notes. Only the
//! library's order of notebooks and the core's journals stay on this device.
//!
//! Node IDs are the core's IDs. Errors carry the contract's codes (`not-found`, `invalid-name`, `invalid-move`,
//! `read-only`, `conflict`, `unavailable`, `io`); an `invalid-name` error names its reason in `field`.

pub mod change;
pub mod events;
pub mod migrate;
pub mod trash;
pub mod tree;

#[cfg(test)]
mod tests;

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

use opennote_core::{
    session::notes::{error_code, invalid_name_reason, SaveStatus},
    CoreError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    ipc::{IpcError, IpcResult},
};

/// The event that carries one notes event to the interface.
pub const NOTES_EVENT: &str = "notes:event";

/// The file in a folder that makes it a notebook (docs/format/README.md section 3.2).
pub const NOTEBOOK_FILE: &str = "notebook.json";

/// A node as the contract's `NodeSummary` describes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub id: String,
    pub kind: &'static str,
    pub parent_id: Option<String>,
    pub title: String,
    /// A pen name, or none. Always none for pages.
    pub color: Option<String>,
    pub page_level: u8,
    pub child_count: u32,
    pub created: String,
    pub modified: String,
    pub read_only: bool,
}

/// The contract's `LibraryInfo`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOut {
    pub folder: String,
    pub read_only: bool,
}

/// The contract's `InitialTree`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialTree {
    pub library: LibraryOut,
    pub notebooks: Vec<NodeSummary>,
    pub children: BTreeMap<String, Vec<NodeSummary>>,
    pub resolved_path: Vec<String>,
    pub page: Option<NodeSummary>,
}

/// Where nodes go: before `before_id` among the children of `parent_id`, or at the end.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub before_id: Option<String>,
}

/// The contract's `CreateInput`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    pub kind: String,
    pub placement: Placement,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub page_level: Option<u8>,
}

/// The contract's `TrashReceipt`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptOut {
    pub id: String,
    pub node_ids: Vec<String>,
}

/// The contract's `TrashedItem`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    pub receipt_id: String,
    pub node: NodeSummary,
    pub trashed_at: String,
    pub original_parent_id: Option<String>,
    pub original_parent_title: String,
    pub page_count: u32,
}

/// The save status and whether anything waits to be saved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOut {
    pub status: SaveStatus,
    pub unsaved: bool,
}

/// What a trash call left for its undo: the receipt its items share, and where each root was.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Pending {
    pub receipt: String,
    pub root: String,
    pub parent: Option<String>,
    /// The sibling after the root when it went to Trash, which the root goes back before.
    pub before: Option<String>,
    /// The root's place in the trash call's display order.
    pub order: usize,
}

/// What the notes commands keep between calls.
#[derive(Default)]
pub struct NotesState {
    /// The notes folder in use, where new notebooks go.
    pub(crate) folder: Option<PathBuf>,
    /// Whether this start has opened the library's notebooks and looked for a beta 1 profile.
    pub(crate) started: bool,
    /// The trees the interface last heard about, for the notes events.
    pub(crate) seen: Option<events::Seen>,
    /// Trash items of this session's trash calls, by item key.
    pub(crate) pending: HashMap<String, Pending>,
}

pub(crate) fn error(code: &str, message: impl Into<String>) -> IpcError {
    IpcError::new(code, message)
}

pub(crate) fn not_found(what: &str) -> IpcError {
    error("not-found", format!("{what} isn't there."))
}

pub(crate) fn invalid_move(why: &str) -> IpcError {
    error("invalid-move", why)
}

pub(crate) fn invalid_name(reason: &str) -> IpcError {
    IpcError {
        field: Some(reason.to_owned()),
        ..error("invalid-name", format!("The name is {reason}."))
    }
}

/// A core error with the contract's code.
pub(crate) fn from_core(error: CoreError) -> IpcError {
    let code = error_code(&error);
    if code == "invalid-name" {
        return invalid_name(invalid_name_reason(&error).unwrap_or("empty"));
    }
    IpcError::new(code, error.to_string())
}

/// Whether two paths name the same folder, ignoring case on Windows.
pub(crate) fn same_path(a: &Path, b: &Path) -> bool {
    opennote_core::session::library::same_path(a, b)
}

impl Bridge {
    /// Uses `folder` as the notes folder. The first call of a start migrates a beta 1 profile and opens the
    /// library's notebooks; a new folder is searched for notebooks, so a notes folder copied from another computer
    /// shows its notebooks.
    pub(crate) fn use_folder(&mut self, folder: Option<PathBuf>) {
        if !self.notes.started {
            self.notes.started = true;
            migrate::run(self, folder.as_deref());
            self.open_library();
        }
        let Some(folder) = folder else {
            return;
        };
        if self
            .notes
            .folder
            .as_deref()
            .is_some_and(|known| same_path(known, &folder))
        {
            return;
        }
        self.notes.folder = Some(folder.clone());
        if let Err(error) = fs::create_dir_all(&folder) {
            ::log::warn!("Couldn't create the notes folder: {error}");
        }
        if let Err(error) = self.core.set_library_folder(&folder) {
            ::log::warn!("Couldn't keep the notes folder in the library: {error}");
        }
        self.open_folder_notebooks(&folder);
        migrate::seed_sample(self, &folder);
    }

    /// Opens every notebook of the library whose folder is there.
    fn open_library(&mut self) {
        for notebook in self.core.library().notebooks {
            if notebook.open || !notebook.available {
                continue;
            }
            if let Err(error) = self.core.open_notebook(&notebook.path) {
                ::log::warn!("Couldn't open a notebook of the library: {error}");
            }
        }
        if let Err(error) = self.core.recover_pending(None) {
            ::log::warn!("Couldn't recover the waiting journals: {error}");
        }
    }

    /// Opens the notebooks in `folder` that the library doesn't list yet, such as notebooks another computer made,
    /// in name order. Notebooks this device moved to Trash stay there.
    fn open_folder_notebooks(&mut self, folder: &Path) {
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };
        let library = self.core.library();
        let mut found: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            .map(|entry| entry.path())
            .filter(|path| path.join(NOTEBOOK_FILE).is_file())
            .filter(|path| !library.notebooks.iter().any(|known| same_path(&known.path, path)))
            .filter(|path| !library.removed.iter().any(|gone| same_path(&gone.entry.path, path)))
            .collect();
        found.sort();
        for path in found {
            if let Err(error) = self.core.open_notebook(&path) {
                ::log::warn!("Couldn't open the notebook at {}: {error}", path.display());
            }
        }
    }

    /// The save status, and whether any page has changes that aren't saved yet.
    pub(crate) fn notes_status(&self) -> StatusOut {
        StatusOut {
            status: self.core.save_status(),
            unsaved: self.core.has_unsaved(),
        }
    }

    /// Saves every open page and the journals.
    pub(crate) fn notes_flush(&self) -> IpcResult<()> {
        self.core
            .flush_all(std::time::Duration::from_secs(10))
            .map(|_| ())
            .map_err(from_core)
    }

    /// One notes command by name, with its arguments as the interface sends them, for the notes harness that runs
    /// the contract suite against this bridge.
    pub fn dispatch(&mut self, command: &str, args: &Value) -> IpcResult<Value> {
        fn arg<T: serde::de::DeserializeOwned>(args: &Value, name: &str) -> IpcResult<T> {
            serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
                .map_err(|error| IpcError::invalid(name, &error.to_string()))
        }
        fn out<T: Serialize>(value: T) -> IpcResult<Value> {
            serde_json::to_value(value).map_err(|error| IpcError::new("io", error.to_string()))
        }
        match command {
            "notes_load_initial" => out(self.load_initial(&arg::<Vec<String>>(args, "path")?)?),
            "notes_list_notebooks" => out(self.list_notebooks()),
            "notes_list_children" => out(self.list_children(&arg::<String>(args, "parentId")?)?),
            "notes_get" => out(self.get_node(&arg::<String>(args, "id")?)),
            "notes_create" => out(self.create(arg(args, "input")?)?),
            "notes_rename" => out(self.rename(&arg::<String>(args, "id")?, &arg::<String>(args, "title")?)?),
            "notes_set_color" => out(self.set_color(&arg::<String>(args, "id")?, arg(args, "color")?)?),
            "notes_move" => out(self.move_nodes(&arg::<Vec<String>>(args, "ids")?, &arg(args, "placement")?)?),
            "notes_set_page_level" => out(self.set_page_level(&arg::<Vec<String>>(args, "ids")?, arg(args, "level")?)?),
            "notes_trash" => out(self.trash(&arg::<Vec<String>>(args, "ids")?)?),
            "notes_restore" => out(self.restore(&arg::<String>(args, "receiptId")?)?),
            "notes_list_trash" => out(self.list_trash()?),
            "notes_restore_from_trash" => out(self.restore_from_trash(&arg::<Vec<String>>(args, "ids")?)?),
            "notes_purge" => out(self.purge(&arg::<Vec<String>>(args, "ids")?)?),
            "notes_status" => out(self.notes_status()),
            "notes_flush" => out(self.notes_flush()?),
            _ => Err(IpcError::invalid("command", "isn't a notes command")),
        }
    }
}

/// The library, the notebooks, the children along `path`, and the page at its end, in one call.
#[tauri::command]
pub async fn notes_load_initial(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    path: Vec<String>,
) -> IpcResult<InitialTree> {
    run_notes(&app, &bridge, |bridge| bridge.load_initial(&path))
}

#[tauri::command]
pub async fn notes_list_notebooks(app: AppHandle, bridge: State<'_, CoreBridge>) -> IpcResult<Vec<NodeSummary>> {
    run_notes(&app, &bridge, |bridge| Ok(bridge.list_notebooks()))
}

#[tauri::command]
pub async fn notes_list_children(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    parent_id: String,
) -> IpcResult<Vec<NodeSummary>> {
    run_notes(&app, &bridge, |bridge| bridge.list_children(&parent_id))
}

#[tauri::command]
pub async fn notes_get(app: AppHandle, bridge: State<'_, CoreBridge>, id: String) -> IpcResult<Option<NodeSummary>> {
    run_notes(&app, &bridge, |bridge| Ok(bridge.get_node(&id)))
}

#[tauri::command]
pub async fn notes_create(app: AppHandle, bridge: State<'_, CoreBridge>, input: CreateInput) -> IpcResult<NodeSummary> {
    run_notes(&app, &bridge, |bridge| bridge.create(input))
}

/// Renames a node. A page's title is the one in its `page.json`, which its heading shows too.
#[tauri::command]
pub async fn notes_rename(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    id: String,
    title: String,
) -> IpcResult<NodeSummary> {
    run_notes(&app, &bridge, |bridge| bridge.rename(&id, &title))
}

#[tauri::command]
pub async fn notes_set_color(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    id: String,
    color: Option<String>,
) -> IpcResult<NodeSummary> {
    run_notes(&app, &bridge, |bridge| bridge.set_color(&id, color))
}

#[tauri::command]
pub async fn notes_move(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    ids: Vec<String>,
    placement: Placement,
) -> IpcResult<()> {
    run_notes(&app, &bridge, |bridge| bridge.move_nodes(&ids, &placement))
}

#[tauri::command]
pub async fn notes_set_page_level(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    ids: Vec<String>,
    level: u8,
) -> IpcResult<()> {
    run_notes(&app, &bridge, |bridge| bridge.set_page_level(&ids, level))
}

#[tauri::command]
pub async fn notes_trash(app: AppHandle, bridge: State<'_, CoreBridge>, ids: Vec<String>) -> IpcResult<ReceiptOut> {
    run_notes(&app, &bridge, |bridge| bridge.trash(&ids))
}

#[tauri::command]
pub async fn notes_restore(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    receipt_id: String,
) -> IpcResult<Vec<NodeSummary>> {
    run_notes(&app, &bridge, |bridge| bridge.restore(&receipt_id))
}

#[tauri::command]
pub async fn notes_list_trash(app: AppHandle, bridge: State<'_, CoreBridge>) -> IpcResult<Vec<TrashedItem>> {
    run_notes(&app, &bridge, |bridge| bridge.list_trash())
}

#[tauri::command]
pub async fn notes_restore_from_trash(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    ids: Vec<String>,
) -> IpcResult<Vec<NodeSummary>> {
    run_notes(&app, &bridge, |bridge| bridge.restore_from_trash(&ids))
}

/// Deletes Trash items for good. A notebook in Trash keeps its folder, which File Explorer can delete.
#[tauri::command]
pub async fn notes_purge(app: AppHandle, bridge: State<'_, CoreBridge>, ids: Vec<String>) -> IpcResult<()> {
    run_notes(&app, &bridge, |bridge| bridge.purge(&ids))
}

#[tauri::command]
pub async fn notes_status(app: AppHandle, bridge: State<'_, CoreBridge>) -> IpcResult<StatusOut> {
    run_notes(&app, &bridge, |bridge| Ok(bridge.notes_status()))
}

#[tauri::command]
pub async fn notes_flush(app: AppHandle, bridge: State<'_, CoreBridge>) -> IpcResult<()> {
    run_notes(&app, &bridge, |bridge| bridge.notes_flush())
}
