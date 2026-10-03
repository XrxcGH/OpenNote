//! The commands behind the import and export dialogs (Phase 11; interop crate README, "What the interface and
//! the app wiring need"). The long ones take a job name from the interface, send `interop://progress` events
//! under it, and stop when `interop_cancel` names it. A canceled job answers `{ status: "canceled" }` and leaves
//! nothing behind.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use opennote_core::{model::DeviceRef, SystemClock};
use opennote_interop::{
    Control, Detected, DiskSink, Exported, ImportEnv, ImportOptions, InteropError, LossGroup, Preview, PreviewSection,
    Report, WordPages,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

use super::{
    export::{self, ExportRequest, TreeSource},
    jobs::{self, Emit, Job},
    pick::{self, PickKind},
    restore::{self, ImportedTree},
};
use crate::{
    core_bridge::{notes_folder, run_notes, CoreBridge},
    ipc::{codes, IpcError, IpcResult},
};

/// How long saving the open pages may take before an export reads their files.
const SAVE_OPEN_PAGES: Duration = Duration::from_secs(5);

/// How a job ended. A canceled job is not an error.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome<T> {
    Done { result: T },
    Canceled,
}

/// What the person chose besides the source.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportChoices {
    /// Add an "Import report" page to the notebook.
    pub report_page: bool,
    /// How to cut Word files into pages: `auto`, `single`, `byTitle`, or `byPageBreak`.
    pub word_pages: Option<String>,
}

impl ImportChoices {
    fn options(&self) -> ImportOptions {
        let word_pages = match self.word_pages.as_deref() {
            Some("single") => WordPages::Single,
            Some("byTitle") => WordPages::ByTitle,
            Some("byPageBreak") => WordPages::ByPageBreak,
            _ => WordPages::Auto,
        };
        ImportOptions {
            kind: None,
            word_pages,
            report_page: self.report_page,
        }
    }
}

fn internal(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::INTERNAL, error.to_string())
}

/// An interop error with the code the interface reads. The message is for logs and for the "details" line.
fn failure(error: InteropError) -> IpcError {
    let code = match &error {
        InteropError::Unsupported { .. } => "unsupported",
        InteropError::Format { .. } => "unreadable",
        InteropError::Io { .. } => codes::IO,
        InteropError::TooBig(_) => "tooBig",
        InteropError::Canceled => "canceled",
        _ => codes::INTERNAL,
    };
    IpcError::new(code, error.to_string())
}

/// Turns a finished job into the command's answer: canceled is an outcome, the rest of the errors are errors.
fn outcome<T, U>(result: Result<T, InteropError>, done: impl FnOnce(T) -> IpcResult<U>) -> IpcResult<Outcome<U>> {
    match result {
        Ok(value) => Ok(Outcome::Done { result: done(value)? }),
        Err(InteropError::Canceled) => Ok(Outcome::Canceled),
        Err(error) => Err(failure(error)),
    }
}

fn emitter(app: &AppHandle) -> Emit {
    let app = app.clone();
    Arc::new(move |payload| {
        if let Err(error) = app.emit(jobs::PROGRESS_EVENT, payload) {
            ::log::warn!("Couldn't send a progress event to the interface: {error}");
        }
    })
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(internal)
}

/// Opens the file or folder picker. Returns `None` when the person cancels.
#[tauri::command]
pub async fn interop_pick(window: WebviewWindow, kind: PickKind, initial: Option<String>) -> IpcResult<Option<String>> {
    // A window handle isn't `Send`, so it crosses to the dialog's thread as a number.
    let owner = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    blocking(move || pick::pick(owner, kind, initial)).await?
}

/// What a file, folder, or archive is, and whether it can be imported.
#[tauri::command]
pub async fn interop_detect(path: String) -> IpcResult<Detected> {
    blocking(move || opennote_interop::detect(Path::new(&path)))
        .await?
        .map_err(failure)
}

/// Sources that live on this PC, offered without browsing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSources {
    /// The Sticky Notes app's database, when this PC has one.
    sticky_notes: Option<String>,
}

