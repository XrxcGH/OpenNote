//! A small reader for SQLite database files, for apps that keep their notes in one, such as Windows Sticky Notes.
//!
//! The reader opens a database as bytes, finds its tables in `sqlite_master`, and walks a table's b-tree to
//! return its rows. It reads only: it cannot run SQL, use an index, or write. It follows the write-ahead log
//! (`-wal`) that sits beside the file, because an app that is open keeps its newest rows there. Damaged files
//! give an error and never a panic: every read checks its bounds, and every walk stops after as many pages as
//! the file holds.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::error::{InteropError, Result};

mod schema;
mod wal;

use schema::parse_columns;
use wal::read_wal;

/// The first 16 bytes of every database file.
const MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// The biggest database that is read, in bytes.
pub const MAX_DATABASE_BYTES: u64 = 1 << 30;

/// One value of a row.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// No value.
    Null,
    /// A whole number.
    Int(i64),
    /// A number with a fraction.
    Real(f64),
    /// Text.
    Text(String),
    /// Bytes.
    Blob(Vec<u8>),
}

static NULL: Value = Value::Null;

impl Value {
    /// The text, if this is text.
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }

    /// The number, if this is a whole number, or text that holds one.
    pub fn as_int(&self) -> Option<i64> {
        match self {
            Value::Int(n) => Some(*n),
            Value::Text(text) => text.trim().parse().ok(),
            _ => None,
        }
    }

    /// The bytes, if this is a blob.
    pub fn as_blob(&self) -> Option<&[u8]> {
        match self {
            Value::Blob(bytes) => Some(bytes),
            _ => None,
        }
    }

    /// Whether there is no value.
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
}

/// A table of the database.
#[derive(Clone, Debug)]
pub struct TableInfo {
    /// The table's name.
    pub name: String,
    root: u32,
    columns: Vec<String>,
    /// The column that is the row ID itself (`INTEGER PRIMARY KEY`), which a record stores as nothing.
    rowid_column: Option<usize>,
}

impl TableInfo {
    /// The names of the columns in order.
    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    /// Whether the table has a column of this name. Names compare without regard to case.
    pub fn has_column(&self, name: &str) -> bool {
        self.columns.iter().any(|c| c.eq_ignore_ascii_case(name))
    }
}

/// One row of a table.
#[derive(Debug)]
pub struct Row<'a> {
    columns: &'a [String],
    /// The row's ID.
    pub rowid: i64,
    values: Vec<Value>,
}

impl Row<'_> {
    /// The value of a column, or `Null` when the table has no such column. Names compare without regard to case.
    pub fn get(&self, column: &str) -> &Value {
        self.columns
            .iter()
            .position(|c| c.eq_ignore_ascii_case(column))
            .and_then(|i| self.values.get(i))
            .unwrap_or(&NULL)
    }

    /// The text of a column, or an empty string.
    pub fn text(&self, column: &str) -> &str {
        self.get(column).as_text().unwrap_or("")
    }
}

/// How the text in the file is encoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
}

/// A database file, read into memory.
#[derive(Debug)]
pub struct Database {
    main: Vec<u8>,
    /// The newest image of each page that the write-ahead log holds.
    wal: HashMap<u32, Vec<u8>>,
    page_size: usize,
    usable: usize,
    pages: u32,
    /// The bytes of the file and the log together. No row's payload can be longer, because its overflow pages
    /// must come from one or the other.
    max_payload: usize,
    encoding: Encoding,
    tables: Vec<TableInfo>,
}

