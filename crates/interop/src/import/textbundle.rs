//! Importing Bear notes exported as TextBundle folders.
//!
//! A TextBundle is a folder named `Note.textbundle` that holds `text.md`, an `assets` folder with the pictures
//! and files the text uses, and `info.json`. Bear exports one for each note. The import makes a page from each
//! bundle, titled by its first heading, or else by the bundle's name, and puts the pages of one folder in one
//! section. Bear's `#tags` and `#tags with spaces#` become tags.

use std::path::Path;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::markdown::{describe_parse, drop_leading_title};
use super::scan::NoteFile;
use super::tags::hashtags;
use crate::doc::parse::{parse, SoftBreaks};
use crate::doc::{plain_text, Block};
use crate::error::Result;
use crate::frontmatter::FrontMatter;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// The ending of a bundle's folder name.
const BUNDLE: &str = ".textbundle";

/// Imports a TextBundle folder, or a folder of them, into a new notebook.
pub fn import_textbundle_folder(root: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(root, &TextBundleReader, env, sink)
}

/// Whether a folder name is a TextBundle.
pub fn is_bundle_name(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(BUNDLE)
}

/// Reads the `text.md` of TextBundles.
pub(super) struct TextBundleReader;

impl NoteReader for TextBundleReader {
    fn label(&self, _root: &Path) -> String {
        "Bear export".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["md", "markdown", "txt", "text"]
    }

    fn ignored_extensions(&self) -> &'static [&'static str] {
        &["json"]
    }

    fn section_dir<'a>(&self, dir: &'a [String]) -> &'a [String] {
        match dir.split_last() {
            Some((last, above)) if is_bundle_name(last) => above,
            _ => dir,
        }
    }

    fn clean_name(&self, raw: &str) -> String {
        if is_bundle_name(raw) {
            raw[..raw.len() - BUNDLE.len()].to_owned()
        } else {
            raw.to_owned()
        }
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        let mut parsed = parse(text, SoftBreaks::Hard);
        let in_bundle = note.dir.last().filter(|d| is_bundle_name(d));
        let heading = match parsed.blocks.first() {
            Some(Block::Heading { level: 1, content }) => Some(plain_text(content).trim().to_owned()),
            _ => None,
        };
        let title = heading
            .clone()
            .filter(|h| !h.is_empty())
            .or_else(|| in_bundle.map(|d| self.clean_name(d)))
            .unwrap_or_else(|| note.stem.clone());
        drop_leading_title(&mut parsed.blocks, &title);
        let mut report = PageReport::default();
        describe_parse(&parsed.notes, &FrontMatter::default(), &mut report);
        NoteContent {
            title,
            blocks: parsed.blocks,
            notes: report.entries,
            ..NoteContent::default()
        }
    }

    fn find_tags(&self, blocks: &[Block]) -> Vec<String> {
        hashtags(blocks)
    }
}
