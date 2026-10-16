//! Symbol tables, and turning a report's code offsets into function names.
//!
//! A release exe has no function names in it, to keep it small, so a crash report holds module offsets. The
//! release workflow keeps the debug information of every build, and a symbol table made from it turns offsets
//! back into names. Tables use the text format of Breakpad symbol files, which the `dump_syms` tool writes from a
//! `.pdb`: a `MODULE` line with the build's debug id, then `FUNC` lines and `PUBLIC` lines with addresses
//! relative to the module's start. All other lines are ignored.
//!
//! ```text
//! MODULE windows x86_64 3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71A opennote.pdb
//! FUNC 1a2b00 120 0 opennote_core::store::Store::save_page
//! PUBLIC 2f3000 0 opennote::main
//! ```
//!
//! Symbolication happens where the symbols are: on a maintainer's computer with [`SymbolSet::load_dir`] and the
//! `opennote-symbolicate` tool, or on the person's own computer when they have put a table in the symbols
//! folder, with [`CrashStore::symbolicate_all`](crate::store::CrashStore::symbolicate_all). The app never
//! downloads symbols, so symbolication never needs the network. A table is matched to a frame by debug id, so
//! symbols of another build are never applied, and a frame without a match keeps its offset.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use crate::pe::is_debug_id;
use crate::report::{Frame, Report};
use crate::scrub::Scrubber;

/// The largest symbol file read, in bytes.
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
/// The most functions one table keeps.
pub const MAX_SYMBOLS: usize = 4_000_000;
/// The farthest a `PUBLIC` symbol, which has no size, is taken to reach.
const PUBLIC_REACH: u64 = 0x1_0000;
/// The longest name a table keeps.
const MAX_NAME: usize = 400;

/// Why a symbol file was not used.
#[derive(Debug, thiserror::Error)]
pub enum SymbolError {
    /// The file could not be read.
    #[error("symbol file: {0}")]
    Io(#[from] io::Error),
    /// The file is larger than [`MAX_FILE_BYTES`].
    #[error("the symbol file is larger than {MAX_FILE_BYTES} bytes")]
    TooLarge,
    /// The first line is not a `MODULE` line with a debug id.
    #[error("not a symbol file: it does not start with a MODULE line")]
    NotSymbols,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Function {
    start: u64,
    /// `None` for a `PUBLIC` symbol, which runs until the next symbol.
    size: Option<u64>,
    name: String,
}

/// The functions of one build of one module.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SymbolTable {
    debug_id: String,
    module: String,
    functions: Vec<Function>,
}

/// A function found for an offset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Resolved<'a> {
    /// The function's name.
    pub name: &'a str,
    /// How far into the function the offset is.
    pub into: u64,
}

impl SymbolTable {
    /// Reads a table from Breakpad symbol text. Lines it does not know are skipped, and so is a function line
    /// that is damaged, so one bad line does not lose the table.
    pub fn parse(text: &str) -> Result<SymbolTable, SymbolError> {
        let mut lines = text.lines();
        let header = lines.next().ok_or(SymbolError::NotSymbols)?;
        let mut fields = header.split_whitespace();
        let (Some("MODULE"), Some(_os), Some(_arch), Some(id), name) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            return Err(SymbolError::NotSymbols);
        };
        let debug_id = id.to_ascii_uppercase();
        if !is_debug_id(&debug_id) {
            return Err(SymbolError::NotSymbols);
        }
        let mut functions = Vec::new();
        for line in lines {
            if functions.len() >= MAX_SYMBOLS {
                break;
            }
            if let Some(function) = parse_function(line) {
                functions.push(function);
            }
        }
        // Sorted by start; a function with a size goes before a public symbol at the same address.
        functions.sort_by_key(|f| (f.start, f.size.is_none()));
        functions.dedup_by(|b, a| a.start == b.start);
        Ok(SymbolTable {
            debug_id,
            module: name.unwrap_or_default().to_owned(),
            functions,
        })
    }

    /// Reads a table from a file.
    pub fn load(path: &Path) -> Result<SymbolTable, SymbolError> {
        let file = fs::File::open(path)?;
        if file.metadata()?.len() > MAX_FILE_BYTES {
            return Err(SymbolError::TooLarge);
        }
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
        SymbolTable::parse(&String::from_utf8_lossy(&bytes))
    }

    /// The debug id of the build the table is for.
    pub fn debug_id(&self) -> &str {
        &self.debug_id
    }

    /// The name of the debug file the table was made from, such as `opennote.pdb`. Empty when the file did not
    /// say.
    pub fn module(&self) -> &str {
        &self.module
    }

    /// How many functions the table holds.
    pub fn len(&self) -> usize {
        self.functions.len()
    }

    /// Whether the table holds no functions.
    pub fn is_empty(&self) -> bool {
        self.functions.is_empty()
    }

    /// The function that holds `offset`, an address relative to the start of the module.
    pub fn lookup(&self, offset: u64) -> Option<Resolved<'_>> {
        let after = self.functions.partition_point(|f| f.start <= offset);
        let function = self.functions.get(after.checked_sub(1)?)?;
        let into = offset - function.start;
        let reach = function.size.filter(|&size| size > 0).unwrap_or(PUBLIC_REACH);
        (into < reach).then_some(Resolved {
            name: &function.name,
            into,
        })
    }
}

