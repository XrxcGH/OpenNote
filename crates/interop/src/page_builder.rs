//! Building a core page from a document tree and files.

mod split;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use opennote_core::format::page_json::write_page;
use opennote_core::limits::Limits;
use opennote_core::model::validate::validate_page;
use opennote_core::model::{
    Asset, Block, BlockData, FileData, FileDisplay, ImageData, JsonMap, Named, Page, Revision, TableCell, TableColumn,
    TableData, TableRow, TextData,
};
use opennote_core::{AssetId, BlockId, ColumnId, OrderKey, PageId, RevisionId, RowId, Timestamp};

use crate::assets::make_asset;
use crate::doc::write::inlines_to_markdown;
use crate::doc::{Block as DocBlock, Inline};
use crate::error::{InteropError, Result};
use crate::sink::{ImportEnv, ImportedPage};

/// A text block holds at most this much Markdown, well under the limit of spec 16.
const TEXT_CHUNK_BYTES: usize = 1 << 20;

/// The longest title and tag a page can hold (spec 16).
const TITLE_CHARS: usize = 1_000;
const TAG_CHARS: usize = 200;
const TAGS_PER_PAGE: usize = 1_000;

/// Collects the blocks and assets of one page.
pub struct PageBuilder<'a> {
    env: &'a ImportEnv<'a>,
    page: Page,
    pieces: Vec<BlockData>,
    text: Vec<DocBlock>,
    bytes: BTreeMap<AssetId, Vec<u8>>,
    by_hash: HashMap<[u8; 32], AssetId>,
}

