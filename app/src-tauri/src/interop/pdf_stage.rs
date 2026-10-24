//! The PDF files of pages the interface printed for a bundle export (ADR 0006).
//!
//! A section or notebook exports as PDF in two steps. The interface prints each page in the hidden print window, the
//! same way a page's own Export as PDF does, and hands each file here under the export's job name. The export then
//! asks [`take`] for that job's files and writes the bundle with them. Nothing here touches the disk. Each file is
//! checked to be a whole PDF file, and the files of one job, and of all jobs together, have a size limit, so a
//! stuck export can't fill the memory. Finished and canceled exports drop their files.

use std::{
    collections::HashMap,
    str::FromStr,
    sync::{Mutex, OnceLock},
};

use base64::Engine as _;
use opennote_core::PageId;
use opennote_interop::PreparedPdfRenderer;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::ipc::{IpcError, IpcResult};

/// The largest PDF file of one page.
const MAX_PAGE_BYTES: usize = 128 << 20;
/// The most all staged files may take together.
const MAX_TOTAL_BYTES: usize = 768 << 20;
/// The most pages one job may stage.
const MAX_PAGES: usize = 10_000;
/// The most jobs staged at once.
const MAX_JOBS: usize = 4;

#[derive(Default)]
struct Staged {
    pages: HashMap<PageId, Vec<u8>>,
    bytes: usize,
}

fn store() -> &'static Mutex<HashMap<String, Staged>> {
    static STORE: OnceLock<Mutex<HashMap<String, Staged>>> = OnceLock::new();
    STORE.get_or_init(Mutex::default)
}

/// A job name is what the interface makes: letters, digits, `-`, and `_`, at most 64 of them.
fn valid_job(job: &str) -> bool {
    !job.is_empty() && job.len() <= 64 && job.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[derive(Deserialize)]
pub(super) struct StageArgs {
    job: String,
    page: String,
    /// The PDF file, in standard base64.
    data: String,
}

/// Keeps the printed PDF file of one page for the job's export.
pub(super) fn stage(args: StageArgs) -> IpcResult<Value> {
    if !valid_job(&args.job) {
        return Err(IpcError::invalid("job", "The export job's name isn't valid."));
    }
    let page = PageId::from_str(&args.page).map_err(|_| IpcError::invalid("page", "That isn't a page."))?;
    if args.data.len() > MAX_PAGE_BYTES / 3 * 4 + 4 {
        return Err(IpcError::invalid("data", "The page's PDF file is too big."));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(args.data.as_bytes())
        .map_err(|_| IpcError::invalid("data", "The page's PDF file didn't arrive whole."))?;
    if !PreparedPdfRenderer::looks_like_pdf(&bytes) {
        return Err(IpcError::invalid("data", "That isn't a PDF file."));
    }
    let mut jobs = store()
        .lock()
        .map_err(|_| IpcError::invalid("job", "The export can't continue."))?;
    let total: usize = jobs.values().map(|s| s.bytes).sum();
    if !jobs.contains_key(&args.job) && jobs.len() >= MAX_JOBS {
        return Err(IpcError::invalid(
            "job",
            "Too many exports are running. Wait for one to finish.",
        ));
    }
    let staged = jobs.entry(args.job).or_default();
    let replaced = staged.pages.get(&page).map_or(0, Vec::len);
    if total - replaced + bytes.len() > MAX_TOTAL_BYTES || (replaced == 0 && staged.pages.len() >= MAX_PAGES) {
        return Err(IpcError::invalid(
            "data",
            "The export is too big to make in one go. Export a section at a time.",
        ));
    }
    staged.bytes = staged.bytes - replaced + bytes.len();
    staged.pages.insert(page, bytes);
    Ok(json!({ "pages": staged.pages.len() }))
}

#[derive(Deserialize)]
pub(super) struct DropArgs {
    job: String,
}

/// Drops a job's files, such as after the person cancels while pages print.
pub(super) fn unstage(args: DropArgs) -> IpcResult<Value> {
    if let Ok(mut jobs) = store().lock() {
        jobs.remove(&args.job);
    }
    Ok(Value::Null)
}

/// Takes the job's files for its export. A job that staged nothing gets an empty renderer, which reports every page.
pub(super) fn take(job: &str) -> PreparedPdfRenderer {
    let staged = store().lock().ok().and_then(|mut jobs| jobs.remove(job));
    PreparedPdfRenderer::new(staged.map(|s| s.pages).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF: &[u8] = b"%PDF-1.7\n%%EOF\n";

    fn encode(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn page() -> String {
        PageId::generate(&opennote_core::SystemClock::new()).to_string()
    }

    #[test]
    fn a_staged_page_is_taken_once_by_its_job() {
        let id = page();
        let args = StageArgs {
            job: "j-stage-1".into(),
            page: id.clone(),
            data: encode(PDF),
        };
        assert_eq!(stage(args).expect("stages")["pages"], 1);
        let renderer = take("j-stage-1");
        let again = take("j-stage-1");
        let parsed = PageId::from_str(&id).expect("an ID");
        assert!(renderer.has_page(parsed));
        assert!(!again.has_page(parsed), "taken once");
    }

    #[test]
    fn bad_names_pages_and_files_are_refused() {
        let bad = |job: &str, page: String, data: String| {
            stage(StageArgs {
                job: job.into(),
                page,
                data,
            })
            .is_err()
        };
        assert!(bad("../x", page(), encode(PDF)));
        assert!(bad("", page(), encode(PDF)));
        assert!(bad("j-ok", "not a page".into(), encode(PDF)));
        assert!(bad("j-ok", page(), encode(b"<html>")));
        assert!(bad("j-ok", page(), "%%%".into()));
        unstage(DropArgs { job: "j-ok".into() }).expect("drops");
    }
}
