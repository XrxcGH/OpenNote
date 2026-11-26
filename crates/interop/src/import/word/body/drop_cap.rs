//! Drop caps: Word writes the letter in a framed paragraph of its own (ECMA-376 Part 1, 17.3.1.11), which joins
//! the paragraph after it again.

use serde_json::Map;

use super::{Fmt, Item};
use crate::doc::{push_text, Inline};
use crate::import::word::paras::para_keys;
use crate::import::word::props::ParaProps;
use crate::import::word::theme::Theme;
use crate::import::xmltree::Element;

/// The formatting of a paragraph in a table cell or a note: only its drop cap. Cells and notes keep no
/// paragraph formatting, but a drop cap there still joins its paragraph.
pub(super) fn only(props: Option<&Element>, theme: &Theme) -> Fmt {
    let mut fmt = Fmt::default();
    if let Some(props) = props {
        let mut keys = Map::new();
        para_keys(&ParaProps::read(props), theme, &mut keys);
        if let Some(drop_cap) = keys.remove("dropCap") {
            fmt.para.insert("dropCap".to_owned(), drop_cap);
        }
    }
    fmt
}

/// Word writes a drop cap as a framed paragraph of its own that holds the letter, then the paragraph with the
/// rest (ECMA-376 Part 1, 17.3.1.11). The two become one paragraph again, with the `dropCap` attribute and the
/// bookmarks of both. `cap` says where the frame read just before is, past the paragraphs of its text boxes,
/// which are returned to follow the joined paragraph.
pub(super) fn join_drop_cap(
    items: &mut Vec<Item>,
    cap: Option<(usize, usize)>,
    inlines: Vec<Inline>,
    mut fmt: Fmt,
    bookmarks: Vec<String>,
) -> (Vec<Inline>, Fmt, Vec<String>, Vec<Item>) {
    let at = match cap {
        Some((end, after)) if end == items.len() && after < end => end - 1 - after,
        _ => return (inlines, fmt, bookmarks, Vec::new()),
    };
    let joins = matches!(&items[at], Item::Para(cap) if cap.fmt.para.contains_key("dropCap") && !cap.inlines.is_empty())
        && !inlines.is_empty()
        && !fmt.para.contains_key("dropCap");
    if !joins {
        return (inlines, fmt, bookmarks, Vec::new());
    }
    let trailing = items.split_off(at + 1);
    let Some(Item::Para(cap)) = items.pop() else {
        unreachable!("the item at the frame's place is a paragraph");
    };
    if let Some(drop_cap) = cap.fmt.para.get("dropCap") {
        fmt.para.insert("dropCap".to_owned(), drop_cap.clone());
    }
    let mut joined = Vec::new();
    for inline in cap.inlines.into_iter().chain(inlines) {
        match inline {
            Inline::Text { text, marks } => push_text(&mut joined, &text, &marks),
            other => joined.push(other),
        }
    }
    let mut marks = cap.bookmarks;
    marks.extend(bookmarks);
    (joined, fmt, marks, trailing)
}
