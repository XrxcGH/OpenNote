//! Splitting a Word document into pages, and reading the title and date lines that OneNote writes.

use opennote_core::Timestamp;

use super::body::{Item, Kind, Para};
use super::styles::StyleKind;
use crate::dates::parse_long_date;
use crate::doc::plain_text;
use crate::import::dateline::{looks_like_date, looks_like_time};

/// How to cut a document into pages.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WordPages {
    /// Cut at title paragraphs when there are two or more, else at page breaks when each part starts with a
    /// short line, else keep one page.
    #[default]
    Auto,
    /// Keep the whole document as one page.
    Single,
    /// Start a page at each paragraph in the Title style.
    ByTitle,
    /// Start a page after each hard page break.
    ByPageBreak,
}

/// A page cut from a document.
pub(super) struct RawPage {
    /// The title, if the document gives one.
    pub title: Option<String>,
    /// The names of the bookmarks on the title, which links inside the file point to.
    pub bookmarks: Vec<String>,
    /// The section the page belongs to, from the line above its title, as OpenNote's own export writes it.
    pub section: Option<String>,
    /// The body, without the title and the date lines.
    pub items: Vec<Item>,
    /// The date from the lines under the title.
    pub created: Option<Timestamp>,
}

/// What the split decided, for the report.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Cut {
    Whole,
    Titles,
    Breaks,
}

pub(super) fn split(items: Vec<Item>, how: WordPages) -> (Vec<RawPage>, Cut) {
    let titles = items.iter().filter(|i| is_title(i)).count();
    let cut = match how {
        WordPages::Single => Cut::Whole,
        WordPages::ByTitle => Cut::Titles,
        WordPages::ByPageBreak => Cut::Breaks,
        WordPages::Auto if titles >= 2 => Cut::Titles,
        WordPages::Auto if starts_with_short_lines(&items) => Cut::Breaks,
        WordPages::Auto => Cut::Whole,
    };
    let parts = match cut {
        Cut::Whole => vec![items],
        Cut::Titles => cut_at_titles(items),
        Cut::Breaks => cut_at_breaks(items),
    };
    let mut pages: Vec<RawPage> = parts
        .into_iter()
        .filter(|p| !is_blank(p))
        .map(|p| page(p, cut))
        .collect();
    // OpenNote's export names a section only on its first page, so the pages after it stay in that section.
    let mut current: Option<String> = None;
    for page in &mut pages {
        match &page.section {
            Some(section) => current = Some(section.clone()),
            None => page.section.clone_from(&current),
        }
    }
    (pages, cut)
}

fn is_title(item: &Item) -> bool {
    matches!(item, Item::Para(p) if p.kind == Kind::Styled(StyleKind::Title) && !p.inlines.is_empty())
}

fn is_blank(items: &[Item]) -> bool {
    items.iter().all(|i| match i {
        Item::Para(p) => p.inlines.is_empty(),
        Item::PageBreak => true,
        Item::Table(_) => false,
    })
}

fn cut_at_titles(items: Vec<Item>) -> Vec<Vec<Item>> {
    let mut parts: Vec<Vec<Item>> = vec![Vec::new()];
    for item in items {
        if is_title(&item) {
            // The lines above a title belong to it: a page break, and the section name.
            let moved = parts.last_mut().map(take_lead_in).unwrap_or_default();
            parts.push(moved);
        }
        if let Some(last) = parts.last_mut() {
            last.push(item);
        }
    }
    parts
}

/// Removes the page break, blank lines, and subtitle at the end of a part, and returns them in order.
fn take_lead_in(part: &mut Vec<Item>) -> Vec<Item> {
    let mut at = part.len();
    while at > 0 {
        let lead = match &part[at - 1] {
            Item::PageBreak => true,
            Item::Para(p) => p.inlines.is_empty() || p.kind == Kind::Styled(StyleKind::Subtitle),
            Item::Table(_) => false,
        };
        if !lead {
            break;
        }
        at -= 1;
    }
    part.split_off(at)
}

fn cut_at_breaks(items: Vec<Item>) -> Vec<Vec<Item>> {
    let mut parts: Vec<Vec<Item>> = vec![Vec::new()];
    for item in items {
        if matches!(item, Item::PageBreak) {
            parts.push(Vec::new());
        } else if let Some(last) = parts.last_mut() {
            last.push(item);
        }
    }
    parts
}

/// Whether the document has page breaks, and each part between them starts with a short line of its own.
fn starts_with_short_lines(items: &[Item]) -> bool {
    if !items.iter().any(|i| matches!(i, Item::PageBreak)) {
        return false;
    }
    let parts: Vec<Vec<Item>> = cut_at_breaks(items.to_vec())
        .into_iter()
        .filter(|p| !is_blank(p))
        .collect();
    parts.len() >= 2 && parts.iter().all(|part| first_line(part).is_some_and(short_line))
}

fn first_line(items: &[Item]) -> Option<&Para> {
    items.iter().find_map(|i| match i {
        Item::Para(p) if !p.inlines.is_empty() => Some(p),
        _ => None,
    })
}

fn short_line(para: &Para) -> bool {
    !matches!(para.kind, Kind::ListItem { .. }) && plain_text(&para.inlines).trim().chars().count() <= 100
}

fn page(mut items: Vec<Item>, cut: Cut) -> RawPage {
    let section = (cut == Cut::Titles).then(|| take_section(&mut items)).flatten();
    let (title, bookmarks) = match cut {
        Cut::Titles | Cut::Whole => take_first_line(&mut items, |p| p.kind == Kind::Styled(StyleKind::Title)),
        Cut::Breaks => take_first_line(&mut items, |_| true),
    };
    let created = if title.is_some() {
        take_date_lines(&mut items)
    } else {
        None
    };
    RawPage {
        title,
        bookmarks,
        section,
        items,
        created,
    }
}

