//! The Word import read the way OpenNote's own Word export writes: theme colors, left-to-right runs, ligatures
//! that are off, outline levels, paragraph shading, "do not check spelling", drop caps, user style IDs, page
//! numbers, numbering styles, `w:lvlRestart`, and hidden text. Expected values come from ECMA-376 Part 1 and
//! [MS-DOCX], worked by hand.

use serde_json::json;

use super::tests::{docx, first_page, import_bytes, summary, text_blocks};
use crate::testing::TestEnv;
use crate::{import_docx, MemorySink};

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
const W14: &str = r#"xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml""#;

const THEME: &str = r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>
    <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    <a:accent2><a:srgbClr val="ED7D31"/></a:accent2></a:clrScheme></a:themeElements></a:theme>"#;

fn run(rpr: &str, text: &str) -> String {
    format!(r#"<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

fn plain(text: &str) -> String {
    format!(r#"<w:r><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

fn markdown_of(sink: &MemorySink) -> String {
    text_blocks(first_page(sink))
        .into_iter()
        .map(|(markdown, _)| markdown)
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[test]
fn plain_theme_colors_stay_theme_colors() {
    // ECMA-376 Part 1, 17.3.2.6: w:themeColor wins over w:val. A plain one is the page theme's slot; a shade
    // (17.3.2.40) makes a color of its own: accent1 4472C4 at shade BF is 2F5496 (hand-worked in HSL). An
    // underline shows on spaces, so its space stays inside (R-WS-1).
    let body = format!(
        "<w:p>{}{}{}{}</w:p>",
        run(r#"<w:color w:val="4472C4" w:themeColor="accent1"/>"#, "accent"),
        run(r#"<w:color w:val="000000" w:themeColor="text1"/>"#, " text"),
        run(
            r#"<w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/>"#,
            " shaded"
        ),
        run(
            r#"<w:u w:val="single" w:color="ED7D31" w:themeColor="accent2"/>"#,
            " line"
        ),
    );
    let sink = import_bytes(&docx(&body, &[("theme/theme1.xml", THEME)]));
    assert_eq!(
        markdown_of(&sink),
        "<span data-color=\"theme:accent1\">accent</span> <span data-color=\"theme:text\">text</span> \
         <span data-color=\"#2f5496\">shaded</span><u data-line-color=\"theme:accent2\"> line</u>"
    );
    assert_eq!(
        first_page(&sink).extra["theme"]["colors"]["accent1"],
        json!("#4472c4"),
        "the page theme holds the document's colors, so theme:accent1 shows as in Word"
    );
}

#[test]
fn the_color_mapping_of_the_settings_picks_the_slot() {
    // ECMA-376 Part 1, 17.15.1.20: w:t1="light1" makes text1 the theme's light color.
    let settings = format!(r#"<w:settings {W}><w:clrSchemeMapping w:bg1="dark1" w:t1="light1"/></w:settings>"#);
    let body = format!(
        "<w:p>{}</w:p>",
        run(r#"<w:color w:val="000000" w:themeColor="text1"/>"#, "light")
    );
    let sink = import_bytes(&docx(
        &body,
        &[("theme/theme1.xml", THEME), ("settings.xml", &settings)],
    ));
    assert_eq!(markdown_of(&sink), "<span data-color=\"theme:background\">light</span>");
}

#[test]
fn left_to_right_runs_and_ligatures_that_are_off_come_over() {
    // 17.3.2.30: w:rtl off is left to right. [MS-DOCX] 2.6.1.3: w14:ligatures lists the kinds that are on, so
    // "none" turns off the standard and contextual ligatures that OpenNote shows by default.
    let body = format!(
        "<w:p>{}{}</w:p>",
        run(r#"<w:rtl w:val="0"/>"#, "ltr"),
        run(r#"<w14:ligatures w14:val="none"/>"#, " flat"),
    );
    let document = body.replace("<w:p>", &format!("<w:p {W14}>"));
    let sink = import_bytes(&docx(&document, &[]));
    assert_eq!(
        markdown_of(&sink),
        "<span dir=\"ltr\">ltr</span> <span data-otf=\"clig-none liga-none\">flat</span>"
    );
}

#[test]
fn outline_levels_shading_and_no_proofing_stay_paragraph_formatting() {
    // A Normal paragraph with w:outlineLvl 0 (17.3.1.20) is a paragraph at outline level 1, not a heading. A
    // shaded paragraph whose text is bold keeps its shading: only OpenNote's callout fill makes a callout.
    // w:noProof on the paragraph mark (17.3.2.21) is "do not check spelling", language zxx.
    let body = format!(
        r#"<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>{}</w:p>
        <w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/></w:pPr>{}</w:p>
        <w:p><w:pPr><w:rPr><w:noProof/></w:rPr></w:pPr>{}</w:p>"#,
        plain("Outlined"),
        run("<w:b/>", "Bold on yellow"),
        plain("Unchecked"),
    );
    let sink = import_bytes(&docx(&body, &[]));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(block["markdown"], json!("Outlined\n\n**Bold on yellow**\n\nUnchecked"));
    assert_eq!(
        block["paras"],
        json!({
            "0": {"outline": 1},
            "1": {"shade": {"fill": "#fff2cc", "pattern": "clear"}},
            "2": {"lang": "zxx"}
        })
    );
}

#[test]
fn a_drop_cap_frame_joins_its_paragraph() {
    // 17.3.1.11: Word writes the letter in a framed paragraph of its own, then the rest of the paragraph.
    let body = format!(
        r#"<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:hSpace="144" w:wrap="around"
        w:vAnchor="text" w:hAnchor="text"/></w:pPr>{}</w:p><w:p>{}</w:p>"#,
        plain("O"),
        plain("nce upon a time."),
    );
    let sink = import_bytes(&docx(&body, &[]));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(block["markdown"], json!("Once upon a time."));
    // hSpace 144 twips is 7.2 points.
    assert_eq!(
        block["paras"],
        json!({"0": {"dropCap": {"mode": "drop", "lines": 3, "distance": 7.2}}})
    );
}

#[test]
fn user_style_ids_keep_their_name_and_page_numbers_come_over() {
    // OpenNote's export writes a user style "u-note" with that ID; it must not read back as "u-u-note".
    // 17.6.12: w:pgNumType gives the page number format and first number.
    let styles = format!(
        r#"<w:styles {W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
        </w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="u-note"><w:name w:val="u-note"/>
        <w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style></w:styles>"#
    );
    let body = format!(
        r#"<w:p><w:pPr><w:pStyle w:val="u-note"/></w:pPr>{}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
        <w:pgNumType w:fmt="upperRoman" w:start="4"/></w:sectPr>"#,
        plain("A note"),
    );
    let sink = import_bytes(&docx(&body, &[("styles.xml", &styles)]));
    let page = first_page(&sink);
    let (_, data) = &text_blocks(page)[0];
    assert_eq!(data.styles.values().collect::<Vec<_>>(), ["u-note"]);
    assert!(
        page.extra["styles"].get("u-note").is_some(),
        "{:?}",
        page.extra["styles"]
    );
    assert_eq!(
        page.view.extra["text"]["pageNumbers"],
        json!({"format": "upperRoman", "start": 4})
    );
}

#[test]
fn numbering_styles_lend_their_levels_and_lvl_restart_keeps_counting() {
    // 17.9.27: numId 2's definition borrows the levels of the definition whose styleLink it names. 17.9.10:
    // level 2 has lvlRestart 0, so it never starts again: its items count 1, 2 across the level 1 item.
    let numbering = format!(
        r#"<w:numbering {W}>
        <w:abstractNum w:abstractNumId="1"><w:styleLink w:val="Outline"/>
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
          <w:lvl w:ilvl="1"><w:start w:val="1"/><w:lvlRestart w:val="0"/><w:numFmt w:val="decimal"/>
          <w:lvlText w:val="%2."/></w:lvl></w:abstractNum>
        <w:abstractNum w:abstractNumId="2"><w:numStyleLink w:val="Outline"/></w:abstractNum>
        <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>"#
    );
    let item = |level: u32, text: &str| {
        format!(
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="2"/></w:numPr></w:pPr>{}</w:p>"#,
            plain(text)
        )
    };
    let body = [item(0, "One"), item(1, "a"), item(0, "Two"), item(1, "b")].concat();
    let sink = import_bytes(&docx(&body, &[("numbering.xml", &numbering)]));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(block["markdown"], json!("1. One\n\n   1. a\n\n2. Two\n\n   2. b"));
    assert!(block["lists"].get("a1").is_some(), "{}", block["lists"]);
}

#[test]
fn hidden_text_comes_in_visible_and_is_counted() {
    // DESIGN 9.2: hidden text (w:vanish, 17.3.2.41) stays visible and the report counts it.
    let body = format!("<w:p>{}{}</w:p>", plain("Shown "), run("<w:vanish/>", "and hidden"));
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("Hidden.docx");
    std::fs::write(&path, docx(&body, &[])).expect("writes the file");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_docx(&path, &world.env(), &mut sink).expect("imports");
    assert_eq!(markdown_of(&sink), "Shown and hidden");
    let text = format!("{report:?}");
    assert!(text.contains("1 piece of hidden text"), "{text}");
}
