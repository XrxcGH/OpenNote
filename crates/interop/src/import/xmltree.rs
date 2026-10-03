//! A small tolerant XML reader for the ENML inside an Evernote note: a tree of elements and text.
//!
//! ENML is XHTML, and other tools write it loosely: HTML entities such as `&nbsp;`, and sometimes a stray `&`.
//! The reader accepts all of that, and never fails: what it cannot read becomes text.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

use crate::doc::html_tags::decode_entities;

/// A node of the tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    /// Text, with entities decoded.
    Text(String),
    /// An element.
    Element(Element),
}

/// An element with its attributes and children.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Element {
    /// The lowercase tag name.
    pub name: String,
    /// The attributes, with lowercase names and decoded values.
    pub attrs: Vec<(String, String)>,
    /// The children, in order.
    pub children: Vec<Node>,
}

impl Element {
    /// The value of an attribute.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// How deep elements nest before the reader stops nesting them. A file that nests further is hostile or broken,
/// and a tree that deep would overflow the stack when it is dropped or walked.
pub const MAX_DEPTH: usize = 256;

/// How many elements the reader builds before it stops. Each costs a name and two lists, so a part made of tiny
/// empty tags takes many times its size in memory.
pub const MAX_ELEMENTS: usize = 1_000_000;

/// Reads XML into a tree and returns its root element, or an empty `en-note` when there is none. Reading stops
/// after [`MAX_ELEMENTS`] elements.
pub fn parse(xml: &str) -> Element {
    parse_at_most(xml, MAX_ELEMENTS).0
}

/// Reads XML into a tree, and stops after `max` elements. Returns the root element and whether it stopped early.
pub fn parse_at_most(xml: &str, max: usize) -> (Element, bool) {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.allow_dangling_amp = true;
    config.check_end_names = false;
    config.allow_unmatched_ends = true;
    let mut stack = vec![Element {
        name: "#root".to_owned(),
        ..Element::default()
    }];
    let mut too_deep = 0usize;
    let (mut built, mut stopped) = (0usize, false);
    loop {
        match reader.read_event() {
            Ok(Event::Start(_) | Event::Empty(_)) if built >= max => {
                stopped = true;
                break;
            }
            Ok(Event::Start(tag)) if stack.len() > MAX_DEPTH => {
                too_deep += 1;
                drop(tag);
            }
            Ok(Event::Start(tag)) => {
                built += 1;
                stack.push(element_from(&tag));
            }
            Ok(Event::Empty(tag)) => {
                built += 1;
                push_child(&mut stack, Node::Element(element_from(&tag)));
            }
            Ok(Event::End(_)) if too_deep > 0 => too_deep -= 1,
            Ok(Event::End(_)) => close(&mut stack),
            Ok(Event::Text(text)) => push_text(&mut stack, &text.xml10_content()),
            Ok(Event::CData(data)) => push_text(&mut stack, &data.xml10_content()),
            Ok(Event::GeneralRef(reference)) => {
                let name = reference.xml10_content();
                push_text(&mut stack, &decode_entities(&format!("&{name};")));
            }
            Ok(Event::Eof) | Err(_) => break,
            Ok(_) => {}
        }
    }
    while stack.len() > 1 {
        close(&mut stack);
    }
    let root = stack.pop().unwrap_or_default();
    let first = root.children.into_iter().find_map(|node| match node {
        Node::Element(element) => Some(element),
        Node::Text(_) => None,
    });
    let root = first.unwrap_or_else(|| Element {
        name: "en-note".to_owned(),
        ..Element::default()
    });
    (root, stopped)
}

fn element_from(tag: &BytesStart<'_>) -> Element {
    let name = tag.name().as_ref().to_lowercase();
    let attrs = tag
        .html_attributes()
        .flatten()
        .map(|attr| {
            let key = attr.key.as_ref().to_lowercase();
            (key, decode_entities(&attr.value))
        })
        .collect();
    Element {
        name,
        attrs,
        children: Vec::new(),
    }
}

fn push_child(stack: &mut [Element], node: Node) {
    if let Some(top) = stack.last_mut() {
        top.children.push(node);
    }
}

fn push_text(stack: &mut [Element], text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(top) = stack.last_mut() {
        if let Some(Node::Text(last)) = top.children.last_mut() {
            last.push_str(text);
            return;
        }
        top.children.push(Node::Text(text.to_owned()));
    }
}

fn close(stack: &mut Vec<Element>) {
    if stack.len() > 1 {
        if let Some(done) = stack.pop() {
            push_child(stack, Node::Element(done));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_stops_after_the_most_elements() {
        let (root, stopped) = parse_at_most("<r><a/><a/><b>x</b></r>", 3);
        assert!(stopped);
        assert_eq!(root.children.len(), 2);
        let (_, stopped) = parse_at_most("<r><a/><a/></r>", 3);
        assert!(!stopped);
    }

    #[test]
    fn absurd_nesting_is_flattened_instead_of_overflowing_the_stack() {
        let deep = format!(
            "<en-note>{}x{}</en-note>",
            "<div>".repeat(50_000),
            "</div>".repeat(50_000)
        );
        let root = parse(&deep);
        assert_eq!(root.name, "en-note");
        let mut depth = 0;
        let mut node = &root;
        while let Some(Node::Element(next)) = node.children.first() {
            node = next;
            depth += 1;
        }
        assert!(depth <= MAX_DEPTH + 1, "{depth}");
    }

    #[test]
    fn reads_entities_cdata_and_loose_attributes() {
        let root = parse(concat!(
            "<?xml version=\"1.0\"?><!DOCTYPE en-note SYSTEM \"x.dtd\"><en-note>",
            "<div a=1 b>&nbsp;x &amp; y &#65;<![CDATA[<z>]]><br/></div></en-note>"
        ));
        assert_eq!(root.name, "en-note");
        let Node::Element(div) = &root.children[0] else {
            panic!("a div");
        };
        assert_eq!(div.attr("a"), Some("1"));
        assert_eq!(div.children[0], Node::Text("\u{a0}x & y A<z>".to_owned()));
    }
}
