//! Phase 3's core behind the app's notes and page commands (core plan 11.1; Phase 4 PLAN.md section 3.13).
//!
//! One core serves both. The notes commands in [`crate::notes`] keep the tree of notebooks, section groups,
//! sections, and pages in the notes folder that setup chose, in the note format: one folder per notebook with its
//! `notebook.json`, its sections, and its pages (docs/format/README.md section 3). The page commands here open and
//! edit those pages by their IDs, which are the tree's node IDs. Only the core's device-local data, such as the
//! journals and the library's order of notebooks, stays under `%LOCALAPPDATA%\OpenNote\core`.
//!
//! The core starts with the first command, which is the tree's first load, and a beta 1 profile is migrated then
//! (see [`crate::notes::migrate`]).

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex, OnceLock, PoisonError},
    time::Duration,
};

use opennote_core::{
    model::{history::VersionEntry, page::Rect},
    ops::{
        resolve::{Edit, TxnRequest},
        CoalesceKey,
    },
    session::notebook::NotebookHandle,
    session::{
        core::{Core, CoreConfig},
        events::{CoreEvent, EventSink},
        page::{PageHandle, RestoreResult, TxnAck},
    },
    BlockId, ClientId, CoreError, NotebookId, PageId, RevisionId,
};
use serde_json::Value;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

use crate::{
    ipc::{codes, IpcError, IpcResult},
    notes::NotesState,
    paths::Paths,
    settings::SettingsStore,
};

// Phase 8: search and linking over this core. One command carries every method.
pub mod search;

/// How long the exit flush may take before the journals keep the rest for the next start (core plan 9.3).
const EXIT_FLUSH: Duration = Duration::from_secs(5);

/// The longest page ID the commands take. Page IDs are 26 characters.
const MAX_PAGE_ID: usize = 128;

/// What the interface hears when the core can't start. The cause, which can name local paths, goes to the log.
const NOT_STARTED: &str = "OpenNote couldn't open its notes. Try again in a moment.";

/// Sends one event to the interface.
pub type Emit = Box<dyn Fn(&'static str, Value) + Send + Sync>;

/// Where the core's events go: the app, once the interface has called a command. It holds the app behind a
/// closure, so unit tests and the notes harness never link the windowing code an `AppHandle` drags in. Tree
/// changes the core makes on its own, such as a page's title copy after a save, go to a worker that turns them
/// into notes events.
#[derive(Default)]
pub struct Relay {
    emit: OnceLock<Emit>,
    /// The search indexer, which hears every core event and every save.
    index: OnceLock<opennote_search::IndexerHandle>,
    trees: Mutex<Option<mpsc::Sender<NotebookId>>>,
}

impl Relay {
    /// Sends an event to the interface, if it is listening.
    pub(crate) fn send(&self, name: &'static str, payload: Value) {
        if let Some(emit) = self.emit.get() {
            emit(name, payload);
        }
    }
}

/// The core's events, as `core:*` events for the interface (core plan 11.2).
struct AppEvents(Arc<Relay>);

impl EventSink for AppEvents {
    fn emit(&self, event: CoreEvent) {
        if let Some(index) = self.0.index.get() {
            index.on_event(&event);
        }
        if let CoreEvent::SaveFailed { .. } = &event {
            ::log::warn!("The core couldn't save a page: {event:?}");
        }
        if let CoreEvent::TreeChanged { notebook } = &event {
            if let Some(trees) = self.0.trees.lock().unwrap_or_else(PoisonError::into_inner).as_ref() {
                let _ = trees.send(*notebook);
            }
            return;
        }
        let name = match &event {
            CoreEvent::TxnApplied { .. } => "core:txn-applied",
            CoreEvent::ExternalChange { .. } => "core:external-change",
            CoreEvent::ReadOnly { .. } => "core:read-only",
            CoreEvent::Saved { .. } => "core:saved",
            CoreEvent::SaveFailed { .. } => "core:save-failed",
            _ => return,
        };
        let Ok(payload) = serde_json::to_value(&event) else {
            return;
        };
        self.0.send(name, payload);
    }
}

/// The managed state behind the notes and page commands.
pub struct CoreBridge {
    /// This device's files, `%LOCALAPPDATA%\OpenNote`: the core's own data and a beta 1 profile's files.
    root: PathBuf,
    /// The started bridge. A start that failed leaves it empty, so the next command tries again.
    state: Arc<Mutex<Option<Bridge>>>,
    relay: Arc<Relay>,
    search: Arc<search::Hub>,
}

/// The started core with what the commands keep beside it.
pub struct Bridge {
    pub(crate) core: Core,
    /// This device's files.
    pub(crate) root: PathBuf,
    /// Open pages by page and client.
    pub(crate) open: HashMap<(PageId, ClientId), PageHandle>,
    /// The notebook each open page was opened in.
    homes: HashMap<(PageId, ClientId), NotebookId>,
    pub(crate) notes: NotesState,
    pub(crate) relay: Arc<Relay>,
}

fn internal(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::INTERNAL, error.to_string())
}

