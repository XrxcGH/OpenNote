//! Edits made outside OpenNote (FEATURES.md, Phase 3): the readable copies a person edited, the text they can
//! bring back into the page, and the files that are only in the cloud.

use std::path::{Path, PathBuf};

use super::state::PageSession;
use crate::error::{CoreError, EditError};
use crate::id::{BlockId, RevisionId};
use crate::model::Page;
use crate::ops::resolve::{Edit, NewBlock};
use crate::store::external::import::{plan_import, MarkdownImport, TextChange};
use crate::store::external::{cloud_only_files, edited_copies, EditedCopy};
use crate::store::layout::PAGE_MD;

/// What an edited `page.md` would change, and the edits that make the changes.
#[derive(Clone, Debug, PartialEq)]
pub struct EditedImport {
    /// The edited copy the plan is for.
    pub copy: PathBuf,
    /// What the copy changes, for the interface to show.
    pub plan: MarkdownImport,
    /// The edits that bring the changes into the page. The interface sends them as one request once the
    /// person accepts, so one undo step takes them back.
    pub edits: Vec<Edit>,
    /// Whether the page as the copy was written from it was found. When it wasn't, the plan compares the copy
    /// with the page as saved, and may undo edits made in OpenNote since.
    pub base_known: bool,
}

impl PageSession {
    /// The edited readable copies kept in the page's `.conflicts/` folder.
    pub(crate) fn edited_copies(&self) -> Result<Vec<EditedCopy>, CoreError> {
        let dir = self.state().dir.clone();
        Ok(edited_copies(self.ctx.fs.as_ref(), &dir)?)
    }

    /// Plans how the text of an edited `page.md` comes into the page.
    pub(crate) fn plan_edited_import(&self, copy: &Path) -> Result<EditedImport, CoreError> {
        let kept = self.kept_copy(copy)?;
        let bytes = self.ctx.fs.read(&kept.path, self.ctx.limits.page_json_bytes)?;
        let text =
            String::from_utf8(bytes).map_err(|_| CoreError::Edit(EditError::Invalid("the copy is not text".into())))?;
        let (dir, current, saved, base_rev) = {
            let st = self.state();
            (st.dir.clone(), st.page.clone(), st.bytes.clone(), st.base)
        };
        let (base, base_known) = self.base_of(&dir, revision_of(&text), (&saved, base_rev))?;
        let notebook = self
            .notebook
            .upgrade()
            .ok_or_else(|| CoreError::NotFound("the notebook".into()))?;
        let links = notebook.links(&dir, &base);
        let plan = plan_import(&base, &current, &text, &links);
        let edits = self.edits_for(&plan);
        Ok(EditedImport {
            copy: kept.path,
            plan,
            edits,
            base_known,
        })
    }

    /// Deletes an edited copy once it is brought in or the person turns it down.
    pub(crate) fn discard_edited_copy(&self, copy: &Path) -> Result<(), CoreError> {
        let kept = self.kept_copy(copy)?;
        self.ctx.fs.remove_file(&kept.path)?;
        Ok(())
    }

    /// The files of the page that are only in the cloud, which a sync tool downloads on demand.
    pub(crate) fn cloud_only_files(&self) -> Vec<PathBuf> {
        let (dir, page) = {
            let st = self.state();
            (st.dir.clone(), st.page.clone())
        };
        cloud_only_files(self.ctx.fs.as_ref(), &dir, &page)
    }

    /// The listed edited copy of `page.md` at this path. Any other path is refused, so the interface can't make
    /// the core read or delete a file it didn't list.
    fn kept_copy(&self, copy: &Path) -> Result<EditedCopy, CoreError> {
        self.edited_copies()?
            .into_iter()
            .find(|kept| kept.path == copy && kept.file == PAGE_MD)
            .ok_or_else(|| CoreError::NotFound(format!("edited copy {}", copy.display())))
    }

    /// The page `page.md` was written from: the saved page if it is that revision, else the version of that
    /// revision, else the saved page again, which is only a guess.
    fn base_of(
        &self,
        dir: &Path,
        revision: Option<RevisionId>,
        (saved, base_rev): (&[u8], RevisionId),
    ) -> Result<(Page, bool), CoreError> {
        let read_saved = || -> Result<Page, CoreError> { Ok(self.ctx.codec.read_page(saved, &self.ctx.limits)?.page) };
        match revision {
            Some(rev) if rev == base_rev => Ok((read_saved()?, true)),
            Some(rev) => match self.ctx.backend.open_version(dir, rev) {
                Ok(read) => Ok((read.page, true)),
                Err(_) => Ok((read_saved()?, false)),
            },
            None => Ok((read_saved()?, false)),
        }
    }

    /// The edits that make a plan's changes: page fields, new text, new blocks, and deleted blocks.
    fn edits_for(&self, plan: &MarkdownImport) -> Vec<Edit> {
        let mut edits = Vec::new();
        if plan.title.is_some() || plan.tags.is_some() {
            edits.push(Edit::SetPage {
                title: plan.title.clone(),
                tags: plan.tags.clone(),
                view: None,
            });
        }
        let mut removed = Vec::new();
        for change in &plan.changes {
            match change {
                TextChange::Replace { block, markdown } => edits.push(Edit::SetText {
                    block: *block,
                    markdown: markdown.clone(),
                }),
                TextChange::Insert {
                    after,
                    before,
                    markdown,
                } => edits.push(Edit::InsertBlock {
                    block: self.new_text_block(markdown),
                    after: *after,
                    before: *before,
                }),
                TextChange::Remove { block } => removed.push(*block),
            }
        }
        if !removed.is_empty() {
            edits.push(Edit::DeleteBlocks { blocks: removed });
        }
        edits
    }

    fn new_text_block(&self, markdown: &str) -> NewBlock {
        let data = serde_json::json!({ "markdown": markdown });
        NewBlock {
            id: BlockId::generate(self.ctx.clock.as_ref()),
            type_name: "text".into(),
            frame: None,
            data: data.as_object().cloned().unwrap_or_default(),
            fallback: None,
        }
    }
}

/// The revision a `page.md` says it was written from, in its front matter.
fn revision_of(text: &str) -> Option<RevisionId> {
    let line = text
        .lines()
        .take(20)
        .find_map(|line| line.trim().strip_prefix("revision:"))?;
    RevisionId::parse(line.trim().trim_matches('"')).ok()
}
