//! Entry points for the fuzz targets in `crates/core/fuzz` (plan 13.3), behind the `fuzzing` feature.
//!
//! Each fuzz target calls one function here with the fuzzer's bytes. On every pull request, an ordinary test
//! with stable Rust feeds every corpus file and every past crash through the same functions, so a fixed crash
//! stays fixed. Each function must never panic, hang, or pass its memory limit, whatever the bytes are.

pub mod formats;
pub mod journal;
pub mod ops;
pub mod tree;

use std::fs;
use std::io;
use std::path::Path;

/// A fuzz target: its name, which is also its file in `fuzz/fuzz_targets/`, its owner, and its entry point.
#[derive(Clone, Copy, Debug)]
pub struct Target {
    /// The target's name.
    pub name: &'static str,
    /// The work package that owns it.
    pub owner: &'static str,
    /// The entry point.
    pub run: fn(&[u8]),
}

/// Every fuzz target of plan 13.3.
pub const TARGETS: &[Target] = &[
    Target {
        name: "page_json",
        owner: "WP1",
        run: formats::page_json,
    },
    Target {
        name: "section_json",
        owner: "WP1",
        run: formats::section_json,
    },
    Target {
        name: "notebook_json",
        owner: "WP1",
        run: formats::notebook_json,
    },
    Target {
        name: "trash_item",
        owner: "WP1",
        run: formats::trash_item,
    },
    Target {
        name: "versions",
        owner: "WP1",
        run: formats::versions,
    },
    Target {
        name: "segment",
        owner: "WP1",
        run: formats::segment,
    },
    Target {
        name: "records",
        owner: "WP1",
        run: formats::records,
    },
    Target {
        name: "readable",
        owner: "WP1",
        run: formats::readable,
    },
    Target {
        name: "migrate",
        owner: "WP1",
        run: formats::migrate,
    },
    Target {
        name: "txn_request",
        owner: "WP3",
        run: ops::txn_request,
    },
    Target {
        name: "journal",
        owner: "WP4",
        run: journal::journal,
    },
    Target {
        name: "notebook_tree",
        owner: "WP5",
        run: tree::notebook_tree,
    },
];

/// The target with this name.
pub fn target(name: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|t| t.name == name)
}

/// Runs a target on every file in `dir`, in name order. A missing folder counts as empty. Returns how many
/// files ran.
pub fn replay_dir(target: &Target, dir: &Path) -> io::Result<usize> {
    let mut files = match fs::read_dir(dir) {
        Ok(entries) => entries.map(|e| e.map(|e| e.path())).collect::<io::Result<Vec<_>>>()?,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err),
    };
    files.retain(|path| path.is_file());
    files.sort();
    for path in &files {
        (target.run)(&fs::read(path)?);
    }
    Ok(files.len())
}

/// Reads structured values from fuzzer bytes. Past the end of the bytes, every read gives an empty value, so a
/// target never has to handle a short input.
#[derive(Clone, Debug)]
pub struct Input<'a> {
    bytes: &'a [u8],
}

impl<'a> Input<'a> {
    /// Reads from `bytes`.
    pub fn new(bytes: &'a [u8]) -> Input<'a> {
        Input { bytes }
    }

    /// The bytes not read yet.
    pub fn rest(&self) -> &'a [u8] {
        self.bytes
    }

    /// Up to `n` bytes.
    pub fn bytes(&mut self, n: usize) -> &'a [u8] {
        let (taken, rest) = self.bytes.split_at(n.min(self.bytes.len()));
        self.bytes = rest;
        taken
    }

    /// One byte.
    pub fn u8(&mut self) -> u8 {
        self.bytes(1).first().copied().unwrap_or(0)
    }

    /// A little-endian `u32`, padded with zeros.
    pub fn u32(&mut self) -> u32 {
        let mut buf = [0u8; 4];
        let taken = self.bytes(4);
        buf[..taken.len()].copy_from_slice(taken);
        u32::from_le_bytes(buf)
    }

    /// A boolean from one byte.
    pub fn bool(&mut self) -> bool {
        self.u8() & 1 == 1
    }

    /// A number below `bound`, or zero when `bound` is zero.
    pub fn below(&mut self, bound: u32) -> u32 {
        self.u32().checked_rem(bound).unwrap_or(0)
    }

    /// A string of up to `max` bytes, with invalid UTF-8 replaced.
    pub fn string(&mut self, max: usize) -> String {
        let len = self.below(u32::try_from(max).unwrap_or(u32::MAX).saturating_add(1));
        String::from_utf8_lossy(self.bytes(len as usize)).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_target_has_a_unique_name() {
        let mut names: Vec<&str> = TARGETS.iter().map(|t| t.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), TARGETS.len());
        assert_eq!(target("journal").map(|t| t.owner), Some("WP4"));
        assert!(target("nope").is_none());
    }

    #[test]
    fn input_reads_values_and_pads_with_zeros() {
        let mut input = Input::new(&[7, 1, 0, 0, 0, 0xff, b'h', b'i']);
        assert_eq!(input.u8(), 7);
        assert_eq!(input.u32(), 1);
        assert!(input.bool());
        assert_eq!(input.rest(), b"hi");
        assert_eq!(input.u32(), u32::from_le_bytes([b'h', b'i', 0, 0]));
        assert_eq!(input.u8(), 0);
        assert_eq!(input.below(0), 0);
        assert_eq!(input.string(10), "");
    }

    #[test]
    fn replaying_a_missing_folder_runs_nothing() {
        let target = Target {
            name: "noop",
            owner: "WP0",
            run: |_| {},
        };
        assert_eq!(replay_dir(&target, Path::new("no/such/folder")).unwrap(), 0);
    }
}
