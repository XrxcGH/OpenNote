//! Where imports write their results.
//!
//! An import hands over one page at a time, so a large vault never sits in memory whole. The app implements
//! [`ImportSink`] to write each page into a new notebook, which is what makes "Undo this import" one step.

use std::collections::BTreeMap;

use opennote_core::model::{DeviceRef, NotebookFile, Page, SectionFile};
use opennote_core::{AssetId, Clock, SectionId};

use crate::error::Result;
use crate::run::Control;

/// What an import needs from the app: a clock for IDs and times, the device that wrote the pages, and the
/// control that carries progress and Cancel.
pub struct ImportEnv<'a> {
    /// The clock for IDs and save times.
    pub clock: &'a dyn Clock,
    /// The device that is importing (spec 5.3).
    pub device: DeviceRef,
    /// Progress and Cancel. [`Control::none`] reports nothing and never cancels.
    pub control: Control,
}

impl<'a> ImportEnv<'a> {
    /// An environment without progress or cancel.
    pub fn new(clock: &'a dyn Clock, device: DeviceRef) -> ImportEnv<'a> {
        ImportEnv {
            clock,
            device,
            control: Control::none(),
        }
    }

    /// The same environment with a control.
    pub fn with_control(mut self, control: Control) -> ImportEnv<'a> {
        self.control = control;
        self
    }
}

impl ImportEnv<'_> {
    /// The writer name that imported pages carry in their revisions.
    pub fn writer(&self) -> String {
        format!("OpenNote {} import", env!("CARGO_PKG_VERSION"))
    }
}

/// A finished page and the bytes of its assets.
#[derive(Clone, Debug)]
pub struct ImportedPage {
    /// The page, with its asset table filled in.
    pub page: Page,
    /// The file for each asset of the page, to write to `assets/` under the name the table gives.
    pub asset_bytes: BTreeMap<AssetId, Vec<u8>>,
}

/// The destination of an import.
pub trait ImportSink {
    /// Starts the notebook that holds the import. Called once, first.
    fn notebook(&mut self, notebook: NotebookFile) -> Result<()>;

    /// Adds a page to a section. The section itself arrives later, with its list of pages.
    fn page(&mut self, section: SectionId, page: ImportedPage) -> Result<()>;

    /// Adds a section, after all of its pages.
    fn section(&mut self, section: SectionFile) -> Result<()>;

    /// Called once after the last section, when the import succeeded. A sink that stages its work makes the
    /// notebook visible here.
    fn finish(&mut self) -> Result<()> {
        Ok(())
    }

    /// Called when the import stops early, because the person canceled or something failed. The sink removes
    /// everything it wrote, so a stopped import leaves nothing behind. It must not fail.
    fn abort(&mut self) {}
}

/// Runs an import against a sink under one rule: the sink's [`ImportSink::finish`] runs after success, and its
/// [`ImportSink::abort`] runs after any error. Every importer goes through this.
pub fn with_sink<T>(sink: &mut dyn ImportSink, job: impl FnOnce(&mut dyn ImportSink) -> Result<T>) -> Result<T> {
    match job(sink).and_then(|value| sink.finish().map(|()| value)) {
        Ok(value) => Ok(value),
        Err(error) => {
            sink.abort();
            Err(error)
        }
    }
}

/// A sink that keeps everything in memory.
#[derive(Debug, Default)]
pub struct MemorySink {
    /// The notebook.
    pub notebook: Option<NotebookFile>,
    /// The sections, in the order they were added.
    pub sections: Vec<SectionFile>,
    /// The pages, each with the section it belongs to.
    pub pages: Vec<(SectionId, ImportedPage)>,
    /// Whether the import ended well.
    pub finished: bool,
    /// Whether the import stopped early. Everything it wrote was dropped.
    pub aborted: bool,
}

impl ImportSink for MemorySink {
    fn notebook(&mut self, notebook: NotebookFile) -> Result<()> {
        self.notebook = Some(notebook);
        Ok(())
    }

    fn page(&mut self, section: SectionId, page: ImportedPage) -> Result<()> {
        self.pages.push((section, page));
        Ok(())
    }

    fn section(&mut self, section: SectionFile) -> Result<()> {
        self.sections.push(section);
        Ok(())
    }

    fn finish(&mut self) -> Result<()> {
        self.finished = true;
        Ok(())
    }

    fn abort(&mut self) {
        self.aborted = true;
        self.notebook = None;
        self.sections.clear();
        self.pages.clear();
    }
}
