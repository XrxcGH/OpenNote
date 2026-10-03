//! Names and the changes to them: the tree of a [`FaultFs`](super::FaultFs), and how each change applies.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use crate::error::{FsError, FsErrorKind};

/// A path as its components. The empty key is the root folder.
pub(super) type Key = Vec<String>;

/// Names to entries.
pub(super) type Tree = BTreeMap<Key, Entry>;

/// A name's target: a folder or a file, by inode number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Entry {
    Dir(u128),
    File(u128),
}

impl Entry {
    pub(super) fn ino(self) -> u128 {
        match self {
            Entry::Dir(ino) | Entry::File(ino) => ino,
        }
    }

    pub(super) fn is_dir(self) -> bool {
        matches!(self, Entry::Dir(_))
    }
}

/// A file's content and attributes. Content only ever grows after the file is made, so the flushed part is
/// always a prefix.
#[derive(Clone, Debug)]
pub(super) struct Inode {
    pub(super) data: Arc<Vec<u8>>,
    pub(super) durable_len: usize,
    pub(super) modified: i64,
    pub(super) read_only: bool,
    pub(super) placeholder: bool,
}

/// A change to the tree of names.
#[derive(Clone, Debug)]
pub(super) enum MetaOp {
    /// A new name, which must not exist.
    Create { key: Key, entry: Entry },
    /// A name set from outside, replacing a file of that name.
    Put { key: Key, entry: Entry },
    /// A file renamed. Only the file `ino` moves.
    Rename {
        from: Key,
        to: Key,
        ino: u128,
        replace: bool,
    },
    /// A file deleted.
    Remove { key: Key },
    /// A folder and everything in it deleted.
    RemoveTree { key: Key },
    /// A folder renamed, never replacing anything.
    RenameDir { from: Key, to: Key },
}

pub(super) fn parent(key: &[String]) -> Key {
    key.split_last().map(|(_, parent)| parent.to_vec()).unwrap_or_default()
}

fn parent_is_dir(tree: &Tree, key: &[String]) -> bool {
    !key.is_empty() && tree.get(&parent(key)).is_some_and(|entry| entry.is_dir())
}

impl MetaOp {
    /// Applies the change to `tree` if its preconditions hold there, and says whether it did.
    pub(super) fn apply(&self, tree: &mut Tree) -> bool {
        match self {
            MetaOp::Create { key, entry } => {
                let ok = parent_is_dir(tree, key) && !tree.contains_key(key);
                ok && tree.insert(key.clone(), *entry).is_none()
            }
            MetaOp::Put { key, entry } => {
                let ok = parent_is_dir(tree, key) && tree.get(key).is_none_or(|old| !old.is_dir());
                if ok {
                    tree.insert(key.clone(), *entry);
                }
                ok
            }
            MetaOp::Rename { from, to, ino, replace } => {
                let source = tree.get(from) == Some(&Entry::File(*ino));
                let target = match tree.get(to) {
                    None => true,
                    Some(entry) => *replace && !entry.is_dir(),
                };
                let ok = source && target && parent_is_dir(tree, to);
                if ok {
                    tree.remove(from);
                    tree.insert(to.clone(), Entry::File(*ino));
                }
                ok
            }
            MetaOp::Remove { key } => matches!(tree.get(key), Some(Entry::File(_))) && tree.remove(key).is_some(),
            MetaOp::RemoveTree { key } => {
                let ok = !key.is_empty() && tree.contains_key(key);
                if ok {
                    tree.retain(|k, _| !k.starts_with(key));
                }
                ok
            }
            MetaOp::RenameDir { from, to } => {
                let ok = tree.get(from).is_some_and(|e| e.is_dir())
                    && !tree.contains_key(to)
                    && parent_is_dir(tree, to)
                    && !to.starts_with(from);
                if ok {
                    move_subtree(tree, from, to);
                }
                ok
            }
        }
    }

    /// The folders whose flush makes the change durable where a rename needs a folder flush (ext4 and FAT).
    pub(super) fn folders(&self) -> Vec<Key> {
        let mut folders = match self {
            MetaOp::Create { key, .. } | MetaOp::Put { key, .. } | MetaOp::Remove { key } => vec![parent(key)],
            MetaOp::RemoveTree { key } => vec![parent(key)],
            MetaOp::Rename { from, to, .. } | MetaOp::RenameDir { from, to } => vec![parent(to), parent(from)],
        };
        folders.dedup();
        folders
    }
}

fn move_subtree(tree: &mut Tree, from: &Key, to: &Key) {
    let moved: Vec<Key> = tree.keys().filter(|k| k.starts_with(from)).cloned().collect();
    for key in moved {
        if let Some(entry) = tree.remove(&key) {
            let mut new_key = to.clone();
            new_key.extend_from_slice(&key[from.len()..]);
            tree.insert(new_key, entry);
        }
    }
}

/// A path as a key. `..` is refused, and the root and `.` are skipped.
pub(super) fn key_of(path: &Path) -> Result<Key, FsError> {
    let mut key = Key::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => key.push(prefix.as_os_str().to_string_lossy().into_owned()),
            Component::Normal(part) => key.push(part.to_string_lossy().into_owned()),
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => return Err(FsError::new(FsErrorKind::Io, path)),
        }
    }
    Ok(key)
}

/// The path of a key: the inverse of [`key_of`], with a drive prefix such as `C:` kept first.
pub(super) fn path_of(key: &[String]) -> PathBuf {
    let mut path = PathBuf::from(std::path::MAIN_SEPARATOR_STR);
    for (index, part) in key.iter().enumerate() {
        if index == 0 && part.ends_with(':') {
            path = PathBuf::from(format!("{part}{}", std::path::MAIN_SEPARATOR));
        } else {
            path.push(part);
        }
    }
    path
}
