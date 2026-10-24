//! Real printing (File > Print): the printer list, and one job that sends a PDF the interface made to a printer. The
//! PDF comes from `print_render` (page_export.rs), so the range, headers and paper pattern are already in it. The
//! work is in the `opennote-print` crate, behind a trait; these two commands only carry bytes and errors.

use std::{path::Path, process::Command, time::Duration};

use opennote_print::{ErrorCode, PrintError, PrintRequest, PrinterInfo, Receipt, SystemBackend};
use tauri::ipc::InvokeBody;

use crate::{
    images::import::percent_decode,
    ipc::{codes, IpcError, IpcResult},
};

/// The error codes the interface reads, one for each kind of refusal.
fn ipc_error(error: PrintError) -> IpcError {
    let code = match error.code {
        ErrorCode::BadDocument | ErrorCode::BadCopies | ErrorCode::UnknownPrinter => codes::INVALID,
        ErrorCode::NoPrinter => "noPrinter",
        ErrorCode::NotAllowed => "notAllowed",
        ErrorCode::Spool => "spool",
    };
    IpcError::new(code, error.message)
}

/// The printers the system lists. Empty where printing is not available.
#[tauri::command]
pub async fn print_printers() -> IpcResult<Vec<PrinterInfo>> {
    use opennote_print::PrintBackend;
    tauri::async_runtime::spawn_blocking(|| SystemBackend.printers())
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))
}

/// The command-line flag that makes this exe do one print job and exit, instead of starting the app.
pub const JOB_FLAG: &str = "--print-job";
/// The longest a print job may take before the app gives up on it and ends it.
const JOB_TIMEOUT: Duration = Duration::from_secs(600);

/// What the job process leaves in its result file: the spooler's receipt, or the refusal.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum JobResult {
    Done { message: String, printer: Option<String> },
    Failed { code: String, message: String },
}

/// Sends a PDF to a printer. The body is the PDF, and the `x-opennote-print` header (percent-encoded JSON) holds the
/// `PrintRequest`. Returns when the spooler has the job.
///
/// The job runs in a process of its own. Drawing a page to the printer goes through the graphics driver, and a driver
/// that fails there takes its whole process down; this way that is the job's process, not the app with the person's
/// notes open.
#[tauri::command]
pub async fn print_submit(request: tauri::ipc::Request<'_>) -> IpcResult<Receipt> {
    let header = request
        .headers()
        .get("x-opennote-print")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-print", "The print header is missing."))?;
    let text = percent_decode(header);
    let job = serde_json::from_str::<PrintRequest>(&text)
        .map_err(|_| IpcError::invalid("x-opennote-print", "The print header isn't valid JSON."))?;
    refuse_before_job(&job, opennote_print::allowlist_from_env().as_deref())?;
    let pdf = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The document must come as raw bytes.")),
    };
    tauri::async_runtime::spawn_blocking(move || run_job_process(&pdf, &text))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
}

/// The check made before a job process starts: a job goes only to the printer the person chose, and under
/// `OPENNOTE_PRINT_ALLOWLIST` only to a printer the list names. A refusal is logged; nothing else happens.
fn refuse_before_job(job: &PrintRequest, allowlist: Option<&str>) -> IpcResult<()> {
    match opennote_print::guard(job, allowlist) {
        Ok(_) => Ok(()),
        Err(error) => {
            log::warn!("Print refused before any job was made: {}", error.message);
            Err(ipc_error(error))
        }
    }
}

