//! `corrupted_files` (plan 13.3): every fixture file with flipped bits, cut short, with byte ranges duplicated
//! and inserted, and with huge numbers swapped in. Every reader must return an error or a valid result, and
//! never panic. The fuzz entry points also check that whatever reads is written back the same way.

mod common;

use opennote_core::fuzzing::formats;

/// A small deterministic random number generator, so failures reproduce.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// Numbers that break limits and types, swapped in for runs of digits.
const HUGE: [&str; 6] = [
    "18446744073709551616",
    "-9223372036854775809",
    "1e999",
    "1e308",
    "-0",
    "0.000001",
];

/// Variants of a file: bit flips, cuts, duplicated and inserted ranges, and swapped numbers.
fn variants(bytes: &[u8], rng: &mut Rng) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let len = bytes.len().max(1);
    for _ in 0..24 {
        let mut flipped = bytes.to_vec();
        if !flipped.is_empty() {
            let at = rng.below(len);
            flipped[at] ^= 1 << rng.below(8);
        }
        out.push(flipped);
    }
    for _ in 0..12 {
        out.push(bytes[..rng.below(len)].to_vec());
    }
    for _ in 0..8 {
        let start = rng.below(len);
        let end = (start + rng.below(64)).min(bytes.len());
        let at = rng.below(len);
        let mut grown = bytes.to_vec();
        grown.splice(at..at, bytes[start..end].to_vec());
        out.push(grown);
    }
    out.extend(swapped_numbers(bytes, rng));
    out
}

/// The file with one run of ASCII digits replaced by a huge or odd number.
fn swapped_numbers(bytes: &[u8], rng: &mut Rng) -> Vec<Vec<u8>> {
    let runs: Vec<(usize, usize)> = bytes
        .iter()
        .enumerate()
        .filter(|&(i, b)| b.is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_digit()))
        .map(|(start, _)| {
            (
                start,
                start + bytes[start..].iter().take_while(|b| b.is_ascii_digit()).count(),
            )
        })
        .collect();
    (0..runs.len().min(8))
        .map(|_| {
            let (start, end) = runs[rng.below(runs.len())];
            let mut swapped = bytes.to_vec();
            swapped.splice(start..end, HUGE[rng.below(HUGE.len())].bytes());
            swapped
        })
        .collect()
}

/// The readers a fixture file goes through, by its name.
fn readers(name: &str) -> Vec<fn(&[u8])> {
    match name {
        "page.json" => vec![formats::page_json, formats::migrate],
        "section.json" => vec![formats::section_json, formats::migrate],
        "notebook.json" => vec![formats::notebook_json, formats::migrate],
        "item.json" => vec![formats::trash_item, formats::migrate],
        "versions.json" => vec![formats::versions, formats::migrate],
        n if n.ends_with(".onk") => vec![formats::segment, formats::records],
        _ => vec![
            formats::page_json,
            formats::section_json,
            formats::notebook_json,
            formats::trash_item,
            formats::versions,
            formats::segment,
            formats::readable,
        ],
    }
}

#[test]
fn corrupted_files_never_panic_a_reader() {
    let files = common::files_under(&common::fixtures_dir());
    assert!(files.len() > 40, "the fixtures are there");
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut runs = 0usize;
    for path in files {
        let bytes = std::fs::read(&path).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let readers = readers(&name);
        for variant in std::iter::once(bytes.clone()).chain(variants(&bytes, &mut rng)) {
            for read in &readers {
                read(&variant);
                runs += 1;
            }
        }
    }
    assert!(runs > 5_000, "{runs} runs");
}

#[test]
fn random_bytes_never_panic_a_reader() {
    let mut rng = Rng(0x2545_f491_4f6c_dd1d);
    for _ in 0..2_000 {
        let len = rng.below(300);
        let bytes: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        for target in opennote_core::fuzzing::TARGETS.iter().filter(|t| t.owner == "WP1") {
            (target.run)(&bytes);
        }
    }
}
