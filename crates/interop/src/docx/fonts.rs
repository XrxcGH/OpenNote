//! Fonts: `fontTable.xml`, `theme1.xml`, and the optional embedding of bundled fonts (ECMA-376 Part 1, 17.8).

use std::collections::BTreeSet;

use super::parts::{xml_escape, NS_R, NS_W, XML_HEADER};

/// The app's body and heading font (spec `R-THM-2`).
pub const APP_SANS: &str = "OpenNote Sans";
/// The app's code font.
pub const APP_MONO: &str = "Atkinson Hyperlegible Mono";

/// The fonts that ship with OpenNote under the SIL Open Font License or the Apache License. Only these may be
/// embedded (DESIGN 6.6); a system font's license cannot be checked.
pub const BUNDLED: [&str; 5] = [APP_SANS, "Literata", APP_MONO, "Carlito", "Caladea"];

/// The fonts that tokens resolve to, and the theme's colors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Theme {
    /// `+heading`.
    pub heading: String,
    /// `+body`.
    pub body: String,
    /// `+mono`.
    pub mono: String,
    /// `accent1` to `accent6`, `text`, and `background` as six hexadecimal digits.
    pub colors: [String; 8],
}

impl Default for Theme {
    fn default() -> Theme {
        let colors = crate::doc::values::THEME_COLORS
            .map(|name| crate::palette::theme_hex(name).unwrap_or_else(|| "000000".to_owned()));
        Theme {
            heading: APP_SANS.to_owned(),
            body: APP_SANS.to_owned(),
            mono: APP_MONO.to_owned(),
            colors,
        }
    }
}

impl Theme {
    /// Reads `theme` of a notebook or page (`R-THM-1`) over this theme. Invalid values are ignored.
    pub fn read(&mut self, theme: &serde_json::Map<String, serde_json::Value>) {
        if let Some(fonts) = theme.get("fonts").and_then(|f| f.as_object()) {
            for (key, slot) in [
                ("heading", &mut self.heading),
                ("body", &mut self.body),
                ("mono", &mut self.mono),
            ] {
                if let Some(name) = fonts.get(key).and_then(|v| v.as_str()) {
                    if crate::doc::values::font_name(name) && !name.starts_with('+') {
                        *slot = name.to_owned();
                    }
                }
            }
        }
        if let Some(colors) = theme.get("colors").and_then(|c| c.as_object()) {
            for (i, name) in crate::doc::values::THEME_COLORS.iter().enumerate() {
                let value = colors.get(*name).and_then(|v| v.as_str());
                if let Some(hex) = value.and_then(|v| v.strip_prefix('#')) {
                    if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                        self.colors[i] = hex.to_ascii_uppercase();
                    }
                }
            }
        }
    }
}

/// A font file that a caller offers to embed: a TrueType or OpenType file of one face.
#[derive(Clone, Debug)]
pub struct EmbedFont {
    /// The family name, such as `Carlito`.
    pub family: String,
    /// Whether the face is bold.
    pub bold: bool,
    /// Whether the face is italic.
    pub italic: bool,
    /// The file. A WOFF2 file must be decompressed first.
    pub bytes: Vec<u8>,
}

/// The class Word uses to substitute a font it lacks (`ST_FontFamily`), and whether its glyphs have one width.
fn class(name: &str) -> (&'static str, bool) {
    let lower = name.to_ascii_lowercase();
    let mono = ["mono", "code", "courier", "consolas", "console", "typewriter"];
    let serif = [
        "serif", "georgia", "times", "cambria", "literata", "caladea", "garamond", "palatino", "book",
    ];
    if mono.iter().any(|m| lower.contains(m)) {
        ("modern", true)
    } else if serif.iter().any(|s| lower.contains(s)) && !lower.contains("sans") {
        ("roman", false)
    } else {
        ("swiss", false)
    }
}

/// The font a metric-compatible stand-in replaces, for `w:altName` (DESIGN 6.3).
fn alternate(name: &str) -> Option<&'static str> {
    Some(match name {
        "Carlito" => "Calibri",
        "Caladea" => "Cambria",
        "Liberation Sans" => "Arial",
        "Liberation Serif" => "Times New Roman",
        "Liberation Mono" => "Courier New",
        _ => return None,
    })
}

