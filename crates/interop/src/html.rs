//! Writing the document tree as HTML, for the HTML export.

use opennote_core::Timestamp;

use crate::dest;
use crate::doc::{Block, Fold, Inline, Marks, Script};
use crate::palette::pen_hex;

const STYLE: &str = "\
body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui,sans-serif;color:#2B2521}\
img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #c9c2b8;padding:.3rem .6rem}\
blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #c9c2b8}\
pre{overflow:auto;padding:.75rem;background:#f4f0ea}\
.callout{padding:.5rem 1rem;border-left:3px solid #2F4F9A;background:#f4f0ea}.callout-title{font-weight:600}\
mark{background:#FAECB7}mark[data-color=mint]{background:#D2EFDB}mark[data-color=rose]{background:#F9D9E3}\
mark[data-color=apricot]{background:#FBE2CA}mark[data-color=lilac]{background:#E8E0F9}\
[data-size=small]{font-size:.85em}[data-size=large]{font-size:1.25em}[data-size=xlarge]{font-size:1.6em}\
li.task{list-style:none;margin-left:-1.2rem}";

/// What the head of an exported page says besides its title, so an import can read it back.
#[derive(Clone, Copy, Debug, Default)]
pub struct Meta<'a> {
    /// When the page was created.
    pub created: Option<Timestamp>,
    /// When the page last changed.
    pub modified: Option<Timestamp>,
    /// The page's tags.
    pub tags: &'a [String],
    /// Whether the document is the index of an export, which an import skips.
    pub index: bool,
}

impl Meta<'_> {
    fn tags_html(&self) -> String {
        let mut out = String::new();
        if let Some(created) = self.created {
            out.push_str(&meta_tag("opennote:created", &created.to_rfc3339()));
        }
        if let Some(modified) = self.modified {
            out.push_str(&meta_tag("opennote:updated", &modified.to_rfc3339()));
        }
        if !self.tags.is_empty() {
            out.push_str(&meta_tag("keywords", &self.tags.join(", ")));
        }
        for tag in self.tags {
            out.push_str(&meta_tag("opennote:tag", tag));
        }
        if self.index {
            out.push_str(&meta_tag("opennote:index", "1"));
        }
        out
    }
}

fn meta_tag(name: &str, content: &str) -> String {
    format!("<meta name=\"{name}\" content=\"{}\">\n", escape(content))
}

/// A whole HTML document around a page's body.
pub fn page_document(title: &str, meta: &Meta<'_>, body: &str) -> String {
    let title = escape(title);
    let meta = meta.tags_html();
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <meta name=\"generator\" content=\"OpenNote\">\n{meta}\
         <title>{title}</title>\n<style>{STYLE}</style>\n</head>\n<body>\n<h1>{title}</h1>\n{body}</body>\n</html>\n"
    )
}

/// One page of a single-file export: where its section starts, its title, how deep it sits, and its body.
pub struct SinglePage {
    /// The anchor that links to the page point at, without `#`.
    pub anchor: String,
    /// The page title.
    pub title: String,
    /// How deep the page sits among subpages, from 0.
    pub level: u8,
    /// The page body as HTML.
    pub body: String,
}

/// One document that holds several pages, with a list of contents at the top.
pub fn bundle_document(title: &str, pages: &[SinglePage]) -> String {
    let mut body = String::from("<nav>\n<ul>\n");
    for page in pages {
        let indent = "&nbsp;".repeat(usize::from(page.level) * 4);
        body.push_str(&format!(
            "<li>{indent}<a href=\"#{}\">{}</a></li>\n",
            escape(&page.anchor),
            escape(&page.title)
        ));
    }
    body.push_str("</ul>\n</nav>\n");
    for page in pages {
        body.push_str(&format!(
            "<section id=\"{}\">\n<h2>{}</h2>\n{}</section>\n",
            escape(&page.anchor),
            escape(&page.title),
            page.body
        ));
    }
    page_document(title, &Meta::default(), &body)
}

/// An index page that links to the exported pages. Each entry is a path, a title, and a depth.
pub fn index_document(title: &str, entries: &[(String, String, u8)]) -> String {
    let mut body = String::from("<ul>\n");
    for (path, name, level) in entries {
        let indent = "&nbsp;".repeat(usize::from(*level) * 4);
        body.push_str(&format!(
            "<li>{indent}<a href=\"{}\">{}</a></li>\n",
            escape(&encode_path(path)),
            escape(name)
        ));
    }
    body.push_str("</ul>\n");
    let meta = Meta {
        index: true,
        ..Meta::default()
    };
    page_document(title, &meta, &body)
}

