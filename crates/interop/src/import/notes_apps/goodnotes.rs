//! Goodnotes documents (`.goodnotes`): a ZIP package.
//!
//! What a package shows, and what public discussions of the format agree on (ADR 0053): each page's data sits in
//! `notes/<id>`, PDF files and pictures in `attachments/<id>` without extensions, and the document's structure in
//! protobuf-encoded index files such as `index.notes.pb`. The page data is private and may be compressed, so the
//! handwriting and typed text stay behind with a report entry. The pages come over in the order the index names
//! them, each with the attachments its data names, and the rest on the first page.

use std::path::Path;

use super::container::{Member, Package};
use super::protobuf;
use super::{note_refused, place, private_pages, read_attachments, NotesApp, PrivatePages};
use crate::error::{InteropError, Result};
use crate::import::files::Converted;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::Goodnotes;

fn in_folder<'m>(package: &'m Package, folder: &str) -> Vec<&'m Member> {
    package
        .members
        .iter()
        .filter(|m| {
            let lower = m.name.to_ascii_lowercase();
            lower.split('/').rev().nth(1) == Some(folder) && !m.file_name().is_empty()
        })
        .collect()
}

pub(super) fn convert(path: &Path, stem: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut package = Package::open(path)?;
    let mut general = PageReport::default();
    note_refused(&package.refused, &mut general);
    let mut notes: Vec<Member> = in_folder(&package, "notes").into_iter().cloned().collect();
    let attachment_members: Vec<Member> = in_folder(&package, "attachments").into_iter().cloned().collect();
    if notes.is_empty() && attachment_members.is_empty() {
        return Err(InteropError::format(
            stem,
            format!("it holds no pages that OpenNote can read. {}", APP.pdf_route()),
        ));
    }
    let order = index_order(&mut package)?;
    sort_by_index(&mut notes, &order);
    let attachments = read_attachments(&mut package, &attachment_members, env, &mut general)?;
    let extras = ["index.bookmarks.pb", "index.outlines.pb", "index.outline.pb"];
    if package
        .members
        .iter()
        .any(|m| extras.iter().any(|e| m.file_name().eq_ignore_ascii_case(e)))
    {
        general.skipped(
            "bookmarks and outline",
            format!("Goodnotes keeps them in a private form. {}", APP.pdf_route()),
        );
    }
    let pages = place(&mut package, &notes, attachments, 8, env)?;
    let left = (!notes.is_empty()).then_some("handwriting and typed text");
    let titles = |n: usize| format!("Page {}", n + 1);
    let plan = PrivatePages {
        app: APP,
        path,
        pages,
        text: Vec::new(),
        left,
    };
    private_pages(plan, titles, env, &mut general)
}

/// The names the document's index lists, in order: the text fields of `index.notes.pb`. An index that is not
/// plain protobuf, such as a compressed one, gives none, and the pages keep the package's order.
fn index_order(package: &mut Package) -> Result<Vec<String>> {
    let Some(index) = package
        .members
        .iter()
        .find(|m| m.file_name().eq_ignore_ascii_case("index.notes.pb"))
        .cloned()
    else {
        return Ok(Vec::new());
    };
    Ok(match package.read(&index)? {
        Ok(bytes) => protobuf::strings(&bytes, 100_000),
        Err(_) => Vec::new(),
    })
}

/// Sorts pages by where the index first names them. Pages it does not name keep their order, after the others.
fn sort_by_index(notes: &mut [Member], order: &[String]) {
    if order.is_empty() {
        return;
    }
    let mut first: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (n, text) in order.iter().enumerate() {
        first.entry(text.as_str()).or_insert(n);
        if let Some((_, last)) = text.rsplit_once('/') {
            first.entry(last).or_insert(n);
        }
    }
    let rank = |m: &Member| first.get(m.file_name()).copied().unwrap_or(usize::MAX);
    notes.sort_by_key(|m| rank(m));
}
