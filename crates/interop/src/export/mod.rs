//! Exporting pages, sections, and notebooks to Markdown and HTML files, and to Word.
//!
//! An export writes a new folder named after what it exports, so it never overwrites anything. Pages become
//! files, assets are copied to `assets/`, and links between pages become relative paths. Each export returns a
//! report of what came over, what was simplified, and what was skipped.

mod convert;
mod equations;
mod files;
mod footnotes;
mod latex;
mod names;
mod pdf;
mod plan;
mod pptx;
mod pptx_parts;
mod share;
mod single;
mod tables;
mod word;

pub use convert::Resolver;
pub use files::{export_files, export_files_with, Exported, Format};
pub use latex::{
    export_latex, export_latex_with, latex_preview, Citation as LatexCitation, DateChoice as LatexDate,
    Engine as LatexEngine, LatexOptions, Margin as LatexMargin, Paper as LatexPaper,
};
pub use pdf::{export_pdf_bundle, NoPdfRenderer, PdfRenderer, PreparedPdfRenderer};
pub use plan::Scope;
pub use pptx::export_pptx;
pub use share::{export_share, export_share_with, EXTENSION as SHARE_EXTENSION};
pub use single::export_html_single;
pub use tables::{export_tables, TableFormat};
pub use word::{export_docx, export_docx_with};