/// Writes blocks as HTML.
pub fn blocks_to_html(blocks: &[Block]) -> String {
    blocks.iter().map(block_html).collect()
}

fn block_html(block: &Block) -> String {
    match block {
        Block::Paragraph(content) => format!("<p>{}</p>\n", inlines_html(content)),
        Block::Heading { level, content } => {
            let level = (*level).clamp(1, 6) + 1;
            let level = level.min(6);
            format!("<h{level}>{}</h{level}>\n", inlines_html(content))
        }
        Block::List { ordered, start, items } => list_html(*ordered, *start, items),
        Block::Quote(blocks) => format!("<blockquote>\n{}</blockquote>\n", blocks_to_html(blocks)),
        Block::Callout {
            kind,
            fold,
            title,
            blocks,
        } => callout_html(kind, *fold, title, blocks),
        Block::Code { language, text } => {
            let class = if language.is_empty() {
                String::new()
            } else {
                format!(" class=\"language-{}\"", escape(language))
            };
            format!("<pre><code{class}>{}</code></pre>\n", escape(text))
        }
        Block::Break => "<hr>\n".to_owned(),
        Block::Table { header, rows } => table_html(*header, rows),
    }
}

fn list_html(ordered: bool, start: u64, items: &[crate::doc::Item]) -> String {
    let (open, close) = match (ordered, start) {
        (false, _) => ("<ul>".to_owned(), "</ul>"),
        (true, 1) => ("<ol>".to_owned(), "</ol>"),
        (true, n) => (format!("<ol start=\"{n}\">"), "</ol>"),
    };
    let mut out = format!("{open}\n");
    for item in items {
        let class = if item.task.is_some() { " class=\"task\"" } else { "" };
        let check = match item.task {
            Some(true) => "<input type=\"checkbox\" checked disabled> ",
            Some(false) => "<input type=\"checkbox\" disabled> ",
            None => "",
        };
        let body = match item.blocks.as_slice() {
            [Block::Paragraph(content)] => inlines_html(content),
            blocks => format!("\n{}", blocks_to_html(blocks)),
        };
        out.push_str(&format!("<li{class}>{check}{body}</li>\n"));
    }
    out.push_str(close);
    out.push('\n');
    out
}

fn callout_html(kind: &str, fold: Option<Fold>, title: &[Inline], blocks: &[Block]) -> String {
    let title = if title.is_empty() {
        escape(&kind.to_uppercase())
    } else {
        inlines_html(title)
    };
    let body = blocks_to_html(blocks);
    let kind = escape(kind);
    match fold {
        Some(fold) => {
            let open = if fold == Fold::Open { " open" } else { "" };
            format!(
                "<details class=\"callout\" data-kind=\"{kind}\"{open}>\n\
                 <summary class=\"callout-title\">{title}</summary>\n{body}</details>\n"
            )
        }
        None => format!(
            "<aside class=\"callout\" data-kind=\"{kind}\">\n<p class=\"callout-title\">{title}</p>\n{body}</aside>\n"
        ),
    }
}

fn table_html(header: bool, rows: &[Vec<Vec<Inline>>]) -> String {
    let mut out = String::from("<table>\n");
    for (i, row) in rows.iter().enumerate() {
        let tag = if header && i == 0 { "th" } else { "td" };
        out.push_str("<tr>");
        for cell in row {
            out.push_str(&format!("<{tag}>{}</{tag}>", inlines_html(cell)));
        }
        out.push_str("</tr>\n");
    }
    out.push_str("</table>\n");
    out
}

/// Writes inlines as HTML. Each run carries its own tags, so runs with different marks never overlap.
pub fn inlines_html(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, marks } => out.push_str(&run_html(text, marks)),
            Inline::HardBreak => out.push_str("<br>\n"),
            Inline::SoftBreak => out.push(' '),
            Inline::Image { dest, alt } => match safe_dest(dest).or_else(|| image_data(dest)) {
                Some(src) => out.push_str(&format!(
                    "<img src=\"{}\" alt=\"{}\">",
                    escape(&encode_path(&src)),
                    escape(alt)
                )),
                None => out.push_str(&escape(alt)),
            },
        }
    }
    out
}