/// Removes a subtitle that stands right above the title, and returns its text.
fn take_section(items: &mut Vec<Item>) -> Option<String> {
    let mut lines = items
        .iter()
        .enumerate()
        .filter(|(_, i)| matches!(i, Item::Para(p) if !p.inlines.is_empty()));
    let (first, _) = lines.next()?;
    let (second, _) = lines.next()?;
    let is_subtitle = matches!(&items[first], Item::Para(p) if p.kind == Kind::Styled(StyleKind::Subtitle));
    if !is_subtitle || !is_title(&items[second]) {
        return None;
    }
    let Item::Para(para) = items.remove(first) else {
        return None;
    };
    Some(plain_text(&para.inlines).trim().to_owned()).filter(|t| !t.is_empty())
}

/// Removes the first non-empty paragraph, if it passes the test, and returns its text.
fn take_first_line(items: &mut Vec<Item>, test: impl Fn(&Para) -> bool) -> (Option<String>, Vec<String>) {
    let Some(index) = items
        .iter()
        .position(|i| matches!(i, Item::Para(p) if !p.inlines.is_empty()))
    else {
        return (None, Vec::new());
    };
    let Item::Para(para) = &items[index] else {
        return (None, Vec::new());
    };
    if !test(para) || !short_line(para) && para.kind != Kind::Styled(StyleKind::Title) {
        return (None, Vec::new());
    }
    let text = plain_text(&para.inlines).trim().to_owned();
    let bookmarks = para.bookmarks.clone();
    items.remove(index);
    (Some(text).filter(|t| !t.is_empty()), bookmarks)
}

/// OneNote writes the page's date, then its time, under the title. Reads and removes them.
fn take_date_lines(items: &mut Vec<Item>) -> Option<Timestamp> {
    let lines: Vec<usize> = items
        .iter()
        .enumerate()
        .filter(|(_, i)| matches!(i, Item::Para(p) if !p.inlines.is_empty()))
        .map(|(n, _)| n)
        .take(2)
        .collect();
    let text = |n: usize| match &items[n] {
        Item::Para(p) => plain_text(&p.inlines).trim().to_owned(),
        _ => String::new(),
    };
    let date_line = text(*lines.first()?);
    if !looks_like_date(&date_line) {
        return None;
    }
    let time_line = lines.get(1).map(|n| text(*n)).filter(|t| looks_like_time(t));
    let combined = match &time_line {
        Some(time) => format!("{date_line} {time}"),
        None => date_line,
    };
    let created = parse_long_date(&combined)?;
    let mut remove = vec![lines[0]];
    if time_line.is_some() {
        remove.push(lines[1]);
    }
    for index in remove.into_iter().rev() {
        items.remove(index);
    }
    Some(created)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::doc::Inline;

    fn para(kind: StyleKind, text: &str) -> Item {
        Item::Para(Para {
            kind: Kind::Styled(kind),
            inlines: if text.is_empty() {
                Vec::new()
            } else {
                vec![Inline::text(text)]
            },
            bookmarks: Vec::new(),
            shaded: false,
        })
    }

    #[test]
    fn two_titles_make_two_pages_and_the_date_lines_are_read() {
        let items = vec![
            para(StyleKind::Title, "First"),
            para(StyleKind::Normal, "Saturday, October 3, 2026"),
            para(StyleKind::Normal, "9:30 AM"),
            para(StyleKind::Normal, "Body one"),
            para(StyleKind::Title, "Second"),
            para(StyleKind::Normal, "Body two"),
        ];
        let (pages, cut) = split(items, WordPages::Auto);
        assert_eq!(cut, Cut::Titles);
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].title.as_deref(), Some("First"));
        assert_eq!(pages[0].created, Timestamp::parse("2026-10-03T09:30:00Z").ok());
        assert_eq!(pages[0].items.len(), 1, "the date lines are gone");
        assert_eq!(pages[1].title.as_deref(), Some("Second"));
        assert!(pages[1].created.is_none());
    }

    #[test]
    fn page_breaks_split_when_every_part_starts_with_a_short_line() {
        let items = vec![
            para(StyleKind::Normal, "Page A"),
            para(StyleKind::Normal, "text a"),
            Item::PageBreak,
            para(StyleKind::Normal, "Page B"),
            para(StyleKind::Normal, "text b"),
        ];
        let (pages, cut) = split(items.clone(), WordPages::Auto);
        assert_eq!((cut, pages.len()), (Cut::Breaks, 2));
        assert_eq!(pages[1].title.as_deref(), Some("Page B"));
        let long = "x".repeat(300);
        let items = vec![
            para(StyleKind::Normal, &long),
            Item::PageBreak,
            para(StyleKind::Normal, "b"),
        ];
        assert_eq!(split(items, WordPages::Auto).1, Cut::Whole);
    }

    #[test]
    fn a_single_page_keeps_a_lone_title_and_a_chosen_split_is_obeyed() {
        let items = vec![para(StyleKind::Title, "Only"), para(StyleKind::Normal, "text")];
        let (pages, cut) = split(items.clone(), WordPages::Auto);
        assert_eq!((cut, pages.len()), (Cut::Whole, 1));
        assert_eq!(pages[0].title.as_deref(), Some("Only"));
        assert_eq!(split(items, WordPages::ByPageBreak).0.len(), 1);
    }
}
