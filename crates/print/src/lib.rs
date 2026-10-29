//! Real printing (File > Print). The page is already a PDF (ADR 0006), so this crate only sends that PDF to a printer.
//!
//! [`PrintBackend`] is the whole surface the app depends on: a list of printers and one job call. [`SystemBackend`]
//! is the real one. On Windows it draws the PDF into the XPS print API inside this process, with no script or other
//! program started. On macOS and Linux it pipes the PDF to CUPS (`lp`). [`MockBackend`] stands in for both in tests,
//! so no test ever reaches a printer.
//!
//! The page range, the sheets, the headers, and the footers are chosen before the PDF is made. So the PDF handed here
//! holds exactly the sheets to print. What is left for the printer is copies, collation, duplex, color, and whether
//! the sheets are shrunk to fit the printer's paper.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The most copies one job may ask for.
pub const MAX_COPIES: u32 = 999;
/// The largest PDF a job takes, as the export's own limit.
pub const MAX_PDF_BYTES: usize = 512 * 1024 * 1024;
/// The longest document name the spooler shows.
pub const MAX_TITLE_CHARS: usize = 120;
/// A test-only guard: when set, a `;`-separated list of the only printers a job may go to. Every other printer is
/// refused before any job is made, so a test run can never reach a physical printer.
pub const ALLOWLIST_ENV: &str = "OPENNOTE_PRINT_ALLOWLIST";

/// A printer the system lists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub default: bool,
    /// Whether the driver says it can print on both sides. `None` when the system does not say.
    pub two_sided: Option<bool>,
}

/// Printing on both sides of the paper.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Duplex {
    #[default]
    Off,
    LongEdge,
    ShortEdge,
}

/// How the sheets sit on the paper.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    /// The sheet's own size. A printer that cannot take it refuses the job.
    #[default]
    Exact,
    /// The printer's matching paper, or its default; a larger sheet is shrunk and a smaller one stays as it is.
    ShrinkToFit,
}

/// What a print dialog asks for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PrintRequest {
    /// The printer the person chose. `None` is refused: a job never falls back to the system's default printer.
    pub printer: Option<String>,
    pub copies: u32,
    pub collate: bool,
    /// `None` leaves duplex as the printer's own setting.
    pub duplex: Option<Duplex>,
    pub fit: Fit,
    pub grayscale: bool,
    /// The document name the spooler shows.
    pub title: String,
}

impl Default for PrintRequest {
    fn default() -> Self {
        Self {
            printer: None,
            copies: 1,
            collate: true,
            duplex: None,
            fit: Fit::Exact,
            grayscale: false,
            title: String::new(),
        }
    }
}

/// Why a job did not go out. `code` is what the interface switches on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// The bytes are not a PDF, or are too large.
    BadDocument,
    /// Copies are outside 1 to 999.
    BadCopies,
    /// The named printer is not in the list.
    UnknownPrinter,
    /// There are no printers to send to, or none was chosen.
    NoPrinter,
    /// The printer is not in `OPENNOTE_PRINT_ALLOWLIST`.
    NotAllowed,
    /// The system turned the job down.
    Spool,
}

impl PrintError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for PrintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for PrintError {}

/// What the spooler said when it took the job. Printing itself happens later, and a paused queue keeps the job.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub message: String,
    /// The printer the job went to.
    pub printer: Option<String>,
}

/// A place to print to.
pub trait PrintBackend: Send + Sync {
    /// The printers the system lists, the default one marked.
    fn printers(&self) -> Vec<PrinterInfo>;
    /// Sends the PDF. `progress` gets `(sheets processed, sheets)` where the system reports it. The call returns when
    /// the spooler has the job, so run it on a worker.
    fn submit(
        &self,
        pdf: &[u8],
        request: &PrintRequest,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<String, PrintError>;
}

/// The allowlist this process runs under: `OPENNOTE_PRINT_ALLOWLIST`, or `None` when it is not set.
pub fn allowlist_from_env() -> Option<String> {
    std::env::var(ALLOWLIST_ENV).ok()
}

/// The printer a request names, refused when it names none or the allowlist (when there is one) leaves it out. Runs
/// before anything else about a job, so a refused printer never sees one.
pub fn guard<'r>(request: &'r PrintRequest, allowlist: Option<&str>) -> Result<&'r str, PrintError> {
    let name = request
        .printer
        .as_deref()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| PrintError::new(ErrorCode::NoPrinter, "Choose a printer in the Print window first."))?;
    if let Some(list) = allowlist {
        if !list.split(';').map(str::trim).any(|allowed| allowed == name) {
            return Err(PrintError::new(
                ErrorCode::NotAllowed,
                format!("{name} is not in {ALLOWLIST_ENV}, so nothing was sent to it."),
            ));
        }
    }
    Ok(name)
}