fn invalid(field: &str, error: impl std::fmt::Display) -> IpcError {
    IpcError::invalid(field, &error.to_string())
}

/// A core error with the code the page service reads: an edit's own code, `readOnly`, `notFound`, or internal.
pub(crate) fn core_error(error: CoreError) -> IpcError {
    let code = match &error {
        CoreError::Edit(edit) => edit.code(),
        CoreError::ReadOnly(_) => "readOnly",
        CoreError::NotFound(_) => "notFound",
        _ => codes::INTERNAL,
    };
    IpcError::new(code, error.to_string())
}

fn revision_id(text: &str) -> IpcResult<RevisionId> {
    RevisionId::parse(text).map_err(|error| invalid("revision", error))
}

/// Checks a page argument: a short, plain ID, as page IDs are.
pub(crate) fn check_page(page: &str) -> IpcResult<()> {
    let plain = page
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if page.is_empty() || page.len() > MAX_PAGE_ID || !plain {
        return Err(IpcError::invalid("page", "isn't a page ID"));
    }
    Ok(())
}

/// The core's device-local data folder. A beta 1 profile kept it under `phase4`; it moves to `core` once, so the
/// device, the journals, and the library stay as they were.
fn data_dir(root: &Path) -> PathBuf {
    let data = root.join("core");
    let old = root.join("phase4").join("core");
    if !data.exists() && old.is_dir() {
        if let Err(error) = fs::rename(&old, &data) {
            ::log::warn!("Couldn't move the core's data from phase4: {error}");
            return old;
        }
    }
    data
}

impl Bridge {
    fn start(root: &Path, relay: Arc<Relay>, search: &search::Hub) -> Result<Bridge, IpcError> {
        let config = CoreConfig::production(data_dir(root), env!("CARGO_PKG_VERSION").to_owned()).map_err(internal)?;
        // The index starts first, because the core's save hook and events need its handle.
        search.spawn(root, &relay)?;
        let core = Core::start(config, Arc::new(AppEvents(relay.clone())), search.sink()).map_err(internal)?;
        search.attach(&core);
        Ok(Bridge {
            core,
            root: root.to_path_buf(),
            open: HashMap::new(),
            homes: HashMap::new(),
            notes: NotesState::default(),
            relay,
        })
    }

    /// The client's open session of a page, for every command but page_open.
    pub(crate) fn open_handle(&self, page: &str, client: &str) -> IpcResult<PageHandle> {
        check_page(page)?;
        let not_open = || IpcError::new("notFound", "This page isn't open.");
        let id = PageId::parse(page).map_err(|_| not_open())?;
        let client = ClientId::parse(client).map_err(|error| invalid("client", error))?;
        self.open.get(&(id, client)).cloned().ok_or_else(not_open)
    }

