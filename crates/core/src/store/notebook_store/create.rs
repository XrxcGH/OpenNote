//! Creating notebooks, section groups, sections, and pages (spec 3.4 and 18.2).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::pages::write_page_files;
use super::plain_entry;
use super::template::template_page;
use super::{invalid_move, invalid_name, NotebookStore, SectionState, TreeEnv};
use crate::error::{CoreError, FsErrorKind};
use crate::format::names::{fold_name, safe_folder_name};
use crate::id::{GroupId, Id, NotebookId, PageId, SectionId};
use crate::model::{FormatInfo, Group, JsonMap, NotebookFile, PageEntry, SectionFile};
use crate::session::journal_thread::TreeOp;
use crate::store::cache::CachedPage;
use crate::store::layout::{NOTEBOOK_JSON, README_MD};
use crate::store::lock::ensure_dir_all;
use crate::store::PageFiles;

/// Creates a notebook folder under `parent_dir`, named from `title` (spec 3.4), with its `notebook.json` and
/// `README.md`. Returns the new folder.
pub fn create_notebook(env: &TreeEnv, parent_dir: &Path, title: &str) -> Result<PathBuf, CoreError> {
    check_title(env, title)?;
    let fs = env.fs.as_ref();
    ensure_dir_all(fs, parent_dir)?;
    let mut taken: HashSet<String> = fs
        .read_dir(parent_dir)?
        .into_iter()
        .map(|e| fold_name(&e.name))
        .collect();
    let dir = loop {
        let name = safe_folder_name(title, &|n| taken.contains(&fold_name(n)));
        let dir = parent_dir.join(&name);
        match fs.create_dir_durable(&dir) {
            Ok(_) => break dir,
            // The file system has the final word on clashes (spec 3.4, step 9).
            Err(e) if e.kind == FsErrorKind::AlreadyExists && taken.insert(fold_name(&name)) => {}
            Err(e) => return Err(e.into()),
        }
    };
    let file = NotebookFile::new(NotebookId::generate(env.clock.as_ref()), title, env.clock.now());
    fs.replace_durable(&dir.join(NOTEBOOK_JSON), &env.codec.write_notebook(&file))?;
    // README.md is derived, so failing to write it doesn't fail the notebook.
    let _ = fs.write_derived(&dir.join(README_MD), &env.formats.readme(title));
    Ok(dir)
}

/// Fails for a title longer than the limit (spec 16).
pub(crate) fn check_title(env: &TreeEnv, title: &str) -> Result<(), CoreError> {
    let chars = title.chars().count();
    if u32::try_from(chars).map_or(true, |n| n > env.limits.title_chars) {
        return Err(invalid_name("too-long"));
    }
    Ok(())
}

impl NotebookStore {
    /// Creates a section group under `parent`, before the sibling `before` or at the end. Groups nest at most
    /// 4 levels deep (spec 4.3).
    pub fn create_group(
        &mut self,
        title: &str,
        parent: Option<GroupId>,
        before: Option<Id>,
    ) -> Result<GroupId, CoreError> {
        self.check_writable()?;
        check_title(&self.env, title)?;
        let depth = match parent {
            Some(p) => {
                self.group(p)?;
                self.group_depth(p)
            }
            None => 0,
        };
        if depth >= self.env.policy.group_depth {
            return Err(invalid_move("section groups nest at most 4 levels deep"));
        }
        let (order, rekeys) = self.child_key(parent, None, before)?;
        let now = self.now();
        let id = GroupId::generate(self.env.clock.as_ref());
        self.notebook.groups.push(Group {
            id,
            title: title.to_owned(),
            color: None,
            parent,
            order,
            created: now,
            changed: now,
            extra: JsonMap::new(),
        });
        self.apply_child_rekeys(&rekeys, true)?;
        Ok(id)
    }