/// Reads a `FUNC` or `PUBLIC` line.
fn parse_function(line: &str) -> Option<Function> {
    let (kind, rest) = line.split_once(' ')?;
    if kind != "FUNC" && kind != "PUBLIC" {
        return None;
    }
    let rest = rest.strip_prefix("m ").unwrap_or(rest);
    let mut parts = rest.splitn(if kind == "FUNC" { 4 } else { 3 }, ' ');
    let start = u64::from_str_radix(parts.next()?, 16).ok()?;
    let size = if kind == "FUNC" {
        Some(u64::from_str_radix(parts.next()?, 16).ok()?)
    } else {
        None
    };
    let _parameter_size = parts.next()?;
    let name = parts.next()?.trim();
    (!name.is_empty() && name.len() <= MAX_NAME).then(|| Function {
        start,
        size,
        name: name.to_owned(),
    })
}

/// Why one file of a folder of symbols was left out.
#[derive(Debug)]
pub struct Skipped {
    /// The file's name, without its folder.
    pub file: String,
    /// Why it was not used.
    pub error: SymbolError,
}

/// Every table a person or a maintainer has.
#[derive(Clone, Debug, Default)]
pub struct SymbolSet {
    by_id: HashMap<String, SymbolTable>,
}

impl SymbolSet {
    /// An empty set.
    pub fn new() -> SymbolSet {
        SymbolSet::default()
    }

    /// Adds a table. A table for the same build as one already in the set replaces it.
    pub fn add(&mut self, table: SymbolTable) {
        self.by_id.insert(table.debug_id.clone(), table);
    }

    /// Reads every `.sym` file in a folder. Files that are not symbol files are reported and skipped. A folder
    /// that does not exist gives an empty set.
    pub fn load_dir(dir: &Path) -> (SymbolSet, Vec<Skipped>) {
        let mut set = SymbolSet::new();
        let mut skipped = Vec::new();
        let Ok(entries) = fs::read_dir(dir) else {
            return (set, skipped);
        };
        let mut paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("sym")))
            .collect();
        paths.sort();
        for path in paths {
            match SymbolTable::load(&path) {
                Ok(table) => set.add(table),
                Err(error) => skipped.push(Skipped {
                    file: path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    error,
                }),
            }
        }
        (set, skipped)
    }

    /// How many tables the set holds.
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// Whether the set holds no tables.
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    /// Every table in the set, in no particular order.
    pub fn tables(&self) -> impl Iterator<Item = &SymbolTable> {
        self.by_id.values()
    }

    /// The table for the build with this debug id.
    pub fn table(&self, debug_id: &str) -> Option<&SymbolTable> {
        self.by_id.get(&debug_id.to_ascii_uppercase())
    }

    /// The function a frame is in, when the set has the table of the frame's build. A frame without a debug id
    /// is never matched, because the build it came from is not known.
    pub fn resolve(&self, frame: &Frame) -> Option<Resolved<'_>> {
        let table = self.table(frame.debug_id.as_deref()?)?;
        let offset = u64::from_str_radix(frame.offset.strip_prefix("0x")?, 16).ok()?;
        table.lookup(offset)
    }
}

/// What symbolicating one report did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Symbolicated {
    /// Frames that got a function name.
    pub resolved: usize,
    /// Frames the set had no table or no function for.
    pub unresolved: usize,
}

impl Report {
    /// A copy with the function name of every frame the set can resolve. A frame that already has a name keeps
    /// it. The names pass through the scrubber like every other piece of text. The second value says how many
    /// frames got a name.
    pub fn symbolicated(&self, set: &SymbolSet, scrubber: &Scrubber) -> (Report, Symbolicated) {
        let mut report = self.clone();
        let mut counts = Symbolicated::default();
        for frame in &mut report.frames {
            if frame.function.is_some() {
                continue;
            }
            match set.resolve(frame) {
                Some(found) => {
                    frame.function = Some(scrubber.symbol(found.name));
                    counts.resolved += 1;
                }
                None => counts.unresolved += 1,
            }
        }
        (report, counts)
    }
}

#[cfg(test)]
#[path = "symbols_tests.rs"]
mod tests;