    /// The client's session of a page, opened when needed (page_open). The page must be in an open notebook.
    pub(crate) fn handle(&mut self, page: &str, client: &str) -> IpcResult<PageHandle> {
        check_page(page)?;
        let missing = || IpcError::new("notFound", "This page isn't in any notebook.");
        let id = PageId::parse(page).map_err(|_| missing())?;
        let client = ClientId::parse(client).map_err(|error| invalid("client", error))?;
        if let Some(handle) = self.open.get(&(id, client.clone())) {
            return Ok(handle.clone());
        }
        let (notebook, _) = self.core.find_node(id.0).ok_or_else(missing)?;
        let handle = notebook.open_page(id, client.clone()).map_err(core_error)?;
        self.homes.insert((id, client.clone()), notebook.id());
        self.open.insert((id, client), handle.clone());
        Ok(handle)
    }

    /// Closes the client's session of a page, if it has one. The core saves the page in the background.
    pub(crate) fn close_handle(&mut self, page: &str, client: &str) -> IpcResult<()> {
        let Ok(id) = PageId::parse(page) else {
            return Ok(());
        };
        let client = ClientId::parse(client).map_err(|error| invalid("client", error))?;
        self.homes.remove(&(id, client.clone()));
        if let Some(handle) = self.open.remove(&(id, client.clone())) {
            handle.close(&client).map_err(internal)?;
        }
        Ok(())
    }

    fn open_handles(&self, page: &str) -> Vec<PageHandle> {
        let Ok(id) = PageId::parse(page) else {
            return Vec::new();
        };
        self.open
            .iter()
            .filter(|((open, _), _)| *open == id)
            .map(|(_, handle)| handle.clone())
            .collect()
    }

    /// Forgets the sessions of pages that left their notebook, such as pages moved to Trash or to another notebook.
    /// The interface opens a page again when it needs it.
    pub(crate) fn drop_stale_handles(&mut self) {
        let core = &self.core;
        let homes = &self.homes;
        let stale: Vec<(PageId, ClientId)> = self
            .open
            .keys()
            .filter(|key| {
                let home = homes.get(*key).copied();
                !core
                    .find_node(key.0 .0)
                    .is_some_and(|(notebook, node)| node.is_some() && Some(notebook.id()) == home)
            })
            .cloned()
            .collect();
        for key in stale {
            self.homes.remove(&key);
            if let Some(handle) = self.open.remove(&key) {
                let _ = handle.close(&key.1);
            }
        }
    }
}

impl CoreBridge {
    pub fn new(paths: &Paths) -> CoreBridge {
        CoreBridge::at(paths.local.clone())
    }

    /// A bridge whose device-local files are under `root`, for tests and the notes harness.
    pub fn at(root: PathBuf) -> CoreBridge {
        CoreBridge {
            root,
            state: Arc::new(Mutex::new(None)),
            relay: Arc::default(),
            search: Arc::default(),
        }
    }

    /// Sends the core's events through `emit`. The first call wins.
    pub fn listen(&self, emit: Emit) {
        let _ = self.relay.emit.set(emit);
    }

    /// Lets the core's events reach the app's window.
    fn listen_app(&self, app: &AppHandle) {
        if self.relay.emit.get().is_some() {
            return;
        }
        let app = app.clone();
        self.listen(Box::new(move |name, payload| {
            if let Err(error) = app.emit(name, payload) {
                ::log::warn!("Couldn't send {name} to the interface: {error}");
            }
        }));
    }

