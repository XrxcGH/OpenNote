//! The commands behind `DiagnosticsClient` (app/src/features/diagnostics/client.ts). Each wraps one call into
//! `crates/crashreport` or `crates/diagnostics`. Errors carry a code and a fixed sentence, never text from a
//! report, so a failure can't leak what the report would have held.

use opennote_core::{session::notebook::NotebookHandle, store::verify::VerifyReport, CoreError};
use opennote_crashreport::{prepare, send, Consent, Report, SendError, StoreError, Summary, Transport};
use opennote_diagnostics::{
    selfcheck::{self, Inputs},
    Bundle, BundleError, BundleInputs, BundleOptions, NotebookCounts, SelfCheck, SessionStats, StartReport, SystemDisk,
    SystemFacts,
};
use std::sync::PoisonError;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::{now_unix, transport::HttpTransport, Hardening};
use crate::{
    boot::channel_for,
    core_bridge::CoreBridge,
    ipc::{codes, IpcError, IpcResult},
    lifecycle::{request_exit, ExitReason, ExitState, Relaunch},
    paths::Paths,
};

/// Error codes of `DiagnosticsError` in the interface.
mod errors {
    pub const NOT_OPTED_IN: &str = "notOptedIn";
    pub const NO_ADDRESS: &str = "noAddress";
    pub const MISSING: &str = "missing";
    pub const NOT_REVIEWED: &str = "notReviewed";
    pub const CANCELED: &str = "canceled";
    pub const OFFLINE: &str = "offline";
    pub const IO: &str = "io";
}

fn failure(code: &str) -> IpcError {
    IpcError::new(code, code)
}

pub(super) fn send_error(error: &SendError) -> IpcError {
    failure(match error {
        SendError::NotOptedIn => errors::NOT_OPTED_IN,
        SendError::NotConfigured | SendError::InvalidEndpoint => errors::NO_ADDRESS,
        SendError::NotReviewed | SendError::WrongAgreement => errors::NOT_REVIEWED,
        SendError::Store(StoreError::BadId(_) | StoreError::Missing(_)) => errors::MISSING,
        SendError::Store(_) | SendError::Transport(_) => errors::IO,
    })
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> IpcResult<T> + Send + 'static) -> IpcResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}

#[tauri::command]
pub fn crash_consent_get(hardening: State<'_, Hardening>) -> IpcResult<Consent> {
    Ok(hardening.consent())
}

/// Stores the person's yes or no. A yes turns saving on; a no turns it off. Nothing is sent either way.
#[tauri::command]
pub fn crash_consent_set(hardening: State<'_, Hardening>, consent: Consent) -> IpcResult<()> {
    hardening
        .update(|privacy| privacy.crash_reports.consent = consent)
        .map(|_| ())
        .map_err(|_| failure(errors::IO))
}

/// A made-up report in the real format, for the consent screen.
#[tauri::command]
pub fn crash_example() -> IpcResult<Report> {
    Ok(Report::example(env!("CARGO_PKG_VERSION"), now_unix()))
}

#[tauri::command]
pub fn crash_list(hardening: State<'_, Hardening>) -> IpcResult<Vec<Summary>> {
    Ok(hardening.store.list())
}

/// What the review shows: the exact text that would be sent, where it would go, and its digest.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    id: String,
    endpoint: String,
    payload: String,
    digest: String,
}

fn prepared(hardening: &Hardening, id: &str) -> Result<opennote_crashreport::PendingSend, SendError> {
    let settings = hardening.privacy().crash_reports;
    let scrubber = hardening
        .scrubber
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    prepare(&hardening.store, id, &settings, &scrubber)
}

/// Reads one report for review. Nothing is sent.
#[tauri::command]
pub fn crash_prepare(hardening: State<'_, Hardening>, id: String) -> IpcResult<Pending> {
    let pending = prepared(&hardening, &id).map_err(|error| send_error(&error))?;
    Ok(Pending {
        id: pending.id().to_owned(),
        endpoint: pending.endpoint().to_owned(),
        payload: pending.payload().to_owned(),
        digest: pending.digest().to_owned(),
    })
}

/// Sends a report the person reviewed. The report is read again, so what goes out is the text with the digest
/// the person saw, or nothing.
pub fn send_reviewed(hardening: &Hardening, transport: &dyn Transport, id: &str, digest: &str) -> IpcResult<()> {
    if super::offline() {
        return Err(failure(errors::OFFLINE));
    }
    let pending = prepared(hardening, id).map_err(|error| send_error(&error))?;
    let agreement = pending.agree(digest).map_err(|error| send_error(&error))?;
    send(&pending, agreement, transport).map_err(|error| {
        ::log::warn!("A crash report was not sent: {error}");
        send_error(&error)
    })?;
    hardening
        .update(|privacy| privacy.report_sent_unix = Some(now_unix()))
        .map(|_| ())
        .map_err(|_| failure(errors::IO))
}

