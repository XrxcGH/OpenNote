//! The start-up perf log (ARCHITECTURE.md section 8.8). With `OPENNOTE_PERF_LOG=<file>`, Rust writes JSON lines
//! for its own start-up steps, and the interface adds its marks through `perf_mark`. Without the variable,
//! marks do nothing. The shell work package adds the log.

use serde::{Deserialize, Serialize};

use crate::ipc::IpcResult;

/// The environment variable that turns on the perf log and names its file.
pub const PERF_LOG_VAR: &str = "OPENNOTE_PERF_LOG";

/// A mark the interface records, matching the interface's `PerfMark`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerfMark {
    FirstPaint,
    ShellReady,
    PageReady,
    PaletteOpen,
}

#[tauri::command]
pub fn perf_mark(name: PerfMark, epoch_ms: f64) -> IpcResult<()> {
    log::trace!("Perf mark {name:?} at {epoch_ms}");
    Ok(())
}
