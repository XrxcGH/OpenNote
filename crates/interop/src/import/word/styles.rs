//! The styles of a Word file: what a paragraph style means for a note, the run and paragraph properties each
//! style gives through its `basedOn` chain, and the document defaults.

use std::collections::HashMap;

use super::props::{ParaProps, RunProps};
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
    /// A heading, level 1 to 9. Levels 7 to 9 become paragraphs with a heading style.
    Heading(u8),
    /// A quotation.
    Quote,
    /// Code, in a fixed-width font.
    Code,
}

/// The type of a style.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum StyleType {
    #[default]
    Paragraph,
    Character,
    Table,
    Numbering,
}

#[derive(Clone, Debug, Default)]
struct Style {
    name: String,
    kind: StyleType,
    based_on: Option<String>,
    /// The list the style puts its paragraphs in, as `w:numPr` in the style's paragraph properties gives it.
    num_id: Option<u32>,
    /// The list level the style gives.
    ilvl: Option<u32>,
    run: RunProps,
    para: ParaProps,
}

/// The styles of a file, by ID, and the document defaults.
#[derive(Clone, Debug, Default)]
pub(super) struct Styles {
    by_id: HashMap<String, Style>,
    /// `w:docDefaults/w:rPrDefault`.
    pub defaults_run: RunProps,
    /// `w:docDefaults/w:pPrDefault`.
    pub defaults_para: ParaProps,
    /// The paragraph style of paragraphs that name none: the one marked `w:default`.
    default_para: Option<String>,
}