/// Looks for notes that other apps keep on this PC.
#[tauri::command]
pub async fn interop_local_sources() -> IpcResult<LocalSources> {
    blocking(|| LocalSources {
        sticky_notes: opennote_interop::sticky_notes_database().map(|path| path.to_string_lossy().into_owned()),
    })
    .await
}

/// What a dry run found, for the review step.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewView {
    detected: Detected,
    notebook_title: String,
    sections: Vec<PreviewSection>,
    pages: usize,
    blocks: usize,
    assets: usize,
    asset_bytes: u64,
    losses: Vec<LossGroup>,
    /// How many pages lose something.
    lost_pages: usize,
    /// How many parts do not come over at all.
    skipped: usize,
}

impl From<Preview> for PreviewView {
    fn from(preview: Preview) -> PreviewView {
        let (lost_pages, skipped) = preview.report.loss_counts();
        PreviewView {
            detected: preview.detected,
            notebook_title: preview.notebook_title,
            sections: preview.sections,
            pages: preview.pages,
            blocks: preview.blocks,
            assets: preview.assets,
            asset_bytes: preview.asset_bytes,
            losses: preview.losses,
            lost_pages,
            skipped,
        }
    }
}

/// A dry run: reads the source as an import would and writes nothing.
#[tauri::command]
pub async fn interop_preview(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    job: String,
    path: String,
    choices: Option<ImportChoices>,
) -> IpcResult<Outcome<PreviewView>> {
    let device = bridge.with(|bridge| Ok(bridge.core.device()))?;
    let (guard, control) = Job::start(&job, emitter(&app));
    let options = choices.unwrap_or_default().options();
    let result = blocking(move || {
        let _guard = guard;
        let clock = SystemClock::new();
        let env = ImportEnv::new(&clock, device).with_control(control);
        opennote_interop::preview(Path::new(&path), &options, &env)
    })
    .await?;
    outcome(result, |preview| Ok(PreviewView::from(preview)))
}

/// What an import made.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDone {
    /// The new notebook, for the interface to build its tree from.
    tree: ImportedTree,
    pages: usize,
    losses: Vec<LossGroup>,
    lost_pages: usize,
    skipped: usize,
}

/// Writes an import into a new notebook folder under `parent`, the notes folder. A canceled or failed import
/// leaves no folder.
pub(super) fn run_import(
    parent: &Path,
    source: &Path,
    options: &ImportOptions,
    device: DeviceRef,
    control: Control,
) -> Result<(Report, PathBuf), InteropError> {
    std::fs::create_dir_all(parent).map_err(|error| InteropError::io(parent, error))?;
    let clock = SystemClock::new();
    let env = ImportEnv::new(&clock, device).with_control(control);
    let mut sink = DiskSink::standard(parent);
    let report = opennote_interop::import(source, options, &env, &mut sink)?;
    let dir = sink
        .notebook_dir()
        .map(Path::to_path_buf)
        .ok_or_else(|| InteropError::Missing("notebook folder after the import".to_owned()))?;
    Ok((report, dir))
}

/// Imports into a new notebook folder in the notes folder, opens it in the core, and answers with its tree. The
/// notebook is in the notes tree when this answers, and the notes events have told the interface.
#[tauri::command]
pub async fn interop_import(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    job: String,
    path: String,
    choices: Option<ImportChoices>,
) -> IpcResult<Outcome<ImportDone>> {
    let Some(parent) = notes_folder(&app) else {
        return Err(IpcError::invalid("folder", "Choose a notes folder first."));
    };
    let device = bridge.with(|bridge| Ok(bridge.core.device()))?;
    let (guard, control) = Job::start(&job, emitter(&app));
    let options = choices.unwrap_or_default().options();
    let folder = parent.clone();
    let result = blocking(move || {
        let _guard = guard;
        restore::clean_staging(&folder);
        run_import(&folder, Path::new(&path), &options, device, control)
    })
    .await?;
    outcome(result, |(report, dir)| {
        let tree = run_notes(&app, &bridge, |bridge| {
            let handle = bridge.core.open_notebook(&dir).map_err(internal)?;
            Ok(restore::tree_of(&handle))
        })?;
        let (lost_pages, skipped) = report.loss_counts();
        jobs::remember_report(&job, report.to_markdown());
        Ok(ImportDone {
            tree,
            pages: report.pages.len(),
            losses: report.loss_groups(),
            lost_pages,
            skipped,
        })
    })
}

