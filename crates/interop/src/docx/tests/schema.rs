//! A hand-written subset of the ECMA-376 transitional schemas (Part 1, 5th edition), for the parts this writer
//! makes: the order of the children of each sequence it writes, the enumerations of the values it writes, and
//! well-formed XML with every prefix declared. The sequences are transcribed from the schema's complex types,
//! not from any application's output (owner decision 11: the schema files themselves are not vendored).

use std::collections::{BTreeMap, BTreeSet};

use quick_xml::events::Event;
use quick_xml::Reader;

/// The sequences of the WordprocessingML types this writer uses: each element's children in order, separated by
/// spaces. Alternatives that share a place are joined by `|`.
///
/// - `w:rPr`: `EG_RPrBase` of `CT_RPr` (17.3.2.28), with the paragraph mark's `ins` and `del` first
///   (`CT_ParaRPr`), and the Word 2010 extensions after the base, before `rPrChange`.
/// - `w:pPr`: `CT_PPrBase` and `CT_PPr` (17.3.1.26).
/// - `w:sectPr`: `CT_SectPr` (17.6.17), where header and footer references are one choice group.
/// - `w:style`: `CT_Style` (17.7.4.17). `w:settings`: the part of `CT_Settings` (17.15.1.78) this writer uses.
const WORD_SEQUENCES: &[(&str, &str)] = &[
    (
        "w:rPr",
        "w:ins w:del w:moveFrom w:moveTo w:rStyle w:rFonts w:b w:bCs w:i w:iCs w:caps w:smallCaps w:strike \
         w:dstrike w:outline w:shadow w:emboss w:imprint w:noProof w:snapToGrid w:vanish w:webHidden w:color \
         w:spacing w:w w:kern w:position w:sz w:szCs w:highlight w:u w:effect w:bdr w:shd w:fitText w:vertAlign \
         w:rtl w:cs w:em w:lang w:eastAsianLayout w:specVanish w:oMath w14:glow w14:shadow w14:reflection \
         w14:textOutline w14:textFill w14:scene3d w14:props3d w14:ligatures w14:numForm w14:numSpacing \
         w14:stylisticSets w14:cntxtAlts w:rPrChange",
    ),
    (
        "w:pPr",
        "w:pStyle w:keepNext w:keepLines w:pageBreakBefore w:framePr w:widowControl w:numPr \
         w:suppressLineNumbers w:pBdr w:shd w:tabs w:suppressAutoHyphens w:kinsoku w:wordWrap w:overflowPunct \
         w:topLinePunct w:autoSpaceDE w:autoSpaceDN w:bidi w:adjustRightInd w:snapToGrid w:spacing w:ind \
         w:contextualSpacing w:mirrorIndents w:suppressOverlap w:jc w:textDirection w:textAlignment \
         w:textboxTightWrap w:outlineLvl w:divId w:cnfStyle w:rPr w:sectPr w:pPrChange",
    ),
    (
        "w:sectPr",
        "w:headerReference|w:footerReference w:footnotePr w:endnotePr w:type w:pgSz w:pgMar w:paperSrc \
         w:pgBorders w:lnNumType w:pgNumType w:cols w:formProt w:vAlign w:noEndnote w:titlePg w:textDirection \
         w:bidi w:rtlGutter w:docGrid w:printerSettings w:sectPrChange",
    ),
    (
        "w:style",
        "w:name w:aliases w:basedOn w:next w:link w:autoRedefine w:hidden w:uiPriority w:semiHidden \
         w:unhideWhenUsed w:qFormat w:locked w:personal w:personalCompose w:personalReply w:rsid w:pPr w:rPr \
         w:tblPr w:trPr w:tcPr w:tblStylePr",
    ),
    (
        "w:settings",
        "w:writeProtection w:view w:zoom w:removePersonalInformation w:removeDateAndTime w:embedTrueTypeFonts \
         w:embedSystemFonts w:saveSubsetFonts w:defaultTabStop w:autoHyphenation w:footnotePr w:endnotePr \
         w:compat w:rsids w:themeFontLang w:clrSchemeMapping",
    ),
    ("w:styles", "w:docDefaults w:latentStyles w:style"),
    ("w:docDefaults", "w:rPrDefault w:pPrDefault"),
    (
        "w:font",
        "w:altName w:panose1 w:charset w:family w:notTrueType w:pitch w:sig w:embedRegular w:embedBold \
         w:embedItalic w:embedBoldItalic",
    ),
    ("w:pBdr", "w:top w:left w:bottom w:right w:between w:bar"),
    ("w:document", "w:background w:body"),
    ("w:tbl", "w:tblPr w:tblGrid w:tr"),
    ("w:tr", "w:tblPrEx w:trPr w:tc"),
];