/// The request as the spooler will see it: the title cleaned, and everything checked against `printers`.
pub fn checked(pdf: &[u8], request: &PrintRequest, printers: &[PrinterInfo]) -> Result<PrintRequest, PrintError> {
    checked_with(pdf, request, printers, allowlist_from_env().as_deref())
}

/// [`checked`] under a given allowlist.
pub fn checked_with(
    pdf: &[u8],
    request: &PrintRequest,
    printers: &[PrinterInfo],
    allowlist: Option<&str>,
) -> Result<PrintRequest, PrintError> {
    let name = guard(request, allowlist)?;
    if !pdf.starts_with(b"%PDF-") || pdf.len() > MAX_PDF_BYTES {
        return Err(PrintError::new(
            ErrorCode::BadDocument,
            "The document is not a PDF this app can print.",
        ));
    }
    if request.copies == 0 || request.copies > MAX_COPIES {
        return Err(PrintError::new(
            ErrorCode::BadCopies,
            format!("Copies must be from 1 to {MAX_COPIES}."),
        ));
    }
    if printers.is_empty() {
        return Err(PrintError::new(
            ErrorCode::NoPrinter,
            "No printer is set up on this computer.",
        ));
    }
    if !printers.iter().any(|p| p.name == name) {
        return Err(PrintError::new(
            ErrorCode::UnknownPrinter,
            "That printer is not in the list.",
        ));
    }
    let title: String = request
        .title
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TITLE_CHARS)
        .collect();
    let title = if title.trim().is_empty() {
        "OpenNote".to_string()
    } else {
        title
    };
    Ok(PrintRequest {
        title,
        ..request.clone()
    })
}

