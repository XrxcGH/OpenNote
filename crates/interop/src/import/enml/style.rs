//! Helpers for ENML: code blocks, tables, and colors.

use super::{is_block, Piece};
use crate::doc::Block;
use crate::import::xmltree::{Element, Node};

/// A code block: the lines of a `pre` or of an Evernote code box.
pub(super) fn code(e: &Element) -> Piece {
    let mut text = String::new();
    lines_of(e, &mut text);
    Piece::Block(Block::Code {
        language: language_of(e),
        text: text.trim_matches('\n').to_owned(),
    })
}

/// The language that a `language-xyz` class on the `pre` or on its `code` child names.
fn language_of(e: &Element) -> String {
    let classes = |el: &Element| el.attr("class").map(str::to_owned).unwrap_or_default();
    let mut all = classes(e);
    for child in &e.children {
        if let Node::Element(c) = child {
            if c.name == "code" {
                all.push(' ');
                all.push_str(&classes(c));
            }
        }
    }
    all.split_whitespace()
        .find_map(|class| class.strip_prefix("language-"))
        .unwrap_or("")
        .to_owned()
}

fn lines_of(e: &Element, out: &mut String) {
    for child in &e.children {
        match child {
            Node::Text(text) => out.push_str(&text.replace('\u{a0}', " ")),
            Node::Element(c) if c.name == "br" => out.push('\n'),
            Node::Element(c) => {
                if is_block(&c.name) && !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                lines_of(c, out);
            }
        }
    }
}

/// The elements with this name below `e`, in document order.
pub(super) fn descendants<'e>(e: &'e Element, name: &str) -> Vec<&'e Element> {
    let mut found = Vec::new();
    for child in &e.children {
        if let Node::Element(c) = child {
            if c.name == name {
                found.push(c);
            } else if c.name != "table" {
                found.extend(descendants(c, name));
            }
        }
    }
    found
}

/// Reads `#rgb`, `#rrggbb`, or `rgb(r, g, b)` as `#rrggbb`. Black and near black are the default text color, so
/// they are not a choice worth keeping.
pub(super) fn parse_color(text: &str) -> Option<String> {
    let text = text.trim().to_lowercase();
    let rgb: [u8; 3] = if let Some(hex) = text.strip_prefix('#') {
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| u8::try_from(c.to_digit(16)?).ok())
            .collect::<Option<_>>()?;
        match digits.as_slice() {
            [r, g, b] => [r * 17, g * 17, b * 17],
            [a, b, c, d, e, f] => [a * 16 + b, c * 16 + d, e * 16 + f],
            _ => return None,
        }
    } else {
        let inner = text.strip_prefix("rgb(")?.strip_suffix(')')?;
        let parts: Vec<u8> = inner.split(',').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
        parts.try_into().ok()?
    };
    if rgb.iter().all(|c| *c <= 0x22) {
        return None;
    }
    Some(format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2]))
}
