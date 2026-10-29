//! Goodnotes documents (`.goodnotes`): a ZIP package.
//!
//! What a package shows, and what public discussions of the format agree on (ADR 0053): each page's data sits in
//! `notes/<id>`, PDF files and pictures in `attachments/<id>` without extensions, and the document's structure in
//! protobuf-encoded index files such as `index.notes.pb`. The page data is private and may be compressed, so the
//! handwriting and typed text stay behind with a report entry. The pages come over in the order the index names
//! them, each with the attachments its data names, and the rest on the first page.

use std::path::Path;

use super::container::{Member, Package};
use super::media::{self, Media};
use super::protobuf;
use super::{build_page, keep_page, names, note_refused, text_runs, Attachment, NotesApp, PageParts};
use crate::error::{InteropError, Result};
use crate::import::files::Converted;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::Goodnotes;
/// Past this many attachments, they all go on the first page instead of being matched to pages.
const MATCH_LIMIT: usize = 500;

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
    let mut attachments = Vec::new();
    for member in &attachment_members {
        env.control.checkpoint()?;
        match package.read(member)? {
            Ok(bytes) => {
                let kind = media::sniff(&bytes, &member.extension());
                let ext = match kind {
                    Media::Image(_, e) | Media::Audio(_, e) => e,
                    Media::Pdf => "pdf",
                    Media::Other => "bin",
                };
                let id = member.file_name().to_owned();
                attachments.push((
                    id.clone(),
                    Some(Attachment {
                        name: media::file_name(&id, ext),
                        kind,
                        bytes,
                    }),
                ));
            }
            Err(why) => general.skipped(member.name.clone(), why),
        }
    }
    for extra in ["index.bookmarks.pb", "index.outlines.pb", "index.outline.pb"] {
        if package
            .members
            .iter()
            .any(|m| m.file_name().eq_ignore_ascii_case(extra))
        {
            general.skipped(
                "bookmarks and outline",
                format!("Goodnotes keeps them in a private form. {}", APP.pdf_route()),
            );
            break;
        }
    }
    let mut out = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let page_count = notes.len().max(1);
    let mut placed: Vec<Vec<Attachment>> = (0..page_count).map(|_| Vec::new()).collect();
    for (n, note) in notes.iter().enumerate() {
        env.control.checkpoint()?;
        package.check_time()?;
        if attachments.len() > MATCH_LIMIT {
            break;
        }
        if let Ok(bytes) = package.read(note)? {
            let runs = text_runs(&bytes, 8);
            for (id, slot) in &mut attachments {
                if slot.is_some() && names(&runs, id) {
                    if let (Some(found), Some(list)) = (slot.take(), placed.get_mut(n)) {
                        list.push(found);
                    }
                }
            }
        }
    }
    if let Some(first) = placed.first_mut() {
        first.extend(attachments.into_iter().filter_map(|(_, a)| a));
    }
    for (n, files) in placed.into_iter().enumerate() {
        env.control.checkpoint()?;
        let title = format!("Page {}", n + 1);
        let mut page = PageReport {
            title: title.clone(),
            source: format!("{} › {title}", path.display()),
            entries: Vec::new(),
        };
        if !notes.is_empty() {
            page.skipped(
                "handwriting and typed text",
                format!(
                    "Goodnotes keeps them in a private format that OpenNote cannot read yet. {}",
                    APP.pdf_route()
                ),
            );
        }
        let parts = PageParts {
            title: title.clone(),
            attachments: files,
            ..PageParts::default()
        };
        let made = build_page(parts, APP, env, &mut page);
        keep_page(made, &title, &mut out, &mut general)?;
    }
    out.general = general.entries;
    Ok(out)
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