#[tauri::command]
pub async fn crash_send(app: AppHandle, id: String, digest: String) -> IpcResult<()> {
    blocking(move || send_reviewed(&app.state::<Hardening>(), &HttpTransport, &id, &digest)).await
}

#[tauri::command]
pub fn crash_delete(hardening: State<'_, Hardening>, id: String) -> IpcResult<()> {
    hardening.store.delete(&id).map_err(|error| match error {
        StoreError::BadId(_) | StoreError::Missing(_) => failure(errors::MISSING),
        _ => failure(errors::IO),
    })
}

#[tauri::command]
pub fn crash_delete_all(hardening: State<'_, Hardening>) -> IpcResult<usize> {
    Ok(hardening.store.delete_all())
}

/// The open notebooks as one notebook for the self-check: the notes folder for the disk check, each notebook's own
/// check for the file check, and any unsaved change in any of them.
pub struct OpenNotebooks {
    folder: std::path::PathBuf,
    handles: Vec<NotebookHandle>,
}

impl OpenNotebooks {
    /// `None` when no notebook is open.
    pub fn new(handles: Vec<NotebookHandle>) -> Option<OpenNotebooks> {
        let first = handles.first()?;
        let folder = first.path().parent().unwrap_or(first.path()).to_path_buf();
        Some(OpenNotebooks { folder, handles })
    }

    fn counts(&self) -> NotebookCounts {
        let (mut sections, mut pages) = (0usize, 0usize);
        for handle in &self.handles {
            let tree = handle.tree();
            sections += tree.sections.len();
            pages += tree.sections.iter().map(|section| section.pages.len()).sum::<usize>();
        }
        let count = |number: usize| u32::try_from(number).unwrap_or(u32::MAX);
        NotebookCounts {
            notebooks: count(self.handles.len()),
            sections: count(sections),
            pages: count(pages),
        }
    }
}

impl selfcheck::NotebookProbe for OpenNotebooks {
    fn path(&self) -> &std::path::Path {
        &self.folder
    }

    fn verify(&self) -> Result<VerifyReport, CoreError> {
        let mut total = VerifyReport::default();
        for handle in &self.handles {
            let report = handle.verify()?;
            total.files = total.files.saturating_add(report.files);
            total.problems.extend(report.problems);
        }
        Ok(total)
    }

    fn has_unsaved(&self) -> bool {
        self.handles.iter().any(NotebookHandle::has_unsaved)
    }
}

/// The open notebooks, and their names registered as private so no report or file repeats them.
fn notebook(hardening: &Hardening, bridge: &CoreBridge) -> Option<OpenNotebooks> {
    let open = OpenNotebooks::new(bridge.notebooks())?;
    for handle in &open.handles {
        let title = handle.tree().title;
        if !title.is_empty() {
            hardening
                .scrubber
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .add_private(&title);
            opennote_crashreport::add_private(&title);
        }
    }
    Some(open)
}

fn run_self_check(hardening: &Hardening, paths: &Paths, notebook: Option<&OpenNotebooks>) -> SelfCheck {
    let probe = notebook.map(|open| open as &dyn selfcheck::NotebookProbe);
    selfcheck::run(
        &Inputs {
            now_unix: now_unix(),
            app_data_dir: &paths.local,
            updates_dir: Some(&paths.updates),
            notebook: probe,
            crash_store: Some(&hardening.store),
        },
        &SystemDisk,
    )
}

/// Runs the self-check. It changes nothing.
#[tauri::command]
pub async fn diagnostics_self_check(app: AppHandle) -> IpcResult<SelfCheck> {
    // `verify` reads every file of the notebook, so it runs off the command thread.
    blocking(move || {
        let hardening = app.state::<Hardening>();
        let handle = notebook(&hardening, &app.state::<CoreBridge>());
        Ok(run_self_check(&hardening, &app.state::<Paths>(), handle.as_ref()))
    })
    .await
}

/// The text the person reviews, and what saves exactly that text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltFeedback {
    bundle: Bundle,
    review: ReviewText,
}

