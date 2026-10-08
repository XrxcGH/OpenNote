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
    borrow::Cow,
    collections::HashMap,
    fs,
    panic::Location,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError},
    time::{Duration, Instant},
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

/// How long one command may hold the core before the log and the interface hear which one, and how often they
/// hear it again while it goes on. The core serves one command at a time, so a command that never returns stops
/// every later one; beta 4's T2-3 was such a stop, and nothing said what the core was doing. Now the watchdog
/// names the holder, the interface shows that the core isn't responding, and the exit goes on without it.
const HELD_WARNING: Duration = Duration::from_secs(10);

/// How long a command waits for the core before it fails as [`BUSY`] instead of joining the queue behind a
/// command that never returns. The interface sends its commands over the webview's IPC channel, which carries
/// only a handful at a time: once that many wait on the core, nothing else gets through, not even the window's
/// Close or a log line (beta 4's T2-3). A command that fails after this wait keeps the channel open, and the
/// interface says the core isn't responding instead of saying "Saving" for the rest of the session. It is longer
/// than the core's journal `OPEN_TIMEOUT` (10 s, journal_thread.rs), the one bounded wait a command makes on
/// another thread while it holds the core, so a stuck journal open gives up before the commands behind it do.
///
/// The channel's limit stays: the interface keeps one edit in flight per page, but with many pages open their
/// edits and the tree's and search's commands can still fill the channel for one such wait while the core is
/// held. The watchdog reports the holder after [`HELD_WARNING`] all the same.
const COMMAND_WAIT: Duration = Duration::from_secs(15);

/// The error code of a command that gave up waiting for the core. The message names what holds it.
pub const BUSY: &str = "coreBusy";

/// The event that says a command has held the core for too long, with `what` holds it and for how many
/// `seconds`, and the one that says the core answers again.
pub const STALLED_EVENT: &str = "core:stalled";
pub const RESPONSIVE_EVENT: &str = "core:responsive";

/// What holds the core now: since when, and which command.
type Held = Arc<Mutex<Option<(Instant, Cow<'static, str>)>>>;

/// The door the commands queue at: whether the core is taken, and the condition the waiters sleep on until
/// the holder leaves. Serializing the commands here, not on the core's own lock, is what lets a command give up
/// after a bounded wait without polling.
type Door = Arc<(Mutex<bool>, Condvar)>;

/// The taken core: the core's state, given back through the door when dropped (after the state's own guard).
struct CoreGuard<'a> {
    state: MutexGuard<'a, Option<Bridge>>,
    _turn: Turn<'a>,
}

impl std::ops::Deref for CoreGuard<'_> {
    type Target = Option<Bridge>;
    fn deref(&self) -> &Option<Bridge> {
        &self.state
    }
}

impl std::ops::DerefMut for CoreGuard<'_> {
    fn deref_mut(&mut self) -> &mut Option<Bridge> {
        &mut self.state
    }
}

/// Frees the door and wakes the next waiter when a command returns, or unwinds.
struct Turn<'a>(&'a Door);

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        let (taken, freed) = &**self.0;
        *taken.lock().unwrap_or_else(PoisonError::into_inner) = false;
        freed.notify_one();
    }
}

/// Clears the holder when the command returns, or unwinds.
struct Holding(Held);

impl Drop for Holding {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }
}

/// Where a command was called from, for the watchdog: the file and line, with the workspace path trimmed.
fn called_from(location: &Location<'_>) -> String {
    let file = location.file().replace('\\', "/");
    let file = file.rsplit_once("/src/").map_or(file.as_str(), |(_, rest)| rest);
    format!("the command at {file}:{}", location.line())
}

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