impl<'a> PageBuilder<'a> {
    /// Starts a page. Its dates are the dates of the source, not the time of the import.
    pub fn new(env: &'a ImportEnv<'a>, title: &str, created: Timestamp, modified: Timestamp) -> PageBuilder<'a> {
        PageBuilder::with_id(env, PageId::generate(env.clock), title, created, modified)
    }

    /// Starts a page with an ID that is already known, so other pages can link to it first.
    pub fn with_id(
        env: &'a ImportEnv<'a>,
        id: PageId,
        title: &str,
        created: Timestamp,
        modified: Timestamp,
    ) -> PageBuilder<'a> {
        let revision = Revision::new(
            RevisionId::generate(env.clock),
            env.clock.now(),
            env.device.clone(),
            env.writer(),
        );
        let mut page = Page::new(id, created, revision);
        page.modified = modified;
        page.title = title.chars().take(TITLE_CHARS).collect();
        PageBuilder {
            env,
            page,
            pieces: Vec::new(),
            text: Vec::new(),
            bytes: BTreeMap::new(),
            by_hash: HashMap::new(),
        }
    }

    /// The page's ID, for links from other pages.
    pub fn id(&self) -> PageId {
        self.page.id
    }

    /// Sets the tags in their order, and drops duplicates and tags the format cannot hold.
    pub fn set_tags(&mut self, tags: impl IntoIterator<Item = String>) {
        let mut seen = BTreeSet::new();
        self.page.tags = tags
            .into_iter()
            .map(|tag| tag.trim().to_owned())
            .filter(|tag| !tag.is_empty() && tag.chars().count() <= TAG_CHARS && seen.insert(tag.clone()))
            .take(TAGS_PER_PAGE)
            .collect();
    }

    /// How many tags the page has.
    pub fn tag_count(&self) -> usize {
        self.page.tags.len()
    }

    /// Adds a file to the page's asset table. A file with the same hash as an earlier one is reused.
    pub fn add_asset(&mut self, name: &str, mime: Option<&str>, bytes: Vec<u8>) -> AssetId {
        let id = AssetId::generate(self.env.clock);
        let asset = make_asset(id, name, mime, &bytes, self.env.clock.now());
        if let Some(existing) = self.by_hash.get(&asset.sha256) {
            return *existing;
        }
        self.by_hash.insert(asset.sha256, id);
        self.page.assets.insert(id, asset);
        self.bytes.insert(id, bytes);
        id
    }

    /// An asset that was added.
    pub fn asset(&self, id: AssetId) -> Option<&Asset> {
        self.page.assets.get(&id)
    }

    /// Adds top-level blocks. Text runs together in text blocks, tables become table blocks, and a paragraph
    /// that holds only an image becomes an image block.
    pub fn push_blocks(&mut self, blocks: Vec<DocBlock>) {
        for block in blocks {
            match block {
                DocBlock::Table { header, rows } => {
                    self.flush_text();
                    let data = table_data(header, rows, self.env);
                    self.pieces.push(BlockData::Table(data));
                }
                DocBlock::Paragraph(inlines) => match image_only(&inlines) {
                    Some((asset, alt)) => self.push_image(asset, alt),
                    None => self.text.push(DocBlock::Paragraph(inlines)),
                },
                other => self.text.push(other),
            }
        }
    }

    /// Gives the last table its column types as smart-table data (`data.smart`), so it opens as a smart table.
    /// Text columns get no entry. A page with no table is left alone.
    pub(crate) fn type_last_table(&mut self, kinds: &[crate::import::ColumnKind]) {
        let Some(BlockData::Table(table)) = self.pieces.iter_mut().rev().find(|p| matches!(p, BlockData::Table(_)))
        else {
            return;
        };
        let ids: Vec<String> = table.columns.iter().map(|c| c.id.to_string()).collect();
        if let Some(smart) = crate::import::smart_data(&ids, kinds) {
            table.extra.insert("smart".to_owned(), smart);
        }
    }

    /// Adds an image block.
    pub fn push_image(&mut self, asset: AssetId, alt: String) {
        self.flush_text();
        self.pieces.push(BlockData::Image(ImageData {
            asset,
            alt,
            decorative: false,
            crop: None,
            extra: JsonMap::new(),
        }));
    }

    /// Adds a file block, shown as an icon.
    pub fn push_file(&mut self, asset: AssetId) {
        self.flush_text();
        self.pieces.push(BlockData::File(FileData {
            asset,
            display: Named::Known(FileDisplay::Icon),
            alt: String::new(),
            decorative: false,
            extra: JsonMap::new(),
        }));
    }

    /// Joins the text so far into text blocks of at most [`TEXT_CHUNK_BYTES`]. A block that is longer on its own,
    /// such as a long log in a code block, is cut into blocks of the same kind first.
    fn flush_text(&mut self) {
        let mut chunk = String::new();
        for block in std::mem::take(&mut self.text) {
            for markdown in split::markdown_pieces(block, TEXT_CHUNK_BYTES) {
                if markdown.is_empty() {
                    continue;
                }
                if !chunk.is_empty() && chunk.len() + markdown.len() > TEXT_CHUNK_BYTES {
                    self.pieces.push(text_data(std::mem::take(&mut chunk)));
                }
                if !chunk.is_empty() {
                    chunk.push_str("\n\n");
                }
                chunk.push_str(&markdown);
            }
        }
        if !chunk.is_empty() {
            self.pieces.push(text_data(chunk));
        }
    }

    /// Finishes the page: gives its blocks order keys and returns it with the bytes of its assets.
    ///
    /// A page that the core would refuse to read, or would open as damaged and read-only, is refused here. The
    /// importer then leaves it out and says so in the report, instead of writing it.
    pub fn finish(mut self) -> Result<ImportedPage> {
        self.flush_text();
        let keys = OrderKey::spread(None, None, self.pieces.len())
            .map_err(|e| InteropError::format("block order", e.to_string()))?;
        let now = self.page.modified;
        for (data, order) in std::mem::take(&mut self.pieces).into_iter().zip(keys) {
            let block = Block {
                id: BlockId::generate(self.env.clock),
                order,
                frame: None,
                lock: None,
                created: self.page.created,
                modified: now,
                data,
                fallback: None,
                extra: JsonMap::new(),
            };
            self.page
                .blocks
                .insert(Arc::new(block))
                .map_err(|e| InteropError::format("block IDs", e.to_string()))?;
        }
        check_fits(&self.page)?;
        Ok(ImportedPage {
            page: self.page,
            asset_bytes: self.bytes,
        })
    }
}

