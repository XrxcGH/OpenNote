//! The OneNote section format ([MS-ONE]) on top of the revision store: sections, page series, and pages.
//!
//! A section file's root object space holds a jcidSectionNode whose children are page series; each page series
//! names the object spaces of its pages ([MS-ONE] 2.1.14, 2.2.17, 2.2.18, 2.2.65). A page's object space has a
//! jcidPageManifestNode as its content root and a jcidPageMetaData as its metadata root ([MS-ONE] 2.1.10).

use super::bytes::{Damage, ExGuid, Read};
use super::ids::{idx, jcid, prop};
use super::limits;
use super::outline::Walker;
use super::props::PropSet;
use super::space::{File, Object, Space};

/// A section, opened. Its pages are read one at a time by [`Section::pages`], so only one is in memory.
pub(crate) struct Section<'a> {
    file: Option<File<'a>>,
    /// The object spaces of the pages, in the order of the section.
    spaces: Vec<ExGuid>,
    /// Whether the section is password-protected, so no page could be read.
    pub encrypted: bool,
    /// Page series that were damaged and left out. A page that cannot be read is an error of [`Section::pages`].
    pub lost_pages: usize,
    /// Pages past [`limits::PAGES`], left out.
    pub too_many_pages: usize,
}

impl<'a> Section<'a> {
    /// Reads the pages in order: each a page, or the damage that left it out.
    pub(crate) fn pages(&self) -> impl Iterator<Item = Read<Page<'a>>> + '_ {
        self.spaces
            .iter()
            .filter_map(|gosid| self.file.as_ref().map(|file| read_page(file, *gosid)))
    }
}

/// A page, read.
#[derive(Debug, Default)]
pub(crate) struct Page<'a> {
    /// The title: the page's title text, or the cached title of its metadata.
    pub title: String,
    /// When the page was created, in Unix milliseconds.
    pub created: Option<i64>,
    /// When the page last changed, in Unix milliseconds.
    pub modified: Option<i64>,
    /// 1 for a page, 2 and 3 for subpages ([MS-ONE] 2.3.74).
    pub level: u32,
    /// The content, top to bottom.
    pub items: Vec<Item<'a>>,
    /// What could not be read.
    pub missed: Missed,
}

/// A piece of page content.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Item<'a> {
    /// A paragraph.
    Text(Paragraph),
    /// A table: rows of cells, each cell a list of items.
    Table(Vec<Vec<Vec<Item<'a>>>>),
    /// A picture.
    Picture(Attached<'a>),
    /// An attached file.
    File(Attached<'a>),
}

/// A paragraph of an outline.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Paragraph {
    /// The runs of text.
    pub runs: Vec<Run>,
    /// 1 to 6 for a heading style, 0 for body text.
    pub heading: u8,
    /// The list it belongs to.
    pub list: Option<ListKind>,
    /// How far the paragraph is indented, 0 at the left of its outline.
    pub depth: usize,
    /// Its note tags.
    pub tags: Vec<Tag>,
}

/// A bulleted or numbered list item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ListKind {
    Bullet,
    Number,
}

/// A run of text with one format ([MS-ONE] 2.2.43).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Run {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub superscript: bool,
    pub subscript: bool,
    /// The run is a hyperlink ([MS-ONE] 2.3.75). The public format gives no place for the target.
    pub hyperlink: bool,
}

/// A note tag ([MS-ONE] 2.1.9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Tag {
    /// The label of a normal tag; empty for a task tag.
    pub label: String,
    /// Whether the tag is a check box ([MS-ONE] 2.3.86).
    pub checkable: bool,
    /// Whether a check box is checked ([MS-ONE] 2.3.91, bit Completed).
    pub done: bool,
}

/// A picture or a file on a page.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Attached<'a> {
    /// The file name, when the page keeps one.
    pub name: String,
    /// The alternative text of a picture.
    pub alt: String,
    /// The bytes.
    pub data: Blob<'a>,
}

/// Where the bytes of a picture or file are.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Blob<'a> {
    /// In the section file: the bytes, borrowed, so a picture used many times is not copied each time.
    Inside(&'a [u8]),
    /// In the onefiles folder beside the section file, under this name.
    Outside(String),
    /// Missing or unreadable.
    Missing,
}

/// What a page held that could not be read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Missed {
    /// Objects of types that the public format description does not cover, such as handwriting (ink).
    pub unknown: usize,
    /// Objects whose data was damaged.
    pub damaged: usize,
    /// Content past [`limits::ITEMS`] or nested past [`limits::DEPTH`].
    pub too_deep: usize,
}

/// Reads a section file.
pub(crate) fn read_section(data: &[u8]) -> Read<Section<'_>> {
    let file = File::open(data)?;
    let root = file
        .space(file.root)
        .ok_or_else(|| Damage::new("the section's object space is missing"))??;
    let mut section = Section {
        file: None,
        spaces: Vec::new(),
        encrypted: root.encrypted,
        lost_pages: 0,
        too_many_pages: 0,
    };
    if root.encrypted {
        return Ok(section);
    }
    let node = root_props(&root, 1, jcid::SECTION)?;
    for series in node.objects(prop::ELEMENT_CHILD_NODES) {
        let Some(Ok(Object::Props { jcid, props })) = root.object(*series) else {
            section.lost_pages += 1;
            continue;
        };
        if idx(jcid) != idx(jcid::PAGE_SERIES) {
            continue;
        }
        for gosid in props.spaces(prop::CHILD_GRAPH_SPACE_ELEMENT_NODES) {
            if section.spaces.len() >= limits::PAGES {
                section.too_many_pages += 1;
                continue;
            }
            section.spaces.push(*gosid);
        }
    }
    section.file = Some(file);
    Ok(section)
}

