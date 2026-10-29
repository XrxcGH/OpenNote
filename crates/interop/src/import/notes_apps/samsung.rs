//! Samsung Notes files (`.sdocx`): a ZIP package.
//!
//! Public descriptions of the format (ADR 0053) say the package holds the note's parts and a `media` folder of its
//! pictures, recordings, and PDF files. Each page is a binary `.page` file, and the order of the pages is listed
//! in `pageIdInfo.dat`. Text the package keeps as XML comes over. The pages' handwriting is in a private binary
//! form, so it stays behind with a report entry, and each page keeps the media its file names.

use std::collections::HashMap;
use std::path::Path;

use super::container::{Member, Package};
use super::{note_refused, place, private_pages, read_attachments, NotesApp, PrivatePages};
use crate::error::{InteropError, Result};
use crate::import::files::Converted;
use crate::import::xmltree;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::SamsungNotes;
/// The most XML text read from one note.
const MAX_XML_BYTES: u64 = 8 << 20;

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
    order_pages(&mut package, &mut pages, env, &mut general)?;
    let text = xml_text(&mut package, &xml)?;
    let files = read_attachments(&mut package, &media_members, env, &mut general)?;
    let placed = place(&mut package, &pages, files, 5, env)?;
    let single = placed.len() == 1;
    let titles = |n: usize| {
        if single {
            stem.to_owned()
        } else {
            format!("Page {}", n + 1)
        }
    };
    let left = (!pages.is_empty()).then_some("handwriting and shapes");
    let plan = PrivatePages {
        app: APP,
        path,
        pages: placed,
        text,
        left,
    };
    private_pages(plan, titles, env, &mut general)
}

/// The text of the package's XML parts.
fn xml_text(package: &mut Package, xml: &[Member]) -> Result<Vec<String>> {
    let mut text = Vec::new();
    for member in xml {
        if let Ok(bytes) = package.read(member)? {
            let (root, _) = xmltree::parse_at_most(&String::from_utf8_lossy(&bytes), 200_000);
            collect_text(&root, &mut text, 0);
        }
    }
    Ok(text)
}

/// The largest `pageIdInfo.dat` read for the page order. A real one is a few kilobytes.
pub(super) const MAX_PAGE_INFO_BYTES: u64 = 4 << 20;

/// The most page IDs that are not whole words looked for one by one in `pageIdInfo.dat`.
const MAX_ODD_IDS: usize = 32;

/// Whether a character can be part of a page ID in `pageIdInfo.dat`.
fn id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

/// The words of `text` made of [`id_char`] characters, each with the byte where it starts.
fn words(text: &str) -> impl Iterator<Item = (usize, &str)> + '_ {
    let mut chars = text.char_indices().peekable();
    std::iter::from_fn(move || {
        while chars.next_if(|(_, c)| !id_char(*c)).is_some() {}
        let (start, _) = *chars.peek()?;
        let mut end = start;
        while let Some((at, c)) = chars.next_if(|(_, c)| id_char(*c)) {
            end = at + c.len_utf8();
        }
        Some((start, text.get(start..end).unwrap_or_default()))
    })
}

/// Orders the page files by where `pageIdInfo.dat` names them. Without it, or for pages it does not name, the
/// package's order stays. A page is named where its ID stands as a whole word, first in the file read as UTF-8
/// and then in the file read as UTF-16. So `page1` is not found inside `page10`. The file is read once, whatever the number of pages.
pub(super) fn order_pages(
    package: &mut Package,
    pages: &mut [Member],
    env: &ImportEnv<'_>,
    general: &mut PageReport,
) -> Result<()> {
    let Some(info) = package
        .members
        .iter()
        .find(|m| m.file_name().eq_ignore_ascii_case("pageIdInfo.dat"))
        .cloned()
    else {
        return Ok(());
    };
    if info.size > MAX_PAGE_INFO_BYTES {
        general.simplified(
            "page order",
            "The list of the pages' order is larger than any note keeps, so the pages come in the order the \
             file holds them.",
        );
        return Ok(());
    }
    let Ok(bytes) = package.read(&info)? else {
        return Ok(());
    };
    let text = String::from_utf8_lossy(&bytes);
    let utf16: String = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| char::from_u32(u32::from(u16::from_le_bytes(*c))).unwrap_or('\u{fffd}'))
        .collect();
    let mut found: HashMap<&str, Option<usize>> = pages
        .iter()
        .map(|p| p.file_name().trim_end_matches(".page"))
        .filter(|id| !id.is_empty())
        .map(|id| (id, None))
        .collect();
    let mut seen = 0usize;
    for (offset, source) in [(0, text.as_ref()), (text.len(), utf16.as_str())] {
        for (at, word) in words(source) {
            seen += 1;
            if seen.is_multiple_of(4096) {
                package.check_time()?;
                env.control.checkpoint()?;
            }
            if let Some(slot @ None) = found.get_mut(word) {
                *slot = Some(offset.saturating_add(at));
            }
        }
    }
    // An ID that is not a whole word is looked for as it is, for a few pages only.
    let odd: Vec<&str> = found
        .keys()
        .filter(|id| !id.chars().all(id_char))
        .take(MAX_ODD_IDS)
        .copied()
        .collect();
    for id in odd {
        package.check_time()?;
        let at = text
            .find(id)
            .or_else(|| utf16.find(id).map(|a| text.len().saturating_add(a)));
        found.insert(id, at);
    }
    let rank: HashMap<String, usize> = pages
        .iter()
        .filter_map(|p| {
            let at = (*found.get(p.file_name().trim_end_matches(".page"))?)?;
            Some((p.name.clone(), at))
        })
        .collect();
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