/// Checks a page against the core's limits (spec 16): every rule `validate_page` checks, and the size of the
/// `page.json` it would write.
fn check_fits(page: &Page) -> Result<()> {
    let limits = Limits::default();
    if let Some(error) = validate_page(page, &limits).errors.first() {
        let what = format!("this page ({})", error.detail);
        return Err(if error.code.starts_with("limit.") {
            InteropError::TooBig(what)
        } else {
            InteropError::format(what, error.code)
        });
    }
    let bytes = write_page(page).len() as u64;
    if bytes > limits.page_json_bytes {
        let mib = |n: u64| n.div_ceil(1 << 20);
        let what = format!(
            "this page ({} MiB of page data, more than the {} MiB a page may hold)",
            mib(bytes),
            mib(limits.page_json_bytes)
        );
        return Err(InteropError::TooBig(what));
    }
    Ok(())
}

fn text_data(markdown: String) -> BlockData {
    BlockData::Text(TextData {
        markdown: Arc::from(markdown),
        ..TextData::default()
    })
}

/// The asset and description of a paragraph that holds nothing but one image from the asset table.
fn image_only(inlines: &[Inline]) -> Option<(AssetId, String)> {
    let [Inline::Image { dest, alt }] = inlines else {
        return None;
    };
    let id = AssetId::parse(dest.strip_prefix("asset:")?).ok()?;
    Some((id, alt.clone()))
}

fn table_data(header: bool, rows: Vec<Vec<Vec<Inline>>>, env: &ImportEnv<'_>) -> TableData {
    let width = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let columns: Vec<TableColumn> = (0..width)
        .map(|_| TableColumn {
            id: ColumnId::generate(env.clock),
            width: None,
            extra: JsonMap::new(),
        })
        .collect();
    let rows = rows
        .into_iter()
        .map(|cells| TableRow {
            id: RowId::generate(env.clock),
            cells: columns
                .iter()
                .zip(cells.iter().map(Some).chain(std::iter::repeat(None)))
                .map(|(column, cell)| {
                    let markdown = cell.map(|c| inlines_to_markdown(c)).unwrap_or_default();
                    (
                        column.id,
                        TableCell {
                            markdown,
                            extra: JsonMap::new(),
                        },
                    )
                })
                .collect(),
            extra: JsonMap::new(),
        })
        .collect();
    TableData {
        header,
        columns,
        rows,
        extra: JsonMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TestEnv;

    #[test]
    fn a_long_code_block_becomes_text_blocks_the_core_accepts() {
        let world = TestEnv::new();
        let env = world.env();
        let now = env.clock.now();
        let mut builder = PageBuilder::new(&env, "Log", now, now);
        let log: Vec<String> = (0..120_000)
            .map(|n| format!("{n:>8} INFO the service answered in 12 ms"))
            .collect();
        let text = log.join("\n");
        assert!(text.len() > 5 << 20);
        builder.push_blocks(vec![DocBlock::Code {
            language: "log".to_owned(),
            text,
        }]);
        let page = builder.finish().expect("the page fits").page;
        assert!(page.blocks.len() >= 5, "{} blocks", page.blocks.len());
        let report = validate_page(&page, &Limits::default());
        assert!(report.is_valid(), "{:?}", report.errors);
    }

    #[test]
    fn a_page_over_the_size_limit_is_refused() {
        let world = TestEnv::new();
        let env = world.env();
        let now = env.clock.now();
        let mut builder = PageBuilder::new(&env, "Huge", now, now);
        let chunk = "x".repeat(TEXT_CHUNK_BYTES);
        builder.pieces = (0..70).map(|_| text_data(chunk.clone())).collect();
        let error = builder.finish().map(|_| ()).expect_err("too big");
        assert!(matches!(error, InteropError::TooBig(_)), "{error}");
        assert!(error.to_string().contains("MiB of page data"), "{error}");
    }
}