    /// Runs `work` on the bridge, starting the core first if it hasn't started. A start that fails is logged and
    /// tried again by the next command.
    pub fn with<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.is_none() {
            match Bridge::start(&self.root, self.relay.clone(), &self.search) {
                Ok(bridge) => {
                    *state = Some(bridge);
                    self.watch_trees();
                }
                Err(error) => {
                    ::log::error!("The core couldn't start: {}", error.message);
                    return Err(IpcError::new(codes::INTERNAL, NOT_STARTED));
                }
            }
        }
        match state.as_mut() {
            Some(bridge) => work(bridge),
            None => Err(IpcError::new(codes::INTERNAL, NOT_STARTED)),
        }
    }

    /// Runs a notes command in the notes folder `folder`, after the folder's notebooks are open and a beta 1
    /// profile is migrated, and sends the notes events for what it changed.
    pub fn notes<T>(&self, folder: Option<PathBuf>, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        self.with(|bridge| {
            bridge.use_folder(folder);
            let result = work(bridge);
            bridge.drop_stale_handles();
            // Notebooks this command opened or closed reach the index now, with the tree events.
            self.search.notebooks_changed(&bridge.core);
            bridge.send_tree_events();
            result
        })
    }

    /// Starts the worker that turns tree changes the core makes on its own into notes events.
    fn watch_trees(&self) {
        let (sender, receiver) = mpsc::channel::<NotebookId>();
        *self.relay.trees.lock().unwrap_or_else(PoisonError::into_inner) = Some(sender);
        let state = Arc::downgrade(&self.state);
        let spawned = std::thread::Builder::new()
            .name("opennote-tree-events".into())
            .spawn(move || {
                while receiver.recv().is_ok() {
                    // A burst of changes needs one pass.
                    while receiver.try_recv().is_ok() {}
                    let Some(state) = state.upgrade() else {
                        return;
                    };
                    let mut state = state.lock().unwrap_or_else(PoisonError::into_inner);
                    if let Some(bridge) = state.as_mut() {
                        bridge.send_tree_events();
                    }
                }
            });
        if let Err(error) = spawned {
            ::log::warn!("Couldn't start the tree events worker: {error}");
        }
    }

    /// The open notebooks, which are the notebook folders in the notes folder. It starts the core and opens the
    /// library if that has not happened. The answer is empty when the core can't start. The self-check reads the
    /// notebooks through their own `verify`.
    pub fn notebooks(&self) -> Vec<NotebookHandle> {
        self.notes(None, |bridge| Ok(bridge.core.notebooks()))
            .unwrap_or_default()
            .into_iter()
            .filter(|notebook| !notebook.is_backup())
            .collect()
    }

    /// Saves every page and stops the core. The app calls it on exit.
    pub fn shutdown(&self) {
        *self.relay.trees.lock().unwrap_or_else(PoisonError::into_inner) = None;
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(bridge) = state.as_ref() {
            if let Err(error) = bridge.core.flush_all(EXIT_FLUSH) {
                ::log::error!("Couldn't save the open pages: {error}");
            }
            // The index follows the saves just flushed, then closes before the core goes.
            self.search.close();
            bridge.core.shutdown(EXIT_FLUSH);
        }
    }
}

/// The notes folder that settings name, if setup has chosen one. A test build asked for the sample library uses
/// the folder setup proposes until then.
pub(crate) fn notes_folder(app: &AppHandle) -> Option<PathBuf> {
    let chosen = app
        .state::<SettingsStore>()
        .get()
        .storage
        .notes_folder
        .filter(|folder| !folder.is_empty())
        .map(PathBuf::from);
    chosen.or_else(|| crate::notes::migrate::seeding().then(|| app.state::<Paths>().documents.join("OpenNote")))
}

/// Runs a notes command for the app: its events go to the window, in the notes folder from settings.
pub(crate) fn run_notes<T>(
    app: &AppHandle,
    bridge: &CoreBridge,
    work: impl FnOnce(&mut Bridge) -> IpcResult<T>,
) -> IpcResult<T> {
    bridge.listen_app(app);
    bridge.notes(notes_folder(app), work)
}

/// An open page of the core, for Phase 4's image commands (P3-8).
pub fn page_handle(app: &AppHandle, page: PageId) -> Option<PageHandle> {
    let bridge = app.state::<CoreBridge>();
    let state = bridge.state.lock().unwrap_or_else(PoisonError::into_inner);
    match state.as_ref() {
        Some(bridge) => bridge
            .open
            .iter()
            .find(|((id, _), _)| *id == page)
            .map(|(_, handle)| handle.clone()),
        _ => None,
    }
}

/// The core page an interface page ID names: they are the same ID.
pub fn core_page_id(_app: &AppHandle, page: &str) -> Option<PageId> {
    PageId::parse(page).ok()
}

