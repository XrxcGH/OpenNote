//! The index: opening it, telling what it holds, and closing it.
//!
//! The file lifecycle (surviving a crash, replacing a damaged file, and rebuilding without a gap in search)
//! lives in [`crate::persist`].

use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};

use opennote_core::{NotebookId, PageId, RevisionId, SectionId, Timestamp};
use rusqlite::{Connection, OptionalExtension};

use crate::error::{Result, SearchError};
use crate::persist::{self, OpenStatus};
use crate::schema;

/// A page the index holds, and the state it was indexed from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IndexedPage {
    /// The page.
    pub page: PageId,
    /// Its notebook.
    pub notebook: NotebookId,
    /// Its section.
    pub section: SectionId,
    /// The revision indexed. A page whose saved revision differs needs indexing again.
    pub revision: Option<RevisionId>,
    /// The page's `modified` time when it was indexed.
    pub modified: Timestamp,
    /// The page's title when it was indexed.
    pub title: String,
    /// The fingerprint of the page file that was indexed, if the source gave one.
    pub fingerprint: Option<String>,
}

/// The search index: a SQLite file that can be deleted and rebuilt from the notes at any time.
///
/// Writes take `&mut self` and reads take `&self`, so an app shares one index behind a lock.
pub struct SearchIndex {
    pub(crate) conn: Connection,
    pub(crate) path: Option<PathBuf>,
    pub(crate) status: OpenStatus,
    generation: u64,
    /// `false` once [`SearchIndex::close`] has run, so dropping the index does not close it twice.
    pub(crate) running: bool,
}

/// Each index starts its generation in a range of its own. A cache that saw one index then never mistakes
/// another for unchanged, such as the one a rebuild swaps in.
static NEXT_EPOCH: AtomicU64 = AtomicU64::new(1);

pub(crate) fn new_epoch() -> u64 {
    NEXT_EPOCH.fetch_add(1, Ordering::Relaxed) << 32
}

impl SearchIndex {
    pub(crate) fn wrap(conn: Connection, path: Option<PathBuf>, status: OpenStatus) -> SearchIndex {
        SearchIndex {
            conn,
            path,
            status,
            generation: new_epoch(),
            running: true,
        }
    }

    /// Opens the index file at `path`, or makes an empty one.
    ///
    /// Three kinds of file are deleted and replaced. One is from another version of the schema. One is not a
    /// database. One failed its check after the app stopped without closing it. The app may have stopped before
    /// swapping in a build. A finished build is then completed, and a half-built one is thrown away.
    /// [`SearchIndex::status`] tells what happened, and [`SearchIndex::was_created`] tells the caller to index
    /// every page again.
    pub fn open(path: &Path) -> Result<SearchIndex> {
        persist::open_file(path)
    }

    /// An empty index in memory, for tests and short-lived tools.
    pub fn open_in_memory() -> Result<SearchIndex> {
        let conn = Connection::open_in_memory()?;
        schema::configure(&conn)?;
        schema::create(&conn)?;
        Ok(SearchIndex::wrap(conn, None, OpenStatus::Created))
    }

    /// What opening found: a new file, the file as it was left, or a replacement for a bad one.
    pub fn status(&self) -> &OpenStatus {
        &self.status
    }

    /// Whether this call made a new, empty index. The caller then indexes every page again.
    pub fn was_created(&self) -> bool {
        matches!(self.status, OpenStatus::Created | OpenStatus::Replaced(_))
    }

    /// Whether the app stopped last time without closing the index. The file passed its check, but the caller
    /// should compare it with the pages on disk, because the last saves may not have reached it.
    pub fn was_unclean(&self) -> bool {
        self.status == OpenStatus::Unclean
    }

    /// The file the index lives in, or `None` for an index in memory.
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// A number that grows with every write. A cache of what the index holds, such as the quick switcher's
    /// list of titles, is stale when this differs from the number it saw.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn touch(&mut self) {
        self.generation += 1;
    }

    pub(crate) fn renew_generation(&mut self) {
        self.generation = new_epoch();
    }

    /// Runs SQLite's quick consistency check. `false` means the file is damaged and should be rebuilt.
    pub fn is_healthy(&self) -> bool {
        persist::quick_check(&self.conn)
    }

    /// How many pages the index holds.
    pub fn page_count(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))?;
        Ok(usize::try_from(count).unwrap_or(0))
    }

    /// What the index knows of one page, if it holds the page.
    pub fn indexed_page(&self, page: PageId) -> Result<Option<IndexedPage>> {
        let sql = format!("{SELECT_INDEXED} WHERE id = ?1");
        let row = self.conn.query_row(&sql, [page.to_string()], read_indexed).optional()?;
        row.map(IndexedRow::into_page).transpose()
    }

    /// Every page the index holds, to compare with the pages on disk after a start or a sync.
    pub fn indexed_pages(&self) -> Result<Vec<IndexedPage>> {
        let mut statement = self.conn.prepare(SELECT_INDEXED)?;
        let rows = statement.query_map([], read_indexed)?;
        rows.map(|row| row?.into_page()).collect()
    }

    /// Closes the index and records a clean stop, so the next start trusts the file without checking it.
    pub fn close(mut self) -> Result<()> {
        self.shut_down()
    }

    /// Marks a clean stop and folds the write-ahead log into the file.
    fn shut_down(&mut self) -> Result<()> {
        if !self.running {
            return Ok(());
        }
        self.running = false;
        if self.path.is_some() {
            persist::write_meta(&self.conn, "dirty", "0")?;
            self.conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
        }
        Ok(())
    }
}

impl Drop for SearchIndex {
    fn drop(&mut self) {
        // A crash never gets here, and that is how the next start knows the stop was not clean.
        let _ = self.shut_down();
    }
}

const SELECT_INDEXED: &str = "SELECT id, notebook, section, revision, modified, title, fingerprint FROM pages";

struct IndexedRow(String, String, String, Option<String>, i64, String, Option<String>);

fn read_indexed(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedRow> {
    Ok(IndexedRow(
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
    ))
}

impl IndexedRow {
    fn into_page(self) -> Result<IndexedPage> {
        Ok(IndexedPage {
            page: parse_id(&self.0)?,
            notebook: parse_id(&self.1)?,
            section: parse_id(&self.2)?,
            revision: self.3.as_deref().map(parse_id).transpose()?,
            modified: Timestamp::from_unix_ms(self.4),
            title: self.5,
            fingerprint: self.6,
        })
    }
}

/// Parses an ID that the index stored.
pub(crate) fn parse_id<T: FromStr>(text: &str) -> Result<T> {
    text.parse().map_err(|_| SearchError::BadId(text.to_string()))
}