/// Asks a running job to stop. Does nothing when the job has finished.
#[tauri::command]
pub fn interop_cancel(job: String) {
    jobs::cancel(&job);
}

/// What an export made.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDone {
    /// The folder or file to show in Explorer.
    reveal: String,
    pages: usize,
    files: usize,
    losses: Vec<LossGroup>,
    lost_pages: usize,
    skipped: usize,
}

impl From<Exported> for ExportDone {
    fn from(exported: Exported) -> ExportDone {
        let (lost_pages, skipped) = exported.report.loss_counts();
        // One file exports show that file; folders show the new folder.
        let reveal = if exported.root.is_dir() {
            exported.root.clone()
        } else {
            exported.files.first().cloned().unwrap_or_else(|| exported.root.clone())
        };
        ExportDone {
            reveal: reveal.to_string_lossy().into_owned(),
            pages: exported.report.pages.len(),
            files: exported.files.len(),
            losses: exported.report.loss_groups(),
            lost_pages,
            skipped,
        }
    }
}

/// Exports a notebook or a section of the interface's tree into a folder.
#[tauri::command]
pub async fn interop_export(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    job: String,
    request: ExportRequest,
) -> IpcResult<Outcome<ExportDone>> {
    if !Path::new(&request.folder).is_dir() {
        return Err(IpcError::invalid("folder", "Choose a folder that exists."));
    }
    let source = bridge.with(|bridge| {
        // The export reads the page files, so the open pages are saved first.
        bridge.core.flush_all(SAVE_OPEN_PAGES).map_err(internal)?;
        TreeSource::build(bridge, &request).map_err(failure)
    })?;
    let (guard, control) = Job::start(&job, emitter(&app));
    let result = blocking(move || {
        let _guard = guard;
        let what = format!("Export {}", request.title);
        control.run(
            &what,
            |exported: &Exported| exported.report.pages.len() as u64,
            |control| export::run(&source, &request, control),
        )
    })
    .await?;
    outcome(result, |exported| Ok(ExportDone::from(exported)))
}

/// Shows a file or folder in Explorer.
#[tauri::command]
pub async fn interop_reveal(path: String) -> IpcResult<()> {
    let target = PathBuf::from(path);
    if !target.is_absolute() || !target.exists() {
        return Err(IpcError::invalid("path", "That file or folder isn't there."));
    }
    reveal(&target)
}

#[cfg(windows)]
fn reveal(target: &Path) -> IpcResult<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let mut command = Command::new("explorer.exe");
    if target.is_dir() {
        command.arg(target);
    } else {
        // Explorer reads this argument as one piece, so it is passed as it is.
        command.raw_arg(format!("/select,\"{}\"", target.display()));
    }
    command.spawn()?;
    Ok(())
}

#[cfg(not(windows))]
fn reveal(_target: &Path) -> IpcResult<()> {
    Err(IpcError::not_implemented("interop_reveal"))
}

#[cfg(test)]
mod tests {
    use opennote_interop::{Outcome as LossOutcome, ReportKind, SourceKind};
    use serde_json::json;

    use super::*;
    use crate::interop::restore::{ImportedPageNode, ImportedSection};

    #[test]
    fn requests_from_the_interface_deserialize() {
        let request: ExportRequest = serde_json::from_value(json!({
            "format": "htmlSingle", "scope": "page", "title": "Biology",
            "sections": [{ "title": "Lectures", "pages": [{ "ui": "p-1", "title": "Mitosis", "level": 1 }] }],
            "folder": "C:/Out",
        }))
        .expect("an export request");
        assert_eq!(request.sections[0].pages[0].ui, "p-1");
        let choices: ImportChoices =
            serde_json::from_value(json!({ "reportPage": true, "wordPages": "byTitle" })).expect("import choices");
        assert!(choices.report_page);
        assert!(matches!(choices.options().word_pages, WordPages::ByTitle));
        let none: ImportChoices = serde_json::from_value(json!({})).expect("empty choices");
        assert!(!none.report_page);
        let kind: PickKind = serde_json::from_value(json!("folder")).expect("a pick kind");
        assert_eq!(kind, PickKind::Folder);
    }