/// The sequences of numbering (17.9) and of the DrawingML theme (Part 1, 20.1.6).
const OTHER_SEQUENCES: &[(&str, &str)] = &[
    (
        "w:lvl",
        "w:start w:numFmt w:lvlRestart w:pStyle w:isLgl w:suff w:lvlText w:lvlPicBulletId w:legacy w:lvlJc w:pPr \
         w:rPr",
    ),
    (
        "w:abstractNum",
        "w:nsid w:multiLevelType w:tmpl w:name w:styleLink w:numStyleLink w:lvl",
    ),
    ("w:num", "w:abstractNumId w:lvlOverride"),
    ("w:lvlOverride", "w:startOverride w:lvl"),
    ("w:numbering", "w:numPicBullet w:abstractNum w:num w:numIdMacAtCleanup"),
    ("w:numPr", "w:ilvl w:numId w:numberingChange w:ins"),
    (
        "a:theme",
        "a:themeElements a:objectDefaults a:extraClrSchemeLst a:custClrLst a:extLst",
    ),
    ("a:themeElements", "a:clrScheme a:fontScheme a:fmtScheme a:extLst"),
    (
        "a:clrScheme",
        "a:dk1 a:lt1 a:dk2 a:lt2 a:accent1 a:accent2 a:accent3 a:accent4 a:accent5 a:accent6 a:hlink a:folHlink \
         a:extLst",
    ),
    ("a:fontScheme", "a:majorFont a:minorFont a:extLst"),
    ("a:majorFont", "a:latin a:ea a:cs a:font a:extLst"),
    ("a:minorFont", "a:latin a:ea a:cs a:font a:extLst"),
    (
        "a:fmtScheme",
        "a:fillStyleLst a:lnStyleLst a:effectStyleLst a:bgFillStyleLst",
    ),
];

/// Sequences by element name.
fn sequences() -> BTreeMap<&'static str, Vec<&'static str>> {
    WORD_SEQUENCES
        .iter()
        .chain(OTHER_SEQUENCES)
        .map(|(name, children)| (*name, children.split_whitespace().collect()))
        .collect()
}

/// Elements that must hold a number of children (`minOccurs` and `maxOccurs` of the schema).
fn counts() -> BTreeMap<&'static str, (usize, usize)> {
    let mut map = BTreeMap::new();
    for list in ["a:fillStyleLst", "a:lnStyleLst", "a:effectStyleLst", "a:bgFillStyleLst"] {
        map.insert(list, (3, usize::MAX));
    }
    map.insert("a:clrScheme", (12, 13));
    map.insert("w:numPr", (1, 4));
    map
}

/// The schema's enumerations of the values this writer writes, by `element@attribute`, separated by spaces.
const ENUMERATIONS: &[(&str, &str)] = &[
    ("w:jc@w:val", "start center end both distribute left right"),
    ("w:spacing@w:lineRule", "auto exact atLeast"),
    ("w:tab@w:val", "clear start center end decimal bar num left right"),
    ("w:tab@w:leader", "none dot hyphen underscore heavy middleDot"),
    ("w:vertAlign@w:val", "baseline superscript subscript"),
    ("w:br@w:type", "page column textWrapping"),
    ("w:type@w:val", "nextPage nextColumn continuous evenPage oddPage"),
    ("w:pgSz@w:orient", "portrait landscape"),
    ("w:family@w:val", "decorative modern roman script swiss auto"),
    ("w:pitch@w:val", "fixed variable default"),
    ("w:style@w:type", "paragraph character table numbering"),
    ("w:headerReference@w:type", "default first even"),
    ("w:footerReference@w:type", "default first even"),
    ("w:framePr@w:dropCap", "none drop margin"),
    ("w:lvlJc@w:val", "start center end both left right"),
    ("w:multiLevelType@w:val", "singleLevel multilevel hybridMultilevel"),
    (
        "w14:ligatures@w14:val",
        "none standard contextual historical discretional standardContextual standardHistorical \
         contextualHistorical standardDiscretional contextualDiscretional historicalDiscretional \
         standardContextualHistorical standardContextualDiscretional standardHistoricalDiscretional \
         contextualHistoricalDiscretional all",
    ),
    ("w14:numForm@w14:val", "default lining oldStyle"),
    ("w14:numSpacing@w14:val", "default proportional tabular"),
];

