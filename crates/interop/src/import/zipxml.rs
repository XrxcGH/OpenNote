//! Reading the parts of an Office or OpenDocument file: a ZIP archive of XML parts and pictures.
//!
//! The `.odt`, `.xlsx`, and `.pptx` importers share this. It keeps the same limits as the Word importer: no part
//! over 64 MiB, no more than a million elements in a part, and no more than 512 MiB unpacked in all.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use super::xmltree::{self, Element, Node};
use crate::archive::{ArchiveLimits, ZipArchive};
use crate::error::{InteropError, Result};

const MAX_PART_BYTES: u64 = 64 << 20;
const MAX_ENTRY_BYTES: u64 = 64 << 20;
const MAX_UNPACKED_BYTES: u64 = 512 << 20;

/// An opened archive that counts what it has unpacked.
pub(super) struct Parts<R: Read + Seek> {
    archive: ZipArchive<R>,
    unpacked: u64,
    /// Pictures left out because the file had already unpacked its budget.
    pub over_budget: usize,
}

impl Parts<BufReader<File>> {
    /// Opens the file at `path`.
    pub fn open(path: &Path) -> Result<Parts<BufReader<File>>> {
        let file = File::open(path).map_err(|e| InteropError::io(path, e))?;
        let archive = ZipArchive::new(
            BufReader::new(file),
            ArchiveLimits {
                entry_bytes: MAX_ENTRY_BYTES,
                ..ArchiveLimits::default()
            },
        )
        .map_err(|error| match error {
            InteropError::Format { detail, .. } => InteropError::format(path.display().to_string(), detail),
            other => other,
        })?;
        Ok(Parts {
            archive,
            unpacked: 0,
            over_budget: 0,
        })
    }
}

impl<R: Read + Seek> Parts<R> {
    /// Opens an archive that is already in a reader.
    pub fn from_reader(reader: R) -> Result<Parts<R>> {
        let archive = ZipArchive::new(
            reader,
            ArchiveLimits {
                entry_bytes: MAX_ENTRY_BYTES,
                ..ArchiveLimits::default()
            },
        )?;
        Ok(Parts {
            archive,
            unpacked: 0,
            over_budget: 0,
        })
    }

    /// Whether the archive holds a part with this name.
    pub fn has(&self, name: &str) -> bool {
        self.archive.find(name).is_some()
    }

    /// The names of the parts that start with `prefix`, sorted.
    pub fn names_under(&self, prefix: &str) -> Vec<String> {
        let mut names: Vec<String> = self
            .archive
            .entries()
            .iter()
            .filter(|e| e.name.starts_with(prefix))
            .map(|e| e.name.clone())
            .collect();
        names.sort();
        names
    }

    /// Reads an XML part. A part over the size limit, or with too many elements, is an error.
    pub fn xml(&mut self, name: &str) -> Result<Option<Element>> {
        let Some(index) = self.archive.find(name) else {
            return Ok(None);
        };
        let size = self.archive.entries().get(index).map_or(0, |e| e.size);
        if size > MAX_PART_BYTES {
            return Err(InteropError::TooBig(format!("the part {name}")));
        }
        let bytes = self.archive.read(index)?;
        self.unpacked = self.unpacked.saturating_add(size);
        let text = crate::text::decode(&bytes).text;
        drop(bytes);
        let (root, stopped) = xmltree::parse_at_most(&text, xmltree::MAX_ELEMENTS);
        if stopped {
            return Err(InteropError::TooBig(format!(
                "the part {name}, which holds too many elements"
            )));
        }
        Ok(Some(root))
    }

    /// Reads a picture or other part. A part that would take the file past its budget is left out and counted.
    pub fn bytes(&mut self, name: &str) -> Option<Vec<u8>> {
        let index = self.archive.find(name)?;
        let size = self.archive.entries().get(index)?.size;
        if self.unpacked.saturating_add(size) > MAX_UNPACKED_BYTES {
            self.over_budget += 1;
            return None;
        }
        let bytes = self.archive.read(index).ok()?;
        self.unpacked = self.unpacked.saturating_add(size);
        Some(bytes)
    }
}

/// Reads the relationships part of an Office file: id to target and whether it points outside the file.
pub(super) fn read_rels(root: &Element) -> HashMap<String, (String, bool)> {
    root.elements("relationship")
        .filter_map(|e| {
            let target = e.attr("target")?.to_owned();
            let external = e.attr("targetmode").is_some_and(|m| m.eq_ignore_ascii_case("external"));
            Some((e.attr("id")?.to_owned(), (target, external)))
        })
        .collect()
}

/// The path of a relationship target, resolved against the folder of the part that holds the relationship.
pub(super) fn resolve(dir: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_owned();
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in target.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// The folder of a part's name, without a trailing slash.
pub(super) fn dir_of(name: &str) -> &str {
    name.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// The relationships part that belongs to `part`: `ppt/slides/slide1.xml` has `ppt/slides/_rels/slide1.xml.rels`.
pub(super) fn rels_name(part: &str) -> String {
    let (dir, file) = part.rsplit_once('/').unwrap_or(("", part));
    if dir.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{dir}/_rels/{file}.rels")
    }
}

/// Reading elements without caring about text nodes.
pub(super) trait ElementExt {
    /// The child elements.
    fn kids(&self) -> Box<dyn Iterator<Item = &Element> + '_>;
    /// The child elements with this name.
    fn elements<'a>(&'a self, name: &'a str) -> Box<dyn Iterator<Item = &'a Element> + 'a>;
    /// The first child element with this name.
    fn first(&self, name: &str) -> Option<&Element>;
    /// All the text below this element, with no separators.
    fn all_text(&self) -> String;
}

impl ElementExt for Element {
    fn kids(&self) -> Box<dyn Iterator<Item = &Element> + '_> {
        Box::new(self.children.iter().filter_map(|n| match n {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        }))
    }

    fn elements<'a>(&'a self, name: &'a str) -> Box<dyn Iterator<Item = &'a Element> + 'a> {
        Box::new(self.kids().filter(move |e| e.name == name))
    }

    fn first(&self, name: &str) -> Option<&Element> {
        self.kids().find(|e| e.name == name)
    }

    fn all_text(&self) -> String {
        let mut out = String::new();
        collect_text(self, &mut out);
        out
    }
}

fn collect_text(element: &Element, out: &mut String) {
    for node in &element.children {
        match node {
            Node::Text(text) => out.push_str(text),
            Node::Element(child) => collect_text(child, out),
        }
    }
}

/// The text of an XML file's `docProps/core.xml` or `meta.xml` entries as `(title, created, modified, keywords)`.
pub(super) fn first_text(root: &Element, name: &str) -> Option<String> {
    let text = root.first(name)?.all_text();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_resolve_against_the_folder_of_their_part() {
        assert_eq!(resolve("ppt/slides", "../media/a.png"), "ppt/media/a.png");
        assert_eq!(resolve("ppt/slides", "slide2.xml"), "ppt/slides/slide2.xml");
        assert_eq!(resolve("ppt", "/docProps/thumbnail.jpeg"), "docProps/thumbnail.jpeg");
        assert_eq!(rels_name("ppt/slides/slide1.xml"), "ppt/slides/_rels/slide1.xml.rels");
        assert_eq!(rels_name("workbook.xml"), "_rels/workbook.xml.rels");
        assert_eq!(dir_of("a/b/c.xml"), "a/b");
    }
}
