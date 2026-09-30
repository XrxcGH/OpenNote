//! Migrations between format versions (spec 15.3). Owned by WP1. Version 1 has none.

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
pub fn upgrade(_kind: FileKind, _value: &mut serde_json::Value) -> Result<UpgradeReport, MigrationError> {
    unimplemented!("WP1: upgrade")
}
