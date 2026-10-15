//! Real printing (File > Print): the printer list, and one job that sends a PDF the interface made to a printer. The
//! PDF comes from `print_render` (page_export.rs), so the range, headers and paper pattern are already in it. The
//! work is in the `opennote-print` crate, behind a trait; these two commands only carry bytes and errors.

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

/// Sends a PDF to a printer. The body is the PDF, and the `x-opennote-print` header (percent-encoded JSON) holds the
/// `PrintRequest`. Returns when the spooler has the job.
#[tauri::command]
pub async fn print_submit(request: tauri::ipc::Request<'_>) -> IpcResult<Receipt> {
    let header = request
        .headers()
        .get("x-opennote-print")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-print", "The print header is missing."))?;
    let job: PrintRequest = serde_json::from_str(&percent_decode(header))
        .map_err(|_| IpcError::invalid("x-opennote-print", "The print header isn't valid JSON."))?;
    let pdf = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The document must come as raw bytes.")),
    };
    tauri::async_runtime::spawn_blocking(move || opennote_print::print(&SystemBackend, &pdf, &job, &mut |_, _| {}))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
        .map_err(ipc_error)
}
