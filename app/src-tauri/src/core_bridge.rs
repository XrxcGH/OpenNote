//! Phase 3's core behind the page commands (core plan 11.1; Phase 4 PLAN.md section 3.13). Phase 3 planned this
//! bridge for its notes service; WP0 of Phase 4 builds the part pages need, so typed text reaches the core and
//! survives a restart.
//!
//! Until the storage-backed notes service lands (`storage.core`), the interface's pages come from Phase 2's notes
//! snapshot, whose IDs the core doesn't know. The bridge keeps their content in one notebook of its own, under
//! `%LOCALAPPDATA%\OpenNote\phase4`, and a small map from each interface page ID to the core page that holds it.
//! The core starts the first time a page opens, so start-up doesn't wait for it.
//!
//! WP2 adds the history commands and turns the core's events into `core:*` events for the interface, with the
//! interface's page IDs.

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, PoisonError},
    time::Duration,
};

use opennote_core::{
    model::{history::VersionEntry, page::Rect},
    ops::{
        resolve::{Edit, TxnRequest},
        CoalesceKey,
    },
    session::{
        core::{Core, CoreConfig},
        events::{CoreEvent, EventSink},
        notebook::{NodePlacement, NotebookHandle, ParentRef},
        page::{PageHandle, RestoreResult, TxnAck},
    },
    BlockId, ClientId, CoreError, PageId, RevisionId, SectionId,
};
use serde_json::Value;
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State};

use crate::{
    ipc::{codes, IpcError, IpcResult},
    paths::Paths,
    settings::file::write_atomic,
};

/// How long the exit flush may take before the journals keep the rest for the next start (core plan 9.3).
const EXIT_FLUSH: Duration = Duration::from_secs(5);

/// Sends one event to the interface.
type Emit = Box<dyn Fn(&'static str, Value) + Send + Sync>;

/// Where the core's page events go: the app, once a page has opened, under the interface's page IDs. It holds the
/// app behind a closure, so unit tests never link the windowing code an `AppHandle` drags in.
#[derive(Default)]
struct Relay {
    emit: OnceLock<Emit>,
    /// Core page ID to interface page ID.
    pages: Mutex<HashMap<PageId, String>>,
}

/// The core's events, as `core:*` events for the interface (core plan 11.2).
struct AppEvents(Arc<Relay>);

impl EventSink for AppEvents {
    fn emit(&self, event: CoreEvent) {
        if let CoreEvent::SaveFailed { .. } = &event {
            ::log::warn!("The core couldn't save a page: {event:?}");
        }
        let (name, page) = match &event {
            CoreEvent::TxnApplied { page, .. } => ("core:txn-applied", *page),
            CoreEvent::ExternalChange { page, .. } => ("core:external-change", *page),
            CoreEvent::ReadOnly { page, .. } => ("core:read-only", *page),
            CoreEvent::Saved { page, .. } => ("core:saved", *page),
            CoreEvent::SaveFailed { page, .. } => ("core:save-failed", *page),
            _ => return,
        };
        let Some(emit) = self.0.emit.get() else {
            return;
        };
        let pages = self.0.pages.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(ui) = pages.get(&page).cloned() else {
            return;
        };
        drop(pages);
        let Ok(mut payload) = serde_json::to_value(&event) else {
            return;
        };
        payload["page"] = Value::String(ui);
        emit(name, payload);
    }
}

/// The managed state behind the page commands.
pub struct CoreBridge {
    root: PathBuf,
    state: Mutex<Option<Result<Bridge, String>>>,
    relay: Arc<Relay>,
}

struct Bridge {
    core: Core,
    notebook: NotebookHandle,
    section: SectionId,
    map_file: PathBuf,
    /// Interface page ID to core page ID.
    map: BTreeMap<String, String>,
    /// Open pages by core page and client.
    open: HashMap<(PageId, ClientId), PageHandle>,
    relay: Arc<Relay>,
}

fn internal(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::INTERNAL, error.to_string())
}

fn invalid(field: &str, error: impl std::fmt::Display) -> IpcError {
    IpcError::invalid(field, &error.to_string())
}