    /// Creates a section under `parent`, before the sibling `before` or at the end (spec 18.2).
    pub fn create_section(
        &mut self,
        title: &str,
        parent: Option<GroupId>,
        before: Option<Id>,
    ) -> Result<SectionId, CoreError> {
        self.check_writable()?;
        check_title(&self.env, title)?;
        if let Some(p) = parent {
            self.group(p)?;
        }
        let (order, rekeys) = self.child_key(parent, None, before)?;
        let id = SectionId::generate(self.env.clock.as_ref());
        let intent = self.begin(TreeOp::CreateSection { section: id });
        let dir = self.layout.section_dir(id);
        self.env.fs.create_dir_durable(&dir)?;
        self.log.step_done(intent, 1);
        let now = self.now();
        let file = SectionFile {
            id,
            title: title.to_owned(),
            color: None,
            group: parent,
            order,
            created: now,
            changed: now,
            defaults: None,
            encryption: None,
            pages: Vec::new(),
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        };
        self.sections.insert(id, SectionState { file, dir });
        if let Err(e) = self.write_section(id) {
            self.sections.remove(&id);
            return Err(e);
        }
        self.log.step_done(intent, 2);
        self.log.done(intent);
        self.apply_child_rekeys(&rekeys, false)?;
        Ok(id)
    }

    /// Creates a page in `section` under the page `parent`, or at the top level, before the sibling `before`
    /// or at the end (spec 18.2). The page's `page.json` comes from the template of spec 4.5.
    pub fn create_page(
        &mut self,
        section: SectionId,
        parent: Option<PageId>,
        before: Option<PageId>,
        title: &str,
    ) -> Result<PageId, CoreError> {
        self.check_section_writable(section)?;
        check_title(&self.env, title)?;
        let (order, rekeys) = self.page_slot(section, parent, before)?;
        let id = PageId::generate(self.env.clock.as_ref());
        let intent = self.begin(TreeOp::CreatePage { section, page: id });
        let state = self.section(section)?;
        let dir = state.dir.join(id.to_string());
        let defaults = [state.file.defaults.as_ref(), self.notebook.defaults.as_ref()];
        let page = template_page(&self.env, id, title, defaults);
        self.env.fs.create_dir_durable(&dir)?;
        self.log.step_done(intent, 1);
        let files = PageFiles {
            fs: self.env.fs.as_ref(),
            codec: self.env.codec.as_ref(),
            dir: &dir,
        };
        let written = write_page_files(&files, self.env.clock.as_ref(), &page, page.revision.clone())?;
        self.log.step_done(intent, 2);
        let entry = plain_entry(id, title.to_owned(), parent, order, page.created);
        self.add_entry(section, entry, &rekeys)?;
        self.log.step_done(intent, 3);
        self.log.done(intent);
        let cached = CachedPage {
            title: title.to_owned(),
            created: page.created,
            modified: page.modified,
            revision: Some(written.revision.id),
        };
        self.cache.record(id, cached);
        Ok(id)
    }

    /// Adds an entry to a section's page list with new keys for some siblings, and writes `section.json`.
    pub(crate) fn add_entry(
        &mut self,
        section: SectionId,
        entry: PageEntry,
        rekeys: &[(Id, crate::order::OrderKey)],
    ) -> Result<(), CoreError> {
        let now = self.now();
        let state = self
            .sections
            .get_mut(&section)
            .ok_or_else(|| super::not_found(format!("section {section}")))?;
        for (id, key) in rekeys {
            if let Some(e) = state.file.pages.iter_mut().find(|e| e.id.0 == *id) {
                e.order = key.clone();
                e.changed = now;
            }
        }
        state.file.pages.push(entry);
        self.write_section(section)
    }

    /// How deep a group sits: 1 for a group at the top level. A loop counts as the top level.
    pub fn group_depth(&self, group: GroupId) -> u32 {
        let mut depth: u32 = 0;
        let mut seen = HashSet::new();
        let mut current = Some(group);
        while let Some(id) = current {
            if !seen.insert(id) {
                break;
            }
            depth = depth.saturating_add(1);
            current = self.notebook.groups.iter().find(|g| g.id == id).and_then(|g| g.parent);
        }
        depth
    }
}