/// The property set of a root object of a given type.
fn root_props<'a>(space: &Space<'a>, role: u32, want: u32) -> Read<PropSet<'a>> {
    let id = space
        .root(role)
        .ok_or_else(|| Damage::new("an object space has no root object"))?;
    match space.object(id) {
        Some(Ok(Object::Props { jcid, props })) if idx(jcid) == idx(want) => Ok(props),
        Some(Err(damage)) => Err(damage),
        _ => Err(Damage::new("an object space's root object is of the wrong type")),
    }
}

fn read_page<'a>(file: &File<'a>, gosid: ExGuid) -> Read<Page<'a>> {
    let space = file
        .space(gosid)
        .ok_or_else(|| Damage::new("a page's object space is missing"))??;
    if space.encrypted {
        return Err(Damage::new("the page is password-protected"));
    }
    let mut page = Page {
        level: 1,
        ..Page::default()
    };
    if let Ok(meta) = root_props(&space, 2, jcid::PAGE_META_DATA) {
        page.title = meta.text(prop::CACHED_TITLE_STRING).unwrap_or_default();
        page.level = meta.number(prop::PAGE_LEVEL).map_or(1, |l| l.clamp(1, 3) as u32);
        page.created = meta.number(prop::TOPOLOGY_CREATION_TIME_STAMP).and_then(filetime_ms);
    }
    let manifest = root_props(&space, 1, jcid::PAGE_MANIFEST)?;
    let node = manifest
        .objects(prop::CONTENT_CHILD_NODES)
        .iter()
        .find_map(|id| match space.object(*id) {
            Some(Ok(Object::Props { jcid, props })) if idx(jcid) == idx(jcid::PAGE) => Some(props),
            _ => None,
        })
        .ok_or_else(|| Damage::new("a page has no page node"))?;
    page.modified = node.number(prop::LAST_MODIFIED_TIME).and_then(time32_ms);
    let mut walker = Walker::new(file, &space);
    let title = walker.title(&node);
    if !title.trim().is_empty() {
        page.title = title;
    } else if page.title.trim().is_empty() {
        page.title = node.text(prop::CACHED_TITLE_STRING_FROM_PAGE).unwrap_or_default();
    }
    page.items = walker.page_children(&node);
    page.missed = walker.missed;
    Ok(page)
}

/// Unix milliseconds from FILETIME ([MS-DTYP]: 100-nanosecond steps since 1601).
pub(crate) fn filetime_ms(value: u64) -> Option<i64> {
    let ms = i64::try_from(value / 10_000).ok()?;
    let unix = ms.checked_sub(11_644_473_600_000)?;
    (unix > 0).then_some(unix)
}

/// A Time32 ([MS-ONE] 2.3.1: seconds since 1980-01-01 UTC) in Unix milliseconds.
pub(crate) fn time32_ms(value: u64) -> Option<i64> {
    let seconds = i64::try_from(value).ok()?.checked_add(315_532_800)?;
    (value > 0).then_some(seconds * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_convert_to_unix_milliseconds() {
        // 2026-01-01T00:00:00Z.
        assert_eq!(filetime_ms(134_116_992_000_000_000), Some(1_767_225_600_000));
        assert_eq!(time32_ms(1_451_692_800), Some(1_767_225_600_000));
        assert_eq!(filetime_ms(0), None);
        assert_eq!(time32_ms(0), None);
    }
}

#[cfg(test)]
mod work {
    use super::*;
    use crate::onenote::space::PARSES;
    use crate::onenote::write::{section, PageSpec, ParaSpec, SectionSpec};

    /// Runs that share one format object read it once, not once per run (R3-3).
    #[test]
    fn a_shared_run_format_is_read_once() {
        let runs: Vec<(String, bool)> = (0..500).map(|i| (format!("r{i} "), true)).collect();
        let spec = SectionSpec {
            pages: vec![PageSpec {
                title: "Runs".into(),
                paragraphs: vec![ParaSpec {
                    runs,
                    shared_style: true,
                    ..ParaSpec::default()
                }],
                ..PageSpec::default()
            }],
            ..SectionSpec::default()
        };
        let data = section(&spec);
        PARSES.with(|n| n.set(0));
        let read = read_section(&data).expect("the section reads");
        let page = read.pages().next().expect("a page").expect("the page reads");
        let parses = PARSES.with(|n| n.get());
        let Item::Text(para) = &page.items[0] else {
            panic!("a paragraph");
        };
        assert_eq!(para.runs.len(), 500);
        assert!(para.runs.iter().all(|r| r.bold));
        assert!(parses < 100, "{parses} property sets parsed");
    }
}

#[cfg(test)]
mod borrowed {
    use super::*;

    /// A picture's bytes are borrowed from the section file, not copied for each object (R3-2).
    #[test]
    fn pictures_borrow_their_bytes_from_the_file() {
        let data = crate::onenote::write::sample_section();
        let section = read_section(&data).expect("the section reads");
        let page = section.pages().next().expect("a page").expect("the page reads");
        let inside = page
            .items
            .iter()
            .find_map(|item| match item {
                Item::Picture(Attached {
                    data: Blob::Inside(bytes),
                    ..
                }) => Some(*bytes),
                _ => None,
            })
            .expect("a picture inside the file");
        assert!(data.as_ptr_range().contains(&inside.as_ptr()));
    }
}
