//! The package parts of a Word file: content types, relationships, settings, notes, comments, and document
//! properties.

use std::collections::BTreeSet;

use opennote_core::Timestamp;

pub const XML_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
pub const NS_W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/// The namespaces of Word 2010 and 2012 extensions, which readers that lack them ignore (`mc:Ignorable`).
pub const NS_EXTENSIONS: &str = "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" \
     xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" \
     xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\"";
pub const NS_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

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

/// The optional parts a file has.
#[derive(Debug, Default)]
pub struct Extras {
    /// `footnotes.xml`.
    pub footnotes: bool,
    /// `endnotes.xml`.
    pub endnotes: bool,
    /// `comments.xml` and `commentsExtended.xml`.
    pub comments: bool,
    /// The header and footer parts: file name and kind.
    pub headers: Vec<(String, &'static str)>,
    /// Embedded fonts under `word/fonts/`.
    pub fonts: bool,
}

const WORD: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml";

/// `[Content_Types].xml`, with a default for each image extension in the file.
pub fn content_types(image_extensions: &BTreeSet<String>, extras: &Extras) -> String {
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
    if extras.fonts {
        out.push_str(
            "<Default Extension=\"odttf\" \
             ContentType=\"application/vnd.openxmlformats-officedocument.obfuscatedFont\"/>",
        );
    }
    let mut parts: Vec<(String, String)> = vec![
        ("/word/document.xml".into(), format!("{WORD}.document.main+xml")),
        ("/word/styles.xml".into(), format!("{WORD}.styles+xml")),
        ("/word/numbering.xml".into(), format!("{WORD}.numbering+xml")),
        ("/word/settings.xml".into(), format!("{WORD}.settings+xml")),
        ("/word/fontTable.xml".into(), format!("{WORD}.fontTable+xml")),
        (
            "/word/theme/theme1.xml".into(),
            "application/vnd.openxmlformats-officedocument.theme+xml".into(),
        ),
    ];
    if extras.footnotes {
        parts.push(("/word/footnotes.xml".into(), format!("{WORD}.footnotes+xml")));
    }
    if extras.endnotes {
        parts.push(("/word/endnotes.xml".into(), format!("{WORD}.endnotes+xml")));
    }
    if extras.comments {
        parts.push(("/word/comments.xml".into(), format!("{WORD}.comments+xml")));
        parts.push((
            "/word/commentsExtended.xml".into(),
            format!("{WORD}.commentsExtended+xml"),
        ));
    }
    for (name, kind) in &extras.headers {
        parts.push((format!("/word/{name}"), format!("{WORD}.{kind}+xml")));
    }
    parts.push((
        "/docProps/core.xml".into(),
        "application/vnd.openxmlformats-package.core-properties+xml".into(),
    ));
    for (name, kind) in parts {
        out.push_str(&format!("<Override PartName=\"{name}\" ContentType=\"{kind}\"/>"));
    }
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

/// A relationships part with these relationships.
pub fn rels_xml(relationships: &str) -> String {
    format!("{XML_HEADER}<Relationships xmlns=\"{NS_REL}\">{relationships}</Relationships>")
}

/// `word/_rels/document.xml.rels`: the fixed parts, and each link, image, header, and footer of the body.
pub fn document_rels(extra: &[String], extras: &Extras) -> String {
    let mut out = String::new();
    let mut fixed = vec![
        ("rId1", "styles", "styles.xml"),
        ("rId2", "numbering", "numbering.xml"),
        ("rId3", "settings", "settings.xml"),
        ("rId4", "fontTable", "fontTable.xml"),
        ("rId5", "theme", "theme/theme1.xml"),
    ];
    if extras.footnotes {
        fixed.push(("rId6", "footnotes", "footnotes.xml"));
    }
    if extras.endnotes {
        fixed.push(("rId7", "endnotes", "endnotes.xml"));
    }
    if extras.comments {
        fixed.push(("rId8", "comments", "comments.xml"));
    }
    for (id, kind, target) in fixed {
        out.push_str(&format!(
            "<Relationship Id=\"{id}\" Type=\"{NS_R}/{kind}\" Target=\"{target}\"/>"
        ));
    }
    if extras.comments {
        out.push_str(
            "<Relationship Id=\"rId9\" Type=\"http://schemas.microsoft.com/office/2011/relationships/commentsExtended\" \
             Target=\"commentsExtended.xml\"/>",
        );
    }
    for relationship in extra {
        out.push_str(relationship);
    }
    rels_xml(&out)
}

/// `docProps/core.xml`: the title and the dates of the document. Without dates, only the title.
pub fn core_props(title: &str, created: Option<Timestamp>, modified: Option<Timestamp>) -> String {
    let date = |t: Timestamp| t.to_rfc3339().replace(".000Z", "Z");
    let mut out = format!(
        "{XML_HEADER}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" \
         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><dc:title>{}</dc:title>",
        xml_escape(title)
    );
    if let Some(created) = created {
        out.push_str(&format!(
            "<dcterms:created xsi:type=\"dcterms:W3CDTF\">{}</dcterms:created>",
            date(created)
        ));
    }
    if let Some(modified) = modified {
        out.push_str(&format!(
            "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">{}</dcterms:modified>",
            date(modified)
        ));
    }
    out.push_str("</cp:coreProperties>");
    out
}

/// `word/settings.xml`: privacy, embedding, tabs, hyphenation, the note separators, and the theme's color
/// mapping, in the order of `CT_Settings`.
pub fn settings_xml(setup: &super::Setup, extras: &Extras) -> String {
    let mut out = format!("{XML_HEADER}<w:settings xmlns:w=\"{NS_W}\">");
    if setup.options.remove_personal {
        out.push_str("<w:removePersonalInformation/><w:removeDateAndTime/>");
    }
    if extras.fonts {
        out.push_str("<w:embedTrueTypeFonts/>");
    }
    let tab = setup.text.default_tab.unwrap_or(36.0);
    out.push_str(&format!("<w:defaultTabStop w:val=\"{}\"/>", super::units::twips(tab)));
    if setup.text.hyphenate == Some(true) {
        out.push_str("<w:autoHyphenation/>");
    }
    if extras.footnotes {
        out.push_str("<w:footnotePr><w:footnote w:id=\"-1\"/><w:footnote w:id=\"0\"/></w:footnotePr>");
    }
    if extras.endnotes {
        out.push_str("<w:endnotePr><w:endnote w:id=\"-1\"/><w:endnote w:id=\"0\"/></w:endnotePr>");
    }
    out.push_str(
        "<w:clrSchemeMapping w:bg1=\"light1\" w:t1=\"dark1\" w:bg2=\"light2\" w:t2=\"dark2\" \
         w:accent1=\"accent1\" w:accent2=\"accent2\" w:accent3=\"accent3\" w:accent4=\"accent4\" \
         w:accent5=\"accent5\" w:accent6=\"accent6\" w:hyperlink=\"hyperlink\" \
         w:followedHyperlink=\"followedHyperlink\"/>",
    );
    out.push_str("</w:settings>");
    out
}

/// `word/footnotes.xml` or `word/endnotes.xml`: the separators, then the notes.
pub fn notes_xml(kind: &str, notes: &[String]) -> String {
    let root = format!("{kind}s");
    let mut out =
        format!("{XML_HEADER}<w:{root} xmlns:w=\"{NS_W}\" xmlns:r=\"{NS_R}\" {NS_EXTENSIONS} mc:Ignorable=\"w14\">");
    let spacing = "<w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/></w:pPr>";
    out.push_str(&format!(
        "<w:{kind} w:type=\"separator\" w:id=\"-1\"><w:p>{spacing}<w:r><w:separator/></w:r></w:p></w:{kind}>\
         <w:{kind} w:type=\"continuationSeparator\" w:id=\"0\"><w:p>{spacing}<w:r><w:continuationSeparator/></w:r>\
         </w:p></w:{kind}>"
    ));
    for note in notes {
        out.push_str(note);
    }
    out.push_str(&format!("</w:{root}>"));
    out
}

/// `word/comments.xml`.
pub fn comments_xml(comments: &[String]) -> String {
    let mut out =
        format!("{XML_HEADER}<w:comments xmlns:w=\"{NS_W}\" xmlns:r=\"{NS_R}\" {NS_EXTENSIONS} mc:Ignorable=\"w14\">");
    for comment in comments {
        out.push_str(comment);
    }
    out.push_str("</w:comments>");
    out
}

/// `word/commentsExtended.xml`: which comments are replies, and which are resolved.
pub fn comments_ex_xml(entries: &[String]) -> String {
    let mut out = format!("{XML_HEADER}<w15:commentsEx {NS_EXTENSIONS} mc:Ignorable=\"w14 w15\">");
    for entry in entries {
        out.push_str(entry);
    }
    out.push_str("</w15:commentsEx>");
    out
}