impl Database {
    /// Opens a database file, and the write-ahead log beside it when there is one.
    pub fn open(path: &Path) -> Result<Database> {
        let size = std::fs::metadata(path).map_err(|e| InteropError::io(path, e))?.len();
        if size > MAX_DATABASE_BYTES {
            return Err(InteropError::TooBig(format!("the database {}", path.display())));
        }
        let main = std::fs::read(path).map_err(|e| InteropError::io(path, e))?;
        let mut wal_path = path.as_os_str().to_owned();
        wal_path.push("-wal");
        let wal_path = PathBuf::from(wal_path);
        let wal = if wal_path.is_file() {
            let size = std::fs::metadata(&wal_path)
                .map_err(|e| InteropError::io(&wal_path, e))?
                .len();
            if size > MAX_DATABASE_BYTES {
                return Err(InteropError::TooBig(format!("the database log {}", wal_path.display())));
            }
            Some(std::fs::read(&wal_path).map_err(|e| InteropError::io(&wal_path, e))?)
        } else {
            None
        };
        Database::from_bytes(main, wal.as_deref())
    }

    /// Reads a database from its bytes, and from the bytes of its write-ahead log if it has one.
    pub fn from_bytes(main: Vec<u8>, wal: Option<&[u8]>) -> Result<Database> {
        let bad = |why: &str| InteropError::format("a SQLite database", why);
        if main.len() < 100 || &main[..16] != MAGIC {
            return Err(bad("the file is not a SQLite database"));
        }
        let page_size = match u16::from_be_bytes([main[16], main[17]]) {
            1 => 65_536,
            n if n >= 512 && n.is_power_of_two() => usize::from(n),
            _ => return Err(bad("the page size is not valid")),
        };
        let usable = page_size - usize::from(main[20]);
        if usable < 480 {
            return Err(bad("the pages have too little room"));
        }
        let encoding = match u32::from_be_bytes([main[56], main[57], main[58], main[59]]) {
            0 | 1 => Encoding::Utf8,
            2 => Encoding::Utf16Le,
            3 => Encoding::Utf16Be,
            _ => return Err(bad("the text encoding is not known")),
        };
        let mut pages = u32::try_from(main.len() / page_size).unwrap_or(u32::MAX);
        let mut overlay = HashMap::new();
        if let Some(wal) = wal {
            if let Some(after) = read_wal(wal, page_size, &mut overlay) {
                // A commit may claim any size, but only the pages that the file or the log holds can be read.
                let highest = overlay.keys().copied().max().unwrap_or(0);
                pages = pages.max(after.min(highest));
            }
        }
        let max_payload = main.len().saturating_add(wal.map_or(0, <[u8]>::len));
        let mut database = Database {
            main,
            wal: overlay,
            page_size,
            usable,
            pages,
            max_payload,
            encoding,
            tables: Vec::new(),
        };
        database.tables = database.read_schema()?;
        Ok(database)
    }

    /// The tables of the database.
    pub fn tables(&self) -> &[TableInfo] {
        &self.tables
    }

    /// The table of this name. Names compare without regard to case.
    pub fn table(&self, name: &str) -> Option<&TableInfo> {
        self.tables.iter().find(|t| t.name.eq_ignore_ascii_case(name))
    }

