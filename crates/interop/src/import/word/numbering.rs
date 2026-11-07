//! The list definitions of a Word file (`numbering.xml`), and how they become a text block's `lists` (spec 6.9).
//!
//! Each `w:abstractNum` is one list definition, `a` plus its number. Lists that share it count on as one list,
//! as Word numbers them. A `w:num` that overrides a level (Word's "Restart numbering") is a definition of its own,
//! `n` plus its number, and its first item restarts.

use std::collections::{BTreeMap, HashMap};

use serde_json::{Map, Value};

use super::styles::{child, children, val};
use super::values::{num, twips};
use crate::import::xmltree::Element;

/// The `ST_NumberFormat` names that `data.lists` takes (`R-LIST-1`).
const FORMATS: &[&str] = &[
    "decimal",
    "decimalZero",
    "lowerLetter",
    "upperLetter",
    "lowerRoman",
    "upperRoman",
    "ordinal",
    "cardinalText",
    "ordinalText",
    "bullet",
    "none",
    "hebrew1",
    "hebrew2",
    "arabicAlpha",
    "arabicAbjad",
    "hindiNumbers",
    "thaiNumbers",
    "chineseCounting",
    "japaneseCounting",
    "koreanCounting",
];

/// Symbol fonts whose bullets sit in the private use area, by their code point there.
const SYMBOL_FONTS: &[&str] = &["symbol", "wingdings", "wingdings 2", "wingdings 3"];

/// One level of a list definition.
#[derive(Clone, Debug, Default)]
struct Level {
    format: String,
    text: Option<String>,
    start: u64,
    /// Twips.
    left: Option<i32>,
    hanging: Option<i32>,
    jc: Option<String>,
    font: Option<String>,
}

