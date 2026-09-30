//! Merging two copies of a tree file that a sync tool made (spec 14.3).
//!
//! The result is the union of the entries by ID. For an entry that both copies have, and for the file's own
//! fields, the copy whose `changed` time is later wins. When the times are equal, the copy whose canonical
//! bytes sort later wins, so merging gives the same result in either order, and merging again changes nothing.

use std::collections::BTreeMap;
use std::hash::Hash;

use super::{entries, write_notebook, write_section};
use crate::format::json::write_document;
use crate::model::{Group, NotebookFile, PageEntry, SectionFile};
use crate::time::Timestamp;

/// Picks the copy changed later, breaking ties by canonical bytes.
fn later<'a, T>(a: &'a T, b: &'a T, changed: impl Fn(&T) -> Timestamp, bytes: impl Fn(&T) -> Vec<u8>) -> &'a T {
    match changed(a).cmp(&changed(b)) {
        std::cmp::Ordering::Greater => a,
        std::cmp::Ordering::Less => b,
        std::cmp::Ordering::Equal => {
            if bytes(b) > bytes(a) {
                b
            } else {
                a
            }
        }
    }
}

/// The union of two lists by ID, with the later copy of each item that both have.
fn union<'a, T, K: Ord + Hash + Copy>(
    ours: &'a [T],
    theirs: &'a [T],
    id: impl Fn(&T) -> K,
    pick: impl Fn(&'a T, &'a T) -> &'a T,
) -> Vec<&'a T> {
    let mut by_id: BTreeMap<K, &'a T> = BTreeMap::new();
    for item in ours.iter().chain(theirs) {
        let chosen = match by_id.get(&id(item)) {
            Some(existing) => pick(existing, item),
            None => item,
        };
        by_id.insert(id(item), chosen);
    }
    by_id.into_values().collect()
}

fn pick_entry<'a>(a: &'a PageEntry, b: &'a PageEntry) -> &'a PageEntry {
    later(a, b, |e| e.changed, |e| write_document(&entries::write_page_entry(e)))
}

fn pick_group<'a>(a: &'a Group, b: &'a Group) -> &'a Group {
    later(a, b, |g| g.changed, |g| write_document(&entries::write_group(g)))
}

/// A copy of a section without its pages, whose bytes decide ties between the files' own fields.
fn section_header(file: &SectionFile) -> Vec<u8> {
    write_section(&SectionFile {
        pages: Vec::new(),
        ..file.clone_header()
    })
}

/// Merges two copies of `section.json`: the union of entries by ID, each from the copy changed later.
pub fn merge_sections(ours: &SectionFile, theirs: &SectionFile) -> SectionFile {
    let header = later(ours, theirs, |f| f.changed, section_header);
    let pages = union(&ours.pages, &theirs.pages, |e| e.id, pick_entry);
    let pages: Vec<PageEntry> = pages.into_iter().cloned().collect();
    let pages = entries::sorted_pages(&pages).into_iter().cloned().collect();
    SectionFile {
        pages,
        ..header.clone_header()
    }
}

/// Merges two copies of `notebook.json` the same way: the union of groups by ID.
pub fn merge_notebooks(ours: &NotebookFile, theirs: &NotebookFile) -> NotebookFile {
    let header_bytes = |f: &NotebookFile| {
        write_notebook(&NotebookFile {
            groups: Vec::new(),
            ..f.clone()
        })
    };
    let header = later(ours, theirs, |f| f.changed, header_bytes);
    let groups = union(&ours.groups, &theirs.groups, |g| g.id, pick_group);
    let groups: Vec<Group> = groups.into_iter().cloned().collect();
    NotebookFile {
        groups: entries::sorted_groups(&groups).into_iter().cloned().collect(),
        ..header.clone()
    }
}

/// Cloning the fields of a section other than its pages.
trait CloneHeader {
    fn clone_header(&self) -> Self;
}

impl CloneHeader for SectionFile {
    fn clone_header(&self) -> SectionFile {
        SectionFile {
            id: self.id,
            title: self.title.clone(),
            color: self.color.clone(),
            group: self.group,
            order: self.order.clone(),
            created: self.created,
            changed: self.changed,
            defaults: self.defaults.clone(),
            encryption: self.encryption.clone(),
            pages: Vec::new(),
            extra: self.extra.clone(),
            format: self.format.clone(),
        }
    }
}
