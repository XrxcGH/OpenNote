//! More of the Word import end to end: notes, comments, tracked changes that are accepted or rejected, page setup,
//! headers and footers, and the report.

use serde_json::json;

use super::tests::{docx, first_page, import_bytes, summary, text_blocks};
use crate::testing::TestEnv;
use crate::{import_docx_options, MemorySink, TrackedChanges, WordImport};

const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

fn run(text: &str) -> String {
    format!(r#"<w:r><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

#[test]
fn footnotes_and_endnotes_come_over_with_their_text() {
    let footnotes = format!(
        r#"<w:footnotes {W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
        <w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr>
        <w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>
        <w:r><w:t xml:space="preserve"> A </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>source</w:t></w:r><w:r>
        <w:t>.</w:t></w:r></w:p></w:footnote></w:footnotes>"#
    );
    let endnotes = format!(
        r#"<w:endnotes {W}><w:endnote w:id="3"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t>Later.</w:t></w:r></w:p>
        <w:p><w:r><w:t>Second line.</w:t></w:r></w:p></w:endnote></w:endnotes>"#
    );
    let body = format!(
        r#"<w:p>{}<w:r><w:footnoteReference w:id="1"/></w:r>{}<w:r><w:endnoteReference w:id="3"/></w:r></w:p>"#,
        run("Claim"),
        run(" and more"),
    );
    let sink = import_bytes(&docx(
        &body,
        &[("footnotes.xml", &footnotes), ("endnotes.xml", &endnotes)],
    ));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(block["markdown"], json!("Claim[^id1] and more[^id2]"));
    assert_eq!(
        block["notes"],
        json!({
            "id1": {"markdown": "A *source*."},
            "id2": {"kind": "end", "markdown": "Later.\\\nSecond line."}
        })
    );
}

#[test]
fn comments_come_over_with_replies_and_resolved_state() {
    let comments = format!(
        r#"<w:comments {W} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
        <w:comment w:id="0" w:author="Ann Lee" w:date="2026-10-01T10:00:00Z" w:initials="AL">
        <w:p w14:paraId="1A2B3C4D"><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment>
        <w:comment w:id="1" w:author="Ben Ito" w:date="2026-10-02T12:30:00Z" w:initials="BI">
        <w:p w14:paraId="5E6F7A8B"><w:r><w:t>Done.</w:t></w:r></w:p></w:comment>
        </w:comments>"#
    );
    let extended = r#"<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
        <w15:commentEx w15:paraId="1A2B3C4D" w15:done="1"/>
        <w15:commentEx w15:paraId="5E6F7A8B" w15:paraIdParent="1A2B3C4D" w15:done="0"/>
        </w15:commentsEx>"#;
    let body = format!(
        r#"<w:p>{}<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>{}<w:commentRangeEnd w:id="0"/>
        <w:r><w:commentReference w:id="0"/></w:r><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/>
        </w:r>{}</w:p>"#,
        run("See "),
        run("this part"),
        run(" here."),
    );
    let sink = import_bytes(&docx(
        &body,
        &[("comments.xml", &comments), ("commentsExtended.xml", extended)],
    ));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(
        block["markdown"],
        json!(r#"See <span data-comment="id1">this part</span> here."#)
    );
    assert_eq!(
        block["comments"],
        json!({"id1": {
            "author": "Ann Lee",
            "time": "2026-10-01T10:00:00.000Z",
            "markdown": "Check this.",
            "replies": [{"author": "Ben Ito", "time": "2026-10-02T12:30:00.000Z", "markdown": "Done."}],
            "resolved": true
        }})
    );
}

fn tracked() -> Vec<u8> {
    let body = format!(
        r#"<w:p>{}<w:ins w:id="1" w:author="Ann" w:date="2026-10-01T09:30:00Z">{}</w:ins>
            <w:del w:id="2" w:author="Ann" w:date="2026-10-01T09:31:00Z"><w:r><w:delText>old</w:delText></w:r>
            </w:del>
        <w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="Ben" w:date="2026-10-03T08:00:00Z"><w:rPr><w:i/></w:rPr>
        </w:rPrChange></w:rPr><w:t xml:space="preserve"> word</w:t></w:r></w:p>"#,
        run("Kept "),
        run("new"),
    );
    docx(&body, &[])
}

fn import_with(bytes: &[u8], changes: TrackedChanges) -> MemorySink {
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("Changes.docx");
    std::fs::write(&path, bytes).expect("writes the file");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let options = WordImport {
        changes,
        ..WordImport::default()
    };
    import_docx_options(&path, &options, &world.env(), &mut sink).expect("imports");
    sink
}

#[test]
fn tracked_changes_can_be_accepted_or_rejected_on_import() {
    let suggested = summary(first_page(&import_bytes(&tracked())));
    let block = &suggested["blocks"][0];
    assert_eq!(
        block["markdown"],
        json!(
            r#"Kept <span data-ins="id1">new</span><span data-del="id2">old</span> <span data-fmt="id3">**word**</span>"#
        )
    );
    assert_eq!(
        block["suggestions"]["id3"],
        json!({"kind": "fmt", "author": "Ben", "time": "2026-10-03T08:00:00.000Z", "before": "*word*"})
    );
    let accepted = import_with(&tracked(), TrackedChanges::Accept);
    let (text, data) = &text_blocks(first_page(&accepted))[0];
    assert_eq!(text, "Kept new **word**");
    assert!(!data.extra.contains_key("suggestions"));
    let rejected = import_with(&tracked(), TrackedChanges::Reject);
    assert_eq!(text_blocks(first_page(&rejected))[0].0, "Kept old *word*");
}

#[test]
fn the_first_section_gives_the_paper_and_its_header_and_footer_become_bands() {
    let rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
        <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
        </Relationships>"#;
    let header = format!(
        r#"<w:hdr {W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Field notes</w:t></w:r></w:p></w:hdr>"#
    );
    let footer = format!(
        r#"<w:ftr {W}><w:p><w:r><w:tab/></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Page </w:t></w:r>
            <w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>"#
    );
    let body = format!(
        r#"<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
            <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
        <w:headerReference w:type="default" r:id="rId8" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <w:footerReference w:type="default" r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        </w:sectPr></w:pPr>{}</w:p>
        <w:p>{}</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>"#,
        run("First section"),
        run("Second section"),
    );
    let sink = import_bytes(&docx(
        &body,
        &[
            ("_rels/document.xml.rels", rels),
            ("header1.xml", &header),
            ("footer1.xml", &footer),
        ],
    ));
    let page = first_page(&sink);
    let summary = summary(page);
    // A4 is 11906 by 16838 twips: 793.73 by 1122.53 page units; 1134 twips are 75.6.
    assert_eq!(
        summary["paper"],
        json!({"size": "a4", "orientation": "portrait", "width": 793.73, "height": 1122.53, "margins": [75.6, 75.6, 75.6, 75.6]})
    );
    assert_eq!(
        summary["print"],
        json!({
            "header": {"left": "", "center": "Field notes", "right": ""},
            "footer": {"left": "", "center": "", "right": "Page {page}"}
        })
    );
}

#[test]
fn the_report_counts_what_came_over_and_what_was_dropped() {
    let world = TestEnv::new();
    let dir = tempfile::tempdir().expect("a temp folder");
    let path = dir.path().join("Report.docx");
    let body = format!(
        r#"<w:p><w:pPr><w:sectPr/></w:pPr>{}</w:p><w:p><w:r><w:rPr><w14:glow xmlns:w14="x" w14:rad="63500"/></w:rPr>
            <w:t>glowing</w:t></w:r></w:p><w:sectPr/>"#,
        run("One")
    );
    std::fs::write(&path, tracked_and(&body)).expect("writes the file");
    let mut sink = MemorySink::default();
    let report = crate::import_docx(&path, &world.env(), &mut sink).expect("imports");
    let text = report.to_markdown();
    for expected in [
        "section after the first",
        "run with glow, reflection, 3-D, or gradient text",
        "suggested change",
    ] {
        assert!(text.contains(expected), "the report names {expected:?}:\n{text}");
    }
}

fn tracked_and(body: &str) -> Vec<u8> {
    let extra =
        r#"<w:p><w:ins w:id="9" w:author="Ann" w:date="2026-10-01T09:30:00Z"><w:r><w:t>new</w:t></w:r></w:ins></w:p>"#;
    docx(&format!("{extra}{body}"), &[])
}

#[test]
fn formatting_stays_with_its_element_in_quotes_and_lists() {
    let styles = format!(
        r#"<w:styles {W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
        <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/></w:style>
        </w:styles>"#
    );
    let numbering = format!(
        r#"<w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>
            <w:lvlText w:val="-"/></w:lvl>
        <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/></w:lvl></w:abstractNum><w:num w:numId="1">
        <w:abstractNumId w:val="0"/></w:num></w:numbering>"#
    );
    let p = |ppr: &str, text: &str| format!("<w:p><w:pPr>{ppr}</w:pPr>{}</w:p>", run(text));
    let item = |lvl: u32, text: &str| {
        p(
            &format!(r#"<w:numPr><w:ilvl w:val="{lvl}"/><w:numId w:val="1"/></w:numPr><w:jc w:val="center"/>"#),
            text,
        )
    };
    let body = [
        p(r#"<w:pStyle w:val="Quote"/><w:jc w:val="right"/>"#, "Quoted one"),
        p(r#"<w:pStyle w:val="Quote"/>"#, "Quoted two"),
        item(1, "deep first"),
        item(0, "top"),
        p(r#"<w:jc w:val="both"/>"#, "After."),
    ]
    .concat();
    let sink = import_bytes(&docx(&body, &[("styles.xml", &styles), ("numbering.xml", &numbering)]));
    let summary = summary(first_page(&sink));
    let block = &summary["blocks"][0];
    assert_eq!(
        block["elements"],
        json!(5),
        "two quoted paragraphs, two items, and a paragraph"
    );
    let centered = json!({"align": "center", "list": {"id": "a0"}});
    assert_eq!(
        block["paras"],
        json!({"0": {"align": "end"}, "2": centered, "3": centered, "4": {"align": "justify"}})
    );
}
