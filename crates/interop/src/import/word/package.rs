//! Opening a Word file: the document part, its relationships, styles, numbering, and properties.

use std::collections::HashMap;
use std::io::{Read, Seek};

use opennote_core::Timestamp;

use super::styles::{Numbering, Styles};
use crate::archive::{ArchiveLimits, ZipArchive};
use crate::dates::parse_date;
use crate::error::{InteropError, Result};
use crate::import::xmltree::{self, Element, Node};

/// The largest XML part that is read. The reader builds an element for each tag, so a part takes several times
/// its size in memory.
const MAX_PART_BYTES: u64 = 64 << 20;

/// The most bytes one part or picture of a Word file may unpack to.
const MAX_ENTRY_BYTES: u64 = 64 << 20;

/// The most bytes that a whole Word file may unpack to with its parts and pictures together. Pictures past it are
/// left out and reported, so a small file cannot fill the memory with pictures that inflate to gigabytes.
pub(super) const MAX_DOCUMENT_BYTES: u64 = 512 << 20;

/// The limits to open a Word file with.
pub(super) fn limits() -> ArchiveLimits {
    ArchiveLimits {
        entry_bytes: MAX_ENTRY_BYTES,
        ..ArchiveLimits::default()
    }
}

/// Where a relationship points.
#[derive(Clone, Debug)]
pub(super) struct Rel {
    /// The target: a path inside the file, or an address.
    pub target: String,
    /// Whether the target is outside the file, such as a web address.
    pub external: bool,
}

/// The title, dates, and keywords from `docProps/core.xml`.
#[derive(Clone, Debug, Default)]
pub(super) struct CoreProps {
    pub title: Option<String>,
    pub created: Option<Timestamp>,
    pub modified: Option<Timestamp>,
    pub keywords: Vec<String>,
}

/// An opened Word file.
pub(super) struct Package<R: Read + Seek> {
    pub archive: ZipArchive<R>,
    pub document: Element,
    pub rels: HashMap<String, Rel>,
    pub styles: Styles,
    pub numbering: Numbering,
    pub props: CoreProps,
    /// Names of parts that hold content this import does not read.
    pub unread_parts: Vec<&'static str>,
    /// The bytes that the parts and pictures have unpacked so far.
    unpacked: u64,
    /// The most bytes the file may unpack to: [`MAX_DOCUMENT_BYTES`].
    budget: u64,
    /// Pictures left out because the file had already unpacked its budget.
    pub over_budget: usize,
}

impl<R: Read + Seek> Package<R> {
    pub fn open(mut archive: ZipArchive<R>, name: &str) -> Result<Package<R>> {
        let mut unpacked = 0;
        let main = main_part(&mut archive, &mut unpacked).ok_or_else(|| {
            InteropError::format(name, "it is not a Word document: the file has no word/document.xml")
        })?;
        let document = xml_part(&mut archive, &main, &mut unpacked)?
            .ok_or_else(|| InteropError::format(name, "the document part is empty"))?;
        let dir = main.rsplit_once('/').map_or("", |(dir, _)| dir).to_owned();
        let rels_name = format!("{dir}/_rels/{}.rels", main.rsplit('/').next().unwrap_or("document.xml"));
        let rels = xml_part(&mut archive, &rels_name, &mut unpacked)?
            .map(|e| read_rels(&e))
            .unwrap_or_default();
        let styles = xml_part(&mut archive, &format!("{dir}/styles.xml"), &mut unpacked)?
            .map(|e| Styles::read(&e))
            .unwrap_or_default();
        let numbering = xml_part(&mut archive, &format!("{dir}/numbering.xml"), &mut unpacked)?
            .map(|e| Numbering::read(&e))
            .unwrap_or_default();
        let props = xml_part(&mut archive, "docProps/core.xml", &mut unpacked)?
            .map(|e| read_props(&e))
            .unwrap_or_default();
        let unread_parts = unread(&archive, &dir);
        Ok(Package {
            archive,
            document,
            rels,
            styles,
            numbering,
            props,
            unread_parts,
            unpacked,
            budget: MAX_DOCUMENT_BYTES,
            over_budget: 0,
        })
    }

    /// The bytes of a part that a relationship names, relative to the document's folder. A picture that would
    /// take the file past its budget is left out and counted in `over_budget`.
    pub fn media(&mut self, target: &str) -> Option<Vec<u8>> {
        let path = target.trim_start_matches('/');
        let candidates = [format!("word/{path}"), path.to_owned()];
        let index = candidates.iter().find_map(|c| self.archive.find(c))?;
        let size = self.archive.entries().get(index)?.size;
        if self.unpacked.saturating_add(size) > self.budget {
            self.over_budget += 1;
            return None;
        }
        let bytes = self.archive.read(index).ok()?;
        self.unpacked = self.unpacked.saturating_add(size);
        Some(bytes)
    }
}