fn edit_error(error: opennote_core::EditError) -> IpcError {
    IpcError::new(error.code(), error.to_string())
}

/// The page envelope (core plan 11.3): session JSON, page.json, and the live strokes, in one buffer.
#[tauri::command]
pub async fn page_open(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    viewport: Option<Rect>,
) -> IpcResult<Response> {
    run_notes(&app, &bridge, |bridge| {
        let handle = bridge.handle(&page, &client)?;
        let envelope = handle.envelope(viewport).map_err(internal)?;
        Ok(Response::new(envelope.bytes))
    })
}

/// One transaction from the interface, in the client's sequence (core plan 11.4).
#[tauri::command]
pub async fn page_apply(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    client_seq: u64,
    coalesce: Option<CoalesceKey>,
    ui: Option<Value>,
    edits: Vec<Edit>,
) -> IpcResult<TxnAck> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        let request = TxnRequest {
            page: handle.id(),
            client: handle.client().clone(),
            client_seq,
            coalesce,
            ui,
            edits,
        };
        handle.apply(request).map_err(edit_error)
    })
}

/// The applied-changes frame of the undone step, or no bytes when there is nothing to undo.
#[tauri::command]
pub async fn page_undo(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        let frame = handle.undo(handle.client()).map_err(edit_error)?;
        Ok(Response::new(frame.map(|frame| frame.bytes).unwrap_or_default()))
    })
}

#[tauri::command]
pub async fn page_redo(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        let frame = handle.redo(handle.client()).map_err(edit_error)?;
        Ok(Response::new(frame.map(|frame| frame.bytes).unwrap_or_default()))
    })
}

/// Saves the page now, as Ctrl+S does.
#[tauri::command]
pub async fn page_save_now(bridge: State<'_, CoreBridge>, page: String) -> IpcResult<()> {
    bridge.with(|bridge| {
        for handle in bridge.open_handles(&page) {
            handle.save_now().map_err(internal)?;
        }
        Ok(())
    })
}

/// Closes the client's session of the page. The core saves it in the background.
#[tauri::command]
pub async fn page_close(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<()> {
    bridge.with(|bridge| bridge.close_handle(&page, &client))
}

/// The page's saved versions, newest first (core plan 8).
#[tauri::command]
pub async fn history_list(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Vec<VersionEntry>> {
    bridge.with(|bridge| bridge.open_handle(&page, &client)?.history().map_err(core_error))
}

/// A saved version as a read-only page envelope.
#[tauri::command]
pub async fn history_open(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    revision: String,
) -> IpcResult<Response> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        let envelope = handle.open_version(revision_id(&revision)?).map_err(core_error)?;
        Ok(Response::new(envelope.bytes))
    })
}

/// Restores a version in place, or as a new page, which the notes events then add to the tree.
#[tauri::command]
pub async fn history_restore(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    revision: String,
    as_copy: bool,
) -> IpcResult<RestoreResult> {
    run_notes(&app, &bridge, |bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        handle
            .restore_version(revision_id(&revision)?, as_copy)
            .map_err(core_error)
    })
}

/// Brings blocks back from a version as one transaction of the client (P3-7).
#[tauri::command]
pub async fn history_restore_blocks(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    client_seq: u64,
    revision: String,
    blocks: Vec<BlockId>,
) -> IpcResult<TxnAck> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        handle
            .restore_blocks(client_seq, revision_id(&revision)?, &blocks)
            .map_err(edit_error)
    })
}

/// Names a version, or marks it to keep forever.
#[tauri::command]
pub async fn history_name(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    revision: String,
    name: Option<String>,
    keep: bool,
) -> IpcResult<()> {
    bridge.with(|bridge| {
        let handle = bridge.open_handle(&page, &client)?;
        handle
            .name_version(revision_id(&revision)?, name, keep)
            .map_err(core_error)
    })
}

#[cfg(test)]
#[path = "core_bridge_tests.rs"]
mod tests;
