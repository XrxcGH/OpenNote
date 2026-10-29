//! Samsung Notes notes (`.sdocx`): a ZIP package.
//!
//! Public descriptions of the format (ADR 0053) say the package holds the note's parts and a `media` folder of its
//! pictures, recordings, and PDF files. Each page is a binary `.page` file, and the order of the pages is listed
//! in `pageIdInfo.dat`. Text the package keeps as XML comes over. The pages' handwriting is in a private binary
//! form, so it stays behind with a report entry, and each page keeps the media its file names.

use std::collections::HashMap;
use std::path::Path;

use super::container::{Member, Package};
use super::media::{self, Media};
use super::{build_page, keep_page, names, note_refused, text_runs, Attachment, NotesApp, PageParts};
use crate::error::{InteropError, Result};
use crate::import::files::Converted;
use crate::import::xmltree;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::SamsungNotes;
/// The most XML text read from one note.
const MAX_XML_BYTES: u64 = 8 << 20;
/// Past this many media files, they all go on the first page instead of being matched to pages.
const MATCH_LIMIT: usize = 500;

fn is_media(member: &Member) -> bool {
    member
        .name
        .to_ascii_lowercase()
        .split('/')
        .rev()
        .skip(1)
        .any(|folder| folder == "media")
}

pub(super) fn convert(path: &Path, stem: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut package = Package::open(path)?;
    let mut general = PageReport::default();
    note_refused(&package.refused, &mut general);
    let mut pages: Vec<Member> = package
        .members
        .iter()
        .filter(|m| m.extension() == "page")
        .cloned()
        .collect();
    let media_members: Vec<Member> = package.members.iter().filter(|m| is_media(m)).cloned().collect();
    let xml: Vec<Member> = package
        .members
        .iter()
        .filter(|m| m.extension() == "xml" && m.size <= MAX_XML_BYTES)
        .cloned()
        .collect();
    if pages.is_empty() && media_members.is_empty() && xml.is_empty() {
        return Err(InteropError::format(
            stem,
            format!("it holds no pages that OpenNote can read. {}", APP.pdf_route()),
        ));
    }
    order_pages(&mut package, &mut pages)?;
    let mut text = Vec::new();
    for member in &xml {
        if let Ok(bytes) = package.read(member)? {
            let (root, _) = xmltree::parse_at_most(&String::from_utf8_lossy(&bytes), 200_000);
            collect_text(&root, &mut text, 0);
        }
    }
    let mut files = Vec::new();
    for member in &media_members {
        env.control.checkpoint()?;
        match package.read(member)? {
            Ok(bytes) => {
                let kind = media::sniff(&bytes, &member.extension());
                let ext = match kind {
                    Media::Image(_, e) | Media::Audio(_, e) => e,
                    Media::Pdf => "pdf",
                    Media::Other => "bin",
                };
                let name = member.file_name().to_owned();
                files.push((
                    name.clone(),
                    Some(Attachment {
                        name: media::file_name(&name, ext),
                        kind,
                        bytes,
                    }),
                ));
            }
            Err(why) => general.skipped(member.name.clone(), why),
        }
    }
    let page_count = pages.len().max(1);
    let mut placed: Vec<Vec<Attachment>> = (0..page_count).map(|_| Vec::new()).collect();
    if files.len() <= MATCH_LIMIT {
        for (n, page) in pages.iter().enumerate() {
            env.control.checkpoint()?;
            if let Ok(bytes) = package.read(page)? {
                let runs = text_runs(&bytes, 5);
                for (name, slot) in &mut files {
                    if slot.is_some() && names(&runs, name) {
                        if let (Some(found), Some(list)) = (slot.take(), placed.get_mut(n)) {
                            list.push(found);
                        }
                    }
                }
            }
        }
    }
    if let Some(first) = placed.first_mut() {
        first.extend(files.into_iter().filter_map(|(_, a)| a));
    }
    let mut out = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let mut text = Some(text);
    for (n, attachments) in placed.into_iter().enumerate() {
        env.control.checkpoint()?;
        let title = if page_count == 1 {
            stem.to_owned()
        } else {
            format!("Page {}", n + 1)
        };
        let mut page = PageReport {
            title: title.clone(),
            source: format!("{} › {title}", path.display()),
            entries: Vec::new(),
        };
        if !pages.is_empty() {
            page.skipped(
                "handwriting and shapes",
                format!(
                    "Samsung Notes keeps them in a private format that OpenNote cannot read yet. {}",
                    APP.pdf_route()
                ),
            );
        }
        let parts = PageParts {
            title: title.clone(),
            text: text.take().unwrap_or_default(),
            attachments,
            ..PageParts::default()
        };
        let made = build_page(parts, APP, env, &mut page);
        keep_page(made, &title, &mut out, &mut general)?;
    }
    out.general = general.entries;
    Ok(out)
}

/// Orders the page files by where `pageIdInfo.dat` names them. Without it, or for pages it does not name, the
/// package's order stays.
fn order_pages(package: &mut Package, pages: &mut [Member]) -> Result<()> {
    let Some(info) = package
        .members
        .iter()
        .find(|m| m.file_name().eq_ignore_ascii_case("pageIdInfo.dat"))
        .cloned()
    else {
        return Ok(());
    };
    let Ok(bytes) = package.read(&info)? else {
        return Ok(());
    };
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let utf16: String = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| char::from_u32(u32::from(u16::from_le_bytes(*c))).unwrap_or('\u{fffd}'))
        .collect();
    let mut rank: HashMap<String, usize> = HashMap::new();
    for page in pages.iter() {
        let id = page.file_name().trim_end_matches(".page").to_owned();
        if id.is_empty() {
            continue;
        }
        if let Some(at) = text
            .find(&id)
            .or_else(|| utf16.find(&id).map(|a| text.len().saturating_add(a)))
        {
            rank.insert(page.name.clone(), at);
        }
    }
    pages.sort_by_key(|p| rank.get(&p.name).copied().unwrap_or(usize::MAX));
    Ok(())
}

/// The text of an XML tree, one entry for each element with text of its own, depth first.
fn collect_text(element: &xmltree::Element, out: &mut Vec<String>, depth: usize) {
    if depth > 64 || out.len() >= 10_000 {
        return;
    }
    let mut own = String::new();
    for child in &element.children {
        match child {
            xmltree::Node::Text(text) => own.push_str(text),
            xmltree::Node::Element(inner) => collect_text(inner, out, depth + 1),
        }
    }
    let own = own.trim();
    if !own.is_empty() && out.len() < 10_000 {
        out.push(own.to_owned());
    }
}
