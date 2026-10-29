//! The note source that reads a notebook folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::model::{Asset, NotebookFile, Page, SectionFile};
use opennote_core::seams::Codec;
use opennote_core::session::page::read_page_dir;
use opennote_core::store::assets::read_asset;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::{NotebookLayout, NOTEBOOK_JSON, SECTION_JSON};
use opennote_core::store::std_fs::StdFs;
use opennote_core::{Limits, PageId, Timings};

use super::core_error;
use crate::error::{InteropError, Result};
use crate::source::NoteSource;

/// A notebook folder that an export reads.
///
/// The source reads the files as they are on disk, so the app flushes unsaved edits first. A section that
/// cannot be read is left out and listed in [`DiskSource::unreadable`], so the rest of the notebook still exports.
pub struct DiskSource {
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    limits: Limits,
    layout: NotebookLayout,
    notebook: NotebookFile,
    sections: Vec<SectionFile>,
    page_dirs: HashMap<PageId, PathBuf>,
    unreadable: Vec<(String, String)>,
}

impl DiskSource {
    /// Opens a notebook folder on the real file system.
    pub fn open(dir: &Path) -> Result<DiskSource> {
        let fs: Arc<dyn Fs> = Arc::new(StdFs::new(&Timings::default()));
        DiskSource::with(fs, Arc::new(CanonicalCodec), dir)
    }

    /// Opens a notebook folder with the given file system and codec.
    pub fn with(fs: Arc<dyn Fs>, codec: Arc<dyn Codec>, dir: &Path) -> Result<DiskSource> {
        let limits = Limits::default();
        let layout = NotebookLayout::new(dir);
        let bytes = fs.read(&dir.join(NOTEBOOK_JSON), u64::MAX).map_err(|e| {
            InteropError::format(
                format!("{}", dir.display()),
                format!("no readable {NOTEBOOK_JSON}: {e}"),
            )
        })?;
        let notebook = codec
            .read_notebook(&bytes, &limits)
            .map_err(|e| InteropError::format(NOTEBOOK_JSON, e.to_string()))?;
        let mut source = DiskSource {
            fs,
            codec,
            limits,
            layout,
            notebook,
            sections: Vec::new(),
            page_dirs: HashMap::new(),
            unreadable: Vec::new(),
        };
        source.read_sections(dir)?;
        Ok(source)
    }

    /// Sections that could not be read, with the reason.
    pub fn unreadable(&self) -> &[(String, String)] {
        &self.unreadable
    }

    fn read_sections(&mut self, dir: &Path) -> Result<()> {
        let mut entries = self.fs.read_dir(dir).map_err(core_error)?;
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        for entry in entries.into_iter().filter(|e| e.is_dir && !e.name.starts_with('.')) {
            let path = dir.join(&entry.name).join(SECTION_JSON);
            let Ok(bytes) = self.fs.read(&path, u64::MAX) else {
                continue;
            };
            match self.codec.read_section(&bytes, &self.limits) {
                Ok(section) => {
                    let section_dir = self.layout.section_dir(section.id);
                    for page in &section.pages {
                        self.page_dirs.insert(page.id, section_dir.join(page.id.to_string()));
                    }
                    self.sections.push(section);
                }
                Err(error) => self.unreadable.push((entry.name.clone(), error.to_string())),
            }
        }
        self.sections
            .sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        Ok(())
    }

    fn page_dir(&self, id: PageId) -> Result<&PathBuf> {
        self.page_dirs
            .get(&id)
            .ok_or_else(|| InteropError::Missing(format!("page {id}")))
    }
}

impl NoteSource for DiskSource {
    fn notebook(&self) -> &NotebookFile {
        &self.notebook
    }

    fn sections(&self) -> &[SectionFile] {
        &self.sections
    }

    fn page(&self, id: PageId) -> Result<Page> {
        let dir = self.page_dir(id)?;
        read_page_dir(self.fs.as_ref(), self.codec.as_ref(), dir, &self.limits)
            .map(|loaded| loaded.page)
            .map_err(|e| InteropError::format(format!("page {id}"), format!("{e:?}")))
    }

    fn asset_bytes(&self, page: &Page, asset: &Asset) -> Result<Vec<u8>> {
        let dir = self.page_dir(page.id)?;
        read_asset(self.fs.as_ref(), dir, asset, None).map_err(core_error)
    }
}