    /// Calls `visit` for each row of a table, in row ID order. A callback that fails stops the walk with its error.
    pub fn for_each_row(&self, table: &TableInfo, visit: &mut dyn FnMut(&Row<'_>) -> Result<()>) -> Result<()> {
        self.walk(table.root, &mut |rowid, mut values| {
            if let Some(index) = table.rowid_column {
                if values.get(index).is_none_or(Value::is_null) {
                    values.resize(values.len().max(index + 1), Value::Null);
                    values[index] = Value::Int(rowid);
                }
            }
            visit(&Row {
                columns: &table.columns,
                rowid,
                values,
            })
        })
    }

    fn page(&self, number: u32) -> Result<&[u8]> {
        if number == 0 || number > self.pages {
            return Err(InteropError::format(
                "a SQLite database",
                format!("page {number} is outside the file"),
            ));
        }
        if let Some(image) = self.wal.get(&number) {
            return Ok(image);
        }
        let start = (number as usize - 1) * self.page_size;
        self.main
            .get(start..start + self.page_size)
            .ok_or_else(|| InteropError::format("a SQLite database", format!("page {number} is cut off")))
    }

    fn read_schema(&self) -> Result<Vec<TableInfo>> {
        let master = TableInfo {
            name: "sqlite_master".to_owned(),
            root: 1,
            columns: ["type", "name", "tbl_name", "rootpage", "sql"]
                .map(str::to_owned)
                .to_vec(),
            rowid_column: None,
        };
        let mut tables = Vec::new();
        self.for_each_row(&master, &mut |row| {
            let root = row.get("rootpage").as_int().and_then(|n| u32::try_from(n).ok());
            if row.text("type") == "table" {
                if let Some(root) = root.filter(|r| *r > 0) {
                    let (columns, rowid_column) = parse_columns(row.text("sql"));
                    tables.push(TableInfo {
                        name: row.text("name").to_owned(),
                        root,
                        columns,
                        rowid_column,
                    });
                }
            }
            Ok(())
        })?;
        Ok(tables)
    }

    /// Walks the b-tree that starts at `root`, calling `visit` with each row's ID and values.
    fn walk(&self, root: u32, visit: &mut dyn FnMut(i64, Vec<Value>) -> Result<()>) -> Result<()> {
        let mut stack = vec![root];
        let mut seen = HashSet::new();
        while let Some(number) = stack.pop() {
            if !seen.insert(number) {
                return Err(InteropError::format("a SQLite database", "a page is used twice"));
            }
            let page = self.page(number)?;
            let base = if number == 1 { 100 } else { 0 };
            let kind = page.get(base).copied().unwrap_or(0);
            let count = usize::from(be16(page, base + 3)?);
            match kind {
                0x0d => {
                    for i in 0..count {
                        let cell = usize::from(be16(page, base + 8 + 2 * i)?);
                        let (rowid, payload) = self.leaf_cell(page, cell)?;
                        visit(rowid, self.decode_record(&payload)?)?;
                    }
                }
                0x05 => {
                    let mut children = Vec::with_capacity(count + 1);
                    for i in 0..count {
                        let cell = usize::from(be16(page, base + 12 + 2 * i)?);
                        children.push(be32(page, cell)?);
                    }
                    children.push(be32(page, base + 8)?);
                    stack.extend(children.into_iter().rev());
                }
                _ => {
                    return Err(InteropError::format(
                        "a SQLite database",
                        format!("page {number} is not a table page"),
                    ))
                }
            }
        }
        Ok(())
    }

    /// The row ID and whole payload of a table leaf cell, with any overflow pages joined on.
    fn leaf_cell(&self, page: &[u8], cell: usize) -> Result<(i64, Vec<u8>)> {
        let (length, a) = varint(page, cell)?;
        let (rowid, b) = varint(page, cell + a)?;
        let start = cell + a + b;
        let length = usize::try_from(length).map_err(|_| cut_off())?;
        if length > self.max_payload {
            return Err(InteropError::format(
                "a SQLite database",
                "a row claims more bytes than the file holds",
            ));
        }
        let local = self.local_size(length);
        let mut payload = Vec::with_capacity(length.min(1 << 20));
        payload.extend_from_slice(page.get(start..start + local).ok_or_else(cut_off)?);
        if length > local {
            // Each overflow page holds `usable - 4` bytes, so the chain has exactly this many pages, each once.
            let hops = (length - local).div_ceil(self.usable - 4);
            let mut seen = HashSet::new();
            let mut next = be32(page, start + local)?;
            while payload.len() < length {
                if next == 0 || seen.len() >= hops || !seen.insert(next) {
                    return Err(cut_off());
                }
                let overflow = self.page(next)?;
                let take = (length - payload.len()).min(self.usable - 4);
                payload.extend_from_slice(overflow.get(4..4 + take).ok_or_else(cut_off)?);
                next = be32(overflow, 0)?;
            }
        }
        Ok((rowid as i64, payload))
    }

    /// How many bytes of a table leaf cell's payload sit on the b-tree page.
    fn local_size(&self, length: usize) -> usize {
        let usable = self.usable;
        let max = usable - 35;
        if length <= max {
            return length;
        }
        let min = (usable - 12) * 32 / 255 - 23;
        let size = min + (length - min) % (usable - 4);
        if size <= max {
            size
        } else {
            min
        }
    }

    fn decode_record(&self, payload: &[u8]) -> Result<Vec<Value>> {
        let (header_len, mut at) = varint(payload, 0)?;
        let header_len = usize::try_from(header_len).map_err(|_| cut_off())?;
        let mut kinds = Vec::new();
        while at < header_len {
            let (kind, used) = varint(payload, at)?;
            kinds.push(kind);
            at += used;
        }
        let mut body = header_len;
        let mut values = Vec::with_capacity(kinds.len());
        for kind in kinds {
            let (value, used) = self.decode_value(kind, payload.get(body..).ok_or_else(cut_off)?)?;
            values.push(value);
            body += used;
        }
        Ok(values)
    }

    fn decode_value(&self, kind: u64, bytes: &[u8]) -> Result<(Value, usize)> {
        let int = |size: usize| -> Result<(Value, usize)> {
            let raw = bytes.get(..size).ok_or_else(cut_off)?;
            let mut n = if raw.first().is_some_and(|b| b & 0x80 != 0) {
                -1i64
            } else {
                0
            };
            for byte in raw {
                n = (n << 8) | i64::from(*byte);
            }
            Ok((Value::Int(n), size))
        };
        match kind {
            0 => Ok((Value::Null, 0)),
            1 => int(1),
            2 => int(2),
            3 => int(3),
            4 => int(4),
            5 => int(6),
            6 => int(8),
            7 => {
                let raw: [u8; 8] = bytes.get(..8).and_then(|b| b.try_into().ok()).ok_or_else(cut_off)?;
                Ok((Value::Real(f64::from_be_bytes(raw)), 8))
            }
            8 => Ok((Value::Int(0), 0)),
            9 => Ok((Value::Int(1), 0)),
            10 | 11 => Err(InteropError::format("a SQLite database", "a value has a reserved type")),
            n => {
                let size = usize::try_from((n - 12) / 2).map_err(|_| cut_off())?;
                let raw = bytes.get(..size).ok_or_else(cut_off)?;
                if n % 2 == 0 {
                    Ok((Value::Blob(raw.to_vec()), size))
                } else {
                    Ok((Value::Text(self.decode_text(raw)), size))
                }
            }
        }
    }

    fn decode_text(&self, raw: &[u8]) -> String {
        let units = |read: fn([u8; 2]) -> u16| -> String {
            let words: Vec<u16> = raw.as_chunks::<2>().0.iter().map(|c| read(*c)).collect();
            String::from_utf16_lossy(&words)
        };
        match self.encoding {
            Encoding::Utf8 => String::from_utf8_lossy(raw).into_owned(),
            Encoding::Utf16Le => units(u16::from_le_bytes),
            Encoding::Utf16Be => units(u16::from_be_bytes),
        }
    }
}

fn cut_off() -> InteropError {
    InteropError::format("a SQLite database", "a page is cut off or damaged")
}

fn be16(bytes: &[u8], at: usize) -> Result<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_be_bytes([b[0], b[1]]))
        .ok_or_else(cut_off)
}

fn be32(bytes: &[u8], at: usize) -> Result<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(cut_off)
}

/// Reads a variable-length integer of 1 to 9 bytes, and returns it with the bytes it took.
fn varint(bytes: &[u8], at: usize) -> Result<(u64, usize)> {
    let mut value = 0u64;
    for i in 0..9 {
        let byte = *bytes.get(at + i).ok_or_else(cut_off)?;
        if i == 8 {
            return Ok(((value << 8) | u64::from(byte), 9));
        }
        value = (value << 7) | u64::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            return Ok((value, i + 1));
        }
    }
    Err(cut_off())
}

#[cfg(test)]
mod tests;
