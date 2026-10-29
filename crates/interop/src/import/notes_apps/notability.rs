//! Notability notes (`.note`): a ZIP package with a folder named after the note.
//!
//! The folder holds `Session.plist`, a binary property list from NSKeyedArchiver. Public write-ups of the format
//! (ADR 0053 lists them) describe the writing as one archived dictionary. Each of its keys holds bytes:
//!
//! - The x and y of each point, in points (`curvespoints`).
//! - How many points each curve has (`curvesnumpoints`).
//! - Each curve's width (`curveswidth`).
//! - Each curve's red, green, blue, and alpha, one byte each (`curvescolors`).
//! - A width factor for each point, which becomes pressure (`curvesfractionalwidths`). Not every note has it.
//!
//! Numbers are 32-bit and little-endian: floats, except the counts, which are integers.
//!
//! Erasing is already applied in what the app saves: an erased curve is gone, and a partly erased one is saved
//! as its pieces. Typed text is archived as `NSAttributedString` objects. Pictures sit in an `Images` folder,
//! recordings in `Recordings`, and imported PDF files beside them.

use std::path::Path;

use super::bplist::Plist;
use super::container::{Member, Package};
use super::ink::Curve;
use super::keyed::Keyed;
use super::media::{self, Media};
use super::{build_page, keep_page, note_refused, Attachment, NotesApp, PageParts};
use crate::error::Result;
use crate::import::files::Converted;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::Notability;

pub(super) fn convert(path: &Path, stem: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut package = Package::open(path)?;
    let mut general = PageReport::default();
    note_refused(&package.refused, &mut general);
    let mut page = PageReport {
        title: stem.to_owned(),
        source: path.display().to_string(),
        entries: Vec::new(),
    };
    let mut parts = PageParts {
        title: stem.to_owned(),
        ..PageParts::default()
    };
    let session = package
        .members
        .iter()
        .filter(|m| m.file_name().eq_ignore_ascii_case("Session.plist"))
        .min_by_key(|m| m.name.len())
        .cloned();
    match session {
        Some(member) => read_session(&mut package, &member, &mut parts, &mut page)?,
        None => page.skipped(
            "handwriting and typed text",
            format!("The note has no Session.plist, which holds them. {}", APP.pdf_route()),
        ),
    }
    let members: Vec<Member> = package.members.clone();
    for member in &members {
        env.control.checkpoint()?;
        if let Some(kind) = media_kind(member) {
            match package.read(member)? {
                Ok(bytes) => {
                    let kind = match media::sniff(&bytes, &member.extension()) {
                        Media::Other => kind,
                        sniffed => sniffed,
                    };
                    parts.attachments.push(Attachment {
                        name: member.file_name().to_owned(),
                        kind,
                        bytes,
                    });
                }
                Err(why) => page.skipped(member.name.clone(), why),
            }
        }
    }
    if parts.curves.is_empty() && parts.text.is_empty() && parts.attachments.is_empty() {
        page.skipped(
            "the note",
            "It holds no writing, text, or files that OpenNote could read.",
        );
    }
    if !parts.attachments.is_empty() && !parts.curves.is_empty() {
        page.simplified(
            "where pictures sit",
            "Pictures and files come after the text, not at their places among the writing.",
        );
    }
    let mut out = Converted {
        pages: Vec::new(),
        general: Vec::new(),
    };
    let made = build_page(parts, APP, env, &mut page);
    keep_page(made, stem, &mut out, &mut general)?;
    out.general = general.entries;
    Ok(out)
}

/// What a member of the package is, when it is content: pictures, recordings, and PDF files. Previews of the
/// note (`thumb*.png`) and the app's own property lists are not.
fn media_kind(member: &Member) -> Option<Media> {
    let name = member.file_name().to_ascii_lowercase();
    if name.starts_with("thumb") || name.starts_with('.') {
        return None;
    }
    let folder = member.name.to_ascii_lowercase();
    match member.extension().as_str() {
        "png" => Some(Media::Image("image/png", "png")),
        "jpg" | "jpeg" => Some(Media::Image("image/jpeg", "jpg")),
        "gif" => Some(Media::Image("image/gif", "gif")),
        "heic" => Some(Media::Image("image/heic", "heic")),
        "pdf" => Some(Media::Pdf),
        "m4a" | "aac" | "caf" | "wav" | "mp3" => Some(Media::Audio("audio/mp4", "m4a")),
        "" if folder.contains("/recordings/") => Some(Media::Audio("audio/mp4", "m4a")),
        "" if folder.contains("/images/") => Some(Media::Other),
        _ => None,
    }
}

