//! Block-level three-way merge: the follow-up to ADR 0049 that ADR 0089 records.
//!
//! When two devices changed the same page, sync keeps one version as `page.json` and the other as a conflict copy
//! (spec 14.1). A block type can do better by registering a [`BlockMerger`]: given the version both devices started
//! from and the two changed versions of one block, it returns one block that keeps both changes, or `None`.
//!
//! [`merge_page`] returns `None` unless every rule here holds, and then the caller keeps today's conflict copy.
//! At least one block that changed has a type with a registered merger, so with none registered nothing changes.
//! Every block that changed on both sides, to different results, has a merger, and that merger succeeds. No block
//! was deleted on one side and changed on the other. Every other page field changed on at most one side.
//!
//! Every device must reach the same bytes from the same versions, in any order, so mergers must be commutative:
//! `merge(base, a, b) == merge(base, b, a)`. The merged revision is made from the two revisions alone, never from
//! a clock or a random source, for the same reason.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock, PoisonError, RwLock};

use crate::id::{BlockId, Id, RevisionId};
use crate::model::{Block, Page, Revision};

/// The most earlier revisions a revision lists (spec 5.3).
const MAX_ANCESTORS: usize = 32;

/// Merges two changed versions of one block of one type.
pub trait BlockMerger: Send + Sync {
    /// One block that keeps the changes from `base` to `mine` and from `base` to `theirs`, or `None` when they
    /// can't both stay. All three have the same ID and type. The result must not depend on which side is `mine`.
    fn merge(&self, base: &Block, mine: &Block, theirs: &Block) -> Option<Block>;
}

/// The mergers, by block type.
#[derive(Clone, Default)]
pub struct Mergers {
    by_type: BTreeMap<String, Arc<dyn BlockMerger>>,
}

impl std::fmt::Debug for Mergers {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_set().entries(self.by_type.keys()).finish()
    }
}

/// The result of merging one block.
#[derive(Clone, Debug, PartialEq)]
pub enum BlockMerge {
    /// One block keeps both changes.
    Merged(Box<Block>),
    /// The changes can't both stay: the page keeps today's conflict copy.
    Conflict,
}

impl Mergers {
    /// No mergers.
    pub fn new() -> Mergers {
        Mergers::default()
    }

    /// Registers the merger for a block type, in place of any earlier one.
    pub fn register(&mut self, type_name: impl Into<String>, merger: Arc<dyn BlockMerger>) {
        self.by_type.insert(type_name.into(), merger);
    }

    /// Whether a block type has a merger.
    pub fn handles(&self, type_name: &str) -> bool {
        self.by_type.contains_key(type_name)
    }

    /// Whether no type has a merger.
    pub fn is_empty(&self) -> bool {
        self.by_type.is_empty()
    }

    /// Merges two changed versions of a block of type `type_name`. Equal sides, or a side equal to `base`, need
    /// no merger. With no merger for the type, the result is [`BlockMerge::Conflict`].
    pub fn merge_block(&self, type_name: &str, base: &Block, mine: &Block, theirs: &Block) -> BlockMerge {
        if mine == theirs || theirs == base {
            return BlockMerge::Merged(Box::new(mine.clone()));
        }
        if mine == base {
            return BlockMerge::Merged(Box::new(theirs.clone()));
        }
        let same = |b: &Block| b.id == base.id && b.type_name() == type_name;
        if !(same(base) && same(mine) && same(theirs)) {
            return BlockMerge::Conflict;
        }
        match self.by_type.get(type_name).and_then(|m| m.merge(base, mine, theirs)) {
            Some(merged) if same(&merged) => BlockMerge::Merged(Box::new(merged)),
            _ => BlockMerge::Conflict,
        }
    }
}

fn registry() -> &'static RwLock<Mergers> {
    static GLOBAL: OnceLock<RwLock<Mergers>> = OnceLock::new();
    GLOBAL.get_or_init(RwLock::default)
}

/// Registers a merger for every merge in this process. Call it at startup, before the first sync.
pub fn register(type_name: impl Into<String>, merger: Arc<dyn BlockMerger>) {
    registry()
        .write()
        .unwrap_or_else(PoisonError::into_inner)
        .register(type_name, merger);
}

/// The mergers registered for this process.
pub fn mergers() -> Mergers {
    registry().read().unwrap_or_else(PoisonError::into_inner).clone()
}

