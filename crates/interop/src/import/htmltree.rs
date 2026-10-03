//! A tolerant HTML reader: tags, text, and entities into the same tree that ENML uses.
//!
//! Real HTML is rarely well formed. Pages from OneNote, Notion, and browsers leave `<br>` and `<img>` open,
//! skip `</p>` and `</li>`, and put scripts in the head. This reader never fails: it closes what the HTML rules
//! close by themselves, drops scripts and styles, and turns what it cannot read into text.

use super::xmltree::{Element, Node};
use crate::doc::html_tags::decode_entities;

/// Elements that never have content.
const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
];

/// Elements whose text is not markup. Their content is dropped.
const RAW: &[&str] = &["script", "style", "textarea", "title", "noscript", "template"];

/// The open elements that a new tag closes first, as `tag: closes` pairs.
const AUTO_CLOSE: &[(&str, &[&str])] = &[
    ("li", &["li"]),
    ("dt", &["dt", "dd"]),
    ("dd", &["dt", "dd"]),
    ("tr", &["tr"]),
    ("td", &["td", "th"]),
    ("th", &["td", "th"]),
    ("option", &["option"]),
];

/// Block tags that end an open paragraph.
const ENDS_PARAGRAPH: &[&str] = &[
    "p",
    "div",
    "ul",
    "ol",
    "table",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "pre",
    "blockquote",
    "hr",
    "section",
    "article",
    "header",
    "footer",
    "aside",
    "details",
    "dl",
    "form",
    "figure",
];

/// What the head of a page says about it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Head {
    /// The text of `<title>`.
    pub title: String,
    /// The `<meta name=... content=...>` pairs, with lowercase names.
    pub meta: Vec<(String, String)>,
}

impl Head {
    /// The content of the first meta tag with this name.
    pub fn meta(&self, name: &str) -> Option<&str> {
        self.meta.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }
}

/// A parsed page: its head, and the root element holding the body.
#[derive(Clone, Debug, Default)]
pub struct HtmlDoc {
    /// The title and meta tags.
    pub head: Head,
    /// A `body` element, or a stand-in for HTML that has none.
    pub body: Element,
}

/// Reads HTML.
pub fn parse(html: &str) -> HtmlDoc {
    let mut builder = Builder::new();
    let mut at = 0;
    while at < html.len() {
        let rest = &html[at..];
        let Some(lt) = rest.find('<') else {
            builder.text(rest);
            break;
        };
        builder.text(&rest[..lt]);
        at += lt;
        at += builder.markup(&html[at..]);
    }
    builder.finish()
}

struct Builder {
    stack: Vec<Element>,
    head: Head,
    in_head: bool,
    /// Set once a tag ran to the end of the page without a `>`. No later tag can end either, so every later `<`
    /// is text, and the page is not scanned to its end once for each `<`.
    unended: bool,
}

impl Builder {
    fn new() -> Builder {
        Builder {
            stack: vec![Element {
                name: "body".to_owned(),
                ..Element::default()
            }],
            head: Head::default(),
            in_head: false,
            unended: false,
        }
    }

    fn text(&mut self, text: &str) {
        if text.is_empty() || self.in_head {
            return;
        }
        let decoded = decode_entities(text);
        if let Some(top) = self.stack.last_mut() {
            if let Some(Node::Text(last)) = top.children.last_mut() {
                last.push_str(&decoded);
            } else {
                top.children.push(Node::Text(decoded));
            }
        }
    }

    /// Handles the markup at the start of `rest` (which begins with `<`) and returns how many bytes it used.
    fn markup(&mut self, rest: &str) -> usize {
        if let Some(body) = rest.strip_prefix("<!--") {
            return 4 + body.find("-->").map_or(body.len(), |end| end + 3);
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            return rest.find('>').map_or(rest.len(), |end| end + 1);
        }
        if let Some(closing) = rest.strip_prefix("</") {
            let end = closing.find('>').map_or(closing.len(), |end| end + 1);
            let name = closing[..end].trim_end_matches('>').trim().to_ascii_lowercase();
            self.close_named(&name);
            return 2 + end;
        }
        let starts_tag = rest[1..].starts_with(|c: char| c.is_ascii_alphabetic());
        let end = if starts_tag && !self.unended {
            tag_end(rest)
        } else {
            None
        };
        match end {
            Some(end) => {
                let used = end + 1;
                match self.open(&rest[1..end]) {
                    Some(raw) => used + self.skip_raw(&rest[used..], &raw),
                    None => used,
                }
            }
            None => {
                self.unended |= starts_tag;
                self.text("<");
                1
            }
        }
    }