fn run_html(text: &str, marks: &Marks) -> String {
    let mut html = escape(text);
    let mut wrap = |open: String, close: &str| html = format!("{open}{html}{close}");
    if marks.code {
        wrap("<code>".to_owned(), "</code>");
    }
    match marks.script {
        Some(Script::Sub) => wrap("<sub>".to_owned(), "</sub>"),
        Some(Script::Sup) => wrap("<sup>".to_owned(), "</sup>"),
        None => {}
    }
    if let Some(size) = &marks.size {
        wrap(format!("<span data-size=\"{}\">", escape(size)), "</span>");
    }
    if let Some(color) = &marks.color {
        let style = pen_hex(color).map_or(String::new(), |hex| format!(" style=\"color:#{hex}\""));
        wrap(format!("<span data-color=\"{}\"{style}>", escape(color)), "</span>");
    }
    if let Some(name) = &marks.highlight {
        wrap(format!("<mark data-color=\"{}\">", escape(name)), "</mark>");
    }
    for (on, open, close) in [
        (marks.underline, "<u>", "</u>"),
        (marks.strike, "<del>", "</del>"),
        (marks.emphasis, "<em>", "</em>"),
        (marks.strong, "<strong>", "</strong>"),
    ] {
        if on {
            wrap(open.to_owned(), close);
        }
    }
    if let Some(dest) = marks.link.as_deref().and_then(safe_dest) {
        wrap(format!("<a href=\"{}\">", escape(&encode_path(&dest))), "</a>");
    }
    html
}

/// Escapes text for HTML.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// A link or image source as it may go into the page (see [`dest::for_export`]): a web or email address, or a
/// path. Any other destination, `javascript:` among them, keeps only its text.
fn safe_dest(dest: &str) -> Option<String> {
    dest::for_export(dest)
}

/// A picture embedded in the page, such as `data:image/png;base64,...`, cleaned as [`safe_dest`] cleans it.
/// Browsers do not run scripts in pictures, so these are safe as the source of an image, but never as a link.
fn image_data(dest: &str) -> Option<String> {
    let cleaned = dest::clean(dest);
    let lower = cleaned.get(..32).unwrap_or(&cleaned).to_ascii_lowercase();
    let is_image = ["png", "jpeg", "gif", "webp", "bmp", "svg+xml"]
        .iter()
        .any(|kind| lower.starts_with(&format!("data:image/{kind};base64,")));
    (is_image && !dest::has_control(&cleaned)).then_some(cleaned)
}

/// Percent-encodes the characters of a relative path that a URL cannot hold. Links with a scheme stay as they are.
fn encode_path(dest: &str) -> String {
    if dest::scheme(dest).is_some() || dest.starts_with('#') {
        return dest.to_owned();
    }
    let mut out = String::with_capacity(dest.len());
    for c in dest.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '%' => out.push_str("%25"),
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_safe_links_and_images_are_written() {
        let evil = Marks::link("javascript:alert(1)");
        let web = Marks::link("https://example.org/a");
        let html = inlines_html(&[
            Inline::marked("click", evil),
            Inline::text(" "),
            Inline::marked("site", web),
            Inline::Image {
                dest: "javascript:x".to_owned(),
                alt: "pic".to_owned(),
            },
        ]);
        assert_eq!(html, "click <a href=\"https://example.org/a\">site</a>pic");
    }

    #[test]
    fn hidden_script_schemes_are_refused() {
        for dest in [
            "java\tscript:alert(1)",
            "java\nscript:alert(1)",
            "\u{1}javascript:alert(1)",
            " \u{0}javascript:alert(1)",
            "JaVaScRiPt:alert(1)",
            "vbscript:x",
            "data:text/html,<script>x</script>",
            "https://example.org/\u{7}x",
            "java script:x",
        ] {
            let html = inlines_html(&[Inline::marked("x", Marks::link(dest))]);
            assert_eq!(html, "x", "{dest:?}");
            let image = inlines_html(&[Inline::Image {
                dest: dest.to_owned(),
                alt: "pic".to_owned(),
            }]);
            assert_eq!(image, "pic", "{dest:?}");
        }
    }

    #[test]
    fn web_addresses_and_paths_are_kept_whatever_their_case() {
        let html = inlines_html(&[
            Inline::marked("a", Marks::link("HTTPS://example.org/a")),
            Inline::marked("b", Marks::link(" Mailto:sam@example.org")),
            Inline::marked("c", Marks::link("pages/a b:c.html")),
        ]);
        let expected = [
            "<a href=\"HTTPS://example.org/a\">a</a>",
            "<a href=\"Mailto:sam@example.org\">b</a>",
            "<a href=\"pages/a%20b:c.html\">c</a>",
        ];
        assert_eq!(html, expected.concat());
    }
}
