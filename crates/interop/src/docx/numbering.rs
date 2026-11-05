//! `word/numbering.xml`: one `w:abstractNum` per list definition (spec 6.9), and a `w:num` for each list or
//! restart.

use super::parts::{xml_escape, NS_W, XML_HEADER};
use super::rpr::fonts_xml;
use super::units::twips;
use crate::doc::data::{ListDef, ListLevel};

/// The bullets of Word's default set: a bullet, `o`, and a square, repeating.
const BULLETS: [(&str, Option<&str>); 3] = [("\u{2022}", None), ("o", Some("Courier New")), ("\u{25AA}", None)];
/// The number formats of the default numbered levels, repeating.
const NUMBERED: [&str; 3] = ["decimal", "lowerLetter", "lowerRoman"];
/// The last level of a definition: `w:ilvl` runs from 0 to 8 (ECMA-376 Part 1, 17.9.3).
pub const LAST_LEVEL: u32 = 8;

/// The list definitions and lists of a document.
#[derive(Debug, Default)]
pub struct Lists {
    /// The definitions: the two defaults, then one per list definition the body used.
    abstracts: Vec<Abstract>,
    /// The lists: each is a definition and the levels whose start it overrides.
    nums: Vec<(usize, Vec<(u32, u64)>)>,
}

#[derive(Debug)]
struct Abstract {
    ordered: bool,
    def: Option<ListDef>,
}

impl Lists {
    pub fn new() -> Lists {
        let mut lists = Lists::default();
        lists.abstracts.push(Abstract {
            ordered: false,
            def: None,
        });
        lists.abstracts.push(Abstract {
            ordered: true,
            def: None,
        });
        // numId 1 is the plain bullet list.
        lists.nums.push((0, Vec::new()));
        lists
    }

    /// The bullet list's number.
    pub fn bullets(&self) -> usize {
        1
    }

    /// A new numbered list with the defaults, starting at `start` at `level`.
    pub fn numbered(&mut self, level: u32, start: u64) -> usize {
        self.nums.push((1, vec![(level.min(LAST_LEVEL), start)]));
        self.nums.len()
    }

    /// A new definition from a list's levels.
    pub fn define(&mut self, def: &ListDef, ordered: bool) -> usize {
        self.abstracts.push(Abstract {
            ordered,
            def: Some(def.clone()),
        });
        self.abstracts.len() - 1
    }

    /// A new list of a definition. With `restart`, `level` starts again at `start`.
    pub fn list(&mut self, abstract_id: usize, restart: Option<(u32, u64)>) -> usize {
        let restart = restart.map(|(level, start)| (level.min(LAST_LEVEL), start));
        self.nums.push((abstract_id, restart.into_iter().collect()));
        self.nums.len()
    }

    /// The start of a level of a definition.
    pub fn level_start(&self, abstract_id: usize, level: u32) -> u64 {
        self.abstracts
            .get(abstract_id)
            .and_then(|a| a.def.as_ref())
            .and_then(|d| d.levels.get(level as usize))
            .and_then(|l| l.start)
            .map_or(1, u64::from)
    }

    /// The part.
    pub fn xml(&self, mono: &str) -> String {
        let mut out = format!("{XML_HEADER}<w:numbering xmlns:w=\"{NS_W}\">");
        for (id, abs) in self.abstracts.iter().enumerate() {
            out.push_str(&abstract_xml(id, abs, mono));
        }
        for (i, (abstract_id, overrides)) in self.nums.iter().enumerate() {
            out.push_str(&format!(
                "<w:num w:numId=\"{}\"><w:abstractNumId w:val=\"{abstract_id}\"/>",
                i + 1
            ));
            for (level, start) in overrides {
                out.push_str(&format!(
                    "<w:lvlOverride w:ilvl=\"{level}\"><w:startOverride w:val=\"{start}\"/></w:lvlOverride>"
                ));
            }
            out.push_str("</w:num>");
        }
        out.push_str("</w:numbering>");
        out
    }
}

fn abstract_xml(id: usize, abs: &Abstract, mono: &str) -> String {
    let multi = if abs.def.is_some() {
        "multilevel"
    } else {
        "hybridMultilevel"
    };
    let mut out = format!("<w:abstractNum w:abstractNumId=\"{id}\"><w:multiLevelType w:val=\"{multi}\"/>");
    for level in 0..=LAST_LEVEL {
        let given = abs.def.as_ref().and_then(|d| d.levels.get(level as usize));
        out.push_str(&level_xml(level, given, abs.ordered, mono));
    }
    out.push_str("</w:abstractNum>");
    out
}

/// One level: its start, format, text, alignment, indent, and the font of its symbol.
fn level_xml(level: u32, given: Option<&ListLevel>, ordered: bool, mono: &str) -> String {
    let i = level as usize % 3;
    let default_format = if ordered { NUMBERED[i] } else { "bullet" };
    let format = given.and_then(|g| g.format.as_deref()).unwrap_or(default_format);
    let bullet = format == "bullet";
    let text = match (
        given.and_then(|g| g.symbol.as_deref()),
        given.and_then(|g| g.text.as_deref()),
    ) {
        (Some(symbol), _) if bullet => symbol.to_owned(),
        (_, Some(text)) if !bullet => text.to_owned(),
        _ if bullet => BULLETS[i].0.to_owned(),
        _ if format == "none" => String::new(),
        _ => format!("%{}.", level + 1),
    };
    let font = given.and_then(|g| g.font.clone()).or_else(|| {
        (bullet && given.and_then(|g| g.symbol.as_ref()).is_none())
            .then(|| BULLETS[i].1)
            .flatten()
            .map(str::to_owned)
    });
    let start = given.and_then(|g| g.start).unwrap_or(1);
    let jc = match given.and_then(|g| g.align.as_deref()) {
        Some("center") => "center",
        Some("end") => "right",
        _ => "left",
    };
    let left = given.and_then(|g| g.indent).map_or(720 * (i64::from(level) + 1), twips);
    let hanging = given.and_then(|g| g.hanging).map_or(360, twips);
    let mut out = format!(
        "<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"{start}\"/><w:numFmt w:val=\"{}\"/>\
         <w:lvlText w:val=\"{}\"/><w:lvlJc w:val=\"{jc}\"/>\
         <w:pPr><w:ind w:left=\"{left}\" w:hanging=\"{hanging}\"/></w:pPr>",
        xml_escape(format),
        xml_escape(&text)
    );
    if let Some(font) = font {
        out.push_str(&format!("<w:rPr>{}</w:rPr>", fonts_xml(&font, mono)));
    }
    out.push_str("</w:lvl>");
    out
}