    /// Opens the tag whose inside (between `<` and `>`) is given. Returns the name of a raw-text element, whose
    /// content the caller skips.
    fn open(&mut self, inside: &str) -> Option<String> {
        let self_closing = inside.ends_with('/');
        let inside = inside.trim_end_matches('/');
        let name_end = inside.find(char::is_whitespace).unwrap_or(inside.len());
        let name = inside[..name_end].to_ascii_lowercase();
        let attrs = parse_attrs(&inside[name_end..]);
        match name.as_str() {
            "head" => self.in_head = true,
            "body" => self.in_head = false,
            "meta" => self.meta(&attrs),
            _ => {}
        }
        let raw = RAW.contains(&name.as_str());
        let structural = matches!(name.as_str(), "meta" | "html" | "head" | "body");
        if !raw && !structural && !self.in_head {
            self.push(name.clone(), attrs, self_closing);
        }
        (raw && !self_closing).then_some(name)
    }

    /// Skips the text of a script, style, or title element and returns its length. A title is kept.
    fn skip_raw(&mut self, after: &str, name: &str) -> usize {
        let end = find_close(after, name).unwrap_or(after.len());
        if name == "title" && self.head.title.is_empty() {
            let title = decode_entities(&after[..end]);
            self.head.title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        }
        end
    }

    fn meta(&mut self, attrs: &[(String, String)]) {
        let find = |key: &str| attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        if let (Some(name), Some(content)) = (find("name").or_else(|| find("property")), find("content")) {
            self.head.meta.push((name.to_lowercase(), content));
        }
    }

    fn push(&mut self, name: String, attrs: Vec<(String, String)>, self_closing: bool) {
        self.auto_close(&name);
        let element = Element {
            name: name.clone(),
            attrs,
            children: Vec::new(),
        };
        if self_closing || VOID.contains(&name.as_str()) || self.stack.len() > super::xmltree::MAX_DEPTH {
            if let Some(top) = self.stack.last_mut() {
                top.children.push(Node::Element(element));
            }
        } else {
            self.stack.push(element);
        }
    }

    /// Closes the open elements that the new tag implies the end of.
    fn auto_close(&mut self, name: &str) {
        if ENDS_PARAGRAPH.contains(&name) {
            self.close_open_if(&["p"], &["li", "td", "th", "blockquote", "div", "section", "article"]);
        }
        if let Some((_, closes)) = AUTO_CLOSE.iter().find(|(tag, _)| *tag == name) {
            let barrier: &[&str] = match name {
                "li" => &["ul", "ol"],
                "td" | "th" => &["tr", "table"],
                "tr" => &["table"],
                _ => &[],
            };
            self.close_open_if(closes, barrier);
        }
    }

    /// Closes the nearest open element in `names`, unless an element in `barrier` comes first.
    fn close_open_if(&mut self, names: &[&str], barrier: &[&str]) {
        let found = self
            .stack
            .iter()
            .rposition(|e| names.contains(&e.name.as_str()) || barrier.contains(&e.name.as_str()));
        if let Some(index) = found {
            if names.contains(&self.stack[index].name.as_str()) && index > 0 {
                while self.stack.len() > index {
                    self.pop();
                }
            }
        }
    }

    fn close_named(&mut self, name: &str) {
        if name == "head" {
            self.in_head = false;
        }
        if let Some(index) = self.stack.iter().rposition(|e| e.name == name) {
            if index > 0 {
                while self.stack.len() > index {
                    self.pop();
                }
            }
        }
    }

    fn pop(&mut self) {
        if self.stack.len() > 1 {
            if let Some(done) = self.stack.pop() {
                if let Some(top) = self.stack.last_mut() {
                    top.children.push(Node::Element(done));
                }
            }
        }
    }

    fn finish(mut self) -> HtmlDoc {
        while self.stack.len() > 1 {
            self.pop();
        }
        HtmlDoc {
            head: self.head,
            body: self.stack.pop().unwrap_or_default(),
        }
    }
}

/// Where `</name` starts in `text`, with the name compared without case. It searches the text in place, so a page
/// of many small scripts is not copied once for each.
fn find_close(text: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = text.get(from..)?.find("</") {
        let at = from + found;
        let tail = text.as_bytes().get(at + 2..at + 2 + name.len());
        if tail.is_some_and(|tail| tail.eq_ignore_ascii_case(name.as_bytes())) {
            return Some(at);
        }
        from = at + 2;
    }
    None
}

/// The index of the `>` that ends the tag at the start of `rest`, skipping any inside quoted attribute values.
fn tag_end(rest: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (at, c) in rest.char_indices().skip(1) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(at),
            (None, _) => {}
        }
    }
    None
}

