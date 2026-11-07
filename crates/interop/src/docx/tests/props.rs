//! Round-trip properties: export then read back, or export then import, equals the original document model, for
//! generated documents.

use std::collections::BTreeMap;

use proptest::prelude::*;
use serde_json::{json, Map, Value};

use super::*;

/// Run marks that Word holds exactly: every mark of DESIGN 2.2 but two kinds. Word has no property for `weight`
/// without a device face, `otf` `zero`, `float`, or `foreign`. And some share a Word form with another
/// mark: point sizes 10, 15, and 18 are the size names, and a highlight that is not one of the 16 is shading.
fn arb_marks() -> impl Strategy<Value = Marks> {
    let font = prop::option::of(prop::sample::select(vec![
        "Georgia",
        "+body",
        "+heading",
        "Segoe UI",
        "Arial Black",
        "Franklin Gothic Medium",
        "Segoe UI Semilight",
    ]));
    let size = prop::option::of(prop::sample::select(vec![
        "small", "large", "xlarge", "10.5", "11", "24", "7.5",
    ]));
    let color = prop::option::of(prop::sample::select(vec![
        "brick",
        "#123456",
        "theme:accent2",
        "theme:text",
    ]));
    let highlight = prop::option::of(prop::sample::select(vec!["#ffff00", "#00ff00", "#c0c0c0"]));
    let underline = prop::option::of((
        prop::sample::select(crate::doc::values::UNDERLINES.to_vec()),
        prop::option::of(prop::sample::select(vec!["fern", "#c00000"])),
    ));
    let otf = prop::option::of(prop::sample::select(vec![
        "dlig",
        "liga-none",
        "clig-none hlig",
        "lnum tnum",
        "onum pnum ss01 ss12",
    ]));
    let flags = (any::<bool>(), any::<bool>(), any::<bool>(), any::<bool>());
    let numbers = (
        prop::option::of(prop::sample::select(vec!["1.5", "-0.75", "3"])),
        prop::option::of(prop::sample::select(vec!["80", "150"])),
        prop::option::of(prop::sample::select(vec!["2", "-3.5"])),
        prop::option::of(prop::sample::select(vec!["14", "8.5"])),
    );
    let extras = (
        prop::option::of(prop::sample::select(vec!["small", "all"])),
        prop::option::of(prop::sample::select(vec!["outline", "emboss shadow", "engrave"])),
        prop::option::of(prop::sample::select(vec![
            "single", "double", "dotted", "dashed", "thick",
        ])),
        prop::option::of(prop::sample::select(vec!["fr-CA", "zxx", "de"])),
        prop::option::of(prop::sample::select(vec!["rtl", "ltr"])),
        prop::option::of(prop::sample::select(vec!["#eeeeee", "#123456"])),
        prop::option::of(prop::bool::ANY),
    );
    (font, size, color, highlight, underline, otf, flags, numbers, extras).prop_map(
        |(font, size, color, highlight, underline, otf, flags, numbers, extras)| {
            let (strong, emphasis, strike, double) = flags;
            let (tracking, scale, shift, kern) = numbers;
            let (caps, effect, text_box, lang, dir, shade, script) = extras;
            let s = |v: Option<&str>| v.map(str::to_owned);
            Marks {
                font: s(font),
                size: s(size),
                color: s(color),
                highlight: s(highlight),
                underline: underline.is_some(),
                underline_line: underline.and_then(|(line, _)| (line != "single").then(|| line.to_owned())),
                underline_color: underline.and_then(|(_, c)| s(c)),
                otf: s(otf),
                strong,
                emphasis,
                strike,
                strike_double: strike && double,
                tracking: s(tracking),
                scale: s(scale),
                shift: s(shift),
                kern: s(kern),
                caps: s(caps),
                effect: s(effect),
                text_box: s(text_box),
                box_color: None,
                lang: s(lang),
                dir: s(dir),
                shade: s(shade),
                script: script.map(|sup| {
                    if sup {
                        crate::doc::Script::Sup
                    } else {
                        crate::doc::Script::Sub
                    }
                }),
                ..Marks::none()
            }
        },
    )
}

