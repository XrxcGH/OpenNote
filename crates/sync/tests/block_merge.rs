//! Block-level merge of a page that two devices changed (ADR 0089): with no merger registered the result is
//! today's conflict copy, byte for byte, and a registered merger merges blocks of its own type.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::{Arc, Mutex};

use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::id::{BlockId, DeviceId, Id, PageId, RevisionId, SectionId};
use opennote_core::merge::{BlockMerger, Mergers};
use opennote_core::model::block::{BlockData, Fallback, OtherData, TextData};
use opennote_core::model::{Block, DeviceRef, JsonMap, Page, Revision};
use opennote_core::{Limits, OrderKey, Timestamp};
use opennote_sync::manifest::{Content, Entry, Manifest};
use opennote_sync::merge::{merge, merge_with, Contents, Merged};
use opennote_sync::Result;
use serde_json::{json, Value};

const TEST_TYPE: &str = "test.tags";

/// Contents kept in memory, named by a hash of their bytes.
#[derive(Default)]
struct Store(Mutex<BTreeMap<String, Vec<u8>>>);

fn content_of(bytes: &[u8]) -> Content {
    // FNV-1a: enough to name test contents apart.
    let hash = bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x100_0000_01b3)
    });
    Content {
        id: format!("{hash:016x}{:08x}", bytes.len()),
        size: bytes.len() as u64,
        chunks: vec![],
    }
}

impl Store {
    fn put(&self, bytes: Vec<u8>) -> Content {
        let content = content_of(&bytes);
        self.0.lock().expect("lock").insert(content.id.clone(), bytes);
        content
    }
}

impl Contents for Store {
    fn bytes(&self, content: &Content) -> Result<Vec<u8>> {
        Ok(self.0.lock().expect("lock")[&content.id].clone())
    }
    fn make(&self, bytes: Vec<u8>) -> Content {
        self.put(bytes)
    }
}

/// A fake merger for the test type: tags added on either side are added, and tags removed on either side go.
struct Tags;

