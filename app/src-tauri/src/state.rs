//! Device state in `%LOCALAPPDATA%\OpenNote\state.json` (ARCHITECTURE.md section 16.4): window placement, pane
//! widths, the last location, expanded ids, recent commands, and device-scoped setup progress. Losing it is
//! harmless, so a corrupt file is discarded. Rust owns `window`; the interface patches the rest, debounced 500 ms.
//!
//! This skeleton accepts patches and flushes without storing anything. The shell work package keeps the state
//! and writes it atomically.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ipc::IpcResult, window::placement::WindowPlacement};

/// The format version this build writes.
pub const STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceState {
    pub state_version: u32,
    pub window: WindowState,
    pub panes: Panes,
    pub location: StoredLocation,
    pub expanded: Vec<String>,
    pub last_page_by_section: BTreeMap<String, String>,
    pub recent_commands: Vec<String>,
    pub setup: DeviceSetup,
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
            setup: DeviceSetup::default(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub placement: Option<WindowPlacement>,
    pub maximized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
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
pub struct PanePref {
    pub width: f64,
    pub collapsed: bool,
}

/// Where the app was, restored at the next start. Matches the interface's `StoredLocation`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "view", rename_all = "camelCase", rename_all_fields = "camelCase")]
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
pub struct DeviceSetup {
    pub status: SetupStatus,
    pub step: Option<String>,
    pub completed_steps: Vec<String>,
    pub draft: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SetupStatus {
    #[default]
    NotStarted,
    InProgress,
    Done,
}

/// Merges a patch into the device state. Patches never touch `window`, which Rust owns.
#[tauri::command]
pub fn state_update(patch: Value) -> IpcResult<()> {
    log::debug!(
        "Device state patch with {} keys",
        patch.as_object().map_or(0, |fields| fields.len())
    );
    Ok(())
}

/// Writes any pending device state change now. The exit handshake calls it.
#[tauri::command]
pub fn state_flush() -> IpcResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn defaults_match_the_documented_shape() {
        let expected = json!({
            "stateVersion": 1,
            "window": { "placement": null, "maximized": false },
            "panes": {
                "notebooks": { "width": 272.0, "collapsed": false },
                "pages": { "width": 300.0, "collapsed": false }
            },
            "location": { "view": "workspace", "notebookId": null, "sectionId": null, "pageId": null },
            "expanded": [],
            "lastPageBySection": {},
            "recentCommands": [],
            "setup": { "status": "notStarted", "step": null, "completedSteps": [], "draft": null }
        });
        assert_eq!(
            serde_json::to_value(DeviceState::default()).expect("serializes"),
            expected
        );
    }

    #[test]
    fn reads_the_documented_example() {
        let example = json!({
            "stateVersion": 1,
            "window": { "placement": { "showCmd": 1, "normal": [120, 80, 1560, 980] }, "maximized": true },
            "location": { "view": "settings", "section": "appearance" },
            "setup": { "status": "done", "step": null, "completedSteps": ["storage"], "draft": null }
        });
        let state: DeviceState = serde_json::from_value(example).expect("parses");
        assert_eq!(
            state.location,
            StoredLocation::Settings {
                section: "appearance".into()
            }
        );
        assert_eq!(state.window.placement.map(|p| p.normal), Some([120, 80, 1560, 980]));
        assert_eq!(state.setup.status, SetupStatus::Done);
    }
}
