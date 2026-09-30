//! Settings migrations (ARCHITECTURE.md section 16.6). A change that renames, reshapes, or changes the meaning of
//! a field bumps the schema version and adds a `vN_to_vN+1` function here, with a fixture test. Before migrating,
//! the store backs up the file. Version 1 is the first schema, so there's nothing to migrate yet.

use serde_json::Value;

/// Brings a settings document up to [`super::schema::SCHEMA_VERSION`].
pub fn migrate(raw: Value) -> Value {
    raw
}