/// Reads the attributes of a tag: `name`, `name=value`, `name="value"`, and `name='value'`.
fn parse_attrs(text: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let mut rest = text.trim_start();
    while !rest.is_empty() {
        let name_end = rest.find(|c: char| c == '=' || c.is_whitespace()).unwrap_or(rest.len());
        let name = rest[..name_end].to_ascii_lowercase();
        rest = rest[name_end..].trim_start();
        let mut value = String::new();
        if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            let (raw, remainder) = match after.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let inner = &after[1..];
                    match inner.find(q) {
                        Some(end) => (&inner[..end], &inner[end + 1..]),
                        None => (inner, ""),
                    }
                }
                _ => {
                    let end = after.find(char::is_whitespace).unwrap_or(after.len());
                    (&after[..end], &after[end..])
                }
            };
            value = decode_entities(raw);
            rest = remainder;
        }
        if !name.is_empty() {
            attrs.push((name, value));
        }
        rest = rest.trim_start();
    }
    attrs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs `job` and checks that it took well under the time a scan per `<` would take.
    fn quickly<T>(job: impl FnOnce() -> T) -> T {
        let started = std::time::Instant::now();
        let out = job();
        assert!(
            started.elapsed() < std::time::Duration::from_secs(3),
            "{:?}",
            started.elapsed()
        );
        out
    }

    #[test]
    fn hostile_pages_are_read_in_one_pass() {
        let unended = quickly(|| parse(&"<a".repeat(50_000)));
        assert_eq!(text_of(&unended.body).len(), 100_000);
        let far = quickly(|| parse(&format!("{}>", "< ".repeat(50_000))));
        assert!(text_of(&far.body).ends_with("< >"));
        let scripts = quickly(|| parse(&format!("{}<p>kept</p>", "<SCRIPT>x</script>".repeat(50_000))));
        assert_eq!(text_of(&scripts.body), "<p>kept</p>");
        let title = parse("<title>A <b>page</b></TITLE><p>x</p>");
        assert_eq!(title.head.title, "A <b>page</b>");
    }

    fn text_of(element: &Element) -> String {
        element
            .children
            .iter()
            .map(|n| match n {
                Node::Text(t) => t.clone(),
                Node::Element(e) => format!("<{}>{}</{}>", e.name, text_of(e), e.name),
            })
            .collect()
    }

    #[test]
    fn void_tags_and_unclosed_paragraphs_and_items_close_themselves() {
        let doc = parse("<p>one<br>two<p>three<ul><li>a<li>b</ul><img src=x.png>");
        assert_eq!(
            text_of(&doc.body),
            "<p>one<br></br>two</p><p>three</p><ul><li>a</li><li>b</li></ul><img></img>"
        );
    }

    #[test]
    fn the_head_gives_a_title_and_meta_and_scripts_are_dropped() {
        let doc = parse(
            "<!doctype html><html><head><title> My  page &amp; more </title>\
             <meta name=\"Keywords\" content=\"a, b\"><script>if (a<b) {}</script>\
             <style>p{}</style></head><body><p>Hi</p><script>x</script></body></html>",
        );
        assert_eq!(doc.head.title, "My page & more");
        assert_eq!(doc.head.meta("keywords"), Some("a, b"));
        assert_eq!(text_of(&doc.body), "<p>Hi</p>");
    }

    #[test]
    fn attributes_may_be_bare_single_quoted_or_hold_a_greater_than_sign() {
        let doc = parse("<a href='x.html?a=1&amp;b=2' title=\"1 > 0\" download>go</a>");
        let Node::Element(a) = &doc.body.children[0] else {
            panic!("an element");
        };
        assert_eq!(a.attr("href"), Some("x.html?a=1&b=2"));
        assert_eq!(a.attr("title"), Some("1 > 0"));
        assert_eq!(a.attr("download"), Some(""));
    }

    #[test]
    fn table_cells_and_rows_close_each_other() {
        let doc = parse("<table><tr><td>1<td>2<tr><td>3</table>");
        assert_eq!(
            text_of(&doc.body),
            "<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>"
        );
    }

    #[test]
    fn absurd_nesting_is_flattened_instead_of_overflowing_the_stack() {
        let deep = format!("{}x{}", "<div>".repeat(50_000), "</div>".repeat(50_000));
        let doc = parse(&deep);
        let mut depth = 0;
        let mut node = &doc.body;
        while let Some(Node::Element(next)) = node.children.first() {
            node = next;
            depth += 1;
        }
        assert!(depth <= super::super::xmltree::MAX_DEPTH + 1, "{depth}");
    }

    #[test]
    fn stray_less_than_signs_and_unknown_end_tags_are_text_and_noise() {
        let doc = parse("a < b </nonsense> and 1<2");
        assert_eq!(text_of(&doc.body), "a < b  and 1<2");
    }
}
