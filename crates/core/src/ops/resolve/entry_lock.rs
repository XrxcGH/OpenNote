//! Stamped entry locks (ADR 0041, A2-17). A locked page holds `view.entryLock` in `page.json`: when it was locked,
//! by whom, and a hash of its content then. While it is there, the core refuses every change to the page except the
//! one edit that removes the lock, so OpenNote can't change a locked entry by accident. The core writes the time
//! and the hash itself when the lock is set, from its own clock and the page as it is, so the interface can't
//! stamp a different moment or content. This is not tamper-proof: anyone with the files can change them.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::Edit;
use crate::error::EditError;
use crate::model::{BlockData, Page, ReadOnlyReason};
use crate::time::Timestamp;

/// The member of the page view that holds the lock.
pub const KEY: &str = "entryLock";

/// The most characters the "by" name keeps.
const MAX_BY: usize = 200;

/// Whether the page is a locked entry.
pub fn is_locked(page: &Page) -> bool {
    page.view.extra.get(KEY).is_some_and(Value::is_object)
}

/// Whether the edits only remove the lock, which is all a locked page accepts.
pub fn unlocks_only(edits: &[Edit]) -> bool {
    let [Edit::SetPage {
        title: None,
        tags: None,
        view: Some(view),
    }] = edits
    else {
        return false;
    };
    view.as_object()
        .is_some_and(|patch| patch.len() == 1 && patch.get(KEY).is_some_and(Value::is_null))
}

/// Refuses the edits when the page is locked and they do more than remove the lock.
pub fn check(page: &Page, edits: &[Edit]) -> Result<(), EditError> {
    if is_locked(page) && !unlocks_only(edits) {
        return Err(EditError::ReadOnly(ReadOnlyReason::LockedEntry));
    }
    Ok(())
}

/// The content hash a lock records: SHA-256 over the title, the Markdown of each text block in page order, the
/// hash of each file, and the IDs of the live strokes, written as `sha256:<hex>`.
pub fn content_hash(page: &Page) -> String {
    let mut hash = Sha256::new();
    let mut part = |label: &str, bytes: &[u8]| {
        hash.update(label.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    };
    part("title", page.title.as_bytes());
    for block in page.blocks.iter() {
        part("block", block.id.to_string().as_bytes());
        if let BlockData::Text(text) = &block.data {
            part("text", text.markdown.as_bytes());
        }
    }
    for asset in page.assets.values() {
        part("asset", &asset.sha256);
    }
    for stroke in page.ink.strokes() {
        part("stroke", stroke.id.to_string().as_bytes());
    }
    let digest = hash.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256:{hex}")
}

/// Stamps a lock the edits set: the core's time and the page's content hash replace whatever the interface sent,
/// and the name is kept short. Returns the stamped edits, or `None` when no edit sets a lock.
pub fn stamp(page: &Page, edits: &[Edit], now: Timestamp) -> Option<Vec<Edit>> {
    let sets_lock = |edit: &Edit| matches!(edit, Edit::SetPage { view: Some(view), .. } if view.get(KEY).is_some_and(Value::is_object));
    if !edits.iter().any(sets_lock) {
        return None;
    }
    let stamped = edits
        .iter()
        .map(|edit| match edit {
            Edit::SetPage {
                title,
                tags,
                view: Some(view),
            } if sets_lock(edit) => {
                let mut view = view.clone();
                if let Some(lock) = view.get_mut(KEY).and_then(Value::as_object_mut) {
                    let by: String = lock
                        .get("by")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .chars()
                        .take(MAX_BY)
                        .collect();
                    let mut record = Map::new();
                    record.insert("lockedAt".into(), Value::String(now.to_rfc3339()));
                    record.insert("by".into(), Value::String(by));
                    record.insert("hash".into(), Value::String(content_hash(page)));
                    *lock = record;
                }
                Edit::SetPage {
                    title: title.clone(),
                    tags: tags.clone(),
                    view: Some(view),
                }
            }
            other => other.clone(),
        })
        .collect();
    Some(stamped)
}

#[cfg(test)]
mod tests;