fn read_level(lvl: &Element) -> Level {
    let ind = child(lvl, "w:ppr").and_then(|p| child(p, "w:ind"));
    let twips_of = |names: [&str; 2]| {
        ind.and_then(|i| i.attr(names[0]).or_else(|| i.attr(names[1])))
            .and_then(|v| v.trim().parse().ok())
    };
    let fonts = child(lvl, "w:rpr").and_then(|r| child(r, "w:rfonts"));
    Level {
        format: val(lvl, "w:numfmt").unwrap_or("decimal").to_owned(),
        text: val(lvl, "w:lvltext").map(str::to_owned),
        start: val(lvl, "w:start").and_then(|v| v.parse().ok()).unwrap_or(1),
        left: twips_of(["w:left", "w:start"]),
        hanging: twips_of(["w:hanging", "w:hanging"]),
        jc: val(lvl, "w:lvljc").map(str::to_owned),
        font: fonts
            .and_then(|f| f.attr("w:ascii").or_else(|| f.attr("w:hansi")))
            .map(str::to_owned),
    }
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

/// A level override of a `w:num`.
#[derive(Clone, Debug, Default)]
struct Override {
    start: Option<u64>,
    level: Option<Level>,
}

/// The list definitions of a file.
#[derive(Clone, Debug, Default)]
pub(super) struct Numbering {
    abstracts: HashMap<u32, BTreeMap<u32, Level>>,
    nums: HashMap<u32, u32>,
    overrides: HashMap<(u32, u32), Override>,
}

impl Numbering {
    pub fn read(root: &Element) -> Numbering {
        let mut numbering = Numbering::default();
        for abs in children(root, "w:abstractnum") {
            let Some(id) = abs.attr("w:abstractnumid").and_then(|v| v.parse().ok()) else {
                continue;
            };
            let mut levels = BTreeMap::new();
            for lvl in children(abs, "w:lvl") {
                let Some(ilvl) = lvl
                    .attr("w:ilvl")
                    .and_then(|v| v.parse::<u32>().ok())
                    .filter(|l| *l < 9)
                else {
                    continue;
                };
                levels.insert(ilvl, read_level(lvl));
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
                let Some(ilvl) = over
                    .attr("w:ilvl")
                    .and_then(|v| v.parse::<u32>().ok())
                    .filter(|l| *l < 9)
                else {
                    continue;
                };
                let entry = Override {
                    start: val(over, "w:startoverride").and_then(|v| v.parse().ok()),
                    level: child(over, "w:lvl").map(read_level),
                };
                if entry.start.is_some() || entry.level.is_some() {
                    numbering.overrides.insert((id, ilvl), entry);
                }
            }
        }
        numbering
    }

    /// The level of a list as it numbers: the override's level or the definition's, with an override's start.
    fn find(&self, num_id: u32, ilvl: u32) -> Option<Level> {
        let over = self.overrides.get(&(num_id, ilvl));
        let mut level = over.and_then(|o| o.level.clone()).or_else(|| {
            self.nums
                .get(&num_id)
                .and_then(|abs| self.abstracts.get(abs))
                .and_then(|levels| levels.get(&ilvl))
                .cloned()
        })?;
        if let Some(start) = over.and_then(|o| o.start) {
            level.start = start;
        }
        Some(level)
    }

    /// The look of a list level. A list the file does not define is a bullet list.
    pub fn level(&self, num_id: u32, ilvl: u32) -> ListLevel {
        let Some(level) = self.find(num_id, ilvl) else {
            return ListLevel {
                ordered: false,
                start: 1,
                exotic: false,
            };
        };
        let ordered = !matches!(level.format.as_str(), "bullet" | "none");
        ListLevel {
            ordered,
            start: level.start,
            exotic: ordered && level.format != "decimal",
        }
    }

    /// The list ID (`R-LIST-1`) of a `w:num`, when the file defines it.
    pub fn list_id(&self, num_id: u32) -> Option<String> {
        let abs = self.nums.get(&num_id)?;
        if self.overrides.keys().any(|(n, _)| *n == num_id) {
            Some(format!("n{num_id}"))
        } else {
            Some(format!("a{abs}"))
        }
    }

    /// Whether the numbering of a level starts again in this `w:num`.
    pub fn restarts(&self, num_id: u32, ilvl: u32) -> bool {
        self.overrides.contains_key(&(num_id, ilvl))
    }

    /// The definition of a list ID as `data.lists` holds it.
    pub fn definition(&self, list_id: &str) -> Option<Value> {
        let levels: Vec<Level> = if let Some(abs) = list_id.strip_prefix('a').and_then(|n| n.parse().ok()) {
            let levels = self.abstracts.get(&abs)?;
            (0..9).map_while(|n| levels.get(&n).cloned()).collect()
        } else {
            let num = list_id.strip_prefix('n')?.parse().ok()?;
            (0..9).map_while(|n| self.find(num, n)).collect()
        };
        if levels.is_empty() {
            return None;
        }
        let levels: Vec<Value> = levels.iter().map(level_json).collect();
        let mut def = Map::new();
        def.insert("levels".to_owned(), Value::Array(levels));
        Some(Value::Object(def))
    }
}

/// A level as `data.lists` holds it. Values outside the spec's ranges are left out, so the defaults apply.
fn level_json(level: &Level) -> Value {
    let mut out = Map::new();
    let format = level.format.as_str();
    if FORMATS.contains(&format) {
        out.insert("format".to_owned(), Value::from(format));
    }
    let symbol_font = level
        .font
        .as_deref()
        .is_some_and(|f| SYMBOL_FONTS.contains(&f.to_lowercase().as_str()));
    if format == "bullet" {
        if let Some(symbol) = level.text.as_deref().and_then(|t| bullet(t, symbol_font)) {
            out.insert("symbol".to_owned(), Value::from(symbol));
        }
    } else if let Some(text) = level.text.as_deref().filter(|t| t.chars().count() <= 64) {
        out.insert("text".to_owned(), Value::from(text));
    }
    if let Ok(start) = u16::try_from(level.start) {
        if start <= 32_767 && start != 1 {
            out.insert("start".to_owned(), Value::from(start));
        }
    }
    let points = |t: Option<i32>| t.map(twips).filter(|p| (0.0..=1584.0).contains(p));
    if let Some(indent) = points(level.left) {
        out.insert("indent".to_owned(), num(indent));
    }
    if let Some(hanging) = points(level.hanging) {
        out.insert("hanging".to_owned(), num(hanging));
    }
    if let Some(font) = level.font.as_deref().filter(|_| !symbol_font) {
        if crate::doc::values::font_name(font) {
            out.insert("font".to_owned(), Value::from(font));
        }
    }
    let align = match level.jc.as_deref() {
        Some("center") => Some("center"),
        Some("right" | "end") => Some("end"),
        _ => None,
    };
    if let Some(align) = align {
        out.insert("align".to_owned(), Value::from(align));
    }
    Value::Object(out)
}

/// The bullet a level's text shows: one code point. Symbol fonts keep their bullets in the private use area,
/// so the common ones become the Unicode characters that look the same.
fn bullet(text: &str, symbol_font: bool) -> Option<String> {
    let mut chars = text.chars();
    let c = chars.next()?;
    if chars.next().is_some() || c.is_control() {
        return None;
    }
    let mapped = match u32::from(c) {
        0xF0B7 => '\u{2022}',
        0xF0A7 => '\u{25AA}',
        0xF0A8 => '\u{25A1}',
        0xF076 => '\u{2756}',
        0xF0D8 => '\u{27A2}',
        0xF0FC => '\u{2713}',
        0xF06E => '\u{25A0}',
        0xF000..=0xF0FF if symbol_font => '\u{2022}',
        _ => c,
    };
    Some(mapped.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    const XML: &str = r#"<w:numbering>
        <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/>
          <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>
          </w:rPr></w:lvl></w:abstractNum>
        <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>
        <w:lvlText w:val="%1."/></w:lvl>
          <w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%2)"/><w:lvlJc w:val="right"/></w:lvl>
          </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
        <w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/>
        </w:lvlOverride></w:num>
        <w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>
        </w:numbering>"#;

    #[test]
    fn list_levels_know_their_format_and_start() {
        let numbering = Numbering::read(&parse(XML));
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

    #[test]
    fn definitions_become_lists_and_overrides_their_own() {
        let numbering = Numbering::read(&parse(XML));
        assert_eq!(numbering.list_id(1).as_deref(), Some("a0"));
        assert_eq!(
            numbering.list_id(3).as_deref(),
            Some("a1"),
            "lists that share a definition count on"
        );
        assert_eq!(
            numbering.list_id(2).as_deref(),
            Some("n2"),
            "a restart is a definition of its own"
        );
        assert!(numbering.restarts(2, 0) && !numbering.restarts(3, 0));
        let bullets = numbering.definition("a0").expect("a definition");
        // ind left 720 and hanging 360 twips are 36 and 18 points; Symbol's private-use bullet is U+2022.
        assert_eq!(
            bullets,
            serde_json::json!({"levels": [{"format": "bullet", "symbol": "\u{2022}", "indent": 36, "hanging": 18}]})
        );
        let restarted = numbering.definition("n2").expect("a definition");
        assert_eq!(
            restarted,
            serde_json::json!({"levels": [
                {"format": "decimal", "text": "%1.", "start": 5},
                {"format": "lowerLetter", "text": "(%2)", "align": "end"}
            ]})
        );
    }
}