impl BuiltFeedback {
    /// The text that was built, for tests.
    #[cfg(test)]
    pub(super) fn review_text(&self) -> &str {
        &self.review.text
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewText {
    text: String,
    digest: String,
    suggested_file_name: String,
}

/// Collects the feedback file and keeps it until it is saved or replaced. `facts` is what only the interface
/// knows, such as the theme; the versions, channel, and counts come from here.
#[tauri::command]
pub async fn diagnostics_build_feedback(
    app: AppHandle,
    options: BundleOptions,
    facts: Option<SystemFacts>,
) -> IpcResult<BuiltFeedback> {
    blocking(move || {
        let hardening = app.state::<Hardening>();
        let handle = notebook(&hardening, &app.state::<CoreBridge>());
        let paths = app.state::<Paths>();
        let check = run_self_check(&hardening, &paths, handle.as_ref());
        let webview2 = app.state::<crate::boot::Startup>().webview2_version.clone();
        Ok(build_feedback(
            &hardening,
            &paths,
            &check,
            handle.as_ref(),
            &options,
            facts,
            &webview2,
        ))
    })
    .await
}

fn channel_name() -> String {
    let channel = channel_for(
        env!("CARGO_PKG_VERSION"),
        cfg!(debug_assertions) || cfg!(feature = "test-endpoints"),
    );
    serde_json::to_value(channel)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Builds the bundle and keeps its review. The versions, channel, and counts are the host's; the rest of `facts`
/// is the interface's.
pub fn build_feedback(
    hardening: &Hardening,
    paths: &Paths,
    check: &SelfCheck,
    notebook: Option<&OpenNotebooks>,
    options: &BundleOptions,
    facts: Option<SystemFacts>,
    webview2: &str,
) -> BuiltFeedback {
    let mut facts = facts.unwrap_or_default();
    facts.app_version = env!("CARGO_PKG_VERSION").to_owned();
    facts.channel = channel_name();
    facts.webview2_version = Some(webview2.to_owned()).filter(|version| !version.is_empty());
    facts.notebooks = notebook.map(OpenNotebooks::counts);
    let scrubber = hardening
        .scrubber
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    let bundle = Bundle::build(&BundleInputs {
        facts: &facts,
        self_check: Some(check),
        logs_dir: Some(&paths.logs),
        crash_store: Some(&hardening.store),
        scrubber: &scrubber,
        now_unix: now_unix(),
        options,
    });
    let review = bundle.review();
    let text = ReviewText {
        text: review.text().to_owned(),
        digest: review.digest().to_owned(),
        suggested_file_name: review.suggested_file_name().to_owned(),
    };
    *hardening.review.lock().unwrap_or_else(PoisonError::into_inner) = Some(review);
    BuiltFeedback { bundle, review: text }
}

#[derive(Serialize)]
pub struct SavedFile {
    name: String,
}

/// Saves the last built file in a folder the person picks. Only the file name goes back to the interface.
#[tauri::command]
pub async fn diagnostics_save_feedback(
    window: WebviewWindow,
    hardening: State<'_, Hardening>,
    digest: String,
) -> IpcResult<SavedFile> {
    let review = hardening
        .review
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
        .ok_or_else(|| failure(errors::NOT_REVIEWED))?;
    if review.digest() != digest {
        return Err(failure(errors::NOT_REVIEWED));
    }
    let owner = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    let folder = blocking(move || crate::install::pick_folder(owner, None)).await?;
    let Some(folder) = folder else {
        return Err(failure(errors::CANCELED));
    };
    let path = review
        .save(&digest, std::path::Path::new(&folder))
        .map_err(|error| match error {
            BundleError::NotReviewed => failure(errors::NOT_REVIEWED),
            BundleError::Io(_) => failure(errors::IO),
        })?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(SavedFile { name })
}

/// What start-up learned from the session record.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartup {
    report: StartReport,
    safe_mode: bool,
    stats: SessionStats,
}

#[tauri::command]
pub fn diagnostics_startup(hardening: State<'_, Hardening>) -> IpcResult<SessionStartup> {
    Ok(SessionStartup {
        report: hardening.start_report(),
        safe_mode: super::safe_mode(),
        stats: hardening.stats(),
    })
}

/// Starts this session in safe mode. Features that safe mode turns off read [`super::safe_mode`].
#[tauri::command]
pub fn diagnostics_enter_safe_mode(hardening: State<'_, Hardening>) -> IpcResult<()> {
    hardening.enter_safe_mode();
    Ok(())
}

/// The privacy choices the panel shows.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyState {
    pub work_offline: bool,
    /// Where saved crash reports may be sent. Empty means nowhere.
    pub report_endpoint: String,
    pub report_sent_unix: Option<u64>,
}

#[tauri::command]
pub fn privacy_get(hardening: State<'_, Hardening>) -> IpcResult<PrivacyState> {
    let privacy = hardening.privacy();
    Ok(PrivacyState {
        work_offline: privacy.work_offline,
        report_endpoint: privacy.crash_reports.endpoint,
        report_sent_unix: privacy.report_sent_unix,
    })
}

#[tauri::command]
pub fn privacy_set_offline(hardening: State<'_, Hardening>, offline: bool) -> IpcResult<()> {
    hardening
        .update(|privacy| privacy.work_offline = offline)
        .map(|_| ())
        .map_err(|_| failure(errors::IO))
}

/// Closes OpenNote and opens it again, normally, so safe mode ends. The exit goes through the usual handshake.
#[tauri::command]
pub fn diagnostics_restart(app: AppHandle) -> IpcResult<()> {
    let exe = std::env::current_exe()?;
    app.state::<ExitState>()
        .plan_relaunch(Relaunch { exe, args: Vec::new() });
    request_exit(&app, ExitReason::Close);
    Ok(())
}
