//! The first keys of every JSON file: `formatVersion`, `minReaderVersion`, and `kind` (spec 15). Owned by WP1.
//!
//! Every file reader starts here. It rejects files that aren't OpenNote files and files this version can't
//! show, upgrades older files in memory, and marks newer files read-only.

use serde_json::Value;

use super::json::{self, Fields, Json, Obj};
use super::migrate::{upgrade, FileKind};
use crate::error::{FormatError, FormatErrorKind};
use crate::limits::Limits;
use crate::model::{Access, FormatInfo, ReadOnlyReason};
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
    for key in ["formatVersion", "minReaderVersion", "kind"] {
        fields.take(key);
    }
    Ok((fields, info))
}

/// Checks the header of a parsed file, and upgrades it in memory when it is older (spec 15.2 and 15.3).
pub fn check(value: &mut Value, kind: &'static str, file_kind: FileKind) -> Result<FormatInfo, FormatError> {
    let not_ours = |detail: String| FormatError::new(FormatErrorKind::WrongKind, detail);
    let map = value
        .as_object()
        .ok_or_else(|| not_ours("not an OpenNote file: not a JSON object".to_owned()))?;
    let version = map
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| not_ours("not an OpenNote file: no formatVersion".to_owned()))?;
    let found = map.get("kind").and_then(Value::as_str).unwrap_or_default();
    if found != kind {
        return Err(not_ours(format!("expected {kind}, found {found:?}")));
    }
    let min_reader = map
        .get("minReaderVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| FormatError::new(FormatErrorKind::Validation, "minReaderVersion is missing"))?;
    let version = u32::try_from(version).unwrap_or(u32::MAX);
    let min_reader = u32::try_from(min_reader).unwrap_or(u32::MAX);
    if min_reader > FORMAT_VERSION {
        let detail = format!("needs a reader of version {min_reader}");
        return Err(FormatError::new(FormatErrorKind::NewerVersion(min_reader), detail));
    }
    let mut info = FormatInfo {
        version_read: version,
        min_reader,
        ..FormatInfo::default()
    };
    if version > FORMAT_VERSION {
        info.access = Access::ReadOnly(ReadOnlyReason::NewerFormat);
    } else if version < FORMAT_VERSION {
        upgrade(file_kind, value).map_err(|err| FormatError::new(FormatErrorKind::Validation, err.to_string()))?;
    }
    Ok(info)
}

/// Starts an object with the header keys this version writes.
pub fn start(kind: &'static str) -> Obj<'static> {
    let mut obj = Obj::new();
    obj.put("formatVersion", Json::Int(FORMAT_VERSION.into()))
        .put("minReaderVersion", Json::Int(MIN_READER_VERSION.into()))
        .put("kind", Json::str(kind));
    obj
}

/// Marks a file read-only for a reason, unless it already is.
pub fn restrict(info: &mut FormatInfo, reason: ReadOnlyReason) {
    if !info.access.is_read_only() {
        info.access = Access::ReadOnly(reason);
    }
}
