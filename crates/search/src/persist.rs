//! The index file: surviving a crash, replacing a bad file, and rebuilding without a gap in search.
//!
//! The index is a cache of the notes, so no failure here can lose a note. What it must do is never serve wrong
//! answers and never leave the person without search for long.
//!
//! # Opening
//!
//! [`SearchIndex::open`] decides what to do with the file it finds. A missing file becomes a new empty index
//! ([`OpenStatus::Created`]). A file from another schema version, or one that is not a database, is deleted and
//! replaced ([`OpenStatus::Replaced`]). A file that was closed cleanly last time is used as it is
//! ([`OpenStatus::Reused`]). A file left open when the app stopped is checked first. It is used if it passes
//! ([`OpenStatus::Unclean`]) and deleted if it fails.
//!
//! A clean stop writes `dirty = 0` into the file's `meta` table, and opening writes `dirty = 1`. A crash leaves
//! the 1 behind. Only then does opening pay for SQLite's quick check and a comparison of the page table with
//! the full-text table. Either way, a caller that sees [`SearchIndex::was_created`] or
//! [`SearchIndex::was_unclean`] should compare the index with the notes. The indexer's reconcile does this, so
//! pages saved just before the crash are not missed.
//!
//! # Rebuilding
//!
//! A rebuild writes a second file, `<name>.building`, and swaps it in only when it is complete. Search keeps
//! answering from the old file until then.
//!
//! [`SearchIndex::begin_rebuild`] starts the new file and deletes a leftover half-built one first. The caller
//! fills [`Rebuild::index`] with every page. This takes as long as it takes, and no lock on the old index is
//! needed. [`SearchIndex::finish_rebuild`] then merges the new file, marks it ready, and closes it. It removes
//! the old file's write-ahead log and renames the new file over the old one. A rename is atomic, so a crash
//! leaves either the old file or the new one, never a mix. Opening deletes a `.building` file it finds beside a
//! good main file.
//!
//! Dropping a [`Rebuild`] without finishing it deletes its file. [`SearchIndex::rebuild_with`] does the three
//! steps for a caller that does not need search to answer in between.

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::PageId;
use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::error::Result;
use crate::index::SearchIndex;
use crate::schema;
use crate::text::fold;

/// What opening an index file found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenStatus {
    /// There was no file, so the index is new and empty.
    Created,
    /// The file was closed cleanly last time, and it is used as it is.
    Reused,
    /// The app stopped without closing the file. It passed its check and is used, but it may lack the last
    /// saves.
    Unclean,
    /// The file could not be used, so it was deleted and the index is new and empty.
    Replaced(ReplaceReason),
}

/// Why a file was replaced.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplaceReason {
    /// It is not a database, or it is too damaged to read.
    Unreadable,
    /// It was made by another version of the schema.
    OtherVersion,
    /// The app stopped without closing it, and it failed its check.
    FailedCheck,
    /// It has the right version but not the tables of that version, or more than those.
    WrongTables,
}

/// The name of a file that sits beside the index file, such as its build in progress.
fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn building_path(path: &Path) -> PathBuf {
    beside(path, ".building")
}

