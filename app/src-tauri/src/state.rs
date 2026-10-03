//! Device state in `%LOCALAPPDATA%\OpenNote\state.json` (ARCHITECTURE.md section 16.4): window placement, pane
//! widths, the last location, expanded ids, recent commands, recent pages, device-scoped setup progress, per-page
//! view state, and the ink device state. Losing it is harmless, so a corrupt file is set aside and the defaults
//! used. Rust owns `window`; the interface patches the rest, and a writer thread saves it 500 ms later.

pub mod page_views;

use std::{
    collections::BTreeMap,
    fs,
    sync::{Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::{
    boot::Notice,
    ipc::{IpcError, IpcResult},
    paths::Paths,
    settings::{file, ink::InkDeviceState, lenient, patch, validate::Check, writer::Writer},
    window::placement::WindowPlacement,
};
use page_views::{PageViewState, MAX_PAGE_VIEWS};

/// The format version this build writes.
pub const STATE_VERSION: u32 = 1;

/// How long the writer folds device state changes together before saving.
pub const SAVE_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct DeviceState {
    #[cfg_attr(test, ts(type = "1"))]
    pub state_version: u32,
    #[cfg_attr(test, ts(inline))]
    pub window: WindowState,
    #[cfg_attr(test, ts(inline))]
    pub panes: Panes,
    pub location: StoredLocation,
    pub expanded: Vec<String>,
    pub last_page_by_section: BTreeMap<String, String>,
    pub recent_commands: Vec<String>,
    /// Page ids, most recent first, so the quick switcher (Ctrl+O) lists recent pages first.
    pub recent_pages: Vec<String>,
    #[cfg_attr(test, ts(inline))]
    pub setup: DeviceSetup,
    /// View state per page id, the 500 most recently used.
    pub page_views: BTreeMap<String, PageViewState>,
    pub ink: InkDeviceState,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            state_version: STATE_VERSION,
            window: WindowState::default(),
            panes: Panes::default(),
            location: StoredLocation::default(),
            expanded: Vec::new(),
            last_page_by_section: BTreeMap::new(),
            recent_commands: Vec::new(),
            recent_pages: Vec::new(),
            setup: DeviceSetup::default(),
            page_views: BTreeMap::new(),
            ink: InkDeviceState::default(),
        }
    }
}

impl DeviceState {
    /// Checks what serde can't. Device state is disposable, so a bad field just falls back.
    pub fn check(&self) -> bool {
        let mut check = Check::default();
        for pane in [&self.panes.notebooks, &self.panes.pages] {
            check.range("panes", pane.width, (0.0, 4_000.0));
        }
        check.that(
            "pageViews",
            self.page_views.len() <= MAX_PAGE_VIEWS,
            "Too many page views.",
        );
        for view in self.page_views.values() {
            view.check(&mut check);
        }
        self.ink.check(&mut check);
        check.finish().is_ok()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct WindowState {
    pub placement: Option<WindowPlacement>,
    pub maximized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Panes {
    pub notebooks: PanePref,
    pub pages: PanePref,
}

impl Default for Panes {
    fn default() -> Self {
        Self {
            notebooks: PanePref {
                width: 272.0,
                collapsed: false,
            },
            pages: PanePref {
                width: 300.0,
                collapsed: false,
            },
        }
    }
}

/// A pane's width in CSS pixels, and whether it's collapsed to its rail.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct PanePref {
    pub width: f64,
    pub collapsed: bool,
}

/// Where the app was, restored at the next start. Matches the interface's `StoredLocation`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "view", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum StoredLocation {
    Workspace {
        notebook_id: Option<String>,
        section_id: Option<String>,
        page_id: Option<String>,
    },
    Settings {
        section: String,
    },
    Setup {
        step: String,
    },
    Trash,
}

impl Default for StoredLocation {
    fn default() -> Self {
        Self::Workspace {
            notebook_id: None,
            section_id: None,
            page_id: None,
        }
    }
}

/// Setup progress for this device, and the draft that lets a closed setup resume where it was.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct DeviceSetup {
    #[cfg_attr(test, ts(inline))]
    pub status: SetupStatus,
    pub step: Option<String>,
    pub completed_steps: Vec<String>,
    #[cfg_attr(test, ts(type = "unknown | null"))]
    pub draft: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum SetupStatus {
    #[default]
    NotStarted,
    InProgress,
    Done,
}

struct Document {
    raw: Value,
    state: DeviceState,
}

/// The device state, in managed Tauri state.
pub struct DeviceStateStore {
    document: Mutex<Document>,
    writer: Option<Writer>,
}

impl DeviceStateStore {
    /// A store that never touches the disk.
    pub fn in_memory() -> Self {
        Self::from_raw(serde_json::to_value(DeviceState::default()).unwrap_or_default(), None)
    }