/// Runs one job in a copy of this exe and reads what it leaves. A process that ends without a result, or does not
/// end, is a spool error, and the app carries on.
fn run_job_process(pdf: &[u8], request_json: &str) -> IpcResult<Receipt> {
    let spool = |message: &str| IpcError::new("spool", message);
    let folder = tempfile::tempdir().map_err(|_| spool("The print job could not be prepared."))?;
    let (pdf_path, request_path, result_path) = (
        folder.path().join("job.pdf"),
        folder.path().join("request.json"),
        folder.path().join("result.json"),
    );
    std::fs::write(&pdf_path, pdf).map_err(|_| spool("The print job could not be prepared."))?;
    std::fs::write(&request_path, request_json).map_err(|_| spool("The print job could not be prepared."))?;
    let exe = std::env::current_exe().map_err(|_| spool("The print job could not be started."))?;
    let mut command = Command::new(exe);
    command
        .arg(JOB_FLAG)
        .arg(&pdf_path)
        .arg(&request_path)
        .arg(&result_path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window for the job.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|_| spool("The print job could not be started."))?;
    // A printer that saves to a file (Microsoft XPS Document Writer) shows its Save window from the job's process, so
    // that process may come to the front; otherwise the window opens behind OpenNote and the job seems stuck.
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
        // SAFETY: plain Win32 call on a process id this process just started; a failure only leaves the window behind.
        let _ = unsafe { AllowSetForegroundWindow(child.id()) };
    }
    let started = std::time::Instant::now();
    let exited = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < JOB_TIMEOUT => std::thread::sleep(Duration::from_millis(50)),
            _ => break None,
        }
    };
    if exited.is_none() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(spool("Printing took too long and was stopped."));
    }
    let result = std::fs::read_to_string(&result_path)
        .ok()
        .and_then(|text| serde_json::from_str::<JobResult>(&text).ok());
    match result {
        Some(JobResult::Done { message, printer }) => Ok(Receipt { message, printer }),
        Some(JobResult::Failed { code, message }) => Err(IpcError::new(&code, message)),
        None => Err(spool(
            "The printer's driver stopped while printing. Nothing was sent, and your notes are untouched.",
        )),
    }
}

/// The job process: reads the PDF, the request, and where to leave the result from the command line, prints, writes
/// the result, and returns the exit code. `None` when this is not a job process.
pub fn run_job_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some(JOB_FLAG) {
        return None;
    }
    let [_, pdf, request, result] = args.as_slice() else {
        return Some(2);
    };
    let outcome = print_from_files(Path::new(pdf), Path::new(request));
    let written = match outcome {
        Ok(receipt) => JobResult::Done {
            message: receipt.message,
            printer: receipt.printer,
        },
        Err(error) => {
            let error = ipc_error(error);
            JobResult::Failed {
                code: error.code,
                message: error.message,
            }
        }
    };
    let ok = serde_json::to_string(&written)
        .ok()
        .is_some_and(|text| std::fs::write(result, text).is_ok());
    Some(if ok { 0 } else { 1 })
}

fn print_from_files(pdf: &Path, request: &Path) -> Result<Receipt, PrintError> {
    let bad = |message: &str| PrintError {
        code: ErrorCode::BadDocument,
        message: message.to_owned(),
    };
    let pdf = std::fs::read(pdf).map_err(|_| bad("The document could not be read."))?;
    let text = std::fs::read_to_string(request).map_err(|_| bad("The request could not be read."))?;
    let job: PrintRequest = serde_json::from_str(&text).map_err(|_| bad("The request isn't valid."))?;
    opennote_print::print(&SystemBackend, &pdf, &job, &mut |_, _| {})
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn to(printer: Option<&str>) -> PrintRequest {
        PrintRequest {
            printer: printer.map(str::to_owned),
            ..PrintRequest::default()
        }
    }

    #[test]
    fn no_job_starts_without_a_chosen_printer() {
        assert_eq!(refuse_before_job(&to(None), None).unwrap_err().code, "noPrinter");
        assert!(refuse_before_job(&to(Some("Office")), None).is_ok());
    }

    #[test]
    fn the_allowlist_refuses_before_a_job_starts() {
        let list = Some("Microsoft Print to PDF");
        assert_eq!(
            refuse_before_job(&to(Some("HP LaserJet")), list).unwrap_err().code,
            "notAllowed"
        );
        assert!(refuse_before_job(&to(Some("Microsoft Print to PDF")), list).is_ok());
    }
}
