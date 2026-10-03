//! Importing notes from other apps: Markdown folders (Obsidian and Joplin), HTML folders, plain text, and
//! Evernote export files.
//!
//! Every import writes a new notebook to an [`crate::ImportSink`], so the whole import can be undone by removing
//! that notebook. Each import returns a [`crate::Report`] with an entry for each page.

mod dateline;
mod enex;
mod enex_xml;
mod enml;
mod files;
mod folder;
mod html;
mod html_note;
mod htmltree;
mod keep;
mod links;
mod logseq;
mod markdown;
mod mht;
mod mime;
mod notion;
mod odt;
mod pictures;
mod placement;
mod plain;
mod scan;
mod sheet;
mod sticky;
mod tags;
mod textbundle;
mod word;
mod xmltree;
mod zipxml;

pub use enex::{import_enex, import_enex_reader};
pub use html::import_html_folder;
pub use keep::{import_keep_folder, looks_like_keep};
pub use logseq::import_logseq_folder;
pub use markdown::import_markdown_folder;
pub use mht::import_mht;
pub use notion::import_notion_folder;
pub use plain::import_text_folder;
pub(crate) use scan::has_notion_id;
pub use scan::Flavor;
pub use sheet::import_csv;
pub use sticky::{
    import_sticky_notes, is_sticky_notes_database, sticky_notes_database, DATABASE_NAME as STICKY_NOTES_FILE,
};
pub use textbundle::{import_textbundle_folder, is_bundle_name};
pub use word::{import_docx, import_docx_with, WordPages};