/// A font embedded in the file: its family, face, relationship ID, and key.
#[derive(Clone, Debug)]
pub struct Embedded {
    family: String,
    element: &'static str,
    rid: String,
    key: String,
}

/// `word/fontTable.xml`: each font the document names, with its class, pitch, and alternate name.
pub fn font_table(names: &BTreeSet<String>, embedded: &[Embedded]) -> String {
    let mut out = format!("{XML_HEADER}<w:fonts xmlns:w=\"{NS_W}\" xmlns:r=\"{NS_R}\">");
    for name in names {
        let (family, fixed) = class(name);
        out.push_str(&format!("<w:font w:name=\"{}\">", xml_escape(name)));
        if let Some(alt) = alternate(name) {
            out.push_str(&format!("<w:altName w:val=\"{alt}\"/>"));
        }
        let pitch = if fixed { "fixed" } else { "variable" };
        out.push_str(&format!(
            "<w:charset w:val=\"00\"/><w:family w:val=\"{family}\"/><w:pitch w:val=\"{pitch}\"/>"
        ));
        // The schema wants the faces in this order: regular, bold, italic, bold italic.
        for element in ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"] {
            if let Some(e) = embedded.iter().find(|e| e.family == *name && e.element == element) {
                out.push_str(&format!("<w:{element} r:id=\"{}\" w:fontKey=\"{}\"/>", e.rid, e.key));
            }
        }
        out.push_str("</w:font>");
    }
    out.push_str("</w:fonts>");
    out
}

