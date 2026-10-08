//! Where exports read notebooks from.
//!
//! The app implements [`NoteSource`] on top of the core's storage. [`MemorySource`] holds a small notebook in
//! memory, for tests and for exporting what an import just made.

use std::collections::HashMap;

use opennote_core::model::{Asset, NotebookFile, Page, SectionFile};
use opennote_core::{AssetId, PageId};

use crate::error::{InteropError, Result};
use crate::sink::{ImportSink, ImportedPage, MemorySink};

/// A notebook that an export reads.
pub trait NoteSource {
    /// The notebook's own file.
    fn notebook(&self) -> &NotebookFile;

    /// The sections, in the order the notebook shows them.
    fn sections(&self) -> &[SectionFile];

    /// Loads a page.
    fn page(&self, id: PageId) -> Result<Page>;

    /// The bytes of an asset of a page.
    fn asset_bytes(&self, page: &Page, asset: &Asset) -> Result<Vec<u8>>;
}

/// A notebook held in memory.
#[derive(Clone, Debug)]
pub struct MemorySource {
    notebook: NotebookFile,
    sections: Vec<SectionFile>,
    pages: HashMap<PageId, Page>,
    assets: HashMap<AssetId, Vec<u8>>,
}

impl MemorySource {
    /// An empty notebook.
    pub fn new(notebook: NotebookFile) -> MemorySource {
        MemorySource {
            notebook,
            sections: Vec::new(),
            pages: HashMap::new(),
            assets: HashMap::new(),
        }
    }

    /// The notebook that an import wrote to a [`MemorySink`].
    pub fn from_sink(sink: MemorySink) -> Result<MemorySource> {
        let notebook = sink
            .notebook
            .ok_or_else(|| InteropError::Missing("notebook in the import".to_owned()))?;
        let mut source = MemorySource::new(notebook);
        source.sections = sink.sections;
        for (_, page) in sink.pages {
            source.add_page(page);
        }
        Ok(source)
    }

    /// Writes the whole notebook to an import sink, as an import would: the notebook, then the pages of each
    /// section with their assets, then the section. The sink's `finish` is left to the caller.
    pub fn write_to(&self, sink: &mut dyn ImportSink) -> Result<()> {
        sink.notebook(self.notebook.clone())?;
        for section in &self.sections {
            for entry in &section.pages {
                let page = self.page(entry.id)?;
                let asset_bytes = page
                    .assets
                    .keys()
                    .filter_map(|id| self.assets.get(id).map(|bytes| (*id, bytes.clone())))
                    .collect();
                sink.page(section.id, ImportedPage { page, asset_bytes })?;
            }
            sink.section(section.clone())?;
        }
        Ok(())
    }

    /// Every page, in no particular order.
    pub fn pages(&self) -> Vec<&Page> {
        self.pages.values().collect()
    }

    /// Adds a section. Its page entries must match the pages added later.
    pub fn add_section(&mut self, section: SectionFile) {
        self.sections.push(section);
    }

    /// Adds a page and its assets.
    pub fn add_page(&mut self, imported: ImportedPage) {
        self.assets.extend(imported.asset_bytes);
        self.pages.insert(imported.page.id, imported.page);
    }
}

impl NoteSource for MemorySource {
    fn notebook(&self) -> &NotebookFile {
        &self.notebook
    }

    fn sections(&self) -> &[SectionFile] {
        &self.sections
    }

    fn page(&self, id: PageId) -> Result<Page> {
        self.pages
            .get(&id)
            .cloned()
            .ok_or_else(|| InteropError::Missing(format!("page {id}")))
    }

    fn asset_bytes(&self, _page: &Page, asset: &Asset) -> Result<Vec<u8>> {
        self.assets
            .get(&asset.id)
            .cloned()
            .ok_or_else(|| InteropError::Missing(format!("asset {}", asset.id)))
    }
}
