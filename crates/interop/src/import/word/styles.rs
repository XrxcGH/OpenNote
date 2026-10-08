//! Paragraph styles and list definitions of a Word file.

use std::collections::HashMap;

use crate::import::xmltree::{Element, Node};

/// What a paragraph style means for a note.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum StyleKind {
    /// Ordinary text.
    Normal,
    /// The title of the document or page.
    Title,
    /// A line under the title.
    Subtitle,
    /// A heading, level 1 to 6.
    Heading(u8),
    /// A quotation.
    Quote,
    /// Code, in a fixed-width font.
    Code,
}

#[derive(Clone, Debug, Default)]
struct Style {
    name: String,
    based_on: Option<String>,
}

/// The paragraph styles of a file, by ID.
#[derive(Clone, Debug, Default)]
pub(super) struct Styles {
    by_id: HashMap<String, Style>,
}

/// The first child element with this name.
pub(super) fn child<'a>(e: &'a Element, name: &str) -> Option<&'a Element> {
    e.children.iter().find_map(|n| match n {
        Node::Element(c) if c.name == name => Some(c),
        _ => None,
    })
}

/// The child elements with this name.
pub(super) fn children<'a>(e: &'a Element, name: &'a str) -> impl Iterator<Item = &'a Element> {
    e.children.iter().filter_map(move |n| match n {
        Node::Element(c) if c.name == name => Some(c),
        _ => None,
    })
}

/// The `w:val` of a child element.
pub(super) fn val<'a>(e: &'a Element, name: &str) -> Option<&'a str> {
    child(e, name).and_then(|c| c.attr("w:val"))
}

impl Styles {
    pub fn read(root: &Element) -> Styles {
        let mut by_id = HashMap::new();
        for style in children(root, "w:style") {
            let Some(id) = style.attr("w:styleid") else {
                continue;
            };
            by_id.insert(
                id.to_owned(),
                Style {
                    name: val(style, "w:name").unwrap_or("").to_owned(),
                    based_on: val(style, "w:basedon").map(str::to_owned),
                },
            );
        }
        Styles { by_id }
    }

    /// What a style means, following the styles it is based on.
    pub fn kind(&self, id: &str) -> StyleKind {
        let mut current = Some(id);
        for _ in 0..8 {
            let Some(id) = current else {
                break;
            };
            let name = self.by_id.get(id).map_or("", |s| s.name.as_str());
            if let Some(kind) = kind_of(id).or_else(|| kind_of(name)) {
                return kind;
            }
            current = self.by_id.get(id).and_then(|s| s.based_on.as_deref());
        }
        StyleKind::Normal
    }
}

fn kind_of(name: &str) -> Option<StyleKind> {
    let lower = name.to_lowercase().replace(['_', '-'], " ");
    let compact: String = lower.split_whitespace().collect();
    match compact.as_str() {
        "title" => return Some(StyleKind::Title),
        "subtitle" => return Some(StyleKind::Subtitle),
        "quote" | "intensequote" | "blocktext" | "blockquote" => return Some(StyleKind::Quote),
        "code" | "sourcecode" | "htmlpreformatted" | "preformattedtext" | "htmlcode" | "macrotext" | "plaintext"
        | "codeblock" => return Some(StyleKind::Code),
        _ => {}
    }
    let digits = compact.strip_prefix("heading")?;
    digits
        .parse::<u8>()
        .ok()
        .filter(|n| (1..=9).contains(n))
        .map(|n| StyleKind::Heading(n.min(6)))
}

/// One level of a list definition.
#[derive(Clone, Debug)]
struct Level {
    format: String,
    start: u64,
}

/// What a list level looks like.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ListLevel {
    /// Whether the items are numbered.
    pub ordered: bool,
    /// The number of the first item.
    pub start: u64,
    /// Whether the numbers are not plain decimals, such as letters or Roman numerals.
    pub exotic: bool,
}