/// A core error with the code the page service reads: an edit's own code, `readOnly`, `notFound`, or internal.
fn core_error(error: CoreError) -> IpcError {
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

impl Bridge {
    fn start(root: &Path, relay: Arc<Relay>) -> Result<Bridge, IpcError> {
        let config =
            CoreConfig::production(root.join("core"), env!("CARGO_PKG_VERSION").to_owned()).map_err(internal)?;
        let core = Core::start(config, Arc::new(AppEvents(relay.clone())), None).map_err(internal)?;
        let dir = root.join("Pages");
        let notebook = if dir.join("notebook.json").exists() {
            core.open_notebook(&dir)
        } else {
            core.create_notebook(root, "Pages")
        }
        .map_err(internal)?;
        let section = match notebook.tree().sections.first() {
            Some(section) => section.id,
            None => {
                let at = NodePlacement {
                    parent: ParentRef::Notebook,
                    before: None,
                };
                notebook.create_section("Pages", at).map_err(internal)?
            }
        };
        let map_file = root.join("pages.json");
        let map = fs::read_to_string(&map_file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Ok(Bridge {
            core,
            notebook,
            section,
            map_file,
            map,
            open: HashMap::new(),
            relay,
        })
    }

    /// Lets the core's events for a core page reach the interface under its page ID.
    fn relay_page(&self, ui: &str, core: PageId) {
        let mut pages = self.relay.pages.lock().unwrap_or_else(PoisonError::into_inner);
        pages.entry(core).or_insert_with(|| ui.to_owned());
    }

    /// The core page that holds an interface page, made the first time it opens.
    fn core_page(&mut self, page: &str) -> IpcResult<PageId> {
        if let Some(id) = self.map.get(page) {
            return PageId::parse(id).map_err(|error| invalid("page", error));
        }
        let at = NodePlacement {
            parent: ParentRef::Section(self.section),
            before: None,
        };
        let id = self.notebook.create_page(self.section, at).map_err(internal)?;
        self.map.insert(page.to_owned(), id.to_string());
        let json = serde_json::to_vec_pretty(&self.map).map_err(internal)?;
        write_atomic(&self.map_file, &json)?;
        Ok(id)
    }

    fn handle(&mut self, page: &str, client: &str) -> IpcResult<PageHandle> {
        let id = self.core_page(page)?;
        self.relay_page(page, id);
        let client = ClientId::parse(client).map_err(|error| invalid("client", error))?;
        if let Some(handle) = self.open.get(&(id, client.clone())) {
            return Ok(handle.clone());
        }
        let handle = self.notebook.open_page(id, client.clone()).map_err(internal)?;
        self.open.insert((id, client), handle.clone());
        Ok(handle)
    }

    fn open_handles(&self, page: &str) -> Vec<PageHandle> {
        let Some(id) = self.map.get(page).and_then(|id| PageId::parse(id).ok()) else {
            return Vec::new();
        };
        self.open
            .iter()
            .filter(|((open, _), _)| *open == id)
            .map(|(_, handle)| handle.clone())
            .collect()
    }
}

impl CoreBridge {
    pub fn new(paths: &Paths) -> CoreBridge {
        CoreBridge::at(paths.local.join("phase4"))
    }

    fn at(root: PathBuf) -> CoreBridge {
        CoreBridge {
            root,
            state: Mutex::new(None),
            relay: Arc::default(),
        }
    }

    /// Runs `work` on the bridge, starting the core first if it hasn't started.
    fn with<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.is_none() {
            *state = Some(Bridge::start(&self.root, self.relay.clone()).map_err(|error| error.message));
        }
        match state.as_mut() {
            Some(Ok(bridge)) => work(bridge),
            Some(Err(message)) => Err(IpcError::new(codes::INTERNAL, message.clone())),
            None => Err(IpcError::new(codes::INTERNAL, "The core didn't start.")),
        }
    }

    /// Saves every page and stops the core. The app calls it on exit.
    pub fn shutdown(&self) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(Ok(bridge)) = state.as_ref() {
            if let Err(error) = bridge.core.flush_all(EXIT_FLUSH) {
                ::log::error!("Couldn't save the open pages: {error}");
            }
            bridge.core.shutdown(EXIT_FLUSH);
        }
    }
}

/// An open page of the core, for Phase 4's image commands (P3-8).
pub fn page_handle(app: &AppHandle, page: PageId) -> Option<PageHandle> {
    let bridge = app.state::<CoreBridge>();
    let state = bridge.state.lock().unwrap_or_else(PoisonError::into_inner);
    match state.as_ref() {
        Some(Ok(bridge)) => bridge
            .open
            .iter()
            .find(|((id, _), _)| *id == page)
            .map(|(_, handle)| handle.clone()),
        _ => None,
    }
}

/// The core page that holds an interface page, if it was ever opened.
pub fn core_page_id(app: &AppHandle, page: &str) -> Option<PageId> {
    let bridge = app.state::<CoreBridge>();
    let state = bridge.state.lock().unwrap_or_else(PoisonError::into_inner);
    match state.as_ref() {
        Some(Ok(bridge)) => bridge.map.get(page).and_then(|id| PageId::parse(id).ok()),
        _ => None,
    }
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
    bridge.relay.emit.get_or_init(|| {
        Box::new(move |name, payload| {
            if let Err(error) = app.emit(name, payload) {
                ::log::warn!("Couldn't send {name} to the interface: {error}");
            }
        })
    });
    bridge.with(|bridge| {
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
        let handle = bridge.handle(&page, &client)?;
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
        let handle = bridge.handle(&page, &client)?;
        let frame = handle.undo(handle.client()).map_err(edit_error)?;
        Ok(Response::new(frame.map(|frame| frame.bytes).unwrap_or_default()))
    })
}

