//! The start-up perf log (ARCHITECTURE.md section 8.8). With `OPENNOTE_PERF_LOG=<file>`, Rust writes JSON lines
//! for its own start-up steps (`processCreated`, `mainEntered`, `settingsLoaded`, `windowCreated`, `windowShown`
//! with the window's background color, and `webviewCreated`), and the interface adds its marks through
//! `perf_mark`: `firstPaint` with the theme it painted, `shellReady`, `pageReady`, and `paletteOpen`. Without
//! the variable, marks do nothing.

use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock, PoisonError},
};

use serde::{Deserialize, Serialize};

use crate::ipc::IpcResult;

/// The environment variable that turns on the perf log and names its file.
pub const PERF_LOG_VAR: &str = "OPENNOTE_PERF_LOG";

/// A mark the interface records, matching the interface's `PerfMark`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum PerfMark {
    FirstPaint,
    ShellReady,
    PageReady,
    PaletteOpen,
}

impl PerfMark {
    /// The name in the log.
    pub fn name(self) -> &'static str {
        match self {
            Self::FirstPaint => "firstPaint",
            Self::ShellReady => "shellReady",
            Self::PageReady => "pageReady",
            Self::PaletteOpen => "paletteOpen",
        }
    }
}

static LOG: OnceLock<Option<Mutex<File>>> = OnceLock::new();

/// Opens the perf log named by `OPENNOTE_PERF_LOG`, if it's set. Later calls do nothing.
pub fn init() {
    init_at(std::env::var_os(PERF_LOG_VAR).map(PathBuf::from).as_deref());
}

fn init_at(path: Option<&Path>) {
    let file = path.and_then(|path| OpenOptions::new().create(true).append(true).open(path).ok());
    let _ = LOG.set(file.map(Mutex::new));
}

/// Whether the perf log is on.
pub fn enabled() -> bool {
    LOG.get().is_some_and(Option::is_some)
}

/// One line of the log: `{"mark":"windowShown","epochMs":1767225600000,"source":"rust","detail":"#1C1916"}`.
pub fn line(mark: &str, epoch_ms: f64, source: &str, detail: Option<&str>) -> String {
    let mut value = serde_json::json!({ "mark": mark, "epochMs": epoch_ms, "source": source });
    if let (Some(detail), Some(fields)) = (detail, value.as_object_mut()) {
        fields.insert("detail".into(), detail.into());
    }
    format!("{value}\n")
}

fn write(line: &str) {
    if let Some(Some(file)) = LOG.get() {
        let mut file = file.lock().unwrap_or_else(PoisonError::into_inner);
        let _ = file.write_all(line.as_bytes()).and_then(|()| file.flush());
    }
}

/// Records one of Rust's own start-up marks now.
pub fn mark(name: &str, detail: Option<&str>) {
    mark_at(name, crate::boot::now_epoch_ms(), detail);
}

/// Records a mark that happened at `epoch_ms`, such as the process's creation.
pub fn mark_at(name: &str, epoch_ms: f64, detail: Option<&str>) {
    if enabled() {
        write(&line(name, epoch_ms, "rust", detail));
    }
}

/// A `#RRGGBB` string for the log.
pub fn hex(crate::theme_tokens::Rgb(r, g, b): crate::theme_tokens::Rgb) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

/// Records a mark from the interface. `detail` says more, such as the theme the first frame painted.
#[tauri::command]
pub fn perf_mark(name: PerfMark, epoch_ms: f64, detail: Option<String>) -> IpcResult<()> {
    log::trace!("Perf mark {name:?} at {epoch_ms}");
    if enabled() {
        write(&line(name.name(), epoch_ms, "interface", detail.as_deref()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    #[test]
    fn writes_one_json_object_per_line() {
        let text = line("windowShown", 1000.5, "rust", Some("#1C1916"));
        assert!(text.ends_with('\n'));
        let parsed: Value = serde_json::from_str(text.trim_end()).expect("JSON");
        assert_eq!(
            parsed,
            json!({ "mark": "windowShown", "epochMs": 1000.5, "source": "rust", "detail": "#1C1916" })
        );
        let plain: Value = serde_json::from_str(line("mainEntered", 1.0, "rust", None).trim_end()).expect("JSON");
        assert!(plain.get("detail").is_none());
    }

    #[test]
    fn names_the_interface_marks_as_the_interface_does() {
        let names = [
            PerfMark::FirstPaint,
            PerfMark::ShellReady,
            PerfMark::PageReady,
            PerfMark::PaletteOpen,
        ]
        .map(|mark| (mark.name(), serde_json::to_value(mark).expect("serializes")));
        for (name, value) in names {
            assert_eq!(value, json!(name));
        }
    }

    #[test]
    fn formats_colors_for_the_log() {
        assert_eq!(hex(crate::theme_tokens::Rgb(0x1C, 0x19, 0x16)), "#1C1916");
    }
}