/// The list definitions of a file.
#[derive(Clone, Debug, Default)]
pub(super) struct Numbering {
    abstracts: HashMap<u32, HashMap<u32, Level>>,
    nums: HashMap<u32, u32>,
    overrides: HashMap<(u32, u32), u64>,
}

impl Numbering {
    pub fn read(root: &Element) -> Numbering {
        let mut numbering = Numbering::default();
        for abs in children(root, "w:abstractnum") {
            let Some(id) = abs.attr("w:abstractnumid").and_then(|v| v.parse().ok()) else {
                continue;
            };
            let mut levels = HashMap::new();
            for lvl in children(abs, "w:lvl") {
                let Some(ilvl) = lvl.attr("w:ilvl").and_then(|v| v.parse().ok()) else {
                    continue;
                };
                levels.insert(
                    ilvl,
                    Level {
                        format: val(lvl, "w:numfmt").unwrap_or("decimal").to_owned(),
                        start: val(lvl, "w:start").and_then(|v| v.parse().ok()).unwrap_or(1),
                    },
                );
            }
            numbering.abstracts.insert(id, levels);
        }
        for num in children(root, "w:num") {
            let Some(id) = num.attr("w:numid").and_then(|v| v.parse::<u32>().ok()) else {
                continue;
            };
            if let Some(abs) = val(num, "w:abstractnumid").and_then(|v| v.parse().ok()) {
                numbering.nums.insert(id, abs);
            }
            for over in children(num, "w:lvloverride") {
                let ilvl = over.attr("w:ilvl").and_then(|v| v.parse().ok());
                let start = val(over, "w:startoverride").and_then(|v| v.parse().ok());
                if let (Some(ilvl), Some(start)) = (ilvl, start) {
                    numbering.overrides.insert((id, ilvl), start);
                }
            }
        }
        numbering
    }

    /// The look of a list level. A list the file does not define is a bullet list.
    pub fn level(&self, num_id: u32, ilvl: u32) -> ListLevel {
        let level = self
            .nums
            .get(&num_id)
            .and_then(|abs| self.abstracts.get(abs))
            .and_then(|levels| levels.get(&ilvl));
        let Some(level) = level else {
            return ListLevel {
                ordered: false,
                start: 1,
                exotic: false,
            };
        };
        let ordered = !matches!(level.format.as_str(), "bullet" | "none");
        ListLevel {
            ordered,
            start: self.overrides.get(&(num_id, ilvl)).copied().unwrap_or(level.start),
            exotic: ordered && level.format != "decimal",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    #[test]
    fn styles_resolve_by_name_and_through_based_on() {
        let xml = r#"<w:styles>
            <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
            <w:style w:styleId="MyHead"><w:name w:val="My head"/><w:basedOn w:val="Heading2"/></w:style>
            <w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
            <w:style w:styleId="Body"><w:name w:val="Body Text"/></w:style>
            <w:style w:styleId="Odd"><w:name w:val="Source Code"/></w:style></w:styles>"#;
        let styles = Styles::read(&parse(xml));
        assert_eq!(styles.kind("Heading1"), StyleKind::Heading(1));
        assert_eq!(styles.kind("MyHead"), StyleKind::Heading(2));
        assert_eq!(styles.kind("Body"), StyleKind::Normal);
        assert_eq!(styles.kind("Odd"), StyleKind::Code);
        assert_eq!(styles.kind("Title"), StyleKind::Title);
        assert_eq!(styles.kind("Heading9"), StyleKind::Heading(6));
    }

    #[test]
    fn list_levels_know_their_format_and_start() {
        let xml = r#"<w:numbering>
            <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
            <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
              <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
            <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
            <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
            </w:numbering>"#;
        let numbering = Numbering::read(&parse(xml));
        assert!(!numbering.level(1, 0).ordered);
        assert_eq!(
            numbering.level(2, 0),
            ListLevel {
                ordered: true,
                start: 5,
                exotic: false
            }
        );
        assert!(numbering.level(2, 1).exotic);
        assert!(!numbering.level(9, 0).ordered, "an unknown list is a bullet list");
    }
}
