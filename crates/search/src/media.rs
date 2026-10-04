//! Text that was read from media, so search can find it: the words in a picture (OCR), recognized handwriting, and a
//! recording's transcript.
//!
//! The text is a cache on this device, kept apart from the notes: it is never written into a page, and the search
//! index can be thrown away and rebuilt without losing it. When the indexer reads a page it adds the page's entries
//! to the blocks they belong to, so a search finds the picture, the drawing, or the recording by what it says.
//!
//! Nothing here may hold the text of a protected page. A page in an encrypted section reads as locked, and the
//! entries of a locked page are forgotten the moment it is read, so what a person locks leaves with it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use opennote_core::{BlockId, PageId};
use serde::{Deserialize, Serialize};

use crate::doc::{BlockKind, BlockText, PageDoc};

/// The longest text kept for one block.
const MAX_TEXT_BYTES: usize = 200_000;

/// Where the text came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    /// Words read from a picture.
    Image,
    /// Handwriting that was recognized.
    Handwriting,
    /// A recording's transcript.
    Transcript,
}

impl MediaKind {
    fn block_kind(self) -> BlockKind {
        match self {
            MediaKind::Image => BlockKind::Image,
            MediaKind::Handwriting => BlockKind::Ink,
            MediaKind::Transcript => BlockKind::Other,
        }
    }
}

/// The text read from one block.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Where it came from.
    pub kind: MediaKind,
    /// The words.
    pub text: String,
}

#[derive(Default)]
struct Inner {
    path: Option<PathBuf>,
    /// Page ID, then block ID, as text.
    pages: BTreeMap<String, BTreeMap<String, Entry>>,
}

/// The text read from media, shared between the app's commands and the indexer.
#[derive(Clone, Default)]
pub struct MediaText {
    inner: Arc<Mutex<Inner>>,
}

impl MediaText {
    /// A store that lives only in memory.
    pub fn new() -> MediaText {
        MediaText::default()
    }

