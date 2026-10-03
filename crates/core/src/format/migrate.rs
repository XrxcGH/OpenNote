//! Migrations between format versions (spec 15.3). Owned by WP1. Version 1 has none.
//!
//! A migration is a pure function on a JSON value. It uses no files, no clock, and no randomness, so running it
//! twice gives the same result. The function [`upgrade`] runs the chain one step at a time, from the file's
//! `formatVersion` to [`crate::FORMAT_VERSION`], and sets `formatVersion` after each step.

use serde_json::Value;
use thiserror::Error;

/// The JSON file kinds a migration can apply to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FileKind {
    /// `notebook.json`.
    Notebook,
    /// `section.json`.
    Section,
    /// `page.json`.
    Page,
    /// A Trash item's `item.json`.
    TrashItem,
    /// `.history/versions.json`.
    Versions,
}

impl FileKind {
    /// Every file kind.
    pub const ALL: [FileKind; 5] = [
        FileKind::Notebook,
        FileKind::Section,
        FileKind::Page,
        FileKind::TrashItem,
        FileKind::Versions,
    ];
}

/// One step from a format version to the next. A pure function: no files, no clock, no randomness.
#[derive(Clone, Copy, Debug)]
pub struct Migration {
    /// The version it upgrades from.
    pub from: u32,
    /// The file kinds it applies to.
    pub kinds: &'static [FileKind],
    /// A short name for logs and fixtures.
    pub name: &'static str,
    /// Upgrades the JSON value in place.
    pub run: fn(&mut serde_json::Value) -> Result<(), MigrationError>,
}

/// Every migration, in order. Empty in version 1.
pub static MIGRATIONS: &[Migration] = &[];

/// A migration that couldn't run.
#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("migration {name} failed: {detail}")]
pub struct MigrationError {
    /// The migration's name.
    pub name: &'static str,
    /// What went wrong.
    pub detail: String,
}

/// What an upgrade did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UpgradeReport {
    /// The file's version before.
    pub from: u32,
    /// The file's version after.
    pub to: u32,
    /// The migrations that ran, in order.
    pub applied: Vec<&'static str>,
}

/// Runs every migration from the value's `formatVersion` to the current one.
///
/// A file of the current version, or of a newer one, is left as it is: newer files open read-only (spec
/// 15.2), and no migration ever runs backward.
pub fn upgrade(kind: FileKind, value: &mut serde_json::Value) -> Result<UpgradeReport, MigrationError> {
    upgrade_with(MIGRATIONS, crate::FORMAT_VERSION, kind, value)
}

/// [`upgrade`] with a given chain and target version, so the chain logic can be tested before any migration
/// exists.
pub fn upgrade_with(
    migrations: &[Migration],
    target: u32,
    kind: FileKind,
    value: &mut Value,
) -> Result<UpgradeReport, MigrationError> {
    let from = format_version(value)?;
    let mut report = UpgradeReport {
        from,
        to: from,
        applied: Vec::new(),
    };
    while report.to < target {
        let step = migrations
            .iter()
            .find(|m| m.from == report.to && m.kinds.contains(&kind))
            .ok_or_else(|| MigrationError {
                name: "upgrade",
                detail: format!("no migration of {kind:?} files from version {}", report.to),
            })?;
        (step.run)(value)?;
        let next = report.to.saturating_add(1);
        set_format_version(value, next, step.name)?;
        report.applied.push(step.name);
        report.to = next;
    }
    Ok(report)
}

/// The `formatVersion` of a file, which must be a whole number that fits `u32`.
fn format_version(value: &Value) -> Result<u32, MigrationError> {
    value
        .get("formatVersion")
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(|| MigrationError {
            name: "upgrade",
            detail: "formatVersion is missing or not a whole number".to_owned(),
        })
}

fn set_format_version(value: &mut Value, version: u32, name: &'static str) -> Result<(), MigrationError> {
    let map = value.as_object_mut().ok_or_else(|| MigrationError {
        name,
        detail: "the migration left something other than an object".to_owned(),
    })?;
    map.insert("formatVersion".to_owned(), Value::from(version));
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use serde_json::json;

    use super::*;

    fn rename_title(value: &mut Value) -> Result<(), MigrationError> {
        let map = value.as_object_mut().ok_or(MigrationError {
            name: "rename",
            detail: "not an object".to_owned(),
        })?;
        if let Some(title) = map.remove("name") {
            map.insert("title".to_owned(), title);
        }
        Ok(())
    }

    fn add_tags(value: &mut Value) -> Result<(), MigrationError> {
        if let Some(map) = value.as_object_mut() {
            map.entry("tags").or_insert_with(|| json!([]));
        }
        Ok(())
    }

    const CHAIN: &[Migration] = &[
        Migration {
            from: 1,
            kinds: &[FileKind::Page],
            name: "rename-title",
            run: rename_title,
        },
        Migration {
            from: 2,
            kinds: &[FileKind::Page, FileKind::Section],
            name: "add-tags",
            run: add_tags,
        },
    ];

    #[test]
    fn version_one_has_no_migrations_and_current_files_stay_as_they_are() {
        assert!(MIGRATIONS.is_empty());
        let mut value = json!({"formatVersion": 1, "title": "x"});
        let report = upgrade(FileKind::Page, &mut value).unwrap();
        assert_eq!((report.from, report.to), (1, 1));
        assert!(report.applied.is_empty());
        assert_eq!(value, json!({"formatVersion": 1, "title": "x"}));
    }

    #[test]
    fn newer_files_are_left_alone() {
        let mut value = json!({"formatVersion": 7});
        let report = upgrade(FileKind::Notebook, &mut value).unwrap();
        assert_eq!((report.from, report.to), (7, 7));
    }

    #[test]
    fn a_missing_step_is_an_error() {
        let mut value = json!({"formatVersion": 0});
        assert!(upgrade(FileKind::Page, &mut value).is_err());
        let mut value = json!({"formatVersion": "1"});
        assert!(upgrade(FileKind::Page, &mut value).is_err());
        let mut value = json!({"formatVersion": 1});
        assert!(upgrade_with(CHAIN, 3, FileKind::Section, &mut value).is_err());
    }

    #[test]
    fn the_chain_runs_one_step_at_a_time_and_is_deterministic() {
        let start = json!({"formatVersion": 1, "name": "Biology"});
        let mut value = start.clone();
        let report = upgrade_with(CHAIN, 3, FileKind::Page, &mut value).unwrap();
        assert_eq!(report.applied, ["rename-title", "add-tags"]);
        assert_eq!((report.from, report.to), (1, 3));
        assert_eq!(value, json!({"formatVersion": 3, "title": "Biology", "tags": []}));
        let mut again = start;
        upgrade_with(CHAIN, 3, FileKind::Page, &mut again).unwrap();
        assert_eq!(again, value);
    }
}