fn tags(block: &Block) -> BTreeSet<String> {
    match &block.data {
        BlockData::Other(o) => o.data["tags"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default(),
        _ => BTreeSet::new(),
    }
}

impl BlockMerger for Tags {
    fn merge(&self, base: &Block, mine: &Block, theirs: &Block) -> Option<Block> {
        let (b, m, t) = (tags(base), tags(mine), tags(theirs));
        let keep: Vec<String> = m
            .union(&t)
            .filter(|tag| !(b.contains(*tag) && (!m.contains(*tag) || !t.contains(*tag))))
            .cloned()
            .collect();
        Some(tag_block_from(base, &keep))
    }
}

fn fake() -> Mergers {
    let mut m = Mergers::new();
    m.register(TEST_TYPE, Arc::new(Tags));
    m
}

fn id(n: u128) -> Id {
    Id::from_parts(1_760_000_000_000, n)
}

fn block(n: u128, data: BlockData) -> Block {
    let mut order = OrderKey::between(None, None).expect("order");
    for _ in 0..n {
        order = OrderKey::between(Some(&order), None).expect("order");
    }
    Block {
        id: BlockId(id(n)),
        order,
        frame: None,
        lock: None,
        created: Timestamp::from_unix_ms(1_760_000_000_000),
        modified: Timestamp::from_unix_ms(1_760_000_000_000),
        fallback: matches!(data, BlockData::Other(_)).then(|| Fallback {
            markdown: "Tags".into(),
            image: None,
            extra: JsonMap::new(),
        }),
        data,
        extra: JsonMap::new(),
    }
}

fn tag_block(n: u128, list: &[&str]) -> Block {
    let mut data = JsonMap::new();
    data.insert("tags".into(), json!(list));
    block(
        n,
        BlockData::Other(OtherData {
            type_name: TEST_TYPE.into(),
            data,
            unreadable: None,
        }),
    )
}

fn tag_block_from(base: &Block, list: &[String]) -> Block {
    let mut out = base.clone();
    if let BlockData::Other(o) = &mut out.data {
        o.data.insert("tags".into(), Value::from(list.to_vec()));
    }
    out
}

fn text_block(n: u128, text: &str) -> Block {
    block(
        n,
        BlockData::Text(TextData {
            markdown: text.into(),
            ..TextData::default()
        }),
    )
}

fn page(revision: u128, ancestors: &[u128], saved: i64, blocks: &[Block]) -> Page {
    let rev = |n: u128| RevisionId(id(1000 + n));
    let mut r = Revision::new(
        rev(revision),
        Timestamp::from_unix_ms(1_760_000_000_000 + saved),
        DeviceRef {
            id: DeviceId(id(9)),
            label: "Windows device TEST".into(),
        },
        "OpenNote test",
    );
    r.ancestors = ancestors.iter().map(|a| rev(*a)).collect();
    r.parents = r.ancestors.iter().take(1).copied().collect();
    let mut p = Page::new(PageId(id(1)), Timestamp::from_unix_ms(1_760_000_000_000), r);
    for b in blocks {
        p.blocks.insert(Arc::new(b.clone())).expect("unique");
    }
    p
}

fn dir() -> String {
    format!("Bio/{}/{}", SectionId(id(1)), PageId(id(1)))
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(bytes).expect("gzip");
    gz.finish().expect("gzip")
}

fn entry(device: &str, count: u64, content: Content) -> Entry {
    Entry {
        vv: [(device.to_owned(), count)].into(),
        content,
        deleted: false,
    }
}

/// Two devices that both had `base` (saved and kept in `.history`) and then saved `mine` and `theirs`.
fn devices(store: &Store, base: &Page, mine: &Page, theirs: &Page) -> (Manifest, Manifest) {
    let (page, history) = (
        format!("{}/page.json", dir()),
        format!("{}/.history/{}.json.gz", dir(), base.revision.id),
    );
    let snapshot = entry("d0", 1, store.put(gzip(&write_page(base))));
    let mut a = Manifest::new();
    a.insert(history.clone(), snapshot.clone());
    let mut b = a.clone();
    let va = entry("d0", 2, store.put(write_page(mine)));
    let mut vb = entry("d0", 1, store.put(write_page(theirs)));
    vb.vv.insert("d1".into(), 1);
    a.insert(page.clone(), va);
    b.insert(page, vb);
    (a, b)
}

fn base_page() -> Page {
    page(
        1,
        &[],
        10,
        &[tag_block(1, &["a"]), tag_block(2, &["b"]), text_block(3, "Hello")],
    )
}

fn page_of(store: &Store, merged: &Merged) -> Page {
    let e = &merged.entries[&format!("{}/page.json", dir())];
    read_page(&store.bytes(&e.content).expect("bytes"), &Limits::default())
        .expect("reads")
        .page
}

#[test]
fn with_no_merger_a_concurrent_page_edit_is_still_a_conflict_copy() {
    let store = Store::default();
    let base = base_page();
    let blocks = |a: &[&str], b: &[&str]| [tag_block(1, a), tag_block(2, b), text_block(3, "Hello")];
    let mine = page(2, &[1], 20, &blocks(&["a", "m"], &["b"]));
    let theirs = page(3, &[1], 30, &blocks(&["a"], &["b", "t"]));
    let (a, b) = devices(&store, &base, &mine, &theirs);
    let none = merge_with(&[&a, &b], &a, &store, &Mergers::new()).expect("merges");
    let global = merge(&[&a, &b], &a, &store).expect("merges");
    assert_eq!(none.entries, global.entries, "nothing is registered in this process");
    assert_eq!(none.conflicts, global.conflicts);
    assert_eq!(none.conflicts.len(), 1, "{:?}", none.conflicts);
    let copy = format!("{}/.conflicts/{}.json", dir(), mine.revision.id);
    assert_eq!(none.conflicts[0].kept_as, copy);
    assert_eq!(
        store.bytes(&none.entries[&copy].content).expect("copy"),
        write_page(&mine)
    );
    let kept = &none.entries[&format!("{}/page.json", dir())];
    assert_eq!(
        store.bytes(&kept.content).expect("page"),
        write_page(&theirs),
        "the later save stays"
    );
}

#[test]
fn a_merger_for_another_type_leaves_text_conflicts_byte_identical() {
    let store = Store::default();
    let base = base_page();
    let edit = |n: u128, saved: i64, text: &str| {
        page(
            n,
            &[1],
            saved,
            &[tag_block(1, &["a"]), tag_block(2, &["b"]), text_block(3, text)],
        )
    };
    let (a, b) = devices(&store, &base, &edit(2, 20, "Mine"), &edit(3, 30, "Theirs"));
    let none = merge_with(&[&a, &b], &a, &store, &Mergers::new()).expect("merges");
    let with = merge_with(&[&a, &b], &a, &store, &fake()).expect("merges");
    assert_eq!(none.entries, with.entries);
    assert_eq!(none.conflicts, with.conflicts);
    assert_eq!(with.conflicts.len(), 1);
}

#[test]
fn a_registered_merger_merges_two_devices_that_changed_different_blocks() {
    let store = Store::default();
    let base = base_page();
    let mine = page(
        2,
        &[1],
        20,
        &[tag_block(1, &["a", "m"]), tag_block(2, &["b"]), text_block(3, "Hello")],
    );
    let theirs = page(
        3,
        &[1],
        30,
        &[tag_block(1, &["a"]), tag_block(2, &["t"]), text_block(3, "Hello")],
    );
    let (a, b) = devices(&store, &base, &mine, &theirs);
    let ab = merge_with(&[&a, &b], &a, &store, &fake()).expect("merges");
    let ba = merge_with(&[&b, &a], &b, &store, &fake()).expect("merges");
    assert!(ab.conflicts.is_empty(), "no conflict copy: {:?}", ab.conflicts);
    assert!(!ab.entries.keys().any(|k| k.contains(".conflicts")));
    assert_eq!(ab.entries, ba.entries, "both devices reach the same files");
    let merged = page_of(&store, &ab);
    let at = |n: u128| tags(merged.blocks.get(BlockId(id(n))).expect("block"));
    assert_eq!(at(1), ["a", "m"].map(String::from).into());
    assert_eq!(at(2), ["t"].map(String::from).into());
    assert!(merged.revision.ancestors.contains(&mine.revision.id));
    assert!(merged.revision.ancestors.contains(&theirs.revision.id));
}

#[test]
fn the_merged_page_does_not_depend_on_which_device_merges() {
    let store = Store::default();
    let base = base_page();
    let lists: [&[&str]; 4] = [&["a"], &["a", "x"], &[], &["y"]];
    for (i, mine_tags) in lists.iter().enumerate() {
        for (j, theirs_tags) in lists.iter().enumerate() {
            let mine = page(2, &[1], 20 + i as i64, &[tag_block(1, mine_tags), tag_block(2, &["b"])]);
            let theirs = page(
                3,
                &[1],
                20 + j as i64,
                &[tag_block(1, theirs_tags), tag_block(2, &["b", "z"])],
            );
            let (a, b) = devices(&store, &base, &mine, &theirs);
            let ab = merge_with(&[&a, &b], &a, &store, &fake()).expect("merges");
            let ba = merge_with(&[&b, &a], &b, &store, &fake()).expect("merges");
            assert_eq!(ab.entries, ba.entries, "case {i} {j}");
            assert_eq!(ab.conflicts, ba.conflicts, "case {i} {j}");
        }
    }
}

#[test]
fn with_no_shared_snapshot_the_page_keeps_the_conflict_copy() {
    let store = Store::default();
    let base = base_page();
    let mine = page(
        2,
        &[1],
        20,
        &[tag_block(1, &["a", "m"]), tag_block(2, &["b"]), text_block(3, "Hello")],
    );
    let theirs = page(
        3,
        &[1],
        30,
        &[tag_block(1, &["a"]), tag_block(2, &["t"]), text_block(3, "Hello")],
    );
    let (mut a, mut b) = devices(&store, &base, &mine, &theirs);
    a.retain(|k, _| !k.contains(".history"));
    b.retain(|k, _| !k.contains(".history"));
    let merged = merge_with(&[&a, &b], &a, &store, &fake()).expect("merges");
    assert_eq!(merged.conflicts.len(), 1, "no base to merge from");
}
