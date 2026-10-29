//! Planning an export: which pages go out, and where each one goes.

use std::collections::HashMap;

use opennote_core::model::section::page_levels;
use opennote_core::model::{NotebookFile, SectionFile};
use opennote_core::{GroupId, PageId, SectionId};

use super::names::{sanitize_name, Namer};
use crate::error::{InteropError, Result};
use crate::source::NoteSource;

/// What to export.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// One page.
    Page(PageId),
    /// A section and its pages.
    Section(SectionId),
    /// The whole notebook.
    Notebook,
}

/// One page of the plan.
#[derive(Clone, Debug)]
pub struct PlannedPage {
    /// The page.
    pub id: PageId,
    /// Its title, as the section lists it.
    pub title: String,
    /// The title of its section.
    pub section: String,
    /// How deep it sits among subpages, from 0.
    pub level: u8,
    /// The folders below the export's root, from the notebook's groups and section.
    pub dir: Vec<String>,
    /// The file name, with its extension.
    pub file: String,
}

impl PlannedPage {
    /// The parts of the page's path below the root.
    pub fn path(&self) -> Vec<String> {
        let mut parts = self.dir.clone();
        parts.push(self.file.clone());
        parts
    }
}

/// The pages of an export, in reading order, and the name of the folder that holds them.
#[derive(Clone, Debug)]
pub struct Plan {
    /// The name of the notebook, section, or page that is exported.
    pub title: String,
    /// The pages.
    pub pages: Vec<PlannedPage>,
}

/// Lists the pages in scope and gives each one a folder and a file name with this extension.
pub fn build(source: &dyn NoteSource, scope: Scope, extension: &str) -> Result<Plan> {
    let notebook = source.notebook();
    let mut files = FileNames::default();
    let mut pages = Vec::new();
    let title = match scope {
        Scope::Notebook => {
            // The assets of the export live in a folder of this name, so no section may use it.
            files.reserve("assets");
            for section in source.sections() {
                let dir = section_dir(notebook, section, &mut files);
                add_section(section, &dir, extension, &mut files, &mut pages);
            }
            notebook.title.clone()
        }
        Scope::Section(id) => {
            let section = source
                .sections()
                .iter()
                .find(|s| s.id == id)
                .ok_or_else(|| InteropError::Missing(format!("section {id}")))?;
            add_section(section, &[], extension, &mut files, &mut pages);
            section.title.clone()
        }
        Scope::Page(id) => {
            let entry = source
                .sections()
                .iter()
                .find_map(|s| s.pages.iter().find(|p| p.id == id))
                .ok_or_else(|| InteropError::Missing(format!("page {id}")))?;
            let file = files.file(&[], &entry.title, extension);
            pages.push(PlannedPage {
                id,
                title: entry.title.clone(),
                section: String::new(),
                level: 0,
                dir: Vec::new(),
                file,
            });
            entry.title.clone()
        }
    };
    Ok(Plan { title, pages })
}

fn add_section(
    section: &SectionFile,
    dir: &[String],
    extension: &str,
    files: &mut FileNames,
    pages: &mut Vec<PlannedPage>,
) {
    for (index, level) in page_levels(&section.pages) {
        let entry = &section.pages[index];
        pages.push(PlannedPage {
            id: entry.id,
            title: entry.title.clone(),
            section: section.title.clone(),
            level,
            dir: dir.to_vec(),
            file: files.file(dir, &entry.title, extension),
        });
    }
}

/// The folders of a section: its groups, from the outermost in, then the section.
fn section_dir(notebook: &NotebookFile, section: &SectionFile, files: &mut FileNames) -> Vec<String> {
    let mut groups: Vec<&str> = Vec::new();
    let mut next: Option<GroupId> = section.group;
    while let Some(id) = next.filter(|_| groups.len() < 16) {
        let Some(group) = notebook.groups.iter().find(|g| g.id == id) else {
            break;
        };
        groups.push(&group.title);
        next = group.parent;
    }
    let mut dir: Vec<String> = Vec::new();
    for title in groups.into_iter().rev().chain(std::iter::once(section.title.as_str())) {
        let name = files.folder(&dir, title);
        dir.push(name);
    }
    dir
}

/// Hands out names that are unique in each folder.
#[derive(Default)]
struct FileNames {
    by_dir: HashMap<Vec<String>, Namer>,
    folders: HashMap<(Vec<String>, String), String>,
}

impl FileNames {
    /// Keeps a name at the top of the export for something else.
    fn reserve(&mut self, name: &str) {
        self.by_dir.entry(Vec::new()).or_default().unique(name, "");
    }

    fn file(&mut self, dir: &[String], title: &str, extension: &str) -> String {
        let name = sanitize_name(title, "Untitled");
        self.by_dir.entry(dir.to_vec()).or_default().unique(&name, extension)
    }

    /// A folder name. Folders with the same name in the same place share one folder.
    fn folder(&mut self, parent: &[String], title: &str) -> String {
        let name = sanitize_name(title, "Untitled");
        let key = (parent.to_vec(), name.to_lowercase());
        if let Some(existing) = self.folders.get(&key) {
            return existing.clone();
        }
        let unique = self.by_dir.entry(parent.to_vec()).or_default().unique(&name, "");
        self.folders.insert(key, unique.clone());
        unique
    }
}
