//! What the index takes in: a page's title, tags, and the text of each block.

use opennote_core::model::{Block, BlockData, Page, TableData};
use opennote_core::{BlockId, NotebookId, PageId, RevisionId, SectionId, Timestamp};
use serde::{Deserialize, Serialize};

/// The type of a block, as search filters see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockKind {
    /// Text in OpenNote Markdown.
    Text,
    /// The cells of a table.
    Table,
    /// The description of an image, and any text read from it.
    Image,
    /// The description of an attached file, and any text read from it.
    File,
    /// The description of a drawing, and any handwriting recognized in it.
    Ink,
    /// The fallback text of a block type this version does not know.
    Other,
}

impl BlockKind {
    /// Every kind, in column order.
    pub const ALL: [BlockKind; 6] = [
        BlockKind::Text,
        BlockKind::Table,
        BlockKind::Image,
        BlockKind::File,
        BlockKind::Ink,
        BlockKind::Other,
    ];

    /// The name stored in the index and used as the column of the full-text table.
    pub fn as_str(self) -> &'static str {
        match self {
            BlockKind::Text => "text",
            BlockKind::Table => "tables",
            BlockKind::Image => "images",
            BlockKind::File => "files",
            BlockKind::Ink => "ink",
            BlockKind::Other => "other",
        }
    }

    pub(crate) fn from_stored(name: &str) -> BlockKind {
        BlockKind::ALL
            .into_iter()
            .find(|kind| kind.as_str() == name)
            .unwrap_or(BlockKind::Other)
    }
}

/// The text of one block. Text and table blocks hold Markdown, and the other kinds hold plain text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockText {
    /// The block's ID, so a result can jump to it.
    pub id: BlockId,
    /// The block's type.
    pub kind: BlockKind,
    /// The text. For a table, the Markdown of every cell, one cell on each line.
    pub text: String,
}

/// One page, ready to index.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageDoc {
    /// The page.
    pub page: PageId,
    /// The notebook that holds it.
    pub notebook: NotebookId,
    /// The section that holds it.
    pub section: SectionId,
    /// The saved revision this text comes from, so a restart can find pages that were saved but not indexed.
    pub revision: Option<RevisionId>,
    /// The page title, as plain text.
    pub title: String,
    /// The page's tags and its elements' tags, as typed.
    pub tags: Vec<String>,
    /// When the page was made.
    pub created: Timestamp,
    /// The last change to the page's content.
    pub modified: Timestamp,
    /// The text of the blocks, in reading order.
    pub blocks: Vec<BlockText>,
    /// The page sits in an encrypted section. The index keeps nothing of it (spec 5.7).
    pub locked: bool,
    /// The fingerprint of the page file this document was read from, if the source can tell. The index keeps
    /// it, to tell later whether the file changed. See [`PageStamp::fingerprint`](crate::PageStamp::fingerprint).
    pub fingerprint: Option<String>,
}

impl PageDoc {
    /// An empty locked document. Writing it makes the index forget the page and wipe it from the file, which is
    /// what a page that becomes encrypted needs.
    pub fn locked_stub(page: PageId, notebook: NotebookId, section: SectionId) -> PageDoc {
        PageDoc {
            page,
            notebook,
            section,
            revision: None,
            title: String::new(),
            tags: Vec::new(),
            created: Timestamp::EPOCH,
            modified: Timestamp::EPOCH,
            blocks: Vec::new(),
            locked: true,
            fingerprint: None,
        }
    }

    /// Reads what search needs from a page of the core model.
    ///
    /// A `locked` page, or a page with an `encryption` key, yields an empty document that the index refuses to
    /// hold, so its text never gets as far as the index.
    pub fn from_page(page: &Page, notebook: NotebookId, section: SectionId, locked: bool) -> PageDoc {
        let locked = locked || page.encryption.is_some();
        let mut doc = PageDoc {
            page: page.id,
            notebook,
            section,
            revision: Some(page.revision.id),
            title: String::new(),
            tags: Vec::new(),
            created: page.created,
            modified: page.modified,
            blocks: Vec::new(),
            locked,
            fingerprint: None,
        };
        if locked {
            return doc;
        }
        doc.title = page.title.clone();
        doc.tags = page.tags.clone();
        for id in page.reading_order() {
            if let Some(block) = page.blocks.get(id) {
                doc.add_block(block);
            }
        }
        doc
    }

    fn add_block(&mut self, block: &Block) {
        if let BlockData::Text(data) = &block.data {
            self.tags.extend(data.tags.values().flatten().cloned());
        }
        let (kind, text) = block_text(block);
        if !text.trim().is_empty() {
            self.blocks.push(BlockText {
                id: block.id,
                kind,
                text,
            });
        }
    }
}

/// The searchable text of a block, and the kind it counts as.
fn block_text(block: &Block) -> (BlockKind, String) {
    match &block.data {
        BlockData::Text(data) => (BlockKind::Text, data.markdown.to_string()),
        BlockData::Table(data) => (BlockKind::Table, table_text(data)),
        BlockData::Image(data) => (BlockKind::Image, described(&data.alt, data.decorative)),
        BlockData::File(data) => (BlockKind::File, described(&data.alt, data.decorative)),
        BlockData::Ink(data) => (BlockKind::Ink, described(&data.alt, data.decorative)),
        BlockData::Other(_) => (
            BlockKind::Other,
            block
                .fallback
                .as_ref()
                .map(|fallback| fallback.markdown.clone())
                .unwrap_or_default(),
        ),
    }
}

fn described(alt: &str, decorative: bool) -> String {
    if decorative {
        String::new()
    } else {
        alt.to_string()
    }
}

/// Every cell of a table, row by row, each on its own line.
fn table_text(table: &TableData) -> String {
    let mut lines: Vec<&str> = Vec::new();
    for row in &table.rows {
        for column in &table.columns {
            if let Some(cell) = row.cells.get(&column.id) {
                lines.push(&cell.markdown);
            }
        }
    }
    lines.join("\n")
}
