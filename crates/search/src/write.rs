//! Changing the index: incremental updates and deletes by page, section, or notebook.

use opennote_core::{NotebookId, PageId, SectionId};
use rusqlite::{params, OptionalExtension, Transaction};

use crate::doc::{BlockKind, PageDoc};
use crate::error::Result;
use crate::index::SearchIndex;
use crate::links::{LinkKind, Rename};
use crate::prepare::{prepare, Prepared};
use crate::text::index_text;

/// How many earlier titles the index remembers for each page.
pub(crate) const MAX_ALIASES: usize = 16;

/// What a batch of writes did, beyond storing the pages.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WriteReport {
    /// Pages the index did not hold before.
    pub added: Vec<PageId>,
    /// Pages the index held and wrote again.
    pub updated: Vec<PageId>,
    /// Pages that were locked, so the index holds nothing of them now.
    pub removed: Vec<PageId>,
    /// Pages whose title changed since the index last wrote them. Until the links are rewritten, a
    /// [`Resolver`](crate::Resolver) finds the page by its old title. Titles are saved while they are typed, so
    /// the links follow only a title that settled: see [`SearchIndex::settle_title`].
    pub renames: Vec<Rename>,
}

impl SearchIndex {
    /// Adds a page, or replaces what the index holds of it. One transaction keeps the index whole if the app
    /// stops half way.
    ///
    /// A locked page (an encrypted section) is never indexed. Anything the index held of it is removed and
    /// wiped from the file, which rewrites the whole full-text index once (spec 5.7).
    pub fn upsert(&mut self, doc: &PageDoc) -> Result<()> {
        self.upsert_many(std::slice::from_ref(doc))
    }

    /// Adds or replaces many pages in one transaction, which is much faster than one at a time.
    pub fn upsert_many(&mut self, docs: &[PageDoc]) -> Result<()> {
        self.write(docs).map(|_| ())
    }

    /// Like [`SearchIndex::upsert_many`], and reports which pages were new and which were renamed.
    pub fn write(&mut self, docs: &[PageDoc]) -> Result<WriteReport> {
        let prepared: Vec<Option<Prepared>> = docs.iter().map(prepare_unless_locked).collect();
        self.write_prepared(docs, &prepared)
    }

    /// Writes pages whose rows were prepared beforehand, so the caller can do that work without holding the
    /// index's lock. `prepared` holds one entry for each document, `None` for a locked one.
    pub(crate) fn write_prepared(&mut self, docs: &[PageDoc], prepared: &[Option<Prepared>]) -> Result<WriteReport> {
        let tx = self.conn.transaction()?;
        let mut report = WriteReport::default();
        let mut purged = false;
        for (at, doc) in docs.iter().enumerate() {
            let rows = prepared.get(at).and_then(Option::as_ref);
            purged |= write_doc(&tx, doc, rows, &mut report)?;
        }
        tx.commit()?;
        self.touch();
        if purged {
            self.scrub()?;
        }
        Ok(report)
    }

    /// Changes the notebook and section a page is filed under, without reading the page again. A move in the
    /// navigation tree changes neither the page's text nor its links. Returns whether the index held the page.
    pub fn relocate(&mut self, page: PageId, notebook: NotebookId, section: SectionId) -> Result<bool> {
        let changed = self.conn.execute(
            "UPDATE pages SET notebook = ?2, section = ?3 WHERE id = ?1",
            params![page.to_string(), notebook.to_string(), section.to_string()],
        )?;
        self.touch();
        Ok(changed > 0)
    }

    /// Removes a page. Returns whether the index held it.
    pub fn delete_page(&mut self, page: PageId) -> Result<bool> {
        let tx = self.conn.transaction()?;
        let rid = find_rid(&tx, page)?;
        if let Some(rid) = rid {
            remove_rows(&tx, rid, Aliases::Forget)?;
        }
        tx.commit()?;
        self.touch();
        Ok(rid.is_some())
    }

    /// Removes every page of a section. Returns how many.
    pub fn delete_section(&mut self, section: SectionId) -> Result<usize> {
        self.delete_where("section", &section.to_string(), Aliases::Forget)
    }

    /// Removes every page of a notebook, as when it closes. Returns how many. The earlier titles of its pages
    /// stay, so they still resolve once the notebook opens again.
    pub fn delete_notebook(&mut self, notebook: NotebookId) -> Result<usize> {
        self.delete_where("notebook", &notebook.to_string(), Aliases::Keep)
    }

    /// Removes every page of a section and wipes their text from the file. Call it when a section becomes
    /// encrypted, because a plain delete leaves the words in the full-text segments until they merge.
    /// Returns how many pages it removed.
    pub fn purge_section(&mut self, section: SectionId) -> Result<usize> {
        let removed = self.delete_where("section", &section.to_string(), Aliases::Forget)?;
        self.scrub()?;
        Ok(removed)
    }

