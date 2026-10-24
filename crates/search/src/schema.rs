//! The SQLite schema of the index. The index is a cache, so a change to the schema raises the version and the
//! next start builds a new file. Nothing migrates.

use rusqlite::config::DbConfig;
use rusqlite::limits::Limit;
use rusqlite::Connection;

use crate::error::Result;

/// The version of the schema, kept in `PRAGMA user_version`.
pub const SCHEMA_VERSION: i64 = 6;

/// The longest string or blob a connection accepts. SQLite's default is a billion bytes. No page comes near this,
/// and a file the app did not write cannot make it read a larger value.
const MAX_VALUE_BYTES: i32 = 128 << 20;

/// The weights of the full-text columns for the text part of ranking, in column order: title, tags, then one
/// per block kind. The title weighs more here, and [`crate::rank`] adds its own bonus for how well the title
/// matches, so a page whose title holds the words still comes first.
pub const RANK_WEIGHTS: &str = "4.0, 3.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0";

const TABLES: &str = "
CREATE TABLE pages (
    rid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    notebook TEXT NOT NULL,
    section TEXT NOT NULL,
    revision TEXT,
    title TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    created INTEGER NOT NULL,
    modified INTEGER NOT NULL,
    -- The fingerprint of the page file that was read, to tell later whether the file changed.
    fingerprint TEXT,
    -- The title the links to the page were last brought up to date with. See `crate::settle`.
    settled TEXT NOT NULL DEFAULT ''
);
CREATE INDEX pages_title ON pages(title_norm);
CREATE INDEX pages_notebook ON pages(notebook);
CREATE INDEX pages_section ON pages(section);
CREATE INDEX pages_modified ON pages(modified);

CREATE TABLE tags (
    page INTEGER NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (tag, page)
) WITHOUT ROWID;
CREATE INDEX tags_page ON tags(page);

CREATE TABLE blocks (
    page INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (page, ord)
) WITHOUT ROWID;

CREATE TABLE headings (
    page INTEGER NOT NULL,
    block TEXT NOT NULL,
    level INTEGER NOT NULL,
    text TEXT NOT NULL,
    norm TEXT NOT NULL
);
CREATE INDEX headings_page ON headings(page);

CREATE TABLE links (
    page INTEGER NOT NULL,
    block TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    title_norm TEXT,
    target TEXT,
    fragment TEXT,
    raw TEXT NOT NULL
);
CREATE INDEX links_page ON links(page);
CREATE INDEX links_title ON links(title_norm);
CREATE INDEX links_target ON links(target);

-- The titles a page had before it was renamed, so a title link that no edit has reached yet still finds it. They
-- are kept by page ID, so they outlive the page's row when its notebook closes, and a rebuild carries them over.
CREATE TABLE aliases (
    page TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    title TEXT NOT NULL,
    at INTEGER NOT NULL,
    -- 1 for a title the page kept, 0 for one it had only while the person was still typing the title.
    settled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (title_norm, page)
) WITHOUT ROWID;
CREATE INDEX aliases_page ON aliases(page);

-- What the file says about itself: whether a build finished, and whether the last run ended cleanly.
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
";

// One row for each page. A contentless table keeps only the index, because the text lives in `blocks`. The
// columns hold folded words one space apart (see `crate::text`), so the tokenizer only splits at the spaces. It
// keeps marks inside a word, and it leaves accents alone because the folding already decided which ones go.
const FULL_TEXT: &str = "
CREATE VIRTUAL TABLE page_fts USING fts5(
    title, tags, text, tables, images, files, ink, other,
    content = '',
    contentless_delete = 1,
    tokenize = \"unicode61 remove_diacritics 0 categories 'L* N* Co M*'\",
    prefix = '2 3 4'
);
";

/// Sets the options every connection needs.
///
/// The file is a cache, so a power cut may cost the last writes but never the notes. Setting `secure_delete`
/// zeroes deleted text, so a page that turns out to be encrypted leaves nothing in the file (spec 5.7).
pub fn configure(conn: &Connection) -> Result<()> {
    harden(conn)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "secure_delete", "ON")?;
    conn.pragma_update(None, "cache_size", -16_384)?;
    conn.set_prepared_statement_cache_capacity(64);
    Ok(())
}

/// Guards a connection against a file the app did not write. Views and triggers in it may not call app functions,
/// SQL cannot damage the file on purpose, and no value may be larger than [`MAX_VALUE_BYTES`].
pub fn harden(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "trusted_schema", "OFF")?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    conn.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)?;
    Ok(())
}

/// Whether a database holds exactly the tables, indexes, and full-text table this schema makes, and nothing
/// else. A file with the right version can still lack a table, or hold a view or a trigger.
pub fn has_expected_shape(conn: &Connection) -> Result<bool> {
    let expected = Connection::open_in_memory()?;
    create(&expected)?;
    Ok(shape(conn)? == shape(&expected)?)
}

/// Every object of a database's schema, with the SQL that made it.
fn shape(conn: &Connection) -> Result<Vec<(String, String, Option<String>)>> {
    let mut statement = conn.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Creates the tables of an empty database.
pub fn create(conn: &Connection) -> Result<()> {
    conn.execute_batch(TABLES)?;
    conn.execute_batch(FULL_TEXT)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// Whether the database was made by this version of the schema.
pub fn is_current(conn: &Connection) -> Result<bool> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    Ok(version == SCHEMA_VERSION)
}
