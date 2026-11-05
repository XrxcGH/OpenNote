//! The first keys of every JSON file: `formatVersion`, `minReaderVersion`, and `kind` (spec 15). Owned by WP1.
//!
//! Every file reader starts here. It rejects files that aren't OpenNote files and files this version can't
//! show, upgrades older files in memory, and marks newer files read-only unless their `minWriterVersion` lets
//! this version edit them (spec 15.2, ADR 0077).

use serde_json::Value;

use super::json::{self, Fields, Json, Obj};
use super::migrate::{upgrade, FileKind};
use crate::error::{FormatError, FormatErrorKind};
use crate::limits::Limits;
use crate::model::{Access, FormatInfo, ReadOnlyReason, Warning};
use crate::{FORMAT_VERSION, MIN_READER_VERSION};

/// Parses a JSON file of one kind: checks its versions and kind, upgrades it, and returns its fields with the
/// header keys taken out, plus what the reader found.
pub fn read_file(
    bytes: &[u8],
    limits: &Limits,
    kind: &'static str,
    file_kind: FileKind,
) -> Result<(Fields, FormatInfo), FormatError> {
    let mut value = json::parse(bytes, limits)?;
    let info = check(&mut value, kind, file_kind)?;
    let mut fields = Fields::new(value, kind.trim_start_matches("opennote."))?;
    for key in ["formatVersion", "minReaderVersion", "minWriterVersion", "kind"] {
        fields.take(key);
    }
    Ok((fields, info))
}

/// The version keys of a file: `formatVersion` F, `minReaderVersion` R, and `minWriterVersion` W (spec 15.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    /// `formatVersion`.
    pub format: u32,
    /// `minReaderVersion`.
    pub min_reader: u32,
    /// `minWriterVersion`. Written only when it differs from `format` (`R-VER-2`).
    pub min_writer: u32,
}

impl Stamp {
    /// The keys of a file that uses only version 1 features.
    pub const V1: Stamp = Stamp::new(1);

    /// The keys of a file whose lowest version is `version`: every version 2 feature keeps `minReaderVersion`
    /// at 1, and `minWriterVersion` equals `formatVersion` (`R-VER-8`).
    pub const fn new(version: u32) -> Stamp {
        Stamp {
            format: version,
            min_reader: MIN_READER_VERSION,
            min_writer: version,
        }
    }

    /// The keys a writer writes back for a file newer than itself, which it may edit (`R-VER-5`), or `None`
    /// for a file of this version or an older one, whose keys the writer works out.
    pub fn kept(info: &FormatInfo) -> Option<Stamp> {
        (info.version_read > FORMAT_VERSION).then_some(Stamp {
            format: info.version_read,
            min_reader: info.min_reader,
            min_writer: info.min_writer,
        })
    }

    /// The keys of a tree, Trash, or history file. In version 2 no such file needs version 2 (`R-VER-1`).
    pub fn of_other_file(info: &FormatInfo) -> Stamp {
        Stamp::kept(info).unwrap_or(Stamp::V1)
    }
}

/// What a reader of some version does with a file (spec 15.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    /// It reads and writes the file.
    Edit,
    /// It shows the file and never replaces it.
    ReadOnly,
    /// It can't show the file, and shows the page's `page.md` instead.
    PageMd,
}

/// The version keys a reader finds in a parsed file, with `minWriterVersion` checked (`R-VER-3`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Found {
    /// The keys, where a missing or invalid `minWriterVersion` is taken as `formatVersion`.
    pub stamp: Stamp,
    /// Whether the file holds a `minWriterVersion` that is not a whole number from R to F.
    pub invalid_writer: bool,
}

/// Reads the version keys of a file. `None` when it has no whole `formatVersion` or `minReaderVersion`.
pub fn found(value: &Value) -> Option<Found> {
    let whole = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .map(|v| u32::try_from(v).unwrap_or(u32::MAX))
    };
    let format = whole("formatVersion")?;
    let min_reader = whole("minReaderVersion")?;
    let valid = whole("minWriterVersion").filter(|w| (min_reader..=format).contains(w));
    Some(Found {
        stamp: Stamp {
            format,
            min_reader,
            min_writer: valid.unwrap_or(format),
        },
        invalid_writer: value.get("minWriterVersion").is_some() && valid.is_none(),
    })
}

