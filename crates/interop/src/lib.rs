//! Import and export for OpenNote.
//!
//! This crate converts between the core note model and other formats. It builds on a neutral document tree
//! ([`doc`]) that reads and writes Markdown. Imports write pages to an [`sink::ImportSink`], and exports read
//! them from a [`source::NoteSource`], so the crate needs no storage of its own.

#![deny(unsafe_code)]

pub mod archive;
pub mod assets;
pub mod csv;
pub mod dates;
pub mod dest;
pub mod detect;
pub mod disk;
pub mod doc;
pub mod docx;
pub mod error;
pub mod export;
pub mod frontmatter;
pub mod html;
pub mod import;
pub mod job;
pub mod page_builder;
pub mod palette;
pub mod report;
pub mod run;
pub mod sink;
pub mod source;
pub mod sqlite;
pub mod text;
pub mod tree;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use detect::{detect, Detected, SourceKind};
pub use disk::{DiskSink, DiskSource};
pub use error::{InteropError, Result};
pub use export::{
    export_docx, export_docx_with, export_files, export_files_with, export_html_single, export_pdf_bundle, export_pptx,
    export_tables, Exported, Format, NoPdfRenderer, PdfRenderer, Scope, TableFormat,
};
pub use import::{
    import_csv, import_docx, import_docx_with, import_enex, import_enex_reader, import_html_folder, import_keep_folder,
    import_logseq_folder, import_markdown_folder, import_mht, import_notion_folder, import_pptx, import_sticky_notes,
    import_text_folder, import_textbundle_folder, import_xlsx, sticky_notes_database, Flavor, WordPages,
};
pub use job::{import, preview, ImportOptions, Preview, PreviewSection};
pub use report::{Entry, LossGroup, Outcome, PageReport, Report, ReportKind};
pub use run::{CancelToken, Control, Event, Phase, Progress, ProgressSink, Unit};
pub use sink::{with_sink, ImportEnv, ImportSink, ImportedPage, MemorySink};
pub use source::{MemorySource, NoteSource};