/// Paragraph formatting on the grids that Word's units hold exactly: points in steps of 0.05 (whole twips) and
/// line multiples in steps of 0.05 (whole 240ths).
fn arb_para() -> impl Strategy<Value = Value> {
    let align = prop::option::of(prop::sample::select(vec![
        "start",
        "center",
        "end",
        "justify",
        "distribute",
    ]));
    let indent = prop::option::of((0..200i32, 0..100i32, -60..60i32));
    let space = prop::option::of((0..100i32, 0..100i32));
    let line = prop::option::of(prop::sample::select(vec![
        json!({"rule": "multiple", "value": 1.15}),
        json!({"rule": "multiple", "value": 2}),
        json!({"rule": "exact", "value": 18}),
        json!({"rule": "atLeast", "value": 12.5}),
    ]));
    let flags = (
        prop::option::of(any::<bool>()),
        prop::option::of(any::<bool>()),
        prop::option::of(any::<bool>()),
        prop::option::of(any::<bool>()),
        prop::option::of(any::<bool>()),
    );
    let extra = (
        prop::option::of(1u8..=9),
        prop::option::of(prop::sample::select(vec!["rtl", "ltr"])),
        prop::option::of(prop::sample::select(vec!["fr-CA", "zxx"])),
        prop::bool::ANY,
        prop::bool::ANY,
        prop::bool::ANY,
    );
    (align, indent, space, line, flags, extra).prop_map(|(align, indent, space, line, flags, extra)| {
        let mut p = Map::new();
        if let Some(a) = align {
            p.insert("align".into(), json!(a));
        }
        if let Some((start, end, first)) = indent {
            p.insert(
                "indent".into(),
                json!({"start": f64::from(start) / 4.0, "end": f64::from(end) / 2.0, "first": f64::from(first) / 2.0}),
            );
        }
        if let Some((before, after)) = space {
            p.insert("before".into(), json!(f64::from(before) / 4.0));
            p.insert("after".into(), json!(f64::from(after) / 2.0));
        }
        if let Some(line) = line {
            p.insert("line".into(), line);
        }
        let (keep_next, keep_lines, break_before, widows, contextual) = flags;
        for (key, value) in [
            ("keepNext", keep_next),
            ("keepLines", keep_lines),
            ("breakBefore", break_before),
            ("widows", widows),
            ("contextual", contextual),
        ] {
            if let Some(v) = value {
                p.insert(key.into(), json!(v));
            }
        }
        let (outline, dir, lang, tabs, border, shade) = extra;
        if let Some(o) = outline {
            p.insert("outline".into(), json!(o));
        }
        if let Some(d) = dir {
            p.insert("dir".into(), json!(d));
        }
        if let Some(l) = lang {
            p.insert("lang".into(), json!(l));
        }
        if tabs {
            p.insert(
                "tabs".into(),
                json!([{"pos": 36, "align": "end", "leader": "dot"}, {"pos": 144.5, "align": "bar", "leader": "none"}]),
            );
        }
        if border {
            p.insert(
                "border".into(),
                json!({"bottom": {"style": "double", "width": 1.5, "space": 4, "color": "#c00000"},
                       "start": {"style": "single", "width": 0.25, "space": 0}}),
            );
        }
        if shade {
            p.insert(
                "shade".into(),
                json!({"fill": "#fff2cc", "pattern": "pct25", "color": "#000000"}),
            );
        }
        Value::Object(p)
    })
}

