//! Check notebook's repairs through the core (A2-2). Writing `page.md` again runs with the notebook open, through
//! the same code a save uses, so an edited copy is kept aside first. Putting back `page.json` or another stored
//! file closes the notebook first, which saves and closes its pages and journals, and opens it again afterwards,
//! as a folder rename does. Every repair returns what it replaced, and [`Core::undo_repair`] puts that back.

use std::path::Path;

use super::Core;
use crate::error::CoreError;
use crate::store::layout::{NotebookLayout, PAGE_MD};
use crate::store::repair::{self, Repair, RepairUndo};

impl Core {
    /// Runs one repair on the open notebook at `notebook`.
    pub fn repair(&self, notebook: &Path, repair: &Repair) -> Result<RepairUndo, CoreError> {
        let open = self.writable_open(notebook)?;
        let ctx = self.ctx().clone();
        if let Repair::PageMd { page } = repair {
            repair::inside(notebook, page)?;
            let bytes = ctx
                .fs
                .read(&NotebookLayout::page_json(page), ctx.limits.page_json_bytes)?;
            let read = ctx.codec.read_page(&bytes, &ctx.limits)?;
            let path = page.join(PAGE_MD);
            let previous = repair::current(ctx.fs.as_ref(), &path)?;
            let links = open.readable_links(page, &read.page);
            ctx.backend.write_readable(page, &read.page, &links)?;
            return Ok(RepairUndo { path, previous });
        }
        open.close()?;
        let result = repair::apply_closed(ctx.fs.as_ref(), ctx.codec.as_ref(), &ctx.limits, notebook, repair);
        self.open_notebook(notebook)?;
        result
    }

    /// Puts back what a repair replaced. A stored file is put back with the notebook closed.
    pub fn undo_repair(&self, notebook: &Path, undo: &RepairUndo) -> Result<(), CoreError> {
        let open = self.writable_open(notebook)?;
        let ctx = self.ctx().clone();
        let readable = undo.path.file_name().is_some_and(|name| name == PAGE_MD);
        if readable {
            return repair::undo(ctx.fs.as_ref(), notebook, undo);
        }
        open.close()?;
        let result = repair::undo(ctx.fs.as_ref(), notebook, undo);
        self.open_notebook(notebook)?;
        result
    }
}
