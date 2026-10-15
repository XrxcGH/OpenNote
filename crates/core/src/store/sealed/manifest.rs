//! The sealed list of a protected section's files and folders (ADR 0042).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

/// A file of an unlocked section: its blob, length, and a write counter used as its time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Entry {
    pub(super) blob: String,
    pub(super) len: u64,
    pub(super) modified: i64,
}

/// The sealed list of a section's files and folders, by path relative to the section folder with `/`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct Manifest {
    pub(super) files: BTreeMap<String, Entry>,
    pub(super) dirs: BTreeSet<String>,
    pub(super) tick: i64,
}

impl Manifest {
    pub(super) fn to_json(&self) -> Vec<u8> {
        let files: serde_json::Map<String, Value> = self
            .files
            .iter()
            .map(|(path, e)| (path.clone(), json!({"b": e.blob, "n": e.len, "m": e.modified})))
            .collect();
        serde_json::to_vec(&json!({"v": 1, "files": files, "dirs": self.dirs, "tick": self.tick})).unwrap_or_default()
    }

    pub(super) fn from_json(bytes: &[u8]) -> Option<Manifest> {
        let value: Value = serde_json::from_slice(bytes).ok()?;
        let mut out = Manifest {
            tick: value.get("tick")?.as_i64()?,
            ..Manifest::default()
        };
        for (path, e) in value.get("files")?.as_object()? {
            let blob = e["b"].as_str()?;
            if !plain_rel(path) || !is_blob_name(blob) {
                return None;
            }
            out.files.insert(
                path.clone(),
                Entry {
                    blob: blob.to_owned(),
                    len: e["n"].as_u64()?,
                    modified: e["m"].as_i64()?,
                },
            );
        }
        for dir in value.get("dirs")?.as_array()? {
            let dir = dir.as_str()?;
            if !plain_rel(dir) {
                return None;
            }
            out.dirs.insert(dir.to_owned());
        }
        Some(out)
    }

    pub(super) fn exists(&self, rel: &str) -> bool {
        rel.is_empty() || self.dirs.contains(rel) || self.files.contains_key(rel)
    }

    pub(super) fn dir_exists(&self, rel: &str) -> bool {
        rel.is_empty() || self.dirs.contains(rel)
    }
}

/// A relative path with plain parts only: no root, `..`, `.`, or empty parts.
pub(super) fn plain_rel(rel: &str) -> bool {
    !rel.is_empty()
        && rel
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != ".." && !p.contains('\\'))
}

pub(super) fn is_blob_name(name: &str) -> bool {
    name.len() == 32 && name.bytes().all(|b| b.is_ascii_hexdigit())
}

pub(super) fn parent_rel(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(parent, _)| parent)
}

pub(super) fn under(rel: &str, dir: &str) -> bool {
    dir.is_empty() || rel == dir || rel.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/'))
}
