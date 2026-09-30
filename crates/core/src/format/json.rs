//! The strict JSON reader and the canonical JSON writer (spec 2.2 and 2.3). Owned by WP1.
//!
//! The writer is hand-written and sorts unknown keys itself, never relying on the order of `serde_json::Map`.
//! Readers reject duplicate keys, escaped lone surrogates, and nesting deeper than the limit, and capture
//! unknown keys with one small visitor per struct.