    /// Loads `state.json`, setting a corrupt file aside, and starts the writer.
    pub fn load(paths: &Paths) -> (Self, Option<Notice>) {
        let path = &paths.state_file;
        let (raw, notice) = match fs::read(path) {
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes).ok().filter(Value::is_object) {
                Some(raw) => (raw, None),
                None => {
                    log::warn!("The device state wasn't valid JSON, so it starts over.");
                    let _ = fs::rename(path, file::with_suffix(path, ".corrupt"));
                    (Value::Object(serde_json::Map::new()), Some(Notice::StateReset))
                }
            },
            Err(_) => (Value::Object(serde_json::Map::new()), None),
        };
        let writer = Writer::spawn(path.clone(), SAVE_DELAY, "state");
        (Self::from_raw(raw, Some(writer)), notice)
    }

    fn from_raw(raw: Value, writer: Option<Writer>) -> Self {
        let parsed = lenient::parse::<DeviceState, _>(&raw, DeviceState::check);
        for path in &parsed.repaired {
            log::info!("Device state: used the default for {}", lenient::display(path));
        }
        Self {
            document: Mutex::new(Document {
                raw,
                state: parsed.value,
            }),
            writer,
        }
    }

    pub fn get(&self) -> DeviceState {
        self.document().state.clone()
    }

    /// Merges a patch from the interface. `window` belongs to Rust, so a patch can't change it.
    pub fn update(&self, mut patch: Value) -> IpcResult<()> {
        let Value::Object(fields) = &mut patch else {
            return Err(IpcError::invalid("patch", "A device state patch is an object."));
        };
        if fields.remove("window").is_some() {
            log::warn!("Ignored a device state patch to window, which Rust owns.");
        }
        self.change(|raw| patch::merge_patch(raw, &patch));
        Ok(())
    }

    /// Records the window's placement, which Rust saves on move, resize, and close.
    pub fn set_window(&self, window: &WindowState) {
        let Ok(window) = serde_json::to_value(window) else {
            return;
        };
        self.change(|raw| {
            if let Value::Object(fields) = raw {
                fields.insert("window".into(), window);
            }
        });
    }

    /// Saves any waiting change now.
    pub fn flush(&self) -> std::io::Result<()> {
        self.writer.as_ref().map_or(Ok(()), Writer::flush)
    }

    fn change(&self, edit: impl FnOnce(&mut Value)) {
        let mut document = self.document();
        edit(&mut document.raw);
        if let Some(views) = document.raw.get_mut("pageViews") {
            page_views::trim(views, MAX_PAGE_VIEWS);
        }
        let parsed = lenient::parse::<DeviceState, _>(&document.raw, DeviceState::check);
        document.state = parsed.value;
        if let Some(writer) = &self.writer {
            writer.schedule(document.raw.clone());
        }
    }

    fn document(&self) -> MutexGuard<'_, Document> {
        self.document.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Merges a patch into the device state. Patches never touch `window`, which Rust owns.
#[tauri::command]
pub fn state_update(store: State<'_, DeviceStateStore>, patch: Value) -> IpcResult<()> {
    store.update(patch)
}

/// Writes any pending device state change now. The exit handshake calls it.
#[tauri::command]
pub fn state_flush(store: State<'_, DeviceStateStore>) -> IpcResult<()> {
    Ok(store.flush()?)
}

#[cfg(test)]
mod tests;