/// The values an attribute may take, by `element@attribute`.
fn enumerations() -> BTreeMap<&'static str, Vec<&'static str>> {
    let mut map: BTreeMap<&'static str, Vec<&'static str>> = ENUMERATIONS
        .iter()
        .map(|(key, values)| (*key, values.split_whitespace().collect()))
        .collect();
    let mut underline = crate::doc::values::UNDERLINES.to_vec();
    underline.push("none");
    map.insert("w:u@w:val", underline);
    let highlights = super::super::units::HIGHLIGHTS.iter().map(|(name, _)| *name);
    map.insert("w:highlight@w:val", highlights.chain(["none"]).collect());
    map
}

/// Hexadecimal color attributes: six digits or `auto`.
const COLOR_ATTRS: [&str; 3] = ["w:color", "w:fill", "w:val"];
const COLOR_ELEMENTS: [&str; 7] = ["w:color", "w:shd", "w:u", "w:top", "w:bottom", "w:left", "w:right"];

struct Open {
    name: String,
    children: Vec<String>,
}

/// Checks one part: well formed, every prefix declared, children in the schema's order, and enumerated values
/// in their enumerations. Panics with the part's name and the problem.
pub fn check_part(name: &str, xml: &str) {
    let sequences = sequences();
    let counts = counts();
    let enumerations = enumerations();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = true;
    let mut stack: Vec<Open> = Vec::new();
    let mut declared: BTreeSet<String> = BTreeSet::new();
    let mut roots = 0;
    loop {
        let event = reader
            .read_event()
            .unwrap_or_else(|e| panic!("{name} is not well formed: {e}"));
        let (start, empty) = match &event {
            Event::Start(s) => (Some(s.clone()), false),
            Event::Empty(s) => (Some(s.clone()), true),
            Event::End(_) => {
                let open = stack.pop().expect("an open element");
                check_children(name, &open, &sequences, &counts);
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let Some(start) = start else { continue };
        let element = start.name().as_ref().to_owned();
        if stack.is_empty() {
            roots += 1;
        }
        let mut attrs = Vec::new();
        for attr in start.attributes() {
            let attr = attr.unwrap_or_else(|e| panic!("{name}: a bad attribute in {element}: {e}"));
            let key = attr.key.as_ref().to_owned();
            let value = attr
                .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .unwrap_or_else(|e| panic!("{name}: {e}"))
                .into_owned();
            if let Some(prefix) = key.strip_prefix("xmlns:") {
                declared.insert(prefix.to_owned());
            }
            attrs.push((key, value));
        }
        for (key, value) in &attrs {
            check_prefix(name, key, &declared);
            if let Some(allowed) = enumerations.get(format!("{element}@{key}").as_str()) {
                assert!(allowed.contains(&value.as_str()), "{name}: {element} {key}=\"{value}\"");
            }
            if COLOR_ELEMENTS.contains(&element.as_str()) && COLOR_ATTRS.contains(&key.as_str()) {
                let is_color = key != "w:val" || element == "w:color";
                if is_color {
                    let ok = value == "auto" || (value.len() == 6 && value.bytes().all(|b| b.is_ascii_hexdigit()));
                    assert!(ok, "{name}: {element} {key}=\"{value}\" is not a color");
                }
            }
        }
        check_prefix(name, &element, &declared);
        if let Some(parent) = stack.last_mut() {
            parent.children.push(element.clone());
        }
        let open = Open {
            name: element,
            children: Vec::new(),
        };
        if empty {
            check_children(name, &open, &sequences, &counts);
        } else {
            stack.push(open);
        }
    }
    assert!(stack.is_empty(), "{name}: unclosed elements");
    assert_eq!(roots, 1, "{name}: one root element");
}

fn check_prefix(name: &str, qualified: &str, declared: &BTreeSet<String>) {
    if let Some((prefix, _)) = qualified.split_once(':') {
        if prefix != "xml" && prefix != "xmlns" {
            assert!(
                declared.contains(prefix),
                "{name}: the prefix {prefix} of {qualified} is not declared"
            );
        }
    }
}

fn check_children(
    name: &str,
    open: &Open,
    sequences: &BTreeMap<&'static str, Vec<&'static str>>,
    counts: &BTreeMap<&'static str, (usize, usize)>,
) {
    if let Some((min, max)) = counts.get(open.name.as_str()) {
        let n = open.children.len();
        assert!(n >= *min && n <= *max, "{name}: {} has {n} children", open.name);
    }
    if open.name == "w:body" {
        let last = open.children.last().map(String::as_str);
        assert_eq!(last, Some("w:sectPr"), "{name}: the body ends with its section");
        assert_eq!(open.children.iter().filter(|c| *c == "w:sectPr").count(), 1);
    }
    let Some(sequence) = sequences.get(open.name.as_str()) else {
        return;
    };
    let place = |child: &str| sequence.iter().position(|s| s.split('|').any(|alt| alt == child));
    let mut last = 0;
    for child in &open.children {
        let at = place(child).unwrap_or_else(|| panic!("{name}: {child} may not be in {}", open.name));
        assert!(
            at >= last,
            "{name}: in {}, {child} comes after {} ({:?})",
            open.name,
            sequence[last],
            open.children
        );
        last = at;
    }
    // A child that may appear once may not repeat; lists, styles, levels, rows, and references may.
    let repeats = [
        "w:style",
        "w:lvl",
        "w:abstractNum",
        "w:num",
        "w:lvlOverride",
        "w:tr",
        "w:tc",
        "w:headerReference",
        "w:footerReference",
        "a:font",
    ];
    for child in &open.children {
        let n = open.children.iter().filter(|c| *c == child).count();
        assert!(
            n == 1 || repeats.contains(&child.as_str()),
            "{name}: {child} repeats in {}",
            open.name
        );
    }
}

/// A font file with one OS/2 table whose `fsType` is given: 0 for installable, 2 for restricted.
pub fn tiny_font(fs_type: u16) -> Vec<u8> {
    let mut bytes = vec![0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    bytes.extend_from_slice(b"OS/2");
    bytes.extend_from_slice(&[0, 0, 0, 0]);
    bytes.extend_from_slice(&28u32.to_be_bytes());
    bytes.extend_from_slice(&10u32.to_be_bytes());
    bytes.extend_from_slice(&[0, 4, 0, 0, 1, 144, 0, 5]);
    bytes.extend_from_slice(&fs_type.to_be_bytes());
    bytes.resize(64, 0);
    bytes
}

#[test]
fn a_child_out_of_order_fails_the_check() {
    let bad = "<w:r xmlns:w=\"x\"><w:rPr><w:i/><w:b/></w:rPr></w:r>";
    let result = std::panic::catch_unwind(|| check_part("bad", bad));
    assert!(result.is_err(), "b comes before i in CT_RPr");
    check_part("good", "<w:r xmlns:w=\"x\"><w:rPr><w:b/><w:i/></w:rPr></w:r>");
    let undeclared = std::panic::catch_unwind(|| check_part("prefix", "<w:p><w14:x/></w:p>"));
    assert!(undeclared.is_err());
}

#[test]
fn the_restricted_font_is_not_embeddable() {
    assert!(super::super::fonts::embeddable(&tiny_font(0)));
    assert!(super::super::fonts::embeddable(&tiny_font(8)));
    assert!(!super::super::fonts::embeddable(&tiny_font(2)));
    assert!(!super::super::fonts::embeddable(b"wOF2 not a font"));
}
