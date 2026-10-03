//! Settings migrations (ARCHITECTURE.md section 16.6). A change that renames, reshapes, or changes the meaning of
//! a field bumps the schema version and adds a `vN_to_vN+1` step to [`MIGRATIONS`], with a fixture test from a
//! saved file. A step that older versions must not write through is marked `breaking`, which raises
//! `minWriterSchema` so older versions open the file read-only. The store backs the file up before migrating.
//!
//! Version 1 is the first schema, so there's nothing to migrate yet.

use serde_json::Value;

use super::schema::SCHEMA_VERSION;

/// One step from schema version `from` to `from + 1`.
pub struct Migration {
    pub from: u32,
    /// Older versions must not write the result (they would write old-meaning values).
    pub breaking: bool,
    pub run: fn(Value) -> Value,
}

/// Every migration, in order.
pub const MIGRATIONS: &[Migration] = &[];

/// Why a document couldn't be brought up to date.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrateError {
    /// No step starts at this version.
    Missing(u32),
    /// The backup before migrating failed, so nothing was migrated.
    Backup(String),
}

/// The document's schema version: its `schemaVersion`, or 1 when it has none.
pub fn version_of(raw: &Value) -> u32 {
    raw.get("schemaVersion")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(1)
}

/// The oldest schema version that may write the document: its `minWriterSchema`, or 1 when it has none.
pub fn min_writer_of(raw: &Value) -> u32 {
    raw.get("minWriterSchema")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(1)
}

/// Brings a settings document up to [`SCHEMA_VERSION`].
pub fn migrate(raw: Value) -> Result<Value, MigrateError> {
    migrate_with(raw, SCHEMA_VERSION, MIGRATIONS)
}

/// Brings a document up to `target` with `steps`, setting `schemaVersion` after each step and raising
/// `minWriterSchema` after a breaking one. Never lowers either number.
pub fn migrate_with(mut raw: Value, target: u32, steps: &[Migration]) -> Result<Value, MigrateError> {
    let mut version = version_of(&raw);
    while version < target {
        let step = steps
            .iter()
            .find(|step| step.from == version)
            .ok_or(MigrateError::Missing(version))?;
        let min_writer = min_writer_of(&raw);
        raw = (step.run)(raw);
        version += 1;
        if let Value::Object(fields) = &mut raw {
            fields.insert("schemaVersion".into(), version.into());
            let min_writer = if step.breaking { version } else { min_writer };
            fields.insert("minWriterSchema".into(), min_writer.into());
        }
    }
    Ok(raw)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn rename_theme(mut raw: Value) -> Value {
        if let Some(appearance) = raw.get_mut("appearance").and_then(Value::as_object_mut) {
            if let Some(theme) = appearance.remove("theme") {
                appearance.insert("colorScheme".into(), theme);
            }
        }
        raw
    }

    fn add_field(mut raw: Value) -> Value {
        raw["added"] = json!(true);
        raw
    }

    const STEPS: &[Migration] = &[
        Migration {
            from: 1,
            breaking: false,
            run: add_field,
        },
        Migration {
            from: 2,
            breaking: true,
            run: rename_theme,
        },
    ];

    #[test]
    fn runs_each_step_and_raises_the_writer_version_only_for_breaking_ones() {
        let v1 = json!({ "schemaVersion": 1, "minWriterSchema": 1, "appearance": { "theme": "dark" } });
        let v2 = migrate_with(v1.clone(), 2, STEPS).expect("migrates");
        assert_eq!(
            (version_of(&v2), min_writer_of(&v2), v2["added"].clone()),
            (2, 1, json!(true))
        );
        let v3 = migrate_with(v1, 3, STEPS).expect("migrates");
        assert_eq!((version_of(&v3), min_writer_of(&v3)), (3, 3));
        assert_eq!(v3["appearance"], json!({ "colorScheme": "dark" }));
    }

    #[test]
    fn leaves_current_and_newer_documents_alone() {
        let newer = json!({ "schemaVersion": 5, "minWriterSchema": 2 });
        assert_eq!(migrate(newer.clone()), Ok(newer));
        assert_eq!(migrate_with(json!({}), 3, &STEPS[1..]), Err(MigrateError::Missing(1)));
    }

    #[test]
    fn every_saved_schema_version_loads_today() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/settings-v1.json")).expect("JSON");
        let migrated = migrate(fixture).expect("migrates");
        assert_eq!(version_of(&migrated), SCHEMA_VERSION);
    }
}
