//! Reading one HTML page as a note: its title, dates, tags, and content blocks.
//!
//! The same reader serves OpenNote's own HTML export, pages saved from a browser or from OneNote, and the
//! HTML that Notion and Google Keep export. Only the way images are found differs, so the caller passes a
//! function that turns an image's `src` into a destination.

use std::collections::HashMap;

use opennote_core::Timestamp;

use super::enml::{Converter, EnmlStats, HtmlMode};
use super::htmltree::{self, Head};
use crate::dates::parse_date;
use crate::doc::{plain_text, Block};

/// A page read from HTML.
pub(super) struct HtmlNote {
    /// The title from `<title>`, else the first heading, else `None`.
    pub title: Option<String>,
    /// The content, without a first heading that repeats the title.
    pub blocks: Vec<Block>,
    /// Tags from the page's meta tags.
    pub tags: Vec<String>,
    /// The created date from its meta tags.
    pub created: Option<Timestamp>,
    /// The modified date from its meta tags.
    pub modified: Option<Timestamp>,
    /// What the conversion dropped or simplified.
    pub stats: EnmlStats,
}

/// Reads an HTML page. `image_dest` turns the `src` of an image into the destination for the page, or `None`
/// when the image is not available. `media` names the media type of each `media:<key>` destination it returns.
pub(super) fn read(
    html: &str,
    image_dest: &dyn Fn(&str) -> Option<String>,
    media: &HashMap<String, String>,
) -> HtmlNote {
    let doc = htmltree::parse(html);
    let from_opennote = doc.head.meta("generator").is_some_and(|g| g.starts_with("OpenNote"));
    let mode = HtmlMode {
        shift_headings: from_opennote,
        image_dest,
    };
    let mut converter = Converter::html(media, mode);
    let mut blocks = converter.convert_blocks(&doc.body);
    let title = page_title(&doc.head, &blocks);
    drop_repeated_title(&mut blocks, title.as_deref());
    HtmlNote {
        title,
        blocks,
        tags: tags(&doc.head),
        created: date(
            &doc.head,
            &["opennote:created", "date", "created", "article:published_time"],
        ),
        modified: date(
            &doc.head,
            &["opennote:updated", "last-modified", "modified", "article:modified_time"],
        ),
        stats: converter.stats,
    }
}

fn page_title(head: &Head, blocks: &[Block]) -> Option<String> {
    let from_head = head.title.trim();
    if !from_head.is_empty() {
        return Some(from_head.to_owned());
    }
    match blocks.first() {
        Some(Block::Heading { level: 1, content }) => {
            Some(plain_text(content).trim().to_owned()).filter(|t| !t.is_empty())
        }
        _ => None,
    }
}

/// Drops a first level 1 heading that repeats the title, because the page already shows its title.
fn drop_repeated_title(blocks: &mut Vec<Block>, title: Option<&str>) {
    let repeats = match (blocks.first(), title) {
        (Some(Block::Heading { level: 1, content }), Some(title)) => {
            plain_text(content).trim().eq_ignore_ascii_case(title.trim())
        }
        _ => false,
    };
    if repeats {
        blocks.remove(0);
    }
}

fn tags(head: &Head) -> Vec<String> {
    let exact: Vec<String> = head
        .meta
        .iter()
        .filter(|(name, _)| name == "opennote:tag")
        .map(|(_, value)| value.clone())
        .collect();
    if !exact.is_empty() {
        return exact;
    }
    head.meta("keywords")
        .map(|list| {
            list.split(',')
                .map(|t| t.trim().to_owned())
                .filter(|t| !t.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn date(head: &Head, names: &[&str]) -> Option<Timestamp> {
    names.iter().find_map(|name| head.meta(name).and_then(parse_date))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_plain(html: &str) -> HtmlNote {
        read(html, &|src| Some(src.to_owned()), &HashMap::new())
    }

    #[test]
    fn the_head_gives_title_dates_and_tags() {
        let note = read_plain(
            "<html><head><title>Cells</title><meta name=\"opennote:created\" content=\"2026-01-05T09:30:00Z\">\
             <meta name=\"opennote:tag\" content=\"a, b\"><meta name=\"opennote:tag\" content=\"c\"></head>\
             <body><h1>Cells</h1><p>Text</p></body></html>",
        );
        assert_eq!(note.title.as_deref(), Some("Cells"));
        assert_eq!(note.tags, ["a, b", "c"]);
        assert!(note.created.is_some() && note.modified.is_none());
        assert_eq!(note.blocks.len(), 1, "the repeated title heading is dropped");
    }

    #[test]
    fn pages_from_opennote_shift_their_headings_up() {
        let note = read_plain(
            "<head><meta name=\"generator\" content=\"OpenNote 0.1\"><title>T</title></head>\
             <body><h1>T</h1><h2>Part</h2><h3>Detail</h3></body>",
        );
        let levels: Vec<u8> = note
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Heading { level, .. } => Some(*level),
                _ => None,
            })
            .collect();
        assert_eq!(levels, [1, 2]);
    }

    #[test]
    fn keywords_stand_in_for_tags_and_other_pages_keep_their_headings() {
        let note = read_plain("<title>X</title><meta name=keywords content=\"one, two\"><h2>Sub</h2><p>x</p>");
        assert_eq!(note.tags, ["one", "two"]);
        assert!(matches!(note.blocks[0], Block::Heading { level: 2, .. }));
    }

    #[test]
    fn a_page_without_a_title_uses_its_first_heading() {
        let note = read_plain("<h1>Only heading</h1><p>text</p>");
        assert_eq!(note.title.as_deref(), Some("Only heading"));
        assert_eq!(note.blocks.len(), 1);
    }
}