/// Whether a file is a TrueType or OpenType font that its license lets a document embed: the OS/2 table's
/// `fsType` must not be "restricted license embedding" alone (bit 1 without bits 2 and 3).
pub fn embeddable(bytes: &[u8]) -> bool {
    let tag = bytes.get(0..4);
    let sfnt = matches!(tag, Some([0, 1, 0, 0]) | Some(b"OTTO") | Some(b"true"));
    if !sfnt {
        return false;
    }
    let count = read_u16(bytes, 4).unwrap_or(0) as usize;
    for i in 0..count {
        let record = 12 + i * 16;
        if bytes.get(record..record + 4) == Some(b"OS/2") {
            let Some(offset) = read_u32(bytes, record + 8) else {
                return false;
            };
            let Some(fs_type) = read_u16(bytes, offset as usize + 8) else {
                return false;
            };
            let restricted = fs_type & 0x000F == 0x0002;
            return !restricted;
        }
    }
    // A font without an OS/2 table makes no embedding claim, so it is treated as installable.
    true
}

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// A GUID made from the font's bytes, so the same file gets the same key in every export.
fn key_for(bytes: &[u8], index: usize) -> String {
    // Two 64-bit FNV-1a hashes with different offsets give 128 bits.
    let hash = |seed: u64| {
        let mut h = seed;
        for b in bytes.iter().copied().chain(index.to_le_bytes()) {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
        h
    };
    let (a, b) = (hash(0xCBF2_9CE4_8422_2325), hash(0x84222325_CBF29CE4));
    let hex = format!("{a:016X}{b:016X}");
    format!(
        "{{{}-{}-{}-{}-{}}}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Obfuscates a font as ECMA-376 Part 1, 17.8.1 describes: the GUID's 32 hexadecimal digits, read as 16 bytes
/// from the last pair to the first, are XORed over the first 32 bytes of the file, twice in a row.
pub fn obfuscate(bytes: &[u8], guid: &str) -> Vec<u8> {
    let digits: Vec<u8> = guid.bytes().filter(u8::is_ascii_hexdigit).collect();
    let mut key = [0u8; 16];
    for (i, slot) in key.iter_mut().enumerate() {
        let at = digits.len().saturating_sub(2 * (i + 1));
        let pair = std::str::from_utf8(&digits[at..at + 2]).unwrap_or("00");
        *slot = u8::from_str_radix(pair, 16).unwrap_or(0);
    }
    let mut out = bytes.to_vec();
    for (i, byte) in out.iter_mut().take(32).enumerate() {
        *byte ^= key[i % 16];
    }
    out
}

/// The fonts a file embeds: their entries in the font table, their files under `word/fonts/`, and the
/// relationships of the font table to the files.
#[derive(Debug, Default)]
pub struct Embedding {
    /// The entries.
    pub embedded: Vec<Embedded>,
    /// The obfuscated files, by name.
    pub files: Vec<(String, Vec<u8>)>,
    /// The relationship elements.
    pub rels: String,
}

/// The fonts to embed: bundled, used by the document, and embeddable. Each gets a relationship of
/// `fontTable.xml` and a file under `word/fonts/`.
pub fn embed(offered: &[EmbedFont], used: &BTreeSet<String>) -> Embedding {
    let mut embedded = Vec::new();
    let mut files = Vec::new();
    let mut rels = String::new();
    for font in offered {
        let wanted = BUNDLED.contains(&font.family.as_str()) && used.contains(&font.family);
        if !wanted || !embeddable(&font.bytes) {
            continue;
        }
        let element = match (font.bold, font.italic) {
            (false, false) => "embedRegular",
            (true, false) => "embedBold",
            (false, true) => "embedItalic",
            (true, true) => "embedBoldItalic",
        };
        if embedded
            .iter()
            .any(|e: &Embedded| e.family == font.family && e.element == element)
        {
            continue;
        }
        let n = files.len() + 1;
        let key = key_for(&font.bytes, n);
        let name = format!("font{n}.odttf");
        let rid = format!("rId{n}");
        rels.push_str(&format!(
            "<Relationship Id=\"{rid}\" Type=\"{NS_R}/font\" Target=\"fonts/{name}\"/>"
        ));
        files.push((name, obfuscate(&font.bytes, &key)));
        embedded.push(Embedded {
            family: font.family.clone(),
            element,
            rid,
            key,
        });
    }
    Embedding { embedded, files, rels }
}

/// `word/theme/theme1.xml`: the theme's fonts and colors, with the plainest format scheme the schema allows.
pub fn theme_xml(theme: &Theme) -> String {
    let c = &theme.colors;
    let srgb = |hex: &str| format!("<a:srgbClr val=\"{hex}\"/>");
    let mut colors = String::new();
    // dk1 is the text and lt1 is white paper. dk2 is the walnut pen, and lt2 is the light page's paper.
    for (name, hex) in [
        ("dk1", c[6].as_str()),
        ("lt1", "FFFFFF"),
        ("dk2", "6E4B2E"),
        ("lt2", c[7].as_str()),
        ("accent1", c[0].as_str()),
        ("accent2", c[1].as_str()),
        ("accent3", c[2].as_str()),
        ("accent4", c[3].as_str()),
        ("accent5", c[4].as_str()),
        ("accent6", c[5].as_str()),
        ("hlink", c[0].as_str()),
        ("folHlink", c[3].as_str()),
    ] {
        colors.push_str(&format!("<a:{name}>{}</a:{name}>", srgb(hex)));
    }
    let font = |name: &str| {
        format!(
            "<a:latin typeface=\"{}\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/>",
            xml_escape(name)
        )
    };
    let fill = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>";
    let line = format!("<a:ln w=\"9525\">{fill}</a:ln>");
    let effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
    format!(
        "{XML_HEADER}<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"OpenNote\">\
         <a:themeElements><a:clrScheme name=\"OpenNote\">{colors}</a:clrScheme>\
         <a:fontScheme name=\"OpenNote\"><a:majorFont>{}</a:majorFont><a:minorFont>{}</a:minorFont></a:fontScheme>\
         <a:fmtScheme name=\"OpenNote\"><a:fillStyleLst>{fill}{fill}{fill}</a:fillStyleLst>\
         <a:lnStyleLst>{line}{line}{line}</a:lnStyleLst>\
         <a:effectStyleLst>{effect}{effect}{effect}</a:effectStyleLst>\
         <a:bgFillStyleLst>{fill}{fill}{fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements>\
         <a:objectDefaults/><a:extraClrSchemeLst/></a:theme>",
        font(&theme.heading),
        font(&theme.body)
    )
}
