//! `index.md` (spec 11.4): the notebook's table of contents.
//!
//! Section groups and sections are headings, one level below their parent, down to level 6. Pages are a list
//! in display order, with subpages indented 2 spaces per level. Pages whose folder is missing or on its way to
//! Trash are left out, and an encrypted section lists only its title (spec 5.7). Groups and sections whose
//! parent group is missing, or whose parents form a loop, follow at the top level, so nothing is left out.

use std::collections::HashSet;

use super::{quoted, seal};
use crate::format::markdown::{escape_text, one_line, write_destination};
use crate::id::{GroupId, SectionId};
use crate::model::{NotebookTree, PageNode, PageNodeState, SectionNode, TreeChild};

/// Renders `index.md` (spec 11.4).
pub fn render_index_md(tree: &NotebookTree) -> Vec<u8> {
    let mut text = String::from("---\nopennote:\n  kind: \"notebook-index\"\n");
    text.push_str(&format!("  notebook: {}\n", quoted(&tree.notebook.to_string())));
    text.push_str(&format!("  format: {}\n", crate::FORMAT_VERSION));
    text.push_str("  checksum: \"crc32:00000000\"\n---\n");
    let mut walk = Walk {
        tree,
        parts: vec![format!("# {}", heading_text(&tree.title))],
        groups: HashSet::new(),
        sections: HashSet::new(),
    };
    walk.visit(tree.children(None));
    let mut groups: Vec<_> = tree.groups.iter().filter(|g| !walk.groups.contains(&g.id)).collect();
    groups.sort_by(|a, b| (&a.order, a.id).cmp(&(&b.order, b.id)));
    walk.visit(groups.into_iter().map(TreeChild::Group).collect());
    let mut sections: Vec<_> = tree
        .sections
        .iter()
        .filter(|s| !walk.sections.contains(&s.id))
        .collect();
    sections.sort_by(|a, b| (&a.order, a.id).cmp(&(&b.order, b.id)));
    walk.visit(sections.into_iter().map(TreeChild::Section).collect());
    text.push('\n');
    text.push_str(&walk.parts.join("\n\n"));
    text.push('\n');
    seal(text)
}

/// A depth-first walk of the tree, without recursion.
struct Walk<'a> {
    tree: &'a NotebookTree,
    parts: Vec<String>,
    groups: HashSet<GroupId>,
    sections: HashSet<SectionId>,
}

impl<'a> Walk<'a> {
    /// Writes each child and everything under it, starting at heading level 2.
    fn visit(&mut self, roots: Vec<TreeChild<'a>>) {
        let mut stack: Vec<(TreeChild<'a>, usize)> = roots.into_iter().rev().map(|c| (c, 2)).collect();
        while let Some((child, level)) = stack.pop() {
            match child {
                TreeChild::Group(group) => {
                    if !self.groups.insert(group.id) {
                        continue;
                    }
                    self.parts
                        .push(format!("{} {}", hashes(level), heading_text(&group.title)));
                    let children = self.tree.children(Some(group.id));
                    stack.extend(children.into_iter().rev().map(|c| (c, level.saturating_add(1))));
                }
                TreeChild::Section(section) => {
                    if self.sections.insert(section.id) {
                        self.parts.extend(section_parts(section, level));
                    }
                }
            }
        }
    }
}

fn hashes(level: usize) -> String {
    "#".repeat(level.min(6))
}

fn heading_text(title: &str) -> String {
    let title = one_line(title);
    if title.is_empty() {
        "Untitled".to_owned()
    } else {
        escape_text(&title, true)
    }
}

/// A section's heading, then its page list.
fn section_parts(section: &SectionNode, level: usize) -> Vec<String> {
    let mut parts = vec![format!("{} {}", hashes(level), heading_text(&section.title))];
    if section.encrypted {
        return parts;
    }
    let lines: Vec<String> = section
        .pages
        .iter()
        .filter(|page| shown(page))
        .map(|page| page_line(section, page))
        .collect();
    if !lines.is_empty() {
        parts.push(lines.join("\n"));
    }
    parts
}

fn shown(page: &PageNode) -> bool {
    !matches!(
        page.state,
        PageNodeState::PendingDelete | PageNodeState::Unavailable { .. }
    )
}

fn page_line(section: &SectionNode, page: &PageNode) -> String {
    let title = one_line(&page.title);
    let text = if title.trim().is_empty() {
        "Untitled".to_owned()
    } else {
        escape_text(title.trim(), false)
    };
    let indent = "  ".repeat(usize::from(page.level.min(2)));
    let path = write_destination(&format!("{}/{}/page.md", section.id, page.id));
    format!("{indent}- [{text}]({path})")
}