/// The path of the main document part: the one `_rels/.rels` names, else `word/document.xml`.
fn main_part<R: Read + Seek>(archive: &mut ZipArchive<R>, unpacked: &mut u64) -> Option<String> {
    if let Ok(Some(root)) = xml_part(archive, "_rels/.rels", unpacked) {
        let rels = read_rels(&root);
        let found = rels
            .values()
            .find(|r| r.target.ends_with("document.xml") && !r.external);
        if let Some(rel) = found {
            let path = rel.target.trim_start_matches('/').to_owned();
            if archive.find(&path).is_some() {
                return Some(path);
            }
        }
    }
    archive
        .find("word/document.xml")
        .map(|_| "word/document.xml".to_owned())
}

/// Reads an XML part and adds its size to `unpacked`. A part over [`MAX_PART_BYTES`], or one that holds more
/// than [`xmltree::MAX_ELEMENTS`] elements, is refused.
fn xml_part<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str, unpacked: &mut u64) -> Result<Option<Element>> {
    let Some(index) = archive.find(name) else {
        return Ok(None);
    };
    let size = archive.entries().get(index).map_or(0, |e| e.size);
    if size > MAX_PART_BYTES {
        return Err(InteropError::TooBig(format!("the part {name}")));
    }
    let bytes = archive.read(index)?;
    *unpacked = unpacked.saturating_add(size);
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

fn read_rels(root: &Element) -> HashMap<String, Rel> {
    root.children
        .iter()
        .filter_map(|n| match n {
            Node::Element(e) if e.name == "relationship" => Some(e),
            _ => None,
        })
        .filter_map(|e| {
            let id = e.attr("id")?.to_owned();
            let target = e.attr("target")?.to_owned();
            let external = e.attr("targetmode").is_some_and(|m| m.eq_ignore_ascii_case("external"));
            Some((id, Rel { target, external }))
        })
        .collect()
}

fn read_props(root: &Element) -> CoreProps {
    let text_of = |name: &str| -> Option<String> {
        let found = root.children.iter().find_map(|n| match n {
            Node::Element(e) if e.name == name => Some(e),
            _ => None,
        })?;
        let text: String = found
            .children
            .iter()
            .filter_map(|n| match n {
                Node::Text(t) => Some(t.as_str()),
                Node::Element(_) => None,
            })
            .collect();
        Some(text.trim().to_owned()).filter(|t| !t.is_empty())
    };
    CoreProps {
        title: text_of("dc:title"),
        created: text_of("dcterms:created").and_then(|t| parse_date(&t)),
        modified: text_of("dcterms:modified").and_then(|t| parse_date(&t)),
        keywords: text_of("cp:keywords")
            .map(|k| {
                k.split([',', ';'])
                    .map(|t| t.trim().to_owned())
                    .filter(|t| !t.is_empty())
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// Content parts that the import leaves out, by what they hold.
fn unread<R: Read + Seek>(archive: &ZipArchive<R>, dir: &str) -> Vec<&'static str> {
    let has = |pattern: &str| {
        archive.entries().iter().any(|e| {
            let name = e.name.to_lowercase();
            name.starts_with(&format!("{}/{pattern}", dir.to_lowercase()))
        })
    };
    let mut found = Vec::new();
    for (pattern, label) in [
        ("footnotes", "footnotes"),
        ("endnotes", "endnotes"),
        ("comments", "comments"),
        ("header", "headers"),
        ("footer", "footers"),
        ("charts/", "charts"),
        ("embeddings/", "embedded objects"),
    ] {
        if has(pattern) {
            found.push(label);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::testing::zip_bytes;

    const DOCUMENT: &[u8] = b"<w:document><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>";

    #[test]
    fn pictures_past_the_budget_are_left_out_and_counted() {
        let picture = [7u8; 1000];
        let bytes = zip_bytes(&[
            ("word/document.xml", DOCUMENT),
            ("word/media/a.png", &picture),
            ("word/media/b.png", &picture),
        ]);
        let archive = ZipArchive::new(Cursor::new(bytes), limits()).expect("opens");
        let mut package = Package::open(archive, "Doc").expect("a package");
        package.budget = package.unpacked + 1500;
        assert!(package.media("media/a.png").is_some());
        assert!(package.media("media/b.png").is_none());
        assert_eq!(package.over_budget, 1);
    }

    #[test]
    fn a_part_of_too_many_tiny_tags_is_refused() {
        let mut document = b"<w:document><w:body>".to_vec();
        document.extend(b"<a/>".repeat(xmltree::MAX_ELEMENTS));
        document.extend(b"</w:body></w:document>");
        let bytes = zip_bytes(&[("word/document.xml", &document)]);
        let archive = ZipArchive::new(Cursor::new(bytes), limits()).expect("opens");
        assert!(matches!(Package::open(archive, "Doc"), Err(InteropError::TooBig(_))));
    }

    #[test]
    fn word_files_open_with_a_small_entry_limit() {
        assert_eq!(limits().entry_bytes, 64 << 20);
        assert!(MAX_PART_BYTES <= limits().entry_bytes);
    }
}