    /// Removes everything, ready for a full rebuild.
    pub fn clear(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        for table in ["tags", "blocks", "headings", "links", "aliases", "pages"] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        tx.execute("INSERT INTO page_fts(page_fts) VALUES ('delete-all')", [])?;
        tx.commit()?;
        self.touch();
        self.scrub()
    }

    /// Merges the full-text segments, which speeds up queries after a large build.
    pub fn optimize(&mut self) -> Result<()> {
        self.conn
            .execute("INSERT INTO page_fts(page_fts) VALUES ('optimize')", [])?;
        Ok(())
    }

    fn delete_where(&mut self, column: &str, id: &str, aliases: Aliases) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let rids: Vec<i64> = {
            let mut statement = tx.prepare(&format!("SELECT rid FROM pages WHERE {column} = ?1"))?;
            let rows = statement.query_map([id], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for rid in &rids {
            remove_rows(&tx, *rid, aliases)?;
        }
        tx.commit()?;
        self.touch();
        Ok(rids.len())
    }

    /// Wipes deleted text from the file. A merge of every segment drops the words of deleted pages, and
    /// `secure_delete` zeroes the freed pages. The checkpoint then folds the write-ahead log into the file.
    fn scrub(&mut self) -> Result<()> {
        self.optimize()?;
        self.conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        Ok(())
    }
}

fn find_rid(tx: &Transaction<'_>, page: PageId) -> Result<Option<i64>> {
    let mut statement = tx.prepare_cached("SELECT rid FROM pages WHERE id = ?1")?;
    Ok(statement.query_row([page.to_string()], |row| row.get(0)).optional()?)
}

/// A page row as the index holds it, before a write replaces it.
struct Existing {
    rid: i64,
    title: String,
    title_norm: String,
    /// The title the links were last brought up to date with.
    settled: String,
}

fn find_row(tx: &Transaction<'_>, page: PageId) -> Result<Option<Existing>> {
    let mut statement = tx.prepare_cached("SELECT rid, title, title_norm, settled FROM pages WHERE id = ?1")?;
    let row = statement
        .query_row([page.to_string()], |row| {
            Ok(Existing {
                rid: row.get(0)?,
                title: row.get(1)?,
                title_norm: row.get(2)?,
                settled: row.get(3)?,
            })
        })
        .optional()?;
    Ok(row)
}

/// The rows of a page, or `None` for a locked page, which leaves nothing in the index.
pub(crate) fn prepare_unless_locked(doc: &PageDoc) -> Option<Prepared> {
    (!doc.locked).then(|| prepare(doc))
}

/// Writes one page from its prepared rows. Returns whether it removed rows of a page that is now locked.
fn write_doc(tx: &Transaction<'_>, doc: &PageDoc, rows: Option<&Prepared>, report: &mut WriteReport) -> Result<bool> {
    let existing = find_row(tx, doc.page)?;
    if doc.locked {
        if let Some(found) = &existing {
            remove_rows(tx, found.rid, Aliases::Forget)?;
            report.removed.push(doc.page);
        }
        return Ok(existing.is_some());
    }
    let owned;
    let prepared = match rows {
        Some(rows) => rows,
        None => {
            owned = prepare(doc);
            &owned
        }
    };
    let known = existing.as_ref().map(|found| found.rid);
    if let Some(rid) = known {
        remove_children(tx, rid)?;
    }
    let rid = save_page(tx, known, doc, prepared)?;
    insert_children(tx, rid, prepared)?;
    insert_full_text(tx, rid, doc, prepared)?;
    match existing {
        Some(found) => {
            report.updated.push(doc.page);
            if found.title != doc.title {
                keep_alias(tx, &found, doc, prepared)?;
                report.renames.push(Rename {
                    page: doc.page,
                    old_title: found.title,
                    new_title: doc.title.clone(),
                });
            }
        }
        None => report.added.push(doc.page),
    }
    Ok(false)
}

/// Remembers the title a page had, and forgets the alias that its new title makes pointless. A title that never
/// settled is marked, so settling the page forgets it again.
fn keep_alias(tx: &Transaction<'_>, old: &Existing, doc: &PageDoc, prepared: &Prepared) -> Result<()> {
    let page = doc.page.to_string();
    tx.prepare_cached("DELETE FROM aliases WHERE page = ?1 AND title_norm = ?2")?
        .execute(params![page, prepared.title_norm])?;
    if old.title_norm.is_empty() || old.title_norm == prepared.title_norm {
        return Ok(());
    }
    tx.prepare_cached(
        "INSERT INTO aliases (page, title_norm, title, at, settled) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (title_norm, page) DO UPDATE SET
            title = excluded.title, at = excluded.at, settled = MAX(settled, excluded.settled)",
    )?
    .execute(params![
        page,
        old.title_norm,
        old.title,
        doc.modified.unix_ms(),
        old.title == old.settled
    ])?;
    tx.prepare_cached(
        "DELETE FROM aliases WHERE page = ?1 AND title_norm NOT IN
            (SELECT title_norm FROM aliases WHERE page = ?1 ORDER BY at DESC, title_norm LIMIT ?2)",
    )?
    .execute(params![page, MAX_ALIASES as i64])?;
    Ok(())
}

/// Writes the row of a page: a new row when `rid` is `None`, or the row that `rid` names. Returns its `rid`.
fn save_page(tx: &Transaction<'_>, rid: Option<i64>, doc: &PageDoc, prepared: &Prepared) -> Result<i64> {
    let mut statement = tx.prepare_cached(
        "INSERT INTO pages
            (rid, id, notebook, section, revision, title, title_norm, created, modified, fingerprint, settled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?6)
         ON CONFLICT (rid) DO UPDATE SET
            notebook = excluded.notebook, section = excluded.section, revision = excluded.revision,
            title = excluded.title, title_norm = excluded.title_norm,
            created = excluded.created, modified = excluded.modified, fingerprint = excluded.fingerprint",
    )?;
    statement.execute(params![
        rid,
        doc.page.to_string(),
        doc.notebook.to_string(),
        doc.section.to_string(),
        doc.revision.map(|revision| revision.to_string()),
        doc.title,
        prepared.title_norm,
        doc.created.unix_ms(),
        doc.modified.unix_ms(),
        doc.fingerprint,
    ])?;
    Ok(rid.unwrap_or_else(|| tx.last_insert_rowid()))
}

fn remove_children(tx: &Transaction<'_>, rid: i64) -> Result<()> {
    for table in ["tags", "blocks", "headings", "links"] {
        tx.prepare_cached(&format!("DELETE FROM {table} WHERE page = ?1"))?
            .execute([rid])?;
    }
    tx.prepare_cached("DELETE FROM page_fts WHERE rowid = ?1")?
        .execute([rid])?;
    Ok(())
}

/// What a removal does with the earlier titles of a page.
#[derive(Clone, Copy)]
enum Aliases {
    /// The page is gone or locked, so its earlier titles go too.
    Forget,
    /// Only the page's notebook closed. Its earlier titles stay for when the notebook opens again.
    Keep,
}

fn remove_rows(tx: &Transaction<'_>, rid: i64, aliases: Aliases) -> Result<()> {
    remove_children(tx, rid)?;
    if let Aliases::Forget = aliases {
        tx.prepare_cached("DELETE FROM aliases WHERE page = (SELECT id FROM pages WHERE rid = ?1)")?
            .execute([rid])?;
    }
    tx.prepare_cached("DELETE FROM pages WHERE rid = ?1")?.execute([rid])?;
    Ok(())
}

fn insert_children(tx: &Transaction<'_>, rid: i64, prepared: &Prepared) -> Result<()> {
    let mut tag = tx.prepare_cached("INSERT INTO tags (page, tag) VALUES (?1, ?2)")?;
    for name in &prepared.tags {
        tag.execute(params![rid, name])?;
    }
    let mut block = tx.prepare_cached("INSERT INTO blocks (page, ord, id, kind, text) VALUES (?1, ?2, ?3, ?4, ?5)")?;
    let mut heading =
        tx.prepare_cached("INSERT INTO headings (page, block, level, text, norm) VALUES (?1, ?2, ?3, ?4, ?5)")?;
    for (ord, item) in prepared.blocks.iter().enumerate() {
        let id = item.id.to_string();
        block.execute(params![rid, ord as i64, id, item.kind.as_str(), item.text])?;
        for found in &item.headings {
            let norm = crate::text::fold(&found.text);
            heading.execute(params![rid, id, found.level, found.text, norm])?;
        }
    }
    insert_links(tx, rid, prepared)
}

fn insert_links(tx: &Transaction<'_>, rid: i64, prepared: &Prepared) -> Result<()> {
    let mut statement = tx.prepare_cached(
        "INSERT INTO links (page, block, kind, title, title_norm, target, fragment, raw)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for item in &prepared.blocks {
        for link in &item.links {
            let (kind, title_norm, target) = match link.kind {
                LinkKind::Title => ("title", Some(link.title_norm()), None),
                LinkKind::Id => ("id", None, link.target.map(|page| page.to_string())),
            };
            if title_norm.as_deref() == Some("") {
                continue;
            }
            let block = item.id.to_string();
            statement.execute(params![
                rid,
                block,
                kind,
                link.title,
                title_norm,
                target,
                link.fragment,
                link.raw
            ])?;
        }
    }
    Ok(())
}

fn insert_full_text(tx: &Transaction<'_>, rid: i64, doc: &PageDoc, prepared: &Prepared) -> Result<()> {
    let mut statement = tx.prepare_cached(
        "INSERT INTO page_fts (rowid, title, tags, text, tables, images, files, ink, other)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )?;
    // The table stores folded words, the same form a query is folded to. See `crate::text`.
    let [text, tables, images, files, ink, other] = BlockKind::ALL.map(|kind| index_text(&prepared.column(kind)));
    statement.execute(params![
        rid,
        index_text(&doc.title),
        index_text(&prepared.tags.join(" ")),
        text,
        tables,
        images,
        files,
        ink,
        other
    ])?;
    Ok(())
}
