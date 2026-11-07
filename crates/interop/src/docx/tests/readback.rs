//! Reading a written document back, for the round-trip properties: a strict reader of the properties this writer
//! writes, each mapped back by the inverse of its rule in DESIGN 9.1, and the crate's own Word import.

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::doc::data::{BorderLine, Borders, Indent, LineSpacing, Para, Shade, Spacing, TabStop};
use crate::doc::{Block, Marks, Script};
use crate::palette::pen_name;

/// An element with its attributes and children.
#[derive(Debug, Default)]
struct El {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<El>,
    text: String,
}

impl El {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    fn child(&self, name: &str) -> Option<&El> {
        self.children.iter().find(|c| c.name == name)
    }

    fn all<'a>(&'a self, name: &'a str, out: &mut Vec<&'a El>) {
        for c in &self.children {
            if c.name == name {
                out.push(c);
            } else {
                c.all(name, out);
            }
        }
    }
}

fn tree(xml: &str) -> El {
    let mut reader = Reader::from_str(xml);
    let mut stack = vec![El::default()];
    loop {
        match reader.read_event().expect("well formed") {
            Event::Start(s) => stack.push(start(&s)),
            Event::Empty(s) => {
                let el = start(&s);
                stack.last_mut().expect("a parent").children.push(el);
            }
            Event::End(_) => {
                let el = stack.pop().expect("an element");
                stack.last_mut().expect("a parent").children.push(el);
            }
            Event::Text(t) => {
                let text = t.xml10_content().into_owned();
                stack.last_mut().expect("an element").text.push_str(&text);
            }
            Event::GeneralRef(r) => {
                let text = match &*r.xml10_content() {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    "apos" => "'",
                    _ => "",
                };
                stack.last_mut().expect("an element").text.push_str(text);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    stack.pop().expect("the root")
}

fn start(s: &quick_xml::events::BytesStart<'_>) -> El {
    El {
        name: s.name().as_ref().to_owned(),
        attrs: s
            .attributes()
            .map(|a| {
                let a = a.expect("an attribute");
                (
                    a.key.as_ref().to_owned(),
                    a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .expect("a value")
                        .into_owned(),
                )
            })
            .collect(),
        ..El::default()
    }
}

fn number(value: Option<&str>) -> f64 {
    value.and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

/// A whole number of Word units divided by its units per point, written as the grammar writes points.
fn points(value: Option<&str>, per_point: f64) -> String {
    format!("{}", number(value) / per_point)
}

fn on(el: Option<&El>) -> Option<bool> {
    el.map(|e| !matches!(e.attr("w:val"), Some("0" | "false" | "off")))
}

fn hex(value: &str) -> Option<String> {
    (value != "auto").then(|| format!("#{}", value.to_ascii_lowercase()))
}

/// The paragraphs of the body that hold runs, and the text runs with their marks.
pub fn read(document: &str) -> (Vec<Para>, Vec<(String, Marks)>) {
    let root = tree(document);
    let mut paragraphs = Vec::new();
    root.all("w:p", &mut paragraphs);
    let mut paras = Vec::new();
    let mut runs = Vec::new();
    for p in paragraphs {
        let mut rs = Vec::new();
        p.all("w:r", &mut rs);
        if rs.is_empty() {
            continue;
        }
        paras.push(p.child("w:pPr").map(para).unwrap_or_default());
        for r in rs {
            if let Some(t) = r.child("w:t") {
                runs.push((t.text.clone(), r.child("w:rPr").map(marks).unwrap_or_default()));
            }
        }
    }
    (paras, runs)
}

fn para(ppr: &El) -> Para {
    let align = ppr.child("w:jc").and_then(|j| j.attr("w:val")).map(|v| {
        match v {
            "left" => "start",
            "right" => "end",
            "both" => "justify",
            other => other,
        }
        .to_owned()
    });
    let mut p = Para {
        align,
        ..Para::default()
    };
    p.indent = ppr.child("w:ind").map(|i| {
        let first = match (i.attr("w:firstLine"), i.attr("w:hanging")) {
            (Some(f), _) => number(Some(f)) / 20.0,
            (None, Some(h)) => -number(Some(h)) / 20.0,
            (None, None) => 0.0,
        };
        Indent {
            start: number(i.attr("w:left")) / 20.0,
            end: number(i.attr("w:right")) / 20.0,
            first,
        }
    });
    if let Some(s) = ppr.child("w:spacing") {
        p.before = s.attr("w:before").map(|v| Spacing::Points(number(Some(v)) / 20.0));
        p.after = s.attr("w:after").map(|v| Spacing::Points(number(Some(v)) / 20.0));
        p.line = s.attr("w:line").map(|v| match s.attr("w:lineRule") {
            Some("exact") => LineSpacing::Exact(number(Some(v)) / 20.0),
            Some("atLeast") => LineSpacing::AtLeast(number(Some(v)) / 20.0),
            _ => LineSpacing::Multiple(number(Some(v)) / 240.0),
        });
    }
    p.contextual = on(ppr.child("w:contextualSpacing"));
    p.keep_next = on(ppr.child("w:keepNext"));
    p.keep_lines = on(ppr.child("w:keepLines"));
    p.break_before = on(ppr.child("w:pageBreakBefore"));
    p.widows = on(ppr.child("w:widowControl"));
    if let Some(tabs) = ppr.child("w:tabs") {
        p.tabs = tabs
            .children
            .iter()
            .map(|t| TabStop {
                pos: number(t.attr("w:pos")) / 20.0,
                align: match t.attr("w:val").unwrap_or("left") {
                    "left" => "start",
                    "right" => "end",
                    other => other,
                }
                .to_owned(),
                leader: t.attr("w:leader").unwrap_or("none").to_owned(),
            })
            .collect();
    }
    p.border = ppr.child("w:pBdr").map(|b| {
        let line = |side: &str| {
            b.child(side).map(|l| BorderLine {
                style: l.attr("w:val").unwrap_or_default().to_owned(),
                width: number(l.attr("w:sz")) / 8.0,
                space: number(l.attr("w:space")) as u8,
                color: l.attr("w:color").and_then(hex),
            })
        };
        Borders {
            top: line("w:top"),
            bottom: line("w:bottom"),
            start: line("w:left"),
            end: line("w:right"),
            between: line("w:between"),
        }
    });
    p.shade = ppr.child("w:shd").map(|s| Shade {
        fill: s.attr("w:fill").and_then(hex),
        pattern: s.attr("w:val").unwrap_or_default().to_owned(),
        color: s.attr("w:color").and_then(hex),
    });
    p.dir = on(ppr.child("w:bidi")).map(|rtl| if rtl { "rtl" } else { "ltr" }.to_owned());
    p.outline = ppr
        .child("w:outlineLvl")
        .and_then(|o| o.attr("w:val"))
        .and_then(|v| v.parse::<u8>().ok())
        .map(|v| v + 1);
    p.hyphenate = on(ppr.child("w:suppressAutoHyphens")).map(|suppressed| !suppressed);
    if let Some(mark) = ppr.child("w:rPr") {
        if mark.child("w:noProof").is_some() {
            p.lang = Some("zxx".to_owned());
        } else {
            p.lang = mark.child("w:lang").and_then(|l| l.attr("w:val")).map(str::to_owned);
        }
    }
    p
}

fn marks(rpr: &El) -> Marks {
    let mut m = Marks::none();
    let has = |name: &str| on(rpr.child(name)) == Some(true);
    if let Some(f) = rpr.child("w:rFonts") {
        m.font = match (f.attr("w:asciiTheme"), f.attr("w:ascii")) {
            (Some("majorHAnsi"), _) => Some("+heading".to_owned()),
            (Some("minorHAnsi"), _) => Some("+body".to_owned()),
            (_, ascii) => ascii.map(str::to_owned),
        };
    }
    m.strong = has("w:b");
    m.emphasis = has("w:i");
    m.caps = if has("w:caps") {
        Some("all".to_owned())
    } else if has("w:smallCaps") {
        Some("small".to_owned())
    } else {
        None
    };
    m.strike = has("w:strike") || has("w:dstrike");
    m.strike_double = has("w:dstrike");
    let mut effects: Vec<&str> = [
        ("w:outline", "outline"),
        ("w:shadow", "shadow"),
        ("w:emboss", "emboss"),
        ("w:imprint", "engrave"),
    ]
    .iter()
    .filter(|(el, _)| has(el))
    .map(|(_, token)| *token)
    .collect();
    effects.sort_unstable();
    m.effect = (!effects.is_empty()).then(|| effects.join(" "));
    if let Some(c) = rpr.child("w:color") {
        m.color = match c.attr("w:themeColor") {
            Some("text1") => Some("theme:text".to_owned()),
            Some("background1") => Some("theme:background".to_owned()),
            Some(theme) => Some(format!("theme:{theme}")),
            None => c.attr("w:val").map(pen_name),
        };
    }
    m.tracking = rpr.child("w:spacing").map(|s| points(s.attr("w:val"), 20.0));
    m.scale = rpr.child("w:w").and_then(|w| w.attr("w:val")).map(str::to_owned);
    m.kern = rpr.child("w:kern").map(|k| points(k.attr("w:val"), 2.0));
    m.shift = rpr.child("w:position").map(|p| points(p.attr("w:val"), 2.0));
    m.size = rpr.child("w:sz").and_then(|s| s.attr("w:val")).map(|v| match v {
        "20" => "small".to_owned(),
        "30" => "large".to_owned(),
        "36" => "xlarge".to_owned(),
        other => points(Some(other), 2.0),
    });
    m.highlight = rpr.child("w:highlight").and_then(|h| h.attr("w:val")).map(|name| {
        let hex = super::super::units::HIGHLIGHTS
            .iter()
            .find(|(n, _)| *n == name)
            .map(|(_, h)| *h)
            .unwrap_or("000000");
        format!("#{}", hex.to_ascii_lowercase())
    });
    if let Some(u) = rpr.child("w:u") {
        m.underline = true;
        m.underline_line = u.attr("w:val").filter(|v| *v != "single").map(str::to_owned);
        m.underline_color = u.attr("w:color").map(pen_name);
    }
    if let Some(b) = rpr.child("w:bdr") {
        m.text_box = Some(match (b.attr("w:val"), b.attr("w:sz")) {
            (Some("single" | "thick"), Some("12")) => "thick".to_owned(),
            (val, _) => val.unwrap_or_default().to_owned(),
        });
        m.box_color = b.attr("w:color").and_then(hex);
    }
    m.shade = rpr.child("w:shd").and_then(|s| s.attr("w:fill")).and_then(hex);
    m.script = match rpr.child("w:vertAlign").and_then(|v| v.attr("w:val")) {
        Some("superscript") => Some(Script::Sup),
        Some("subscript") => Some(Script::Sub),
        _ => None,
    };
    m.dir = on(rpr.child("w:rtl")).map(|rtl| if rtl { "rtl" } else { "ltr" }.to_owned());
    m.lang = if rpr.child("w:noProof").is_some() {
        Some("zxx".to_owned())
    } else {
        rpr.child("w:lang").and_then(|l| l.attr("w:val")).map(str::to_owned)
    };
    m.otf = open_type(rpr);
    m
}

fn open_type(rpr: &El) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    if let Some(value) = rpr.child("w14:ligatures").and_then(|l| l.attr("w14:val")) {
        let (standard, contextual, historical, discretional) = match value {
            "none" => (false, false, false, false),
            "all" => (true, true, true, true),
            v => {
                let lower = v.to_ascii_lowercase();
                (
                    lower.contains("standard"),
                    lower.contains("contextual"),
                    lower.contains("historical"),
                    lower.contains("discretional"),
                )
            }
        };
        if !standard {
            tokens.push("liga-none".to_owned());
        }
        if !contextual {
            tokens.push("clig-none".to_owned());
        }
        if historical {
            tokens.push("hlig".to_owned());
        }
        if discretional {
            tokens.push("dlig".to_owned());
        }
    }
    match rpr.child("w14:numForm").and_then(|n| n.attr("w14:val")) {
        Some("lining") => tokens.push("lnum".to_owned()),
        Some("oldStyle") => tokens.push("onum".to_owned()),
        _ => {}
    }
    match rpr.child("w14:numSpacing").and_then(|n| n.attr("w14:val")) {
        Some("proportional") => tokens.push("pnum".to_owned()),
        Some("tabular") => tokens.push("tnum".to_owned()),
        _ => {}
    }
    if let Some(sets) = rpr.child("w14:stylisticSets") {
        for set in &sets.children {
            let id: u8 = set.attr("w14:id").and_then(|v| v.parse().ok()).unwrap_or(0);
            tokens.push(format!("ss{id:02}"));
        }
    }
    tokens.sort();
    (!tokens.is_empty()).then(|| tokens.join(" "))
}

/// Imports a written file as one page with the crate's Word import, and returns its text blocks and their records.
pub fn import_text(docx: &[u8]) -> (Vec<Block>, crate::doc::data::TextData) {
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("generated.docx");
    std::fs::write(&path, docx).expect("writes");
    let world = crate::testing::TestEnv::new();
    let mut sink = crate::MemorySink::default();
    crate::import_docx_with(&path, crate::WordPages::Single, &world.env(), &mut sink).expect("imports");
    let mut blocks = Vec::new();
    let mut data = crate::doc::data::TextData::default();
    for (_, imported) in &sink.pages {
        for block in imported.page.blocks.iter() {
            if let opennote_core::model::BlockData::Text(text) = &block.data {
                blocks.extend(crate::doc::parse::parse_page(&text.markdown).blocks);
                let ids: Vec<String> = text.ids.iter().map(|id| id.to_string()).collect();
                let styles = text.styles.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
                data = crate::doc::data::TextData::read(&ids, &styles, &text.extra);
            }
        }
    }
    (blocks, data)
}