fn read_session(package: &mut Package, member: &Member, parts: &mut PageParts, page: &mut PageReport) -> Result<()> {
    let bytes = match package.read(member)? {
        Ok(bytes) => bytes,
        Err(why) => {
            page.skipped("handwriting and typed text", format!("{why} {}", APP.pdf_route()));
            return Ok(());
        }
    };
    let plist = match Plist::parse(&bytes) {
        Ok(plist) => plist,
        Err(error) => {
            page.skipped(
                "handwriting and typed text",
                format!("Session.plist could not be read: {}. {}", error.0, APP.pdf_route()),
            );
            return Ok(());
        }
    };
    let Some(archive) = Keyed::new(&plist) else {
        page.skipped(
            "handwriting and typed text",
            format!("Session.plist is not in the layout OpenNote knows. {}", APP.pdf_route()),
        );
        return Ok(());
    };
    let mut bad = 0usize;
    for holder in archive.dicts_with("curvespoints") {
        bad += read_curves(&archive, holder, &mut parts.curves);
    }
    if bad > 0 {
        page.skipped(
            format!("{bad} damaged curve lists"),
            format!(
                "Their sizes do not agree, so OpenNote could not tell the strokes apart. {}",
                APP.pdf_route()
            ),
        );
    }
    parts.text = texts(&archive);
    if !parts.text.is_empty() {
        page.simplified(
            "where text boxes sit",
            "Typed text comes at the top of the page, in the order the note keeps it, with its formatting removed.",
        );
    }
    let shapes = archive
        .dicts_with("shapes")
        .iter()
        .map(|d| archive.get(*d, "shapes").map_or(0, |s| archive.array(s).len()))
        .sum::<usize>();
    page.skipped_count(
        shapes,
        ("shape", "shapes"),
        &format!(
            "Notability keeps shapes apart from the writing, in a form OpenNote cannot read yet. {}",
            APP.pdf_route()
        ),
    );
    Ok(())
}

fn f32s(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| f32::from_le_bytes(*c))
        .collect()
}

/// Reads one dictionary's curves. Returns 1 when its lists disagree, after keeping the curves that fit.
fn read_curves(archive: &Keyed<'_, '_>, holder: usize, out: &mut Vec<Curve>) -> usize {
    let blob = |key: &str| {
        archive
            .get(holder, key)
            .and_then(|v| archive.data(v))
            .unwrap_or_default()
    };
    let points = f32s(blob("curvespoints"));
    let counts: Vec<i32> = blob("curvesnumpoints")
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| i32::from_le_bytes(*c))
        .collect();
    let widths = f32s(blob("curveswidth"));
    let colors: Vec<[u8; 4]> = blob("curvescolors").as_chunks::<4>().0.to_vec();
    let fractional = f32s(blob("curvesfractionalwidths"));
    let total_points = points.len() / 2;
    let with_pressure = fractional.len() == total_points && total_points > 0;
    let mut at = 0usize;
    for (n, count) in counts.iter().enumerate() {
        let Ok(count) = usize::try_from(*count) else {
            return 1;
        };
        let Some(end) = at.checked_add(count).filter(|end| *end <= total_points) else {
            return 1;
        };
        let curve_points: Vec<(f32, f32)> = (at..end)
            .filter_map(|p| Some((*points.get(2 * p)?, *points.get(2 * p + 1)?)))
            .collect();
        let pressure = with_pressure.then(|| {
            fractional
                .get(at..end)
                .unwrap_or_default()
                .iter()
                .map(|f| if f.is_finite() { f * 0.5 } else { 0.5 })
                .collect()
        });
        out.push(Curve {
            points: curve_points,
            pressure,
            width: widths.get(n).copied().unwrap_or(1.5),
            color: colors.get(n).copied().unwrap_or([0, 0, 0, 255]),
        });
        at = end;
    }
    usize::from(at != total_points && !counts.is_empty())
}

/// The typed text of every attributed string in the archive, in archive order, once each.
fn texts(archive: &Keyed<'_, '_>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for object in archive.dicts_with("NS.string") {
        let class = archive.class_name(object).unwrap_or_default();
        if !class.contains("AttributedString") {
            continue;
        }
        if let Some(text) = archive.get(object, "NS.string").and_then(|s| archive.string(s)) {
            let text = text.replace('\u{fffc}', "").trim().to_owned();
            if !text.is_empty() && !out.contains(&text) && out.len() < 10_000 {
                out.push(text);
            }
        }
    }
    out
}