/// [`Mergers::merge_block`] with the mergers registered for this process.
pub fn merge_block(type_name: &str, base: &Block, mine: &Block, theirs: &Block) -> BlockMerge {
    mergers().merge_block(type_name, base, mine, theirs)
}

/// The three-way choice for one value: equal sides, or the side that changed. `None` if both changed it
/// differently.
fn pick<'a, T: PartialEq>(base: &T, mine: &'a T, theirs: &'a T) -> Option<&'a T> {
    if mine == theirs || theirs == base {
        Some(mine)
    } else if mine == base {
        Some(theirs)
    } else {
        None
    }
}

/// The three-way merge of a map, key by key. `None` if one key changed differently on both sides.
fn pick_map<K: Ord + Clone, V: PartialEq + Clone>(
    base: &BTreeMap<K, V>,
    mine: &BTreeMap<K, V>,
    theirs: &BTreeMap<K, V>,
) -> Option<BTreeMap<K, V>> {
    let keys: BTreeSet<&K> = base.keys().chain(mine.keys()).chain(theirs.keys()).collect();
    let mut out = BTreeMap::new();
    for key in keys {
        if let Some(value) = pick(&base.get(key), &mine.get(key), &theirs.get(key))? {
            out.insert(key.clone(), (*value).clone());
        }
    }
    Some(out)
}

/// The blocks of two versions of a page that differ, by ID: present on one side only, or different on both.
/// For a side-by-side view of a conflict, which shows each block type's own compare view.
pub fn differing_blocks<'a>(mine: &'a Page, theirs: &'a Page) -> Vec<(BlockId, Option<&'a Block>, Option<&'a Block>)> {
    let ids: BTreeSet<BlockId> = mine.blocks.iter().chain(theirs.blocks.iter()).map(|b| b.id).collect();
    ids.into_iter()
        .filter_map(|id| {
            let m = mine.blocks.get(id).map(Arc::as_ref);
            let t = theirs.blocks.get(id).map(Arc::as_ref);
            (m != t).then_some((id, m, t))
        })
        .collect()
}

/// A block as `page.json` writes it.
pub fn block_json(block: &Block) -> serde_json::Value {
    let device = crate::model::DeviceRef {
        id: crate::id::DeviceId(Id::ZERO),
        label: String::new(),
    };
    let revision = Revision::new(RevisionId(Id::ZERO), block.created, device, "");
    let mut page = Page::new(crate::id::PageId(Id::ZERO), block.created, revision);
    // A page with one block can't hold a duplicate ID.
    let _ = page.blocks.insert(Arc::new(block.clone()));
    serde_json::from_slice::<serde_json::Value>(&crate::format::page_json::write_page(&page))
        .ok()
        .and_then(|mut v| v.get_mut("blocks")?.as_array_mut()?.pop())
        .unwrap_or(serde_json::Value::Null)
}

/// [`differing_blocks`] as JSON for the app's conflict view: `{ id, type, mine, theirs }`, where a side without
/// the block is `null` and the type is the one on this device, else the other.
pub fn differing_blocks_json(mine: &Page, theirs: &Page) -> Vec<serde_json::Value> {
    differing_blocks(mine, theirs)
        .into_iter()
        .map(|(id, m, t)| {
            let type_name = m.or(t).map(Block::type_name).unwrap_or_default();
            serde_json::json!({
                "id": id.to_string(),
                "type": type_name,
                "mine": m.map(block_json),
                "theirs": t.map(block_json),
            })
        })
        .collect()
}

/// One page from two versions that changed `base` concurrently, or `None` to keep today's conflict copy. See the
/// module documentation for when it merges.
pub fn merge_page(mergers: &Mergers, base: &Page, mine: &Page, theirs: &Page) -> Option<Page> {
    if mergers.is_empty() || mine.id != base.id || theirs.id != base.id || mine.revision.id == theirs.revision.id {
        return None;
    }
    // A side this device may only read must not be rewritten by sync, and two sides read at different versions
    // would leave the merged page stamped for one side while it holds the other's blocks (spec 15, `R-VER-5`).
    let keys = |p: &Page| (p.format.version_read, p.format.min_reader, p.format.min_writer);
    if mine.format.access.is_read_only() || theirs.format.access.is_read_only() || keys(mine) != keys(theirs) {
        return None;
    }
    let ids: BTreeSet<BlockId> = [base, mine, theirs]
        .iter()
        .flat_map(|p| p.blocks.iter().map(|b| b.id))
        .collect();
    let mut opted_in = false;
    let mut kept: Vec<Arc<Block>> = Vec::new();
    for id in ids {
        let (b, m, t) = (base.blocks.get(id), mine.blocks.get(id), theirs.blocks.get(id));
        let changed = m != b || t != b;
        if changed {
            opted_in |= [b, m, t].into_iter().flatten().any(|x| mergers.handles(x.type_name()));
        }
        kept.extend(merge_one(mergers, b, m, t)?);
    }
    if !opted_in {
        return None;
    }
    let mut merged = later(mine, theirs).clone();
    merged.blocks = crate::model::blocks::Blocks::new();
    for block in kept {
        merged.blocks.insert(block).ok()?;
    }
    merge_fields(&mut merged, base, mine, theirs)?;
    merged.revision = merged_revision(&mine.revision, &theirs.revision);
    Some(merged)
}

