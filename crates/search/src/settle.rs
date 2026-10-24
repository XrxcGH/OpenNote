//! Settled titles: when a rename is real enough for the links to follow it.
//!
//! Titles are saved while they are typed. A page that is being named "Physics Lab Report" may be saved as
//! "Physics" on the way. If links followed every saved title, that pause would capture every `[[Physics]]` link
//! of the notebooks, which were meant for another page. So the index remembers, for each page, the title the
//! links were last brought up to date with: its settled title.
//!
//! A write that changes a title keeps the old title as an alias, so links that name it still find the page. It
//! does not touch the settled title. [`SearchIndex::settle_title`] then makes the current title the settled one.
//! It returns the rename from the old settled title, whose links found this page before the rename began. It
//! also forgets the aliases of titles the page had only on the way. The indexer settles a title when the
//! interface says the person finished editing it, or once it has stayed long enough.

use opennote_core::PageId;
use rusqlite::{params, OptionalExtension};

use crate::error::Result;
use crate::index::{parse_id, SearchIndex};
use crate::links::Rename;

impl SearchIndex {
    /// Makes a page's current title its settled title. Returns the rename from the title it had settled on
    /// before, or `None` when the title did not change since. Either way, the aliases of the titles the page had
    /// only on the way are forgotten.
    ///
    /// The links that name the old title need [`SearchIndex::rename_edits`] with the returned rename.
    pub fn settle_title(&mut self, page: PageId) -> Result<Option<Rename>> {
        let tx = self.conn.transaction()?;
        let id = page.to_string();
        let row: Option<(String, String)> = tx
            .prepare_cached("SELECT title, settled FROM pages WHERE id = ?1")?
            .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?;
        let Some((title, settled)) = row else {
            return Ok(None);
        };
        tx.prepare_cached("DELETE FROM aliases WHERE page = ?1 AND settled = 0")?
            .execute([&id])?;
        tx.prepare_cached("UPDATE pages SET settled = title WHERE id = ?1")?
            .execute([&id])?;
        tx.commit()?;
        self.touch();
        Ok((title != settled).then_some(Rename {
            page,
            old_title: settled,
            new_title: title,
        }))
    }

    /// The pages whose title changed since it last settled.
    pub fn unsettled_pages(&self) -> Result<Vec<PageId>> {
        let mut statement = self
            .conn
            .prepare_cached("SELECT id FROM pages WHERE title != settled ORDER BY rid")?;
        let rows = statement.query_map(params![], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(parse_id(&row?)?);
        }
        Ok(out)
    }
}