    /// Keeps the store in a file, and loads what the file holds. A file that can't be read is ignored: this is a
    /// cache, and the pictures can be read again.
    pub fn attach(&self, path: &Path) {
        let mut inner = self.lock();
        inner.path = Some(path.to_owned());
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(pages) = serde_json::from_slice(&bytes) {
                inner.pages = pages;
            }
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn save(inner: &Inner) {
        let Some(path) = &inner.path else { return };
        let Ok(bytes) = serde_json::to_vec(&inner.pages) else {
            return;
        };
        let temporary = path.with_extension("tmp");
        if std::fs::write(&temporary, bytes).is_ok() && std::fs::rename(&temporary, path).is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
    }

    /// Records the words read from a block. Empty text removes the entry. Returns whether anything changed.
    pub fn set(&self, page: PageId, block: BlockId, kind: MediaKind, text: &str) -> bool {
        let text = clip(text.trim());
        let mut inner = self.lock();
        let key = page.to_string();
        let changed = if text.is_empty() {
            let removed = inner
                .pages
                .get_mut(&key)
                .is_some_and(|blocks| blocks.remove(&block.to_string()).is_some());
            if inner.pages.get(&key).is_some_and(BTreeMap::is_empty) {
                inner.pages.remove(&key);
            }
            removed
        } else {
            let entry = Entry {
                kind,
                text: text.to_owned(),
            };
            inner
                .pages
                .entry(key)
                .or_default()
                .insert(block.to_string(), entry.clone())
                != Some(entry)
        };
        if changed {
            Self::save(&inner);
        }
        changed
    }

    /// Forgets everything recorded for a page. Returns whether there was anything.
    pub fn forget_page(&self, page: PageId) -> bool {
        let mut inner = self.lock();
        let removed = inner.pages.remove(&page.to_string()).is_some();
        if removed {
            Self::save(&inner);
        }
        removed
    }

    /// The blocks of a page that have text, and what kind it is.
    pub fn blocks(&self, page: PageId) -> Vec<(String, MediaKind)> {
        self.lock()
            .pages
            .get(&page.to_string())
            .map(|blocks| {
                blocks
                    .iter()
                    .map(|(block, entry)| (block.clone(), entry.kind))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Adds the page's entries to its document. Text goes after the block's own words, and a block the document
    /// has no words for gets a block of its own. A locked page gets nothing, and its entries are forgotten.
    pub fn apply(&self, doc: &mut PageDoc) {
        if doc.locked {
            self.forget_page(doc.page);
            return;
        }
        let inner = self.lock();
        let Some(entries) = inner.pages.get(&doc.page.to_string()) else {
            return;
        };
        for (block, entry) in entries {
            let Ok(id) = block.parse::<BlockId>() else { continue };
            match doc.blocks.iter_mut().find(|candidate| candidate.id == id) {
                Some(found) => {
                    found.text.push('\n');
                    found.text.push_str(&entry.text);
                }
                None => doc.blocks.push(BlockText {
                    id,
                    kind: entry.kind.block_kind(),
                    text: entry.text.clone(),
                }),
            }
        }
    }
}

/// The text cut to the limit, at a character boundary.
fn clip(text: &str) -> &str {
    if text.len() <= MAX_TEXT_BYTES {
        return text;
    }
    let mut end = MAX_TEXT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use opennote_core::{Id, NotebookId, SectionId, Timestamp};

    use super::*;

    fn page() -> PageId {
        PageId::from(Id::from_parts(1_001, 1))
    }

    fn block(n: u64) -> BlockId {
        BlockId::from(Id::from_parts(2_000 + n, 1))
    }

    fn doc(locked: bool) -> PageDoc {
        PageDoc {
            page: page(),
            notebook: NotebookId::from(Id::from_parts(3_001, 1)),
            section: SectionId::from(Id::from_parts(4_001, 1)),
            revision: None,
            title: "Trip".into(),
            tags: Vec::new(),
            created: Timestamp::from_unix_ms(0),
            modified: Timestamp::from_unix_ms(0),
            blocks: vec![BlockText {
                id: block(1),
                kind: BlockKind::Image,
                text: "A map".into(),
            }],
            locked,
            fingerprint: None,
        }
    }

    #[test]
    fn adds_text_to_its_block_or_makes_a_block() {
        let media = MediaText::new();
        assert!(media.set(page(), block(1), MediaKind::Image, "Gate 12 Terminal B"));
        assert!(media.set(page(), block(2), MediaKind::Transcript, "welcome to the tour"));
        assert!(!media.set(page(), block(2), MediaKind::Transcript, "welcome to the tour"));
        let mut doc = doc(false);
        media.apply(&mut doc);
        assert_eq!(doc.blocks[0].text, "A map\nGate 12 Terminal B");
        assert_eq!(doc.blocks[1].kind, BlockKind::Other);
        assert_eq!(doc.blocks[1].text, "welcome to the tour");
    }

    #[test]
    fn empty_text_removes_the_entry() {
        let media = MediaText::new();
        media.set(page(), block(1), MediaKind::Image, "words");
        assert!(media.set(page(), block(1), MediaKind::Image, "  "));
        assert!(media.blocks(page()).is_empty());
    }

    #[test]
    fn a_locked_page_gets_nothing_and_is_forgotten() {
        let media = MediaText::new();
        media.set(page(), block(1), MediaKind::Handwriting, "secret plan");
        let mut locked = doc(true);
        locked.blocks.clear();
        media.apply(&mut locked);
        assert!(locked.blocks.is_empty());
        assert!(media.blocks(page()).is_empty());
    }

    #[test]
    fn survives_a_restart_through_its_file() {
        let dir = std::env::temp_dir().join(format!("opennote-media-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("media-text.json");
        let first = MediaText::new();
        first.attach(&file);
        first.set(page(), block(1), MediaKind::Image, "kept words");
        let second = MediaText::new();
        second.attach(&file);
        assert_eq!(second.blocks(page()), vec![(block(1).to_string(), MediaKind::Image)]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