/// Deletes a SQLite file and its write-ahead log and shared-memory files. A file that is not there is fine.
pub(crate) fn remove_files(path: &Path) -> Result<()> {
    for suffix in ["", "-wal", "-shm"] {
        match fs::remove_file(beside(path, suffix)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Deletes only the write-ahead log and shared-memory file of a database.
fn remove_log(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm"] {
        match fs::remove_file(beside(path, suffix)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Reads a value of the `meta` table.
pub(crate) fn read_meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()?)
}

/// Writes a value of the `meta` table.
pub(crate) fn write_meta(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

/// SQLite's own quick check of the file's structure.
pub(crate) fn quick_check(conn: &Connection) -> bool {
    let verdict: rusqlite::Result<String> = conn.query_row("PRAGMA quick_check", [], |row| row.get(0));
    verdict.is_ok_and(|text| text == "ok")
}

/// The quick check, and every page having one full-text row and the other way round.
fn passes_check(conn: &Connection) -> bool {
    let same: rusqlite::Result<bool> = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM pages) = (SELECT COUNT(*) FROM page_fts_docsize)
            AND NOT EXISTS (SELECT 1 FROM pages p
                            WHERE NOT EXISTS (SELECT 1 FROM page_fts_docsize d WHERE d.id = p.rid))",
        [],
        |row| row.get(0),
    );
    quick_check(conn) && same.unwrap_or(false)
}

enum Probe {
    Ready { conn: Connection, unclean: bool },
    OtherVersion,
    WrongTables,
    Unreadable,
}

fn probe(path: &Path) -> Probe {
    let Ok(conn) = Connection::open(path) else {
        return Probe::Unreadable;
    };
    if schema::configure(&conn).is_err() {
        return Probe::Unreadable;
    }
    match schema::is_current(&conn) {
        Ok(true) => {}
        Ok(false) => return Probe::OtherVersion,
        Err(_) => return Probe::Unreadable,
    }
    match schema::has_expected_shape(&conn) {
        Ok(true) => {}
        Ok(false) => return Probe::WrongTables,
        Err(_) => return Probe::Unreadable,
    }
    match read_meta(&conn, "dirty") {
        Ok(value) => Probe::Ready {
            conn,
            unclean: value.as_deref() != Some("0"),
        },
        Err(_) => Probe::Unreadable,
    }
}

/// Whether a file is a finished build of the current schema.
fn is_finished_build(path: &Path) -> bool {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    schema::is_current(&conn).unwrap_or(false)
        && read_meta(&conn, "state").ok().flatten().as_deref() == Some("ready")
        && quick_check(&conn)
}

/// Deals with a build left beside the index file by a stop in the middle of a rebuild.
fn settle_build(path: &Path) -> Result<()> {
    let building = building_path(path);
    if !building.exists() {
        return Ok(());
    }
    if !path.exists() && is_finished_build(&building) {
        remove_log(&building)?;
        remove_log(path)?;
        fs::rename(&building, path)?;
        return Ok(());
    }
    remove_files(&building)
}

fn open_connection(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    schema::configure(&conn)?;
    Ok(conn)
}

fn create_connection(path: &Path) -> Result<Connection> {
    let conn = open_connection(path)?;
    schema::create(&conn)?;
    Ok(conn)
}

/// Opens or makes the index file. See the module documentation for the rules.
pub(crate) fn open_file(path: &Path) -> Result<SearchIndex> {
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent)?;
    }
    settle_build(path)?;
    let mut status = OpenStatus::Created;
    let mut carried = Vec::new();
    if path.exists() {
        let reason = match probe(path) {
            Probe::Ready { conn, unclean } if !unclean || passes_check(&conn) => {
                // The first write can be the first read of a damaged page. That file is replaced too.
                match write_meta(&conn, "dirty", "1") {
                    Ok(()) => {
                        let status = if unclean {
                            OpenStatus::Unclean
                        } else {
                            OpenStatus::Reused
                        };
                        return Ok(SearchIndex::wrap(conn, Some(path.to_path_buf()), status));
                    }
                    Err(error) if error.is_corrupt() => ReplaceReason::Unreadable,
                    Err(error) => return Err(error),
                }
            }
            Probe::Ready { .. } => ReplaceReason::FailedCheck,
            Probe::OtherVersion => ReplaceReason::OtherVersion,
            Probe::WrongTables => ReplaceReason::WrongTables,
            Probe::Unreadable => ReplaceReason::Unreadable,
        };
        if reason != ReplaceReason::Unreadable {
            carried = salvage_aliases(path);
        }
        status = OpenStatus::Replaced(reason);
        remove_files(path)?;
    }
    let conn = create_connection(path)?;
    write_aliases(&conn, &carried)?;
    write_meta(&conn, "dirty", "1")?;
    Ok(SearchIndex::wrap(conn, Some(path.to_path_buf()), status))
}

/// An earlier title of a page: the page's ID, the folded title, the title, when the page left it, and whether
/// the page kept it.
type AliasRow = (String, String, String, i64, bool);

/// The earlier titles a file holds.
fn read_aliases(conn: &Connection) -> Result<Vec<AliasRow>> {
    let mut statement = conn.prepare("SELECT page, title_norm, title, at, settled FROM aliases")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Adds earlier titles to a file, and drops those that a page of the file has as its title now.
fn write_aliases(conn: &Connection, rows: &[AliasRow]) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut statement = conn
        .prepare("INSERT OR IGNORE INTO aliases (page, title_norm, title, at, settled) VALUES (?1, ?2, ?3, ?4, ?5)")?;
    for (page, norm, title, at, settled) in rows {
        statement.execute(rusqlite::params![page, norm, title, at, settled])?;
    }
    conn.execute(
        "DELETE FROM aliases WHERE title_norm = ''
            OR EXISTS (SELECT 1 FROM pages p WHERE p.id = aliases.page AND p.title_norm = aliases.title_norm)",
        [],
    )?;
    Ok(())
}