/// One block from its base and two sides: `Some(None)` when it stays deleted, `None` for a conflict.
fn merge_one(
    mergers: &Mergers,
    b: Option<&Arc<Block>>,
    m: Option<&Arc<Block>>,
    t: Option<&Arc<Block>>,
) -> Option<Option<Arc<Block>>> {
    match (b, m, t) {
        (Some(b), Some(m), Some(t)) => match mergers.merge_block(b.type_name(), b, m, t) {
            BlockMerge::Merged(block) if *block == **m => Some(Some(m.clone())),
            BlockMerge::Merged(block) if *block == **t => Some(Some(t.clone())),
            BlockMerge::Merged(block) => Some(Some(Arc::new(*block))),
            BlockMerge::Conflict => None,
        },
        // Deleted on one side or both: it stays deleted unless the other side changed it.
        (Some(b), m, t) => (!(m.is_some_and(|m| m != b) || t.is_some_and(|t| t != b))).then_some(None),
        // Added on one side, or the same block added on both.
        (None, Some(m), Some(t)) if m != t => None,
        (None, m, t) => Some(m.or(t).cloned()),
    }
}

/// The page fields outside the blocks, each from the side that changed it. `None` when both changed one apart.
fn merge_fields(merged: &mut Page, base: &Page, mine: &Page, theirs: &Page) -> Option<()> {
    merged.title = pick(&base.title, &mine.title, &theirs.title)?.clone();
    merged.created = *pick(&base.created, &mine.created, &theirs.created)?;
    merged.modified = mine.modified.max(theirs.modified);
    merged.tags = pick(&base.tags, &mine.tags, &theirs.tags)?.clone();
    merged.view = pick(&base.view, &mine.view, &theirs.view)?.clone();
    merged.assets = pick_map(&base.assets, &mine.assets, &theirs.assets)?;
    merged.ink = pick(&base.ink, &mine.ink, &theirs.ink)?.clone();
    merged.recordings = pick(&base.recordings, &mine.recordings, &theirs.recordings)?.clone();
    merged.encryption = pick(&base.encryption, &mine.encryption, &theirs.encryption)?.clone();
    merged.extra = pick(&base.extra, &mine.extra, &theirs.extra)?.clone();
    Some(())
}

/// The side whose revision was saved later, then sorts later: the same on every device.
fn later<'a>(a: &'a Page, b: &'a Page) -> &'a Page {
    if (b.revision.saved_at, b.revision.id) > (a.revision.saved_at, a.revision.id) {
        b
    } else {
        a
    }
}

