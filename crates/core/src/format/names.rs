//! Names made from titles and file names (spec 3.4, 10.1, and 14.2).

use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::id::AssetId;

/// Longest notebook folder name, in UTF-16 code units.
pub const MAX_FOLDER_NAME_UNITS: usize = 64;
/// Longest asset stem, in UTF-16 code units.
pub const MAX_STEM_UNITS: usize = 24;
/// Longest asset file extension.
pub const MAX_EXTENSION_LEN: usize = 8;

/// Windows device names, compared without case with the part of a name before its first `.`.
const RESERVED: [&str; 32] = [
    "con", "prn", "aux", "nul", "conin$", "conout$", "com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "com¹", "com²", "com³", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8",
    "lpt9", "lpt¹", "lpt²", "lpt³",
];

/// The tree and history files whose sync-tool copies a writer merges or absorbs (spec 14.2 and 14.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ConflictCopyOf {
    /// A copy of `page.json`.
    Page,
    /// A copy of `section.json`.
    Section,
    /// A copy of `notebook.json`.
    Notebook,
    /// A copy of `.history/versions.json`.
    Versions,
    /// A copy of a Trash item's `item.json`.
    TrashItem,
}

/// A safe notebook folder or export file name for a title (spec 3.4, steps 1 to 8).
///
/// `taken` must return true when an entry of the parent folder equals the candidate after [`fold_name`]. The
/// caller then creates the folder with "fail if it exists", and on a clash asks again with that name marked as
/// taken (step 9).
pub fn safe_folder_name(title: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let name = base_folder_name(title);
    if !taken(&name) {
        return name;
    }
    let mut n: u32 = 2;
    loop {
        let candidate = numbered(&name, n);
        if !taken(&candidate) || n == u32::MAX {
            return candidate;
        }
        n = n.saturating_add(1);
    }
}

/// A name as the clash check in spec 3.4 compares it: normalized to NFC and lowercased.
pub fn fold_name(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

fn base_folder_name(title: &str) -> String {
    // Normalizes again after cleaning, because a removed character can let its neighbors combine.
    let cleaned: String = title.nfc().filter_map(clean_char).collect::<String>().nfc().collect();
    let mut name = trim_ends(&collapse_whitespace(&cleaned));
    if name.is_empty() {
        name = "Untitled".to_owned();
    }
    name = trim_ends(truncate_units(&name, MAX_FOLDER_NAME_UNITS));
    name = avoid_reserved(&name);
    trim_ends(truncate_units(&name, MAX_FOLDER_NAME_UNITS))
}

/// Step 2: control characters become spaces, separators become `-`, and some characters are removed.
fn clean_char(c: char) -> Option<char> {
    match c {
        '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}' => Some(' '),
        '/' | '\\' | '|' | ':' => Some('-'),
        '<' | '>' | '"' | '?' | '*' => None,
        c if is_invisible(c) => None,
        c => Some(c),
    }
}

/// The invisible format characters that step 2 removes.
fn is_invisible(c: char) -> bool {
    matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2069}' | '\u{feff}')
}

fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if c.is_whitespace() {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// Step 4: trims spaces, leading `.` and `~`, and trailing `.`, until nothing changes.
fn trim_ends(text: &str) -> String {
    let mut current = text;
    loop {
        let next = current
            .trim_matches(' ')
            .trim_start_matches(['.', '~'])
            .trim_end_matches('.');
        if next == current {
            return next.to_owned();
        }
        current = next;
    }
}

/// The longest prefix of `text` within `max_units` UTF-16 code units, cut at a character boundary.
fn truncate_units(text: &str, max_units: usize) -> &str {
    let mut units = 0usize;
    for (at, c) in text.char_indices() {
        units = units.saturating_add(c.len_utf16());
        if units > max_units {
            return text.get(..at).unwrap_or(text);
        }
    }
    text
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Step 7: inserts `_` after a reserved device name, appends `_` to `desktop.ini`, and breaks up `_vti_`.
fn avoid_reserved(name: &str) -> String {
    let stem_end = name.find('.').unwrap_or(name.len());
    let (stem, rest) = name.split_at(stem_end);
    let trimmed = stem.trim_end_matches(' ');
    let mut out = if is_reserved_stem(trimmed) {
        format!("{trimmed}_{}{rest}", stem.get(trimmed.len()..).unwrap_or(""))
    } else {
        name.to_owned()
    };
    if out.eq_ignore_ascii_case("desktop.ini") {
        out.push('_');
    }
    while let Some(at) = out.to_ascii_lowercase().find("_vti_") {
        out.replace_range(at.saturating_add(4)..at.saturating_add(5), "-");
    }
    out
}

fn is_reserved_stem(stem: &str) -> bool {
    let lower = stem.to_lowercase();
    RESERVED.contains(&lower.as_str())
}

/// Step 8: `name (n)`, with the base shortened so the whole stays within 64 units.
fn numbered(name: &str, n: u32) -> String {
    let suffix = format!(" ({n})");
    let room = MAX_FOLDER_NAME_UNITS.saturating_sub(utf16_len(&suffix));
    let base = trim_ends(truncate_units(name, room));
    format!("{base}{suffix}")
}

/// Whether a character is a letter or digit: Unicode categories L and N.
fn is_letter_or_digit(c: char) -> bool {
    matches!(
        c.general_category_group(),
        GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
    )
}

/// An asset's file name (spec 10.1): its ID, then `-` and a short stem from the original name, then an extension.
pub fn asset_file_name(id: AssetId, original_name: &str, mime: &str) -> String {
    let (stem, extension) = split_extension(original_name);
    let stem = asset_stem(stem);
    let extension = match extension.map(str::to_ascii_lowercase) {
        Some(ext) if is_extension(&ext) => ext,
        _ => extension_for_mime(mime).unwrap_or("bin").to_owned(),
    };
    if stem.is_empty() {
        format!("{id}.{extension}")
    } else {
        format!("{id}-{stem}.{extension}")
    }
}

/// Splits `name.ext` at its last `.`. A leading `.` doesn't start an extension.
fn split_extension(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(at) if at > 0 => {
            let (stem, dot_ext) = name.split_at(at);
            (stem, dot_ext.get(1..).filter(|ext| !ext.is_empty()))
        }
        _ => (name, None),
    }
}

fn asset_stem(original: &str) -> String {
    let lower = original.nfc().collect::<String>().to_lowercase();
    let mut stem = String::with_capacity(lower.len());
    for c in lower.chars() {
        if is_letter_or_digit(c) {
            stem.push(c);
        } else if !stem.ends_with('-') {
            stem.push('-');
        }
    }
    let stem = stem.trim_matches('-');
    truncate_units(stem, MAX_STEM_UNITS).trim_end_matches('-').to_owned()
}

fn is_extension(ext: &str) -> bool {
    (1..=MAX_EXTENSION_LEN).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// Media types and their usual extensions, one pair per line.
const MIME_EXTENSIONS: &str = "\
image/png png
image/jpeg jpg
image/gif gif
image/webp webp
image/svg+xml svg
image/bmp bmp
image/tiff tiff
image/heic heic
image/avif avif
application/pdf pdf
audio/ogg opus
audio/opus opus
audio/mpeg mp3
audio/wav wav
audio/x-wav wav
audio/mp4 m4a
audio/webm webm
video/webm webm
video/mp4 mp4
text/plain txt
text/markdown md
text/csv csv
application/json json
application/zip zip
application/vnd.openxmlformats-officedocument.wordprocessingml.document docx
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx
application/vnd.openxmlformats-officedocument.presentationml.presentation pptx";

/// The usual extension for a media type.
pub fn extension_for_mime(mime: &str) -> Option<&'static str> {
    let essence = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    MIME_EXTENSIONS.lines().find_map(|line| {
        let (known, extension) = line.split_once(' ')?;
        (known == essence).then_some(extension)
    })
}

/// Whether an asset's file name passes the reader's check (spec 10.1): the asset's ID, then optionally `-` and
/// a stem of letters, digits, and `-`, then `.` and an extension of 1 to 8 characters from `a-z0-9`.
/// Anything else is treated as a missing file, so a name from a file can never leave the `assets/` folder.
pub fn check_asset_file_name(id: AssetId, name: &str) -> bool {
    let Some(rest) = name.strip_prefix(id.to_string().as_str()) else {
        return false;
    };
    let Some((stem_part, extension)) = rest.rsplit_once('.') else {
        return false;
    };
    let stem_ok = match stem_part.strip_prefix('-') {
        Some(stem) => !stem.is_empty() && stem.chars().all(|c| c == '-' || is_letter_or_digit(c)),
        None => stem_part.is_empty(),
    };
    stem_ok && is_extension(extension)
}

/// Which file a sync-tool conflict copy is a copy of, judged by its name alone (spec 14.2).
///
/// A name that starts with the file's base name and ends with `.json`, other than the file itself, is a
/// candidate, such as `page (Sam's conflicted copy 2026-09-30).json` or `page-LAPTOP.json`. The caller must
/// still parse it and check that it holds the same ID.
pub fn conflict_copy_kind(file_name: &str) -> Option<ConflictCopyOf> {
    const BASES: [(&str, ConflictCopyOf); 5] = [
        ("page", ConflictCopyOf::Page),
        ("section", ConflictCopyOf::Section),
        ("notebook", ConflictCopyOf::Notebook),
        ("versions", ConflictCopyOf::Versions),
        ("item", ConflictCopyOf::TrashItem),
    ];
    let lower = file_name.to_ascii_lowercase();
    let stem = lower.strip_suffix(".json")?;
    BASES
        .iter()
        .find(|(base, _)| stem.starts_with(base) && stem != *base)
        .map(|&(_, kind)| kind)
}

#[cfg(test)]
mod tests;