/// The earlier titles of pages in a file about to be replaced, read as well as the file allows. They exist only
/// in the index, so losing them would break the links that still name an old title. Older versions kept them by
/// the page's row, so the page's ID is looked up, and every title is folded again by today's rules.
fn salvage_aliases(path: &Path) -> Vec<AliasRow> {
    let read = || -> Result<Vec<AliasRow>> {
        let conn = Connection::open(path)?;
        schema::harden(&conn)?;
        let mut statement = conn.prepare(
            "SELECT COALESCE(p.id, a.page), a.title, a.at FROM aliases a
             LEFT JOIN pages p ON typeof(a.page) = 'integer' AND p.rid = a.page",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for (page, title, at) in rows.flatten() {
            if page.parse::<PageId>().is_ok() {
                out.push((page, fold(&title), title, at, true));
            }
        }
        Ok(out)
    };
    read().unwrap_or_default()
}

/// Runs SQLite's quick check on a file through a connection of its own, so the connection that serves searches
/// is not held up. A file that cannot be opened for the check counts as passing, since nothing was learned.
pub(crate) fn file_passes_quick_check(path: &Path) -> bool {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    match Connection::open_with_flags(path, flags) {
        Ok(conn) => schema::harden(&conn).is_err() || quick_check(&conn),
        Err(_) => true,
    }
}

/// A new index being filled beside the live one. See the module documentation.
pub struct Rebuild {
    next: Option<SearchIndex>,
    side: Option<PathBuf>,
}

impl Rebuild {
    /// The new index, empty at first, for the caller to fill.
    pub fn index(&mut self) -> &mut SearchIndex {
        self.next.as_mut().expect("a rebuild holds its index until it finishes")
    }
}

impl Drop for Rebuild {
    fn drop(&mut self) {
        drop(self.next.take());
        if let Some(side) = &self.side {
            let _ = remove_files(side);
        }
    }
}

impl SearchIndex {
    /// Starts a rebuild: a new, empty index beside this one. See the module documentation.
    pub fn begin_rebuild(&self) -> Result<Rebuild> {
        match &self.path {
            None => Ok(Rebuild {
                next: Some(SearchIndex::open_in_memory()?),
                side: None,
            }),
            Some(path) => {
                let side = building_path(path);
                remove_files(&side)?;
                let conn = create_connection(&side)?;
                write_meta(&conn, "state", "building")?;
                write_meta(&conn, "dirty", "1")?;
                Ok(Rebuild {
                    next: Some(SearchIndex::wrap(conn, Some(side.clone()), OpenStatus::Created)),
                    side: Some(side),
                })
            }
        }
    }

    /// Swaps a filled rebuild in for this index. If the swap fails, this index keeps serving from the old file.
    pub fn finish_rebuild(&mut self, mut rebuild: Rebuild) -> Result<()> {
        let Some(mut next) = rebuild.next.take() else {
            return Ok(());
        };
        // Earlier titles live only in the index, so they move to the new file instead of being lost.
        write_aliases(&next.conn, &read_aliases(&self.conn).unwrap_or_default())?;
        next.optimize()?;
        write_meta(&next.conn, "state", "ready")?;
        let Some(path) = self.path.clone() else {
            std::mem::swap(&mut self.conn, &mut next.conn);
            self.renew_generation();
            return Ok(());
        };
        let side = rebuild.side.clone().unwrap_or_else(|| building_path(&path));
        next.close()?;
        remove_log(&side)?;
        // Close this index's file, so the system lets go of it and its log can be removed with it.
        drop(std::mem::replace(&mut self.conn, Connection::open_in_memory()?));
        remove_log(&path)?;
        let renamed = fs::rename(&side, &path);
        self.conn = open_connection(&path)?;
        renamed?;
        write_meta(&self.conn, "dirty", "1")?;
        self.status = OpenStatus::Reused;
        self.renew_generation();
        Ok(())
    }

    /// Rebuilds the index in one go: `populate` fills a new index, and it replaces this one when it returns.
    /// An error leaves this index as it was.
    pub fn rebuild_with(&mut self, populate: impl FnOnce(&mut SearchIndex) -> Result<()>) -> Result<()> {
        let mut rebuild = self.begin_rebuild()?;
        populate(rebuild.index())?;
        self.finish_rebuild(rebuild)
    }
}

#[cfg(test)]
mod tests;
