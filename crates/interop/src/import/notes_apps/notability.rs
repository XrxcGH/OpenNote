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
//! Erasing is expected to be applied already in what the app saves, so that an erased curve is gone and a partly
//! erased one is saved as its pieces. No real note has confirmed it yet. Typed text is archived as
//! `NSAttributedString` objects. Pictures sit in an `Images` folder, recordings in `Recordings`, and imported PDF
//! files beside them.

use std::collections::HashSet;
use std::path::Path;

use super::bplist::Plist;
use super::container::{Member, Package};
use super::ink::{Curve, MAX_PAGE_POINTS, MAX_STROKES};
use super::keyed::Keyed;
use super::media::{self, Media};
use super::{build_page, keep_page, note_refused, Attachment, NotesApp, PageParts};
use crate::error::Result;
use crate::import::files::Converted;
use crate::report::PageReport;
use crate::sink::ImportEnv;

const APP: NotesApp = NotesApp::Notability;
/// The most curve lists read from one note. A real note has one.
const MAX_HOLDERS: usize = 16;
/// How many items a loop handles between checks of the time budget and Cancel.
const CHECK_EVERY: usize = 4096;

pub(super) fn convert(path: &Path, stem: &str, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut package = Package::open(path)?;
    let mut general = PageReport::default();
    let is_session = |name: &str| {
        name.rsplit(['/', '\\'])
            .next()
            .is_some_and(|n| n.eq_ignore_ascii_case("Session.plist"))
    };
    let (session_refused, others): (Vec<_>, Vec<_>) =
        package.refused.iter().cloned().partition(|(name, _)| is_session(name));
    note_refused(&others, &mut general);
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
        Some(member) => read_session(&mut package, &member, env, &mut parts, &mut page)?,
        None => match session_refused.first() {
            // The note has a Session.plist, but the package limits left it out: say so, not that it is missing.
            Some((_, why)) => page.skipped(
                "handwriting and typed text",
                format!(
                    "Session.plist, which holds the handwriting and typed text, was left out ({}). {}",
                    lower_first(why.trim_end_matches('.')),
                    APP.pdf_route()
                ),
            ),
            None => page.skipped(
                "handwriting and typed text",
                format!("The note has no Session.plist, which holds them. {}", APP.pdf_route()),
            ),
        },
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

/// The text with its first letter in lowercase, to sit inside a sentence.
fn lower_first(text: &str) -> String {
    let mut chars = text.chars();
    chars
        .next()
        .map_or_else(String::new, |first| first.to_lowercase().chain(chars).collect())
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

fn read_session(
    package: &mut Package,
    member: &Member,
    env: &ImportEnv<'_>,
    parts: &mut PageParts,
    page: &mut PageReport,
) -> Result<()> {
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
    let package: &Package = package;
    let check = || -> Result<()> {
        package.check_time()?;
        env.control.checkpoint()
    };
    let mut read = CurveRead::default();
    let holders = archive.dicts_with("curvespoints", &check)?;
    for holder in holders.iter().take(MAX_HOLDERS) {
        check()?;
        read_curves(&archive, *holder, &mut read, &check)?;
    }
    parts.curves = read.curves;
    parts.dropped = read.dropped;
    page.skipped_count(
        holders.len().saturating_sub(MAX_HOLDERS),
        ("extra curve list", "extra curve lists"),
        &format!(
            "A note keeps its writing in one list, so OpenNote reads only the first {MAX_HOLDERS}. {}",
            APP.pdf_route()
        ),
    );
    if read.bad > 0 {
        page.skipped(
            format!("{} damaged curve lists", read.bad),
            format!(
                "Their sizes do not agree, so OpenNote could not tell the strokes apart. {}",
                APP.pdf_route()
            ),
        );
    }
    parts.text = texts(&archive, &check)?;
    if !parts.text.is_empty() {
        page.simplified(
            "where text boxes sit",
            "Typed text comes at the top of the page, in the order the note keeps it, with its formatting removed.",
        );
    }
    let mut shapes = 0usize;
    for (n, dict) in archive.dicts_with("shapes", &check)?.into_iter().enumerate() {
        if n.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        shapes += archive.get(dict, "shapes").map_or(0, |s| archive.array(s).len());
    }
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

/// The curves read so far from a note's curve lists.
#[derive(Debug, Default)]
pub(super) struct CurveRead {
    /// The curves kept: at most [`MAX_STROKES`] of them, with at most [`MAX_PAGE_POINTS`] points in all.
    pub curves: Vec<Curve>,
    /// The points the kept curves hold.
    pub points: usize,
    /// Curves left out: those with no point, and those past the page's limits.
    pub dropped: usize,
    /// Curve lists whose sizes disagree.
    pub bad: usize,
}

impl CurveRead {
    fn full(&self) -> bool {
        self.curves.len() >= MAX_STROKES || self.points >= MAX_PAGE_POINTS
    }
}

fn f32_le(bytes: &[u8]) -> f32 {
    f32::from_le_bytes(bytes.try_into().unwrap_or_default())
}

/// Reads one dictionary's curves into `read`. Only what one page takes is kept, and only the points of the
/// curves kept are decoded. When the dictionary's lists disagree, the curves that fit are kept and it counts as bad.
pub(super) fn read_curves(
    archive: &Keyed<'_, '_>,
    holder: usize,
    read: &mut CurveRead,
    check: &dyn Fn() -> Result<()>,
) -> Result<()> {
    let blob = |key: &str| {
        archive
            .get(holder, key)
            .and_then(|v| archive.data(v))
            .unwrap_or_default()
    };
    // Each point is an x and a y, 4 bytes each.
    let points = blob("curvespoints").as_chunks::<8>().0;
    let counts = blob("curvesnumpoints").as_chunks::<4>().0;
    let widths = blob("curveswidth").as_chunks::<4>().0;
    let colors = blob("curvescolors").as_chunks::<4>().0;
    let fractional = blob("curvesfractionalwidths").as_chunks::<4>().0;
    let total_points = points.len();
    let with_pressure = fractional.len() == total_points && total_points > 0;
    let mut at = 0usize;
    for (n, count) in counts.iter().enumerate() {
        if n.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        if read.full() {
            read.dropped += counts.len() - n;
            return Ok(());
        }
        let Ok(count) = usize::try_from(i32::from_le_bytes(*count)) else {
            read.bad += 1;
            return Ok(());
        };
        let Some(end) = at.checked_add(count).filter(|end| *end <= total_points) else {
            read.bad += 1;
            return Ok(());
        };
        let range = at..end;
        at = end;
        if count == 0 || count > MAX_PAGE_POINTS - read.points {
            read.dropped += 1;
            continue;
        }
        let curve_points: Vec<(f32, f32)> = points
            .get(range.clone())
            .unwrap_or_default()
            .iter()
            .map(|p| {
                let (x, y) = p.split_at(4);
                (f32_le(x), f32_le(y))
            })
            .collect();
        let pressure = with_pressure.then(|| {
            fractional
                .get(range)
                .unwrap_or_default()
                .iter()
                .map(|c| {
                    let f = f32::from_le_bytes(*c);
                    if f.is_finite() {
                        f * 0.5
                    } else {
                        0.5
                    }
                })
                .collect()
        });
        read.points += curve_points.len();
        read.curves.push(Curve {
            points: curve_points,
            pressure,
            width: widths.get(n).map_or(1.5, |c| f32::from_le_bytes(*c)),
            color: colors.get(n).copied().unwrap_or([0, 0, 0, 255]),
        });
    }
    read.bad += usize::from(at != total_points && !counts.is_empty());
    Ok(())
}

/// The typed text of every attributed string in the archive, in archive order, once each.
fn texts(archive: &Keyed<'_, '_>, check: &dyn Fn() -> Result<()>) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (n, object) in archive.dicts_with("NS.string", check)?.into_iter().enumerate() {
        if n.is_multiple_of(CHECK_EVERY) {
            check()?;
        }
        if out.len() >= 10_000 {
            break;
        }
        let class = archive.class_name(object).unwrap_or_default();
        if !class.contains("AttributedString") {
            continue;
        }
        if let Some(text) = archive.get(object, "NS.string").and_then(|s| archive.string(s)) {
            let text = text.replace('\u{fffc}', "").trim().to_owned();
            if !text.is_empty() && seen.insert(text.clone()) {
                out.push(text);
            }
        }
    }
    Ok(out)
}