/// The revision of a merged page, made from the two revisions alone. Its ID's time is one millisecond after the
/// later of the two, so it sorts after both, and its random part joins theirs. Both are its parents and
/// ancestors, so sync sees the two as older saves of it.
pub fn merged_revision(a: &Revision, b: &Revision) -> Revision {
    let low = |id: RevisionId| u128::from_be_bytes(*id.0.as_bytes());
    let time = a.id.0.time_ms().max(b.id.0.time_ms()).saturating_add(1);
    let id = RevisionId(Id::from_parts(time, low(a.id) ^ low(b.id)));
    let newer = if (b.saved_at, b.id) > (a.saved_at, a.id) { b } else { a };
    let mut parents = vec![a.id, b.id];
    parents.sort_unstable_by(|x, y| y.cmp(x));
    let mut ancestors: Vec<RevisionId> = parents
        .iter()
        .chain(&a.ancestors)
        .chain(&b.ancestors)
        .copied()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .rev()
        .collect();
    ancestors.truncate(MAX_ANCESTORS);
    Revision {
        id,
        parents,
        ancestors,
        saved_at: newer.saved_at,
        device: newer.device.clone(),
        writer: newer.writer.clone(),
        extra: newer.extra.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::page_json::{read_page, write_page};
    use crate::id::{DeviceId, PageId};
    use crate::model::block::{BlockData, Fallback, OtherData, TextData};
    use crate::model::{DeviceRef, JsonMap};
    use crate::{Limits, OrderKey, Timestamp};
    use serde_json::{json, Value};

    const TEST_TYPE: &str = "test.tags";

    /// A fake merger for a test type whose data is a set of tags: a tag added on either side is added, and a tag
    /// removed on either side is removed. Any other change on both sides can't merge.
    struct Tags;

    fn tags(block: &Block) -> BTreeSet<String> {
        match &block.data {
            BlockData::Other(other) => other
                .data
                .get("tags")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect())
                .unwrap_or_default(),
            _ => BTreeSet::new(),
        }
    }

    fn with_tags(block: &Block, set: &BTreeSet<String>, modified: Timestamp) -> Block {
        let mut out = block.clone();
        if let BlockData::Other(other) = &mut out.data {
            other.data.insert("tags".into(), json!(set.iter().collect::<Vec<_>>()));
        }
        out.modified = modified;
        out
    }

    impl BlockMerger for Tags {
        fn merge(&self, base: &Block, mine: &Block, theirs: &Block) -> Option<Block> {
            let strip = |b: &Block| with_tags(b, &BTreeSet::new(), base.modified);
            if strip(mine) != strip(base) || strip(theirs) != strip(base) {
                return None;
            }
            let (b, m, t) = (tags(base), tags(mine), tags(theirs));
            let set: BTreeSet<String> = m
                .union(&t)
                .filter(|tag| !(b.contains(*tag) && (!m.contains(*tag) || !t.contains(*tag))))
                .cloned()
                .collect();
            Some(with_tags(base, &set, mine.modified.max(theirs.modified)))
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

    fn at(ms: i64) -> Timestamp {
        Timestamp::from_unix_ms(1_760_000_000_000 + ms)
    }

    fn key(n: u128) -> OrderKey {
        let mut k = OrderKey::between(None, None).expect("order");
        for _ in 0..(n % 64) {
            k = OrderKey::between(Some(&k), None).expect("order");
        }
        k
    }

    fn block(n: u128, data: BlockData) -> Block {
        let fallback = matches!(data, BlockData::Other(_)).then(|| Fallback {
            markdown: "Tags".into(),
            image: None,
            extra: JsonMap::new(),
        });
        Block {
            id: BlockId(id(n)),
            order: key(n),
            frame: None,
            lock: None,
            created: at(0),
            modified: at(0),
            data,
            fallback,
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

    fn text_block(n: u128, text: &str) -> Block {
        block(
            n,
            BlockData::Text(TextData {
                markdown: text.into(),
                ..TextData::default()
            }),
        )
    }

    fn revision(n: u128, ancestors: &[u128], saved: i64) -> Revision {
        let mut r = Revision::new(
            RevisionId(id(1000 + n)),
            at(saved),
            DeviceRef {
                id: DeviceId(id(9)),
                label: "Test device".into(),
            },
            "OpenNote test",
        );
        r.ancestors = ancestors.iter().map(|a| RevisionId(id(1000 + a))).collect();
        r.parents = r.ancestors.iter().take(1).copied().collect();
        r
    }

    fn page(rev: Revision, blocks: &[Block]) -> Page {
        let mut p = Page::new(PageId(id(1)), at(0), rev);
        for b in blocks {
            p.blocks.insert(Arc::new(b.clone())).expect("unique");
        }
        p
    }

    fn base() -> Page {
        page(
            revision(1, &[], 10),
            &[tag_block(1, &["a"]), tag_block(2, &["b"]), text_block(3, "Hello")],
        )
    }

    fn edit(rev: Revision, f: impl FnOnce(&mut Page)) -> Page {
        let mut p = base();
        p.revision = rev;
        f(&mut p);
        p
    }

    fn set(p: &mut Page, b: Block) {
        p.blocks.replace(Arc::new(b)).expect("present");
    }

    #[test]
    fn with_no_merger_a_block_changed_on_both_sides_is_a_conflict() {
        let (b, m, t) = (
            tag_block(1, &["a"]),
            tag_block(1, &["a", "m"]),
            tag_block(1, &["a", "t"]),
        );
        assert_eq!(Mergers::new().merge_block(TEST_TYPE, &b, &m, &t), BlockMerge::Conflict);
        assert_eq!(
            merge_block(TEST_TYPE, &b, &m, &t),
            BlockMerge::Conflict,
            "nothing registered here"
        );
        // A side that kept the base, or equal sides, need no merger.
        assert_eq!(
            Mergers::new().merge_block(TEST_TYPE, &b, &m, &b),
            BlockMerge::Merged(Box::new(m.clone()))
        );
        assert_eq!(
            Mergers::new().merge_block(TEST_TYPE, &b, &b, &t),
            BlockMerge::Merged(Box::new(t.clone()))
        );
        assert_eq!(
            Mergers::new().merge_block(TEST_TYPE, &b, &m, &m),
            BlockMerge::Merged(Box::new(m.clone()))
        );
    }

    #[test]
    fn a_registered_merger_merges_its_type_only() {
        let (b, m, t) = (tag_block(1, &["a"]), tag_block(1, &["a", "m"]), tag_block(1, &["t"]));
        let BlockMerge::Merged(merged) = fake().merge_block(TEST_TYPE, &b, &m, &t) else {
            panic!("the fake merger merges tags");
        };
        assert_eq!(tags(&merged), ["m", "t"].iter().map(|s| (*s).to_owned()).collect());
        let (tb, tm, tt) = (text_block(3, "a"), text_block(3, "b"), text_block(3, "c"));
        assert_eq!(fake().merge_block("text", &tb, &tm, &tt), BlockMerge::Conflict);
        // A merger never sees blocks of another type.
        assert_eq!(fake().merge_block(TEST_TYPE, &tb, &tm, &tt), BlockMerge::Conflict);
    }

    #[test]
    fn with_no_merger_registered_no_page_merges() {
        let mine = edit(revision(2, &[1], 20), |p| set(p, tag_block(1, &["a", "m"])));
        let theirs = edit(revision(3, &[1], 30), |p| set(p, tag_block(2, &["b", "t"])));
        assert_eq!(merge_page(&Mergers::new(), &base(), &mine, &theirs), None);
    }

    #[test]
    fn two_devices_that_changed_different_blocks_merge() {
        let mine = edit(revision(2, &[1], 20), |p| set(p, tag_block(1, &["a", "m"])));
        let theirs = edit(revision(3, &[1], 30), |p| {
            set(p, tag_block(2, &["b", "t"]));
            set(p, text_block(3, "Hello there"));
        });
        let merged = merge_page(&fake(), &base(), &mine, &theirs).expect("merges");
        assert_eq!(
            tags(merged.blocks.get(BlockId(id(1))).expect("1")),
            ["a", "m"].map(String::from).into()
        );
        assert_eq!(
            tags(merged.blocks.get(BlockId(id(2))).expect("2")),
            ["b", "t"].map(String::from).into()
        );
        assert_eq!(
            merged.plain_text(),
            theirs.plain_text(),
            "the text change on one side stays"
        );
        let parents: Vec<RevisionId> = vec![theirs.revision.id, mine.revision.id];
        assert_eq!(merged.revision.parents, parents);
        assert!(merged.revision.id > theirs.revision.id);
        assert_eq!(merged.revision.ancestors[..2], parents[..]);
        // The merged page writes and reads back.
        let read = read_page(&write_page(&merged), &Limits::default()).expect("reads").page;
        assert_eq!(read.blocks, merged.blocks);
    }

    #[test]
    fn a_side_read_as_a_newer_version_or_read_only_keeps_the_conflict_copy() {
        let mine = edit(revision(2, &[1], 20), |p| set(p, tag_block(1, &["a", "m"])));
        let theirs = edit(revision(3, &[1], 30), |p| set(p, tag_block(2, &["b", "t"])));
        assert!(
            merge_page(&fake(), &base(), &mine, &theirs).is_some(),
            "the same sides merge"
        );
        // The other side was read as a newer version that this device may still edit (`R-VER-5`).
        let mut newer = theirs.clone();
        newer.format.version_read = crate::FORMAT_VERSION + 1;
        newer.format.min_writer = crate::FORMAT_VERSION;
        assert_eq!(merge_page(&fake(), &base(), &mine, &newer), None);
        assert_eq!(merge_page(&fake(), &base(), &newer, &mine), None);
        // A side this device may only read.
        let mut locked = theirs.clone();
        locked.format.access = crate::model::Access::ReadOnly(crate::model::ReadOnlyReason::NewerFormat);
        assert_eq!(merge_page(&fake(), &base(), &mine, &locked), None);
        assert_eq!(merge_page(&fake(), &base(), &locked, &mine), None);
    }

    #[test]
    fn a_page_whose_changes_have_no_merger_keeps_the_conflict_copy() {
        // Only text changed, and text has no merger.
        let mine = edit(revision(2, &[1], 20), |p| set(p, text_block(3, "Mine")));
        let theirs = edit(revision(3, &[1], 30), |p| set(p, text_block(3, "Theirs")));
        assert_eq!(merge_page(&fake(), &base(), &mine, &theirs), None);
        // A block changed on one side and deleted on the other.
        let mine = edit(revision(2, &[1], 20), |p| set(p, tag_block(1, &["m"])));
        let theirs = edit(revision(3, &[1], 30), |p| {
            p.blocks.remove(BlockId(id(1)));
        });
        assert_eq!(merge_page(&fake(), &base(), &mine, &theirs), None);
        // The title changed differently on both sides.
        let mine = edit(revision(2, &[1], 20), |p| {
            set(p, tag_block(1, &["m"]));
            p.title = "Mine".into();
        });
        let theirs = edit(revision(3, &[1], 30), |p| p.title = "Theirs".into());
        assert_eq!(merge_page(&fake(), &base(), &mine, &theirs), None);
    }

    #[test]
    fn differing_blocks_name_each_changed_block_with_its_type() {
        let mine = edit(revision(2, &[1], 20), |p| set(p, tag_block(1, &["m"])));
        let theirs = edit(revision(3, &[1], 30), |p| {
            p.blocks.remove(BlockId(id(3)));
        });
        let list = differing_blocks_json(&mine, &theirs);
        assert_eq!(list.len(), 2, "{list:?}");
        assert_eq!(list[0]["id"], json!(BlockId(id(1)).to_string()));
        assert_eq!(list[0]["type"], json!(TEST_TYPE));
        assert_eq!(list[0]["mine"]["data"]["tags"], json!(["m"]));
        assert_eq!(list[0]["theirs"]["data"]["tags"], json!(["a"]));
        assert_eq!(list[1]["type"], json!("text"));
        assert_eq!(list[1]["theirs"], Value::Null);
    }

    /// A small, seeded generator, so the generated cases are the same on every run.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self, n: u64) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0 % n
        }
    }

    fn random_edit(rng: &mut Rng, rev: Revision, side: u128) -> Page {
        edit(rev, |p| {
            for n in 1..=3u128 {
                match rng.next(6) {
                    0 if n < 3 => {
                        let mut t = tags(p.blocks.get(BlockId(id(n))).expect("block"));
                        t.insert(format!("s{side}-{}", rng.next(3)));
                        set(p, with_tags(&tag_block(n, &[]), &t, at(rng.next(50) as i64)));
                    }
                    1 if n < 3 => set(p, tag_block(n, &[])),
                    2 if n == 3 => set(p, text_block(3, &format!("Text {}", rng.next(2)))),
                    3 => {
                        p.blocks.remove(BlockId(id(n)));
                    }
                    _ => {}
                }
            }
            if rng.next(3) == 0 {
                p.blocks
                    .insert(Arc::new(tag_block(100 + side * 10 + u128::from(rng.next(2)), &["new"])))
                    .expect("unique");
            }
            match rng.next(8) {
                0 => p.title = format!("Title {}", rng.next(2)),
                1 => p.tags = vec![format!("tag{}", rng.next(2))],
                _ => {}
            }
        })
    }

    #[test]
    fn the_merge_does_not_depend_on_the_order_of_the_sides() {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
        let mut merged = 0;
        for case in 0..2000u128 {
            let (sa, sb) = (20 + rng.next(30) as i64, 20 + rng.next(30) as i64);
            let a = random_edit(&mut rng, revision(2 + case * 2, &[1], sa), 1);
            let b = random_edit(&mut rng, revision(3 + case * 2, &[1], sb), 2);
            let ab = merge_page(&fake(), &base(), &a, &b);
            let ba = merge_page(&fake(), &base(), &b, &a);
            assert_eq!(ab.as_ref().map(write_page), ba.as_ref().map(write_page), "case {case}");
            merged += usize::from(ab.is_some());
        }
        assert!(merged > 200, "enough generated cases merge to mean something: {merged}");
    }
}