/// The most `basedOn` steps a chain follows (`R-STY-4`).
const MAX_CHAIN: usize = 16;

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
        let mut default_para = None;
        for style in children(root, "w:style") {
            let Some(id) = style.attr("w:styleid") else {
                continue;
            };
            let kind = match style.attr("w:type") {
                Some("character") => StyleType::Character,
                Some("table") => StyleType::Table,
                Some("numbering") => StyleType::Numbering,
                _ => StyleType::Paragraph,
            };
            if kind == StyleType::Paragraph && style.attr("w:default").is_some_and(|v| v == "1" || v == "true") {
                default_para.get_or_insert_with(|| id.to_owned());
            }
            let ppr = child(style, "w:ppr");
            let num = ppr.and_then(|p| child(p, "w:numpr"));
            let number = |name| num.and_then(|n| val(n, name)).and_then(|v| v.parse().ok());
            by_id.insert(
                id.to_owned(),
                Style {
                    name: val(style, "w:name").unwrap_or("").to_owned(),
                    kind,
                    based_on: val(style, "w:basedon").map(str::to_owned),
                    num_id: number("w:numid"),
                    ilvl: number("w:ilvl"),
                    run: child(style, "w:rpr").map(RunProps::read).unwrap_or_default(),
                    para: ppr.map(ParaProps::read).unwrap_or_default(),
                },
            );
        }
        let defaults = child(root, "w:docdefaults");
        let defaults_run = defaults
            .and_then(|d| child(d, "w:rprdefault"))
            .and_then(|d| child(d, "w:rpr"))
            .map(RunProps::read)
            .unwrap_or_default();
        let defaults_para = defaults
            .and_then(|d| child(d, "w:pprdefault"))
            .and_then(|d| child(d, "w:ppr"))
            .map(ParaProps::read)
            .unwrap_or_default();
        Styles {
            by_id,
            defaults_run,
            defaults_para,
            default_para,
        }
    }

    /// The styles of a chain, from the root to `id`: `basedOn` is followed while it names a style of the same
    /// type, at most 16 steps, and never to a style already seen (`R-STY-4`).
    fn chain(&self, id: &str) -> Vec<&Style> {
        let mut out: Vec<&Style> = Vec::new();
        let mut seen: Vec<&str> = Vec::new();
        let mut current = Some(id);
        while let Some(id) = current {
            if seen.contains(&id) || seen.len() > MAX_CHAIN {
                break;
            }
            let Some(style) = self.by_id.get(id) else {
                break;
            };
            if out.first().is_some_and(|leaf| leaf.kind != style.kind) {
                break;
            }
            seen.push(id);
            out.push(style);
            current = style.based_on.as_deref();
        }
        out.reverse();
        out
    }

    /// The run properties a style gives, with what it inherits.
    pub fn run_chain(&self, id: &str) -> RunProps {
        let mut out = RunProps::default();
        for style in self.chain(id) {
            out.set_over(&style.run);
        }
        out
    }

    /// The paragraph properties a style gives, with what it inherits.
    pub fn para_chain(&self, id: &str) -> ParaProps {
        let mut out = ParaProps::default();
        for style in self.chain(id) {
            out.set_over(&style.para);
        }
        out
    }

    /// The paragraph style of a paragraph: the one it names when the file defines it, else the default.
    pub fn paragraph_style<'s>(&'s self, named: Option<&'s str>) -> Option<&'s str> {
        named
            .filter(|id| self.by_id.get(*id).is_some_and(|s| s.kind == StyleType::Paragraph))
            .or(self.default_para.as_deref())
    }

    /// Whether a style ID is the file's default paragraph style.
    pub fn is_default(&self, id: &str) -> bool {
        self.default_para.as_deref() == Some(id)
    }

    /// The style's display name.
    pub fn name(&self, id: &str) -> Option<&str> {
        self.by_id.get(id).map(|s| s.name.as_str())
    }

    /// The style a style is based on, when it is of the same type.
    pub fn based_on(&self, id: &str) -> Option<&str> {
        let style = self.by_id.get(id)?;
        let parent = style.based_on.as_deref()?;
        self.by_id
            .get(parent)
            .is_some_and(|p| p.kind == style.kind)
            .then_some(parent)
    }

    /// The OpenNote style name of a paragraph style (`R-STY-3`): a built-in name when the style's own ID or name
    /// is one, else a user style `u-` plus its ID in lowercase letters, digits, and hyphens.
    pub fn sheet_name(&self, id: &str) -> String {
        if self.is_default(id) {
            return "normal".to_owned();
        }
        let name = self.by_id.get(id).map_or("", |s| s.name.as_str());
        let own = |text: &str| {
            let compact: String = text.to_lowercase().replace(['_', '-'], "").split_whitespace().collect();
            match compact.as_str() {
                "normal" => Some("normal".to_owned()),
                "intensequote" => Some("quote2".to_owned()),
                _ => kind_of(text).map(|kind| match kind {
                    StyleKind::Normal => "normal".to_owned(),
                    StyleKind::Title => "title".to_owned(),
                    StyleKind::Subtitle => "subtitle".to_owned(),
                    StyleKind::Heading(n) => format!("h{n}"),
                    StyleKind::Quote => "quote".to_owned(),
                    StyleKind::Code => "code".to_owned(),
                }),
            }
        };
        if let Some(builtin) = own(id).or_else(|| own(name)) {
            return builtin;
        }
        let slug: String = id
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let mut slug: String = slug.trim_matches('-').chars().take(32).collect();
        while slug.ends_with('-') {
            slug.pop();
        }
        if slug.is_empty() {
            let hash = id
                .bytes()
                .fold(0u32, |h, b| h.wrapping_mul(31).wrapping_add(u32::from(b)));
            slug = format!("{hash:x}");
        }
        format!("u-{slug}")
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

impl Styles {
    /// The list a style puts its paragraphs in, and the level, following the styles it is based on. Word's
    /// "List Bullet" and "List Number" styles keep their numbering here rather than on each paragraph. A list
    /// style with no numbering of its own is a bullet or numbered list by its name.
    pub fn list(&self, id: &str) -> Option<StyleList> {
        let mut current = Some(id);
        let mut ilvl = None;
        for _ in 0..8 {
            let style = self.by_id.get(current?)?;
            ilvl = ilvl.or(style.ilvl);
            if let Some(num_id) = style.num_id {
                return Some(StyleList { num_id, ilvl });
            }
            current = style.based_on.as_deref();
        }
        None
    }

    /// A list by the style's name alone: `Some(true)` for numbered styles, `Some(false)` for bullets.
    pub fn list_by_name(&self, id: &str) -> Option<bool> {
        let name = self.by_id.get(id).map_or(id, |s| s.name.as_str());
        let compact: String = name.to_lowercase().split_whitespace().collect();
        if compact.starts_with("listbullet") {
            Some(false)
        } else if compact.starts_with("listnumber") {
            Some(true)
        } else {
            None
        }
    }
}

/// The numbering a paragraph style gives.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct StyleList {
    /// The list of numbering.xml.
    pub num_id: u32,
    /// The level, when the style sets one.
    pub ilvl: Option<u32>,
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
        .map(StyleKind::Heading)
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
        assert_eq!(styles.kind("Heading9"), StyleKind::Heading(9));
    }

    #[test]
    fn list_styles_carry_their_numbering_through_based_on() {
        let xml = r#"<w:styles>
            <w:style w:styleId="ListBullet"><w:name w:val="List Bullet"/>
              <w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr></w:style>
            <w:style w:styleId="Mine"><w:name w:val="Mine"/><w:basedOn w:val="ListBullet"/>
              <w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
            <w:style w:styleId="ListNumber2"><w:name w:val="List Number 2"/></w:style></w:styles>"#;
        let styles = Styles::read(&parse(xml));
        assert_eq!(styles.list("ListBullet"), Some(StyleList { num_id: 3, ilvl: None }));
        assert_eq!(
            styles.list("Mine"),
            Some(StyleList {
                num_id: 3,
                ilvl: Some(1)
            })
        );
        assert_eq!(styles.list("ListNumber2"), None);
        assert_eq!(styles.list_by_name("ListNumber2"), Some(true));
        assert_eq!(styles.list_by_name("ListBullet"), Some(false));
    }
}
