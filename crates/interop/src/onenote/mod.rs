//! Reading OneNote's own files: section files (`.one`) and notebook packages (`.onepkg`), A3-17.
//!
//! The reader is written from Microsoft's published descriptions of the formats, [MS-ONESTORE] (the revision
//! store) and [MS-ONE] (sections and pages), and from test files, never from other programs' code. README.md in
//! this folder records each format fact with its evidence. Every file is treated as hostile: every read is
//! bounds-checked, every count and loop is capped by [`limits`], and damage ends a read with an error, not a
//! panic. The fuzz target `onenote` runs the whole reader on damaged input.
//!
//! Layers, bottom up: [`bytes`] (checked reads), `store` (header, transaction log, file node lists), `space`
//! (object spaces, revisions, objects), `props` (property sets), and `model` with `outline` (sections and pages).
//! `cab` reads the Cabinet container of a `.onepkg` file.

mod bytes;
mod cab;
mod ids;
mod model;
mod outline;
mod props;
mod space;
mod store;

#[cfg(any(test, feature = "testing"))]
pub mod write;

pub(crate) use bytes::Damage;
pub(crate) use cab::{is_cabinet, Cabinet, STOPPED as CAB_STOPPED};
pub(crate) use model::{read_section, Attached, Blob, Item, ListKind, Page, Paragraph, Run};
pub(crate) use store::{file_kind, FileKind};

/// Caps on what one file may make the reader do.
pub(crate) mod limits {
    /// The largest section file read, in bytes.
    pub(crate) const SECTION_BYTES: u64 = 512 << 20;
    /// File nodes read from one file.
    pub(crate) const NODES: usize = 4_000_000;
    /// Fragments of one file node list or transaction log.
    pub(crate) const FRAGMENTS: usize = 1_000_000;
    /// Object spaces in one file: one for the section and one for each page.
    pub(crate) const SPACES: usize = 100_000;
    /// Revisions in one object space.
    pub(crate) const REVISIONS: usize = 100_000;
    /// Entries of one global identification table.
    pub(crate) const TABLE_ENTRIES: usize = 1_000_000;
    /// Nesting of property sets inside property sets.
    pub(crate) const NESTING: usize = 16;
    /// Properties of one object, nested ones included.
    pub(crate) const PROPERTIES: usize = 100_000;
    /// Pages of one section.
    pub(crate) const PAGES: usize = 20_000;
    /// Indent levels of outline elements.
    pub(crate) const DEPTH: usize = 64;
    /// Pieces of content on one page.
    pub(crate) const ITEMS: usize = 100_000;
    /// Bytes of pictures and files copied out of one section file and its onefiles folder. One picture placed
    /// on many pages is copied for each page, so a small file could otherwise ask for terabytes.
    pub(crate) const COPIED_BYTES: u64 = 2 << 30;
    /// Files in one notebook package.
    pub(crate) const CAB_FILES: usize = 20_000;
    /// Bytes of one notebook package, and bytes it unpacks to. A package is read whole and each folder is
    /// unpacked whole, so a hostile one holds at most twice this in memory.
    pub(crate) const CAB_BYTES: usize = 256 << 20;
}

/// The name a picture or file in the onefiles folder must have: a UUID and `.onebin` ([MS-ONESTORE] 2.5.27).
pub(crate) fn is_onefiles_name(name: &str) -> bool {
    name.strip_suffix(".onebin")
        .is_some_and(|stem| bytes::Guid::parse(stem).is_some() && !stem.starts_with('{'))
}

/// Every file of a cabinet with its bytes, for tests of the Cabinet reader.
#[cfg(any(test, feature = "testing"))]
pub fn unpack_for_tests(data: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let cabinet = Cabinet::open(data).map_err(|d| d.0)?;
    let mut files = Vec::new();
    cabinet
        .extract(&|| false, |file, bytes| {
            files.push((file.name.clone(), bytes.to_vec()));
            Ok(())
        })
        .map_err(|d| d.0)?;
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_uuid_names_are_looked_up_in_the_onefiles_folder() {
        assert!(is_onefiles_name("6f1d7e2a-0b3c-4d5e-8f90-a1b2c3d4e5f6.onebin"));
        assert!(!is_onefiles_name("../secret.onebin"));
        assert!(!is_onefiles_name("6f1d7e2a-0b3c-4d5e-8f90-a1b2c3d4e5f6.png"));
        assert!(!is_onefiles_name("{6f1d7e2a-0b3c-4d5e-8f90-a1b2c3d4e5f6}.onebin"));
    }
}