#[tauri::command]
pub async fn page_redo(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge.with(|bridge| {
        let handle = bridge.handle(&page, &client)?;
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
    bridge.with(|bridge| {
        let Some(id) = bridge.map.get(&page).and_then(|id| PageId::parse(id).ok()) else {
            return Ok(());
        };
        let client = ClientId::parse(&client).map_err(|error| invalid("client", error))?;
        if let Some(handle) = bridge.open.remove(&(id, client.clone())) {
            handle.close(&client).map_err(internal)?;
        }
        Ok(())
    })
}

/// The page's saved versions, newest first (core plan 8).
#[tauri::command]
pub async fn history_list(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Vec<VersionEntry>> {
    bridge.with(|bridge| bridge.handle(&page, &client)?.history().map_err(core_error))
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
        let handle = bridge.handle(&page, &client)?;
        let envelope = handle.open_version(revision_id(&revision)?).map_err(core_error)?;
        Ok(Response::new(envelope.bytes))
    })
}

/// Restores a version in place, or as a new page.
#[tauri::command]
pub async fn history_restore(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    revision: String,
    as_copy: bool,
) -> IpcResult<RestoreResult> {
    bridge.with(|bridge| {
        let handle = bridge.handle(&page, &client)?;
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
        let handle = bridge.handle(&page, &client)?;
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
        let handle = bridge.handle(&page, &client)?;
        handle
            .name_version(revision_id(&revision)?, name, keep)
            .map_err(core_error)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use opennote_core::ops::resolve::Edit;

    fn text_of(handle: &PageHandle) -> String {
        let envelope = handle.envelope(None).expect("an envelope");
        let decoded = opennote_core::wire::envelope::decode(&envelope.bytes).expect("decodes");
        let page: Value = serde_json::from_slice(decoded.page_json).expect("page JSON");
        page["blocks"][0]["data"]["markdown"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    fn insert(handle: &PageHandle, seq: u64, markdown: &str) {
        let block: opennote_core::ops::resolve::NewBlock = serde_json::from_value(serde_json::json!({
            "id": "01k6f00000000000000000b001", "type": "text", "data": { "markdown": markdown }
        }))
        .expect("a new block");
        let request = TxnRequest {
            page: handle.id(),
            client: handle.client().clone(),
            client_seq: seq,
            coalesce: None,
            ui: None,
            edits: vec![Edit::InsertBlock {
                block,
                after: None,
                before: None,
            }],
        };
        handle.apply(request).expect("applies");
    }

    #[test]
    fn typed_text_survives_a_restart_of_the_core() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().to_owned());
        bridge
            .with(|bridge| {
                let handle = bridge.handle("p-mitosis", "main-1")?;
                insert(&handle, 1, "Cells divide");
                Ok(())
            })
            .expect("the first run");
        bridge.shutdown();
        let again = CoreBridge::at(dir.path().to_owned());
        let text = again
            .with(|bridge| Ok(text_of(&bridge.handle("p-mitosis", "main-1")?)))
            .expect("the second run");
        again.shutdown();
        assert_eq!(text, "Cells divide");
    }

    #[test]
    fn each_interface_page_gets_its_own_core_page() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().to_owned());
        let (one, two, again) = bridge
            .with(|bridge| Ok((bridge.core_page("a")?, bridge.core_page("b")?, bridge.core_page("a")?)))
            .expect("pages");
        bridge.shutdown();
        assert_ne!(one, two);
        assert_eq!(one, again);
    }

    #[test]
    fn events_name_the_interface_page_and_history_keeps_closed_versions() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().to_owned());
        let (core, versions) = bridge
            .with(|bridge| {
                let handle = bridge.handle("p-history", "main-1")?;
                insert(&handle, 1, "Kept when closed");
                let client = handle.client().clone();
                bridge.open.remove(&(handle.id(), client.clone()));
                handle.close(&client).map_err(internal)?;
                let again = bridge.handle("p-history", "main-1")?;
                Ok((again.id(), again.history().map_err(core_error)?))
            })
            .expect("a saved page");
        let named = bridge.relay.pages.lock().expect("the relay").get(&core).cloned();
        bridge.shutdown();
        assert_eq!(named.as_deref(), Some("p-history"));
        assert!(!versions.is_empty());
        assert_eq!(core_error(CoreError::NotFound("version".into())).code, "notFound");
    }
}