    fn loss() -> LossGroup {
        LossGroup {
            outcome: LossOutcome::Skipped,
            why: "No reminders yet.".to_owned(),
            examples: vec!["2 reminders".to_owned()],
            pages: 2,
        }
    }

    #[test]
    fn a_dry_run_answers_with_the_names_the_interface_reads() {
        let mut preview = Preview {
            detected: Detected {
                needs_password: false,
                kind: SourceKind::GoogleKeep,
                label: "Google Keep export".to_owned(),
                supported: true,
                zipped: false,
                advice: None,
            },
            notebook_title: "Keep".to_owned(),
            sections: vec![PreviewSection {
                title: "Notes".to_owned(),
                pages: 4,
            }],
            pages: 4,
            blocks: 9,
            assets: 1,
            asset_bytes: 2048,
            losses: vec![loss()],
            report: Report::new(ReportKind::Import, "Keep"),
        };
        preview.report.general.skipped("2 reminders", "No reminders yet.");
        let answer = serde_json::to_value(Outcome::Done {
            result: PreviewView::from(preview),
        })
        .expect("serializes");
        assert_eq!(
            answer,
            json!({
                "status": "done",
                "result": {
                    "detected": { "kind": "googleKeep", "label": "Google Keep export", "supported": true, "zipped": false, "advice": null },
                    "notebookTitle": "Keep",
                    "sections": [{ "title": "Notes", "pages": 4 }],
                    "pages": 4, "blocks": 9, "assets": 1, "assetBytes": 2048,
                    "losses": [{ "outcome": "skipped", "why": "No reminders yet.", "examples": ["2 reminders"], "pages": 2 }],
                    "lostPages": 0, "skipped": 1,
                },
            })
        );
    }

    #[test]
    fn an_import_answers_with_its_tree_and_a_canceled_job_with_only_its_status() {
        let done = ImportDone {
            tree: ImportedTree {
                notebook_id: "n-1".to_owned(),
                dir: "C:/Imported/Keep".to_owned(),
                title: "Keep".to_owned(),
                color: None,
                sections: vec![ImportedSection {
                    id: "s-1".to_owned(),
                    title: "Notes".to_owned(),
                    color: Some("fern".to_owned()),
                    pages: vec![ImportedPageNode {
                        core: "c-1".to_owned(),
                        title: "Groceries".to_owned(),
                        level: 0,
                    }],
                }],
            },
            pages: 1,
            losses: vec![],
            lost_pages: 0,
            skipped: 0,
        };
        let answer = serde_json::to_value(Outcome::Done { result: done }).expect("serializes");
        assert_eq!(
            answer["result"]["tree"],
            json!({
                "notebookId": "n-1", "dir": "C:/Imported/Keep", "title": "Keep", "color": null,
                "sections": [{
                    "id": "s-1", "title": "Notes", "color": "fern",
                    "pages": [{ "core": "c-1", "title": "Groceries", "level": 0 }],
                }],
            })
        );
        assert_eq!(answer["result"]["lostPages"], 0);
        assert_eq!(
            serde_json::to_value(Outcome::<ImportDone>::Canceled).expect("serializes"),
            json!({ "status": "canceled" })
        );
    }

    #[test]
    fn local_sources_use_the_names_the_interface_reads() {
        let sources = LocalSources {
            sticky_notes: Some("C:/Packages/plum.sqlite".to_owned()),
        };
        assert_eq!(
            serde_json::to_value(sources).expect("serializes"),
            json!({ "stickyNotes": "C:/Packages/plum.sqlite" })
        );
    }

    #[test]
    fn errors_carry_the_codes_the_interface_maps_to_sentences() {
        let code = |error: InteropError| failure(error).code;
        assert_eq!(code(InteropError::unsupported("a.one", "no")), "unsupported");
        assert_eq!(code(InteropError::format("a.enex", "bad")), "unreadable");
        assert_eq!(code(InteropError::TooBig("a.zip".to_owned())), "tooBig");
        assert_eq!(code(InteropError::Missing("page".to_owned())), codes::INTERNAL);
    }
}