/// Paragraphs with neighboring runs of equal marks joined, as every reader joins them.
pub(super) fn joined(blocks: &[Block]) -> Vec<Block> {
    blocks
        .iter()
        .map(|block| match block {
            Block::Paragraph(inlines) => {
                let mut out = Vec::new();
                for inline in inlines {
                    match inline {
                        crate::doc::Inline::Text { text, marks } => crate::doc::push_text(&mut out, text, marks),
                        other => out.push(other.clone()),
                    }
                }
                Block::Paragraph(out)
            }
            other => other.clone(),
        })
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    /// Every mark and paragraph key that Word holds comes back as it went out.
    #[test]
    fn export_then_read_back_equals_the_model(
        runs in prop::collection::vec(arb_marks(), 1..4),
        para in arb_para(),
    ) {
        let words: Vec<String> = (0..runs.len()).map(|i| format!("w{i}")).collect();
        let blocks = vec![Block::Paragraph(
            words.iter().zip(&runs).map(|(w, m)| crate::doc::Inline::marked(w.clone(), m.clone())).collect(),
        )];
        let ids = vec![ID1.to_owned()];
        let mut extra = Map::new();
        extra.insert("paras".into(), json!({ ID1: para }));
        let data = TextData::read(&ids, &BTreeMap::new(), &extra);
        let expected_para = data.paras.get(ID1).cloned().unwrap_or_default();
        let doc = document(vec![Part::Text { blocks, data: Box::new(data) }]);
        let (paras, read_runs) = readback::read(&doc);
        prop_assert_eq!(paras.len(), 1, "{}", doc);
        prop_assert_eq!(&paras[0], &expected_para, "{}", doc);
        let expected: Vec<(String, Marks)> = words.into_iter().zip(runs).collect();
        prop_assert_eq!(read_runs, expected, "{}", doc);
    }

    /// The crate's Word import gives back the model of a generated document: every mark and paragraph key that
    /// it reads.
    #[test]
    fn export_then_import_equals_the_model(
        runs in prop::collection::vec(arb_import_marks(), 1..4),
        para in arb_import_para(),
    ) {
        let runs: Vec<(String, Marks)> = runs.into_iter().enumerate().map(|(i, m)| (format!("w{i}"), m)).collect();
        let (part, expected_para) = super::roundtrip::one_paragraph(&runs, para);
        let original = match &part {
            Part::Text { blocks, .. } => blocks.clone(),
            _ => unreachable!("a text part"),
        };
        let bytes = build(&input(vec![part], Setup::default())).expect("builds");
        let (blocks, data) = readback::import_text(&bytes);
        prop_assert_eq!(joined(&blocks), joined(&original));
        let para = data.ids.first().and_then(|id| data.paras.get(id)).cloned().unwrap_or_default();
        prop_assert_eq!(para, expected_para);
    }
}

/// The marks of [`arb_marks`] that the crate's Word import reads back exactly. Four are left out until the
/// import reads them (a hand-over to text:docx-import-v2): theme colors come back as the nearest pen, the
/// `+body` and `+heading` font tokens as nothing, `ltr` as nothing, and ligatures turned off (`liga-none`,
/// `clig-none`) as nothing.
fn arb_import_marks() -> impl Strategy<Value = Marks> {
    arb_marks().prop_map(|mut m| {
        if m.color.as_deref().is_some_and(|c| c.starts_with("theme:")) {
            m.color = None;
        }
        if m.font.as_deref().is_some_and(|f| f.starts_with('+')) {
            m.font = None;
        }
        if m.dir.as_deref() == Some("ltr") {
            m.dir = None;
        }
        m.otf = m.otf.filter(|o| !o.contains("-none"));
        m
    })
}

/// The paragraph keys of [`arb_para`] that the import reads back as paragraph keys. An outline level makes a
/// heading and shading makes a callout on import, and the import does not read `w:noProof` on the paragraph
/// mark as language `zxx`.
fn arb_import_para() -> impl Strategy<Value = Value> {
    arb_para().prop_map(|mut p| {
        if let Some(map) = p.as_object_mut() {
            map.remove("outline");
            map.remove("shade");
            if map.get("lang") == Some(&json!("zxx")) {
                map.remove("lang");
            }
        }
        p
    })
}