/// The managed state behind the notes and page commands. Cloning shares it, so a command can take it onto a
/// blocking thread (see [`CoreBridge::run`]).
#[derive(Clone)]
pub struct CoreBridge {
    /// This device's files, `%LOCALAPPDATA%\OpenNote`: the core's own data and a beta 1 profile's files.
    root: PathBuf,
    /// The started bridge. A start that failed leaves it empty, so the next command tries again.
    state: Arc<Mutex<Option<Bridge>>>,
    /// Where the commands wait for the core; see [`CoreBridge::take_core_within`].
    door: Door,
    relay: Arc<Relay>,
    search: Arc<search::Hub>,
    /// The command that holds the core now, for the watchdog and the exit.
    held: Held,
    /// After how long a held core is reported: [`HELD_WARNING`], shorter in tests.
    warn_after: Duration,
    /// How long a command waits for the core: [`COMMAND_WAIT`], shorter in tests.
    command_wait: Duration,
    /// Set once the watchdog runs. It starts with the first command, before the core does, so a start that
    /// never returns is reported too.
    watched: Arc<OnceLock<()>>,
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
            door: Arc::default(),
            relay: Arc::default(),
            search: Arc::default(),
            held: Arc::default(),
            warn_after: HELD_WARNING,
            command_wait: COMMAND_WAIT,
            watched: Arc::default(),
        }
    }

    /// The same bridge, reporting a held core after `warn_after`. For tests.
    #[cfg(test)]
    pub fn warning_after(mut self, warn_after: Duration) -> CoreBridge {
        self.warn_after = warn_after;
        self
    }

    /// The same bridge, with commands giving up on a held core after `command_wait`. For tests.
    #[cfg(test)]
    pub fn waiting_at_most(mut self, command_wait: Duration) -> CoreBridge {
        self.command_wait = command_wait;
        self
    }

    /// Takes the core, waiting at most `timeout` for the command that holds it. `None` when it is still held
    /// after that. Commands queue at the door: a waiter sleeps on its condition variable until the holder
    /// leaves, not on a poll, so a contended command starts the moment the one before it ends.
    fn take_core_within(&self, timeout: Duration) -> Option<CoreGuard<'_>> {
        let deadline = Instant::now().checked_add(timeout);
        let (taken, freed) = &*self.door;
        let mut taken = taken.lock().unwrap_or_else(PoisonError::into_inner);
        while *taken {
            let left = deadline.map_or(Duration::MAX, |d| d.saturating_duration_since(Instant::now()));
            if left.is_zero() {
                return None;
            }
            taken = freed
                .wait_timeout(taken, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        *taken = true;
        drop(taken);
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        Some(CoreGuard {
            state,
            _turn: Turn(&self.door),
        })
    }

    /// Runs `work` on a blocking thread and answers when it is done. Every command that touches the core goes
    /// through it. The core serves one command at a time, so a command waits for the one before it; waiting on
    /// one of the async runtime's few worker threads meant that one command that never returned took every
    /// worker in turn, and then nothing the interface asked for came back, not even what has nothing to do
    /// with the core (beta 4's T2-3). On a blocking thread a wait costs nothing else: unrelated commands keep
    /// answering, and the watchdog says what the core is busy with.
    pub async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&CoreBridge) -> IpcResult<T> + Send + 'static,
    ) -> IpcResult<T> {
        let bridge = self.clone();
        tauri::async_runtime::spawn_blocking(move || work(&bridge))
            .await
            .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
    }

    /// What holds the core now, for the log.
    fn holder(&self) -> String {
        let holder = self.held.lock().unwrap_or_else(PoisonError::into_inner);
        holder
            .as_ref()
            .map_or("nothing holds it now".to_owned(), |(since, what)| {
                format!("{what} has held it for {} s", since.elapsed().as_secs())
            })
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
    /// tried again by the next command. The watchdog knows the command by where it was called from.
    #[track_caller]
    pub fn with<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        self.with_named(called_from(Location::caller()), work)
    }

    /// [`CoreBridge::with`], with the command's name for the watchdog should it hold the core too long.
    pub fn with_named<T>(
        &self,
        what: impl Into<Cow<'static, str>>,
        work: impl FnOnce(&mut Bridge) -> IpcResult<T>,
    ) -> IpcResult<T> {
        self.watched.get_or_init(|| self.watch_held());
        let what = what.into();
        let Some(mut state) = self.take_core_within(self.command_wait) else {
            let holder = self.holder();
            ::log::error!("{what} gave up waiting for the core: {holder}");
            return Err(IpcError::new(
                BUSY,
                format!("OpenNote's core is busy ({holder}). Try again in a moment."),
            ));
        };
        *self.held.lock().unwrap_or_else(PoisonError::into_inner) = Some((Instant::now(), what));
        let _holding = Holding(self.held.clone());
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
    #[track_caller]
    pub fn notes<T>(&self, folder: Option<PathBuf>, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        self.notes_named(called_from(Location::caller()), folder, work)
    }

    /// [`CoreBridge::notes`], with the command's name for the watchdog.
    pub fn notes_named<T>(
        &self,
        what: impl Into<Cow<'static, str>>,
        folder: Option<PathBuf>,
        work: impl FnOnce(&mut Bridge) -> IpcResult<T>,
    ) -> IpcResult<T> {
        self.with_named(what, |bridge| {
            bridge.use_folder(folder);
            let result = work(bridge);
            bridge.drop_stale_handles();
            // Notebooks this command opened or closed reach the index now, with the tree events.
            self.search.notebooks_changed(&bridge.core);
            bridge.send_tree_events();
            result
        })
    }

    /// Starts the watchdog that reports a command holding the core for longer than `warn_after`: an error in
    /// the log, and [`STALLED_EVENT`] to the interface, again every `warn_after` while it goes on, and then
    /// [`RESPONSIVE_EVENT`] once the command returns. It can't free the core, but the log then says what to
    /// look at, and the title bar says the core isn't responding, where a silent hang said "Saving" forever.
    fn watch_held(&self) {
        let held = Arc::downgrade(&self.held);
        let relay = Arc::downgrade(&self.relay);
        let warn_after = self.warn_after;
        let spawned = std::thread::Builder::new()
            .name("opennote-core-watchdog".into())
            .spawn(move || {
                // The hold last reported, by its start, and when it was reported.
                let mut reported: Option<(Instant, Instant)> = None;
                loop {
                    std::thread::sleep(warn_after / 4);
                    let Some(held) = held.upgrade() else { return };
                    let now = held.lock().unwrap_or_else(PoisonError::into_inner).clone();
                    let send = |name, payload| {
                        if let Some(relay) = relay.upgrade() {
                            relay.send(name, payload);
                        }
                    };
                    let Some((since, what)) = now else {
                        if reported.take().is_some() {
                            ::log::info!("The core answers again");
                            send(RESPONSIVE_EVENT, serde_json::json!({}));
                        }
                        continue;
                    };
                    let elapsed = since.elapsed();
                    let due = match reported {
                        Some((hold, at)) if hold == since => at.elapsed() >= warn_after,
                        _ => elapsed >= warn_after,
                    };
                    if !due {
                        continue;
                    }
                    reported = Some((since, Instant::now()));
                    let seconds = elapsed.as_secs();
                    ::log::error!("{what} has held the core for {seconds} s, and every other command waits for it");
                    send(STALLED_EVENT, serde_json::json!({ "what": what, "seconds": seconds }));
                }
            });
        if let Err(error) = spawned {
            ::log::warn!("Couldn't start the core watchdog: {error}");
        }
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
        self.shutdown_within(EXIT_FLUSH);
    }

    /// [`CoreBridge::shutdown`], waiting at most `timeout` for a command that holds the core. A command that
    /// never returns must not keep the window open with nothing to show for it: the exit goes on without the
    /// final save, and the journals keep every edit for the next start (spec 20).
    pub fn shutdown_within(&self, timeout: Duration) {
        *self.relay.trees.lock().unwrap_or_else(PoisonError::into_inner) = None;
        let Some(state) = self.take_core_within(timeout) else {
            ::log::error!(
                "The core is still busy at exit ({}), so OpenNote exits without a final save. \
                 The journals keep the edits for the next start.",
                self.holder()
            );
            return;
        };
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
#[track_caller]
pub(crate) fn run_notes<T>(
    app: &AppHandle,
    bridge: &CoreBridge,
    work: impl FnOnce(&mut Bridge) -> IpcResult<T>,
) -> IpcResult<T> {
    run_notes_named(app, bridge, called_from(Location::caller()), work)
}

/// [`run_notes`], with the command's name for the watchdog.
pub(crate) fn run_notes_named<T>(
    app: &AppHandle,
    bridge: &CoreBridge,
    what: impl Into<Cow<'static, str>>,
    work: impl FnOnce(&mut Bridge) -> IpcResult<T>,
) -> IpcResult<T> {
    bridge.listen_app(app);
    bridge.notes_named(what, notes_folder(app), work)
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
    bridge
        .run(move |bridge| {
            run_notes_named(&app, bridge, "page_open", |bridge| {
                let handle = bridge.handle(&page, &client)?;
                let envelope = handle.envelope(viewport).map_err(internal)?;
                Ok(Response::new(envelope.bytes))
            })
        })
        .await
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
    bridge
        .run(move |bridge| {
            bridge.with_named("page_apply", |bridge| {
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
        })
        .await
}

/// The applied-changes frame of the undone step, or no bytes when there is nothing to undo.
#[tauri::command]
pub async fn page_undo(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge
        .run(move |bridge| {
            bridge.with_named("page_undo", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                let frame = handle.undo(handle.client()).map_err(edit_error)?;
                Ok(Response::new(frame.map(|frame| frame.bytes).unwrap_or_default()))
            })
        })
        .await
}

#[tauri::command]
pub async fn page_redo(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge
        .run(move |bridge| {
            bridge.with_named("page_redo", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                let frame = handle.redo(handle.client()).map_err(edit_error)?;
                Ok(Response::new(frame.map(|frame| frame.bytes).unwrap_or_default()))
            })
        })
        .await
}

/// Saves the page now, as Ctrl+S does.
#[tauri::command]
pub async fn page_save_now(bridge: State<'_, CoreBridge>, page: String) -> IpcResult<()> {
    bridge
        .run(move |bridge| {
            bridge.with_named("page_save_now", |bridge| {
                for handle in bridge.open_handles(&page) {
                    handle.save_now().map_err(internal)?;
                }
                Ok(())
            })
        })
        .await
}

/// Closes the client's session of the page. The core saves it in the background.
#[tauri::command]
pub async fn page_close(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<()> {
    bridge
        .run(move |bridge| {
            bridge.with_named("page_close", |bridge| {
                let Ok(id) = PageId::parse(&page) else {
                    return Ok(());
                };
                let client = ClientId::parse(&client).map_err(|error| invalid("client", error))?;
                bridge.homes.remove(&(id, client.clone()));
                if let Some(handle) = bridge.open.remove(&(id, client.clone())) {
                    handle.close(&client).map_err(internal)?;
                }
                Ok(())
            })
        })
        .await
}

/// The page's saved versions, newest first (core plan 8).
#[tauri::command]
pub async fn history_list(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Vec<VersionEntry>> {
    bridge
        .run(move |bridge| {
            bridge.with_named("history_list", |bridge| {
                bridge.open_handle(&page, &client)?.history().map_err(core_error)
            })
        })
        .await
}

/// A saved version as a read-only page envelope.
#[tauri::command]
pub async fn history_open(
    bridge: State<'_, CoreBridge>,
    page: String,
    client: String,
    revision: String,
) -> IpcResult<Response> {
    bridge
        .run(move |bridge| {
            bridge.with_named("history_open", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                let envelope = handle.open_version(revision_id(&revision)?).map_err(core_error)?;
                Ok(Response::new(envelope.bytes))
            })
        })
        .await
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
    bridge
        .run(move |bridge| {
            run_notes_named(&app, bridge, "history_restore", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                handle
                    .restore_version(revision_id(&revision)?, as_copy)
                    .map_err(core_error)
            })
        })
        .await
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
    bridge
        .run(move |bridge| {
            bridge.with_named("history_restore_blocks", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                handle
                    .restore_blocks(client_seq, revision_id(&revision)?, &blocks)
                    .map_err(edit_error)
            })
        })
        .await
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
    bridge
        .run(move |bridge| {
            bridge.with_named("history_name", |bridge| {
                let handle = bridge.open_handle(&page, &client)?;
                handle
                    .name_version(revision_id(&revision)?, name, keep)
                    .map_err(core_error)
            })
        })
        .await
}

#[cfg(test)]
#[path = "core_bridge_tests.rs"]
mod tests;
