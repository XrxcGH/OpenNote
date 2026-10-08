//! The fixed parts of a Word file: content types, relationships, styles, numbering, and document properties.

use std::collections::BTreeSet;

use opennote_core::Timestamp;

pub const XML_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
pub const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

/// Escapes text for XML, and drops the control characters that XML 1.0 forbids.
pub fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if c < ' ' && !matches!(c, '\t' | '\n' | '\r') => {}
            '\u{fffe}' | '\u{ffff}' => {}
            c => out.push(c),
        }
    }
    out
}

/// `[Content_Types].xml`, with a default for each image extension in the file.
pub fn content_types(image_extensions: &BTreeSet<String>) -> String {
    let mut out = format!("{XML_HEADER}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">");
    out.push_str(
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
    );
    out.push_str("<Default Extension=\"xml\" ContentType=\"application/xml\"/>");
    for ext in image_extensions {
        let mime = if ext == "jpg" || ext == "jpeg" {
            "jpeg".to_owned()
        } else {
            ext.clone()
        };
        out.push_str(&format!("<Default Extension=\"{ext}\" ContentType=\"image/{mime}\"/>"));
    }
    let word = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    out.push_str(&format!(
        "<Override PartName=\"/word/document.xml\" ContentType=\"{word}.document.main+xml\"/>"
    ));
    out.push_str(&format!(
        "<Override PartName=\"/word/styles.xml\" ContentType=\"{word}.styles+xml\"/>"
    ));
    out.push_str(&format!(
        "<Override PartName=\"/word/numbering.xml\" ContentType=\"{word}.numbering+xml\"/>"
    ));
    let core = "application/vnd.openxmlformats-package.core-properties+xml";
    out.push_str(&format!(
        "<Override PartName=\"/docProps/core.xml\" ContentType=\"{core}\"/>"
    ));
    out.push_str("</Types>");
    out
}

/// `_rels/.rels`: where the document and its properties are.
pub fn root_rels() -> String {
    format!(
        "{XML_HEADER}<Relationships xmlns=\"{NS_REL}\">\
         <Relationship Id=\"rId1\" Type=\"{NS_R}/officeDocument\" Target=\"word/document.xml\"/>\
         <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
         </Relationships>"
    )
}

/// `word/_rels/document.xml.rels`: the styles, the numbering, and each link and image of the body.
pub fn document_rels(extra: &[String]) -> String {
    let mut out = format!("{XML_HEADER}<Relationships xmlns=\"{NS_REL}\">");
    out.push_str(&format!(
        "<Relationship Id=\"rId1\" Type=\"{NS_R}/styles\" Target=\"styles.xml\"/>"
    ));
    out.push_str(&format!(
        "<Relationship Id=\"rId2\" Type=\"{NS_R}/numbering\" Target=\"numbering.xml\"/>"
    ));
    for relationship in extra {
        out.push_str(relationship);
    }
    out.push_str("</Relationships>");
    out
}

/// `docProps/core.xml`: the title and the dates of the document.
pub fn core_props(title: &str, created: Timestamp, modified: Timestamp) -> String {
    let date = |t: Timestamp| t.to_rfc3339().replace(".000Z", "Z");
    format!(
        "{XML_HEADER}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" \
         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>{}</dc:title>\
         <dcterms:created xsi:type=\"dcterms:W3CDTF\">{}</dcterms:created>\
         <dcterms:modified xsi:type=\"dcterms:W3CDTF\">{}</dcterms:modified></cp:coreProperties>",
        xml_escape(title),
        date(created),
        date(modified)
    )
}

fn style(id: &str, name: &str, based_on: &str, ppr: &str, rpr: &str) -> String {
    let based = if based_on.is_empty() {
        String::new()
    } else {
        format!("<w:basedOn w:val=\"{based_on}\"/>")
    };
    let next = if id.starts_with("Heading") || id == "Title" {
        "<w:next w:val=\"Normal\"/>"
    } else {
        ""
    };
    format!(
        "<w:style w:type=\"paragraph\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/>{based}{next}<w:qFormat/>\
         <w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>"
    )
}

/// `word/styles.xml`: Normal, Title, Subtitle, Heading 1 to 6, Quote, Code, and Hyperlink.
pub fn styles() -> String {
    let mut out = format!("{XML_HEADER}<w:styles xmlns:w=\"{NS_W}\">");
    out.push_str(concat!(
        "<w:docDefaults><w:rPrDefault><w:rPr>",
        "<w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>",
        "<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/><w:lang w:val=\"en-US\"/></w:rPr></w:rPrDefault>",
        "<w:pPrDefault><w:pPr>",
        "<w:spacing w:after=\"160\" w:line=\"264\" w:lineRule=\"auto\"/>",
        "</w:pPr></w:pPrDefault></w:docDefaults>",
        "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\">",
        "<w:name w:val=\"Normal\"/><w:qFormat/></w:style>",
    ));
    out.push_str(&heading_styles());
    out.push_str(&block_styles());
    out.push_str(concat!(
        "<w:style w:type=\"character\" w:styleId=\"Hyperlink\"><w:name w:val=\"Hyperlink\"/>",
        "<w:rPr><w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/></w:rPr></w:style></w:styles>"
    ));
    out
}

/// The Title, Subtitle, and Heading 1 to 6 styles.
fn heading_styles() -> String {
    let title_space = "<w:spacing w:before=\"240\" w:after=\"120\"/>";
    let mut out = style("Title", "Title", "Normal", title_space, "<w:b/><w:sz w:val=\"48\"/>");
    let subtitle_run = "<w:color w:val=\"6E4B2E\"/><w:sz w:val=\"28\"/>";
    out.push_str(&style("Subtitle", "Subtitle", "Normal", "", subtitle_run));
    for level in 1..=6u32 {
        let size = 36 - level * 3;
        let ppr = format!(
            "<w:keepNext/><w:spacing w:before=\"240\" w:after=\"80\"/><w:outlineLvl w:val=\"{}\"/>",
            level - 1
        );
        let rpr = format!("<w:b/><w:sz w:val=\"{size}\"/>");
        let (id, name) = (format!("Heading{level}"), format!("heading {level}"));
        out.push_str(&style(&id, &name, "Normal", &ppr, &rpr));
    }
    out
}

/// The Quote, Code, and List Paragraph styles.
fn block_styles() -> String {
    let quote_ppr = concat!(
        "<w:pBdr><w:left w:val=\"single\" w:sz=\"18\" w:space=\"8\" w:color=\"C9C2B8\"/></w:pBdr>",
        "<w:ind w:left=\"567\"/>"
    );
    let mut out = style("Quote", "Quote", "Normal", quote_ppr, "<w:i/>");
    let code_ppr = concat!(
        "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F4F0EA\"/>",
        "<w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/>"
    );
    let code_rpr = "<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\" w:cs=\"Consolas\"/><w:sz w:val=\"20\"/>";
    out.push_str(&style("Code", "Code", "Normal", code_ppr, code_rpr));
    let list_ppr = "<w:spacing w:after=\"60\"/>";
    out.push_str(&style("ListParagraph", "List Paragraph", "Normal", list_ppr, ""));
    out
}

/// `word/numbering.xml`: bullets, and one numbered list for each `(level, start)` the body used.
pub fn numbering(ordered: &[(u32, u64)]) -> String {
    let mut out = format!("{XML_HEADER}<w:numbering xmlns:w=\"{NS_W}\">");
    out.push_str(&abstract_num(0, "bullet", "\u{2022}"));
    out.push_str(&abstract_num(1, "decimal", "%"));
    out.push_str("<w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num>");
    for (i, (level, start)) in ordered.iter().enumerate() {
        out.push_str(&format!(
            "<w:num w:numId=\"{}\"><w:abstractNumId w:val=\"1\"/><w:lvlOverride w:ilvl=\"{level}\">\
             <w:startOverride w:val=\"{start}\"/></w:lvlOverride></w:num>",
            i + 2
        ));
    }
    out.push_str("</w:numbering>");
    out
}

/// A list definition with nine levels. `marker` is the bullet character, or `%` for `%1.`, `%2.`, and so on.
fn abstract_num(id: u32, format: &str, marker: &str) -> String {
    let mut out = format!("<w:abstractNum w:abstractNumId=\"{id}\"><w:multiLevelType w:val=\"hybridMultilevel\"/>");
    for level in 0..9u32 {
        let text = if marker == "%" {
            format!("%{}.", level + 1)
        } else {
            marker.to_owned()
        };
        let left = 720 * (level + 1);
        out.push_str(&format!(
            "<w:lvl w:ilvl=\"{level}\"><w:start w:val=\"1\"/><w:numFmt w:val=\"{format}\"/>\
             <w:lvlText w:val=\"{text}\"/>\
             <w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{left}\" w:hanging=\"360\"/></w:pPr></w:lvl>"
        ));
    }
    out.push_str("</w:abstractNum>");
    out
}
