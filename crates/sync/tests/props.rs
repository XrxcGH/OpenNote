//! Property tests: two to four devices edit, delete, and sync in random orders. Once they all sync, every device
//! holds the same files, and every version that no device knowingly replaced is still somewhere.

mod common;

use std::collections::BTreeSet;
use std::sync::Arc;

use common::*;
use opennote_core::format::page_json::read_page;
use opennote_core::Limits;
use opennote_sync::MemoryBackend;
use proptest::prelude::*;

#[derive(Clone, Debug)]
enum Op {
    /// Writes one of a few ordinary files.
    Write { device: usize, file: usize },
    /// Saves the page, as a later revision of whatever this device has.
    Page { device: usize },
    /// Deletes one of the files this device has.
    Delete { device: usize, pick: usize },
    /// Syncs.
    Sync { device: usize },
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (0..4usize, 0..3usize).prop_map(|(device, file)| Op::Write { device, file }),
        2 => (0..4usize).prop_map(|device| Op::Page { device }),
        1 => (0..4usize, 0..8usize).prop_map(|(device, pick)| Op::Delete { device, pick }),
        4 => (0..4usize).prop_map(|device| Op::Sync { device }),
    ]
}

fn page_path() -> String {
    format!("{}/page.json", page_dir(1))
}

/// What a file holds, as the marker the test wrote: an ordinary file's text, or a page's title.
fn marker(path: &str, bytes: &[u8]) -> String {
    if path.ends_with(".json") {
        if let Ok(read) = read_page(bytes, &Limits::default()) {
            return read.page.title;
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn run(count: usize, ops: Vec<Op>) -> std::result::Result<(), TestCaseError> {
    let store = MemoryBackend::new();
    let devices = devices(Arc::new(store), count);
    let mut written: BTreeSet<String> = BTreeSet::new();
    let mut replaced: BTreeSet<String> = BTreeSet::new();
    let mut counter = 0u128;
    for op in ops {
        counter += 1;
        match op {
            Op::Write { device, file } => {
                let d = &devices[device % count];
                let path = format!("Bio/f{file}.txt");
                if let Some(old) = d.read(&path) {
                    replaced.insert(marker(&path, &old));
                }
                let text = format!("text {counter} from {}", d.tag);
                d.write(&path, text.as_bytes());
                written.insert(text);
            }
            Op::Page { device } => {
                let d = &devices[device % count];
                let mut ancestors = Vec::new();
                if let Some(old) = d.read(&page_path()) {
                    let read = read_page(&old, &Limits::default()).expect("a page this test wrote");
                    replaced.insert(read.page.title.clone());
                    let previous = devices_rev(&read.page.revision.id.to_string());
                    ancestors.push(previous);
                }
                let title = format!("page {counter} from {}", d.tag);
                d.write(
                    &page_path(),
                    &page(1, &title, counter, &ancestors, 1_000 + counter as i64, &[]),
                );
                written.insert(title);
            }
            Op::Delete { device, pick } => {
                let d = &devices[device % count];
                let files = d.files();
                if let Some((path, bytes)) = files.iter().nth(pick % files.len().max(1)) {
                    replaced.insert(marker(path, bytes));
                    d.remove(path);
                }
            }
            Op::Sync { device } => {
                devices[device % count]
                    .engine
                    .sync()
                    .map_err(|e| TestCaseError::fail(format!("sync: {e}")))?;
            }
        }
    }
    settle(&devices, 6);
    let first = devices[0].files();
    for d in &devices[1..] {
        prop_assert_eq!(&d.files(), &first, "device {} differs", d.tag);
    }
    let present: BTreeSet<String> = first.iter().map(|(p, b)| marker(p, b)).collect();
    for text in written.difference(&replaced) {
        prop_assert!(present.contains(text), "{text:?} was lost; present: {present:?}");
    }
    Ok(())
}

/// The counter a test revision ID was made from.
fn devices_rev(text: &str) -> u128 {
    (0..100_000u128)
        .find(|n| rev(*n).to_string() == text)
        .expect("a revision this test made")
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    #[test]
    fn devices_converge_without_losing_edits(count in 2usize..=4, ops in prop::collection::vec(op(), 1..28)) {
        run(count, ops)?;
    }
}

#[test]
fn a_known_three_way_conflict_converges() {
    use Op::*;
    run(
        3,
        vec![
            Page { device: 0 },
            Sync { device: 0 },
            Sync { device: 1 },
            Sync { device: 2 },
            Page { device: 0 },
            Page { device: 1 },
            Page { device: 2 },
            Write { device: 0, file: 0 },
            Write { device: 1, file: 0 },
            Sync { device: 2 },
            Sync { device: 1 },
            Delete { device: 2, pick: 0 },
            Sync { device: 0 },
        ],
    )
    .expect("converges");
}