/// Checks the request and sends the job. The only entry point the app uses, so every backend gets the same checks.
pub fn print(
    backend: &dyn PrintBackend,
    pdf: &[u8],
    request: &PrintRequest,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Receipt, PrintError> {
    print_with(backend, pdf, request, allowlist_from_env().as_deref(), progress)
}

/// [`print`] under a given allowlist. The allowlist and the chosen printer are checked before the backend is asked
/// anything, even for its printer list.
pub fn print_with(
    backend: &dyn PrintBackend,
    pdf: &[u8],
    request: &PrintRequest,
    allowlist: Option<&str>,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Receipt, PrintError> {
    guard(request, allowlist)?;
    let request = checked_with(pdf, request, &backend.printers(), allowlist)?;
    let message = backend.submit(pdf, &request, progress)?;
    Ok(Receipt {
        message,
        printer: request.printer,
    })
}

/// The request as craft-print's job. Paper size is not here: craft-print takes the sheet's own size (or, shrinking to
/// fit, the paper the driver matches, or else its default) and exposes no driver paper list to choose from.
pub fn to_job(request: &PrintRequest) -> craft_print::Job {
    craft_print::Job {
        printer: request.printer.clone(),
        copies: request.copies,
        collate: request.collate,
        duplex: request.duplex.map(|d| match d {
            Duplex::Off => craft_print::Duplex::Off,
            Duplex::LongEdge => craft_print::Duplex::LongEdge,
            Duplex::ShortEdge => craft_print::Duplex::ShortEdge,
        }),
        scaling: match request.fit {
            Fit::Exact => craft_print::Scaling::Exact,
            Fit::ShrinkToFit => craft_print::Scaling::ShrinkToFit,
        },
        grayscale: request.grayscale,
        title: request.title.clone(),
        options: Vec::new(),
    }
}

/// The system's own spooler: XPS on Windows, CUPS elsewhere.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemBackend;

impl SystemBackend {
    /// Whether this platform has a spooler this crate can reach.
    pub const fn available() -> bool {
        craft_print::backend().is_some()
    }
}

impl PrintBackend for SystemBackend {
    fn printers(&self) -> Vec<PrinterInfo> {
        craft_print::printers()
            .into_iter()
            .map(|p| PrinterInfo {
                name: p.name,
                default: p.default,
                two_sided: p.two_sided,
            })
            .collect()
    }

    fn submit(
        &self,
        pdf: &[u8],
        request: &PrintRequest,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<String, PrintError> {
        let job = to_job(request);
        craft_print::submit_with_progress(pdf, &job, progress)
            .map_err(|e| PrintError::new(ErrorCode::Spool, e.to_string()))
    }
}

/// A stand-in for tests: it lists the printers it is given, keeps every job, and can be told to fail. It never
/// reaches a printer.
#[derive(Debug, Default)]
pub struct MockBackend {
    printers: Vec<PrinterInfo>,
    fail: Mutex<Option<String>>,
    jobs: Mutex<Vec<MockJob>>,
}

/// A job the mock took.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MockJob {
    pub request: PrintRequest,
    pub bytes: usize,
}

impl MockBackend {
    pub fn new(printers: Vec<PrinterInfo>) -> Self {
        Self {
            printers,
            ..Self::default()
        }
    }

    /// The next job fails with this message.
    pub fn fail_next(&self, message: &str) {
        if let Ok(mut fail) = self.fail.lock() {
            *fail = Some(message.to_string());
        }
    }

    pub fn jobs(&self) -> Vec<MockJob> {
        self.jobs.lock().map(|jobs| jobs.clone()).unwrap_or_default()
    }
}

impl PrintBackend for MockBackend {
    fn printers(&self) -> Vec<PrinterInfo> {
        self.printers.clone()
    }

    fn submit(
        &self,
        pdf: &[u8],
        request: &PrintRequest,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<String, PrintError> {
        if let Some(message) = self.fail.lock().ok().and_then(|mut fail| fail.take()) {
            return Err(PrintError::new(ErrorCode::Spool, message));
        }
        progress(0, 1);
        progress(1, 1);
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.push(MockJob {
                request: request.clone(),
                bytes: pdf.len(),
            });
        }
        Ok("spooled 1 sheet(s)".to_string())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.4\n%%EOF\n";

    fn printer(name: &str, default: bool) -> PrinterInfo {
        PrinterInfo {
            name: name.into(),
            default,
            two_sided: Some(true),
        }
    }

    fn mock() -> MockBackend {
        MockBackend::new(vec![printer("Office", true), printer("Hall", false)])
    }

    #[test]
    fn a_job_reaches_the_named_printer_with_its_options() {
        let backend = mock();
        let request = PrintRequest {
            printer: Some("Hall".into()),
            copies: 3,
            collate: false,
            duplex: Some(Duplex::ShortEdge),
            fit: Fit::ShrinkToFit,
            grayscale: true,
            title: "Notes".into(),
        };
        let mut seen = Vec::new();
        let receipt = print_with(&backend, PDF, &request, None, &mut |a, b| seen.push((a, b))).unwrap();
        assert_eq!(receipt.printer.as_deref(), Some("Hall"));
        assert_eq!(seen, vec![(0, 1), (1, 1)]);
        assert_eq!(
            backend.jobs(),
            vec![MockJob {
                request,
                bytes: PDF.len()
            }]
        );
    }

    fn to(name: &str) -> PrintRequest {
        PrintRequest {
            printer: Some(name.into()),
            ..PrintRequest::default()
        }
    }

    #[test]
    fn a_job_without_a_chosen_printer_never_falls_back_to_the_default() {
        let backend = mock();
        for request in [PrintRequest::default(), to(""), to("  ")] {
            let error = print_with(&backend, PDF, &request, None, &mut |_, _| {}).unwrap_err();
            assert_eq!(error.code, ErrorCode::NoPrinter);
        }
        assert!(backend.jobs().is_empty());
    }

    #[test]
    fn the_allowlist_refuses_every_other_printer_before_any_job() {
        let backend = mock();
        let list = Some("Microsoft Print to PDF; Hall");
        let error = print_with(&backend, PDF, &to("Office"), list, &mut |_, _| {}).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotAllowed);
        assert!(error.message.contains(ALLOWLIST_ENV));
        // An empty allowlist allows nothing.
        let error = print_with(&backend, PDF, &to("Hall"), Some(""), &mut |_, _| {}).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotAllowed);
        assert!(backend.jobs().is_empty());
        print_with(&backend, PDF, &to("Hall"), list, &mut |_, _| {}).unwrap();
        assert_eq!(backend.jobs()[0].request.printer.as_deref(), Some("Hall"));
    }

    #[test]
    fn the_guard_runs_before_the_document_is_looked_at() {
        let error = checked_with(b"not a pdf", &to("Office"), &[], Some("Hall")).unwrap_err();
        assert_eq!(error.code, ErrorCode::NotAllowed);
    }

    #[test]
    fn bad_input_never_reaches_the_backend() {
        let backend = mock();
        let go = |pdf: &[u8], request: PrintRequest| {
            print_with(&backend, pdf, &request, None, &mut |_, _| {})
                .unwrap_err()
                .code
        };
        assert_eq!(go(b"hello", to("Office")), ErrorCode::BadDocument);
        assert_eq!(
            go(
                PDF,
                PrintRequest {
                    copies: 0,
                    ..to("Office")
                }
            ),
            ErrorCode::BadCopies
        );
        assert_eq!(
            go(
                PDF,
                PrintRequest {
                    copies: 1000,
                    ..to("Office")
                }
            ),
            ErrorCode::BadCopies
        );
        let unknown = PrintRequest {
            printer: Some("Nowhere".into()),
            ..PrintRequest::default()
        };
        assert_eq!(go(PDF, unknown), ErrorCode::UnknownPrinter);
        assert!(backend.jobs().is_empty());
    }

    #[test]
    fn no_printers_is_its_own_error() {
        let backend = MockBackend::new(Vec::new());
        let error = print_with(&backend, PDF, &to("Office"), None, &mut |_, _| {}).unwrap_err();
        assert_eq!(error.code, ErrorCode::NoPrinter);
    }

    #[test]
    fn a_failing_spooler_is_reported_once() {
        let backend = mock();
        backend.fail_next("The queue is full.");
        let error = print_with(&backend, PDF, &to("Office"), None, &mut |_, _| {}).unwrap_err();
        assert_eq!(
            (error.code, error.message.as_str()),
            (ErrorCode::Spool, "The queue is full.")
        );
        assert!(print_with(&backend, PDF, &to("Office"), None, &mut |_, _| {}).is_ok());
    }

    #[test]
    fn the_title_is_cleaned_and_never_empty() {
        let printers = [printer("Office", true)];
        let long = "x".repeat(500);
        let clean = |title: &str| {
            checked_with(
                PDF,
                &PrintRequest {
                    title: title.into(),
                    ..to("Office")
                },
                &printers,
                None,
            )
            .unwrap()
            .title
        };
        assert_eq!(clean("a\u{0}b\nc"), "abc");
        assert_eq!(clean(&long).chars().count(), MAX_TITLE_CHARS);
        assert_eq!(clean("  "), "OpenNote");
    }

    #[test]
    fn requests_read_from_the_interface_with_defaults() {
        let request: PrintRequest =
            serde_json::from_str(r#"{"copies":2,"duplex":"longEdge","fit":"shrinkToFit"}"#).unwrap();
        assert_eq!(request.copies, 2);
        assert_eq!(request.duplex, Some(Duplex::LongEdge));
        assert_eq!(request.fit, Fit::ShrinkToFit);
        assert!(request.collate);
    }

    #[test]
    fn a_request_becomes_the_spoolers_command_without_starting_it() {
        let request = PrintRequest {
            printer: Some("Hall".into()),
            copies: 3,
            collate: false,
            duplex: Some(Duplex::ShortEdge),
            fit: Fit::ShrinkToFit,
            grayscale: true,
            title: "Notes".into(),
        };
        let preview = craft_print::command_preview(&to_job(&request)).unwrap();
        if cfg!(windows) {
            assert_eq!(preview[0], "xps-print");
            assert!(preview.contains(&"printer=Hall".to_string()));
            assert!(preview.contains(&"copies=3".to_string()));
            assert!(preview.contains(&"duplex=two-sided-short-edge".to_string()));
        } else {
            assert_eq!(preview[0], "lp");
            for expected in [
                "Hall",
                "3",
                "Notes",
                "collate=false",
                "sides=two-sided-short-edge",
                "print-color-mode=monochrome",
                "print-scaling=auto-fit",
            ] {
                assert!(
                    preview.contains(&expected.to_string()),
                    "{expected} missing from {preview:?}"
                );
            }
        }
    }
}
