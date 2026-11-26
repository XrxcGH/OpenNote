//! Block-level merge through the sync engine (ADR 0089). A page can sync while open, at an autosave the app kept
//! no version of. It still has the base a block merge needs. This file runs in its own process, because the
//! merger here is registered for every merge in it.

mod common;

use std::collections::BTreeSet;
use std::io::Read;
use std::sync::Arc;

use common::{devices, page_dir, settle};
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::id::{BlockId, DeviceId, Id, PageId, RevisionId};
use opennote_core::merge::{register, BlockMerger};
use opennote_core::model::block::{BlockData, Fallback, OtherData};
use opennote_core::model::{Block, DeviceRef, JsonMap, Page, Revision};
use opennote_core::{Limits, OrderKey, Timestamp};
use opennote_sync::MemoryBackend;
use serde_json::{json, Value};

const TEST_TYPE: &str = "test.sync-tags";

fn id(n: u128) -> Id {
    Id::from_parts(1_760_000_000_000, n)
}

fn tags(block: &Block) -> BTreeSet<String> {
    match &block.data {
        BlockData::Other(o) => o.data["tags"]
            .as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
            .unwrap_or_default(),
        _ => BTreeSet::new(),
    }
}

/// Tags added on either side are added, and tags removed on either side go.
struct Tags;

impl BlockMerger for Tags {
    fn merge(&self, base: &Block, mine: &Block, theirs: &Block) -> Option<Block> {
        let (b, m, t) = (tags(base), tags(mine), tags(theirs));
        let keep: Vec<String> = m
            .union(&t)
            .filter(|tag| !(b.contains(*tag) && (!m.contains(*tag) || !t.contains(*tag))))
            .cloned()
            .collect();
        let mut out = base.clone();
        if let BlockData::Other(o) = &mut out.data {
            o.data.insert("tags".into(), Value::from(keep));
        }
        Some(out)
    }
}

fn tag_block(n: u128, list: &[&str]) -> Block {
    let mut order = OrderKey::between(None, None).expect("order");
    for _ in 0..n {
        order = OrderKey::between(Some(&order), None).expect("order");
    }
    let mut data = JsonMap::new();
    data.insert("tags".into(), json!(list));
    Block {
        id: BlockId(id(n)),
        order,
        frame: None,
        lock: None,
        created: Timestamp::from_unix_ms(1_760_000_000_000),
        modified: Timestamp::from_unix_ms(1_760_000_000_000),
        fallback: Some(Fallback {
            markdown: "Tags".into(),
            image: None,
            extra: JsonMap::new(),
        }),
        data: BlockData::Other(OtherData {
            type_name: TEST_TYPE.into(),
            data,
            unreadable: None,
        }),
        extra: JsonMap::new(),
    }
}

/// A page saved as revision `n`, made from the revisions in `ancestors` (newest first).
fn page(n: u128, ancestors: &[u128], saved: i64, blocks: &[Block]) -> Page {
    let rev = |n: u128| RevisionId(id(1000 + n));
    let mut r = Revision::new(
        rev(n),
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

fn gunzip(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes).read_to_end(&mut out).expect("gzip");
    out
}

#[test]
fn a_page_synced_between_versions_still_merges_by_block() {
    register(TEST_TYPE, Arc::new(Tags));
    let d = devices(Arc::new(MemoryBackend::new()), 2);
    let p = page_dir(1);
    let page_path = format!("{p}/page.json");
    // An autosave: the app wrote no `.history` version of it.
    let base = page(1, &[], 10, &[tag_block(1, &["a"]), tag_block(2, &["b"])]);
    d[0].write(&page_path, &write_page(&base));
    settle(&d, 3);
    let snapshot = format!("{p}/.history/{}.json.gz", base.revision.id);
    for device in &d {
        let kept = device.read(&snapshot).expect("the uploaded revision has a snapshot");
        assert_eq!(gunzip(&kept), write_page(&base), "the snapshot holds the exact bytes");
    }

    let mine = page(2, &[1], 20, &[tag_block(1, &["a", "m"]), tag_block(2, &["b"])]);
    let theirs = page(3, &[1], 30, &[tag_block(1, &["a"]), tag_block(2, &["b", "t"])]);
    d[0].write(&page_path, &write_page(&mine));
    d[1].write(&page_path, &write_page(&theirs));
    settle(&d, 4);
    assert_eq!(d[0].files(), d[1].files(), "both devices reach the same files");
    assert!(
        !d[0].files().keys().any(|k| k.contains(".conflicts")),
        "merged by block, no conflict copy"
    );
    let merged = read_page(&d[0].read(&page_path).expect("page"), &Limits::default())
        .expect("reads")
        .page;
    let at = |n: u128| tags(merged.blocks.get(BlockId(id(n))).expect("block"));
    assert_eq!(at(1), ["a", "m"].map(String::from).into());
    assert_eq!(at(2), ["b", "t"].map(String::from).into());
}