/// The reading rules of spec 15.2, for a reader whose newest version is `reader`. A reader of version 1 does
/// not know `minWriterVersion`, so it never edits a newer file (`R-VER-4`).
pub fn permission(stamp: Stamp, reader: u32) -> Permission {
    if stamp.min_reader > reader {
        Permission::PageMd
    } else if stamp.format <= reader || (reader >= 2 && stamp.min_writer <= reader) {
        Permission::Edit
    } else {
        Permission::ReadOnly
    }
}

/// Checks the header of a parsed file, and upgrades it in memory when it is older (spec 15.2 and 15.3).
pub fn check(value: &mut Value, kind: &'static str, file_kind: FileKind) -> Result<FormatInfo, FormatError> {
    let not_ours = |detail: String| FormatError::new(FormatErrorKind::WrongKind, detail);
    let map = value
        .as_object()
        .ok_or_else(|| not_ours("not an OpenNote file: not a JSON object".to_owned()))?;
    if !map.get("formatVersion").is_some_and(Value::is_u64) {
        return Err(not_ours("not an OpenNote file: no formatVersion".to_owned()));
    }
    let kind_found = map.get("kind").and_then(Value::as_str).unwrap_or_default();
    if kind_found != kind {
        return Err(not_ours(format!("expected {kind}, found {kind_found:?}")));
    }
    let found =
        found(value).ok_or_else(|| FormatError::new(FormatErrorKind::Validation, "minReaderVersion is missing"))?;
    let stamp = found.stamp;
    let mut info = FormatInfo {
        version_read: stamp.format,
        min_reader: stamp.min_reader,
        min_writer: stamp.min_writer,
        ..FormatInfo::default()
    };
    if found.invalid_writer {
        let detail = format!(
            "minWriterVersion: a whole number from {} to {}",
            stamp.min_reader, stamp.format
        );
        info.warnings.push(Warning::new("format.minWriterVersion", detail));
    }
    match permission(stamp, FORMAT_VERSION) {
        Permission::PageMd => {
            let detail = format!("needs a reader of version {}", stamp.min_reader);
            return Err(FormatError::new(
                FormatErrorKind::NewerVersion(stamp.min_reader),
                detail,
            ));
        }
        Permission::ReadOnly => info.access = Access::ReadOnly(ReadOnlyReason::NewerFormat),
        Permission::Edit if stamp.format < FORMAT_VERSION => {
            upgrade(file_kind, value).map_err(|err| FormatError::new(FormatErrorKind::Validation, err.to_string()))?;
        }
        Permission::Edit => {}
    }
    Ok(info)
}

/// The `formatVersion` of a file as the canonical writer writes it, its first key, read without parsing the
/// file. `None` when the file does not start that way.
pub fn leading_version(bytes: &[u8]) -> Option<u32> {
    // The key comes long before any character that is not ASCII, so a cut that splits one stops at it.
    let head = bytes.get(..bytes.len().min(64)).unwrap_or_default();
    let ascii = head.iter().take_while(|b| b.is_ascii()).count();
    let text = std::str::from_utf8(head.get(..ascii).unwrap_or_default()).ok()?;
    let rest = text
        .strip_prefix('{')?
        .trim_start()
        .strip_prefix("\"formatVersion\":")?
        .trim_start();
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Starts an object with the version keys of `stamp`, then `kind`.
pub fn start(kind: &'static str, stamp: Stamp) -> Obj<'static> {
    let mut obj = Obj::new();
    obj.put("formatVersion", Json::Int(stamp.format.into()))
        .put("minReaderVersion", Json::Int(stamp.min_reader.into()));
    if stamp.min_writer != stamp.format {
        obj.put("minWriterVersion", Json::Int(stamp.min_writer.into()));
    }
    obj.put("kind", Json::str(kind));
    obj
}

/// Marks a file read-only for a reason, unless it already is.
pub fn restrict(info: &mut FormatInfo, reason: ReadOnlyReason) {
    if !info.access.is_read_only() {
        info.access = Access::ReadOnly(reason);
    }
}
