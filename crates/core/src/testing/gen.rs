//! Proptest generators for the model (plan 13.2), used by the round-trip, storage, and operation properties.
//!
//! Generated values follow the spec's rules, so a correct reader and writer must round-trip them exactly.
//! Geometry is rounded to 0.01, and IDs are unique where the spec requires it. Every asset a block names is
//! in the table, and each ink block's `strokeCount` matches its strokes. Unknown keys start with `zz`, which
//! no known key does.

use std::sync::Arc;

use proptest::collection::vec;
use proptest::prelude::*;

use crate::format::names::asset_file_name;
use crate::id::{AssetId, BlockId, DeviceId, Id, PageId, RevisionId, SegmentId, StrokeId};
use crate::model::{
    Asset, BBox, Background, Channels, Color, DeviceRef, InkRecord, JsonMap, Layout, Named, Orientation, Page,
    PageView, Paper, PaperSize, Pattern, Point, Revision, SegmentRef, Stroke, StrokeStyle, ViewMode,
};
use crate::order::OrderKey;
use crate::time::Timestamp;

mod blocks;
mod ink;
mod tree;

pub use blocks::{arb_block_parts, arb_frame, BlockParts};
pub use ink::{arb_points, arb_stroke, encode_test_points};
pub use tree::{arb_notebook_file, arb_page_entries, arb_section_file, arb_trash_item, arb_versions_file};

/// A time prefix for generated IDs. Each kind of ID gets its own range, so IDs never collide, even while
/// proptest shrinks the random bits.
pub(crate) const ID_BASE_MS: u64 = 1_790_000_000_000;

/// How large and varied generated pages are.
#[derive(Clone, Debug)]
pub struct PageGen {
    /// Most blocks.
    pub max_blocks: usize,
    /// Most strokes.
    pub max_strokes: usize,
    /// Most points per stroke.
    pub max_points: usize,
    /// Most assets.
    pub max_assets: usize,
    /// Adds unknown keys and unknown enum values at every level.
    pub unknown_keys: bool,
    /// Lists random segments in `page.json`, for JSON round trips. Storage round trips leave this off, so the
    /// live strokes are the pending records a save writes.
    pub segment_refs: bool,
}

impl Default for PageGen {
    fn default() -> PageGen {
        PageGen {
            max_blocks: 12,
            max_strokes: 16,
            max_points: 24,
            max_assets: 3,
            unknown_keys: true,
            segment_refs: false,
        }
    }
}

impl PageGen {
    /// Pages for JSON round trips: random segment lists and no live strokes.
    pub fn json_only() -> PageGen {
        PageGen {
            max_strokes: 0,
            segment_refs: true,
            ..PageGen::default()
        }
    }

    /// Small pages for fast properties.
    pub fn small() -> PageGen {
        PageGen {
            max_blocks: 4,
            max_strokes: 4,
            max_points: 8,
            max_assets: 1,
            ..PageGen::default()
        }
    }
}

/// An ID with a time prefix and random bits.
pub fn arb_id() -> impl Strategy<Value = Id> {
    (0u64..(1 << 48), any::<u128>()).prop_map(|(time, random)| Id::from_parts(time, random))
}

/// A unique ID for the `index`-th item of a kind.
pub(crate) fn unique_id(kind: u64, index: usize, random: u128) -> Id {
    Id::from_parts(ID_BASE_MS + kind * 1_000_000 + index as u64, random)
}

/// A time between the years 2000 and 2100.
pub fn arb_timestamp() -> impl Strategy<Value = Timestamp> {
    (946_684_800_000i64..4_102_444_800_000).prop_map(Timestamp::from_unix_ms)
}

/// An order key that [`OrderKey::between`] accepts.
pub fn arb_order_key() -> impl Strategy<Value = OrderKey> {
    ("[a-c]", "[0-9A-Za-z]{3}", "([0-9A-Za-z]{0,4}[1-9A-Za-z])?").prop_map(|(head, digits, fraction)| {
        let len = usize::from(head.as_bytes()[0] - b'a') + 1;
        OrderKey::parse(&format!("{head}{}{fraction}", &digits[..len])).expect("generated keys are valid")
    })
}

/// A geometry value, already rounded to 0.01 (spec 2.3).
pub fn arb_geometry() -> impl Strategy<Value = f64> {
    (-1_000_000_000i64..=1_000_000_000).prop_map(|n| n as f64 / 100.0)
}

/// A positive size, rounded to 0.01.
pub fn arb_size() -> impl Strategy<Value = f64> {
    (1i64..=100_000_000).prop_map(|n| n as f64 / 100.0)
}

/// Any short text, including characters that need escaping.
pub fn arb_text(max: usize) -> impl Strategy<Value = String> {
    vec(any::<char>(), 0..=max).prop_map(String::from_iter)
}

/// Unknown keys, or none when `enabled` is false.
pub fn arb_extra(enabled: bool) -> BoxedStrategy<JsonMap> {
    if !enabled {
        return Just(JsonMap::new()).boxed();
    }
    proptest::collection::btree_map("zz[a-z]{0,4}", arb_json(), 0..3)
        .prop_map(|m| m.into_iter().collect())
        .boxed()
}

/// Any JSON value, nested at most two levels, with finite numbers.
pub fn arb_json() -> impl Strategy<Value = serde_json::Value> {
    use serde_json::Value;
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(Value::from),
        (-1e12f64..1e12).prop_map(Value::from),
        arb_text(8).prop_map(Value::String),
    ];
    leaf.prop_recursive(2, 8, 3, |inner| {
        prop_oneof![
            vec(inner.clone(), 0..3).prop_map(Value::Array),
            proptest::collection::btree_map("[a-z]{1,3}", inner, 0..3)
                .prop_map(|m| Value::Object(m.into_iter().collect())),
        ]
    })
}

/// A known enum value, or sometimes an unknown one when `unknown` is set.
pub fn arb_named<T: crate::model::NamedValue + std::fmt::Debug>(unknown: bool) -> BoxedStrategy<Named<T>> {
    let known = proptest::sample::select(T::ALL).prop_map(Named::Known);
    if unknown {
        prop_oneof![4 => known, 1 => "zz[a-z]{1,6}".prop_map(|s| Named::Unknown(s.into()))].boxed()
    } else {
        known.boxed()
    }
}

/// A palette name, a hexadecimal color, or an unknown palette name.
pub fn arb_color() -> impl Strategy<Value = Color> {
    prop_oneof![
        proptest::sample::select(&crate::model::PEN_NAMES[..]).prop_map(|n| Color::Palette(n.into())),
        any::<[u8; 3]>().prop_map(Color::Rgb),
        any::<[u8; 4]>().prop_map(Color::Rgba),
        "zz[a-z]{1,5}".prop_map(|n| Color::Palette(n.into())),
    ]
}

/// View settings.
pub fn arb_view(unknown: bool) -> impl Strategy<Value = PageView> {
    let paper = (
        arb_named::<PaperSize>(unknown),
        arb_named::<Orientation>(unknown),
        arb_size(),
        arb_size(),
    )
        .prop_flat_map(move |(size, orientation, width, height)| {
            (proptest::array::uniform4(arb_geometry()), arb_extra(unknown)).prop_map(move |(margins, extra)| Paper {
                size: size.clone(),
                orientation: orientation.clone(),
                width,
                height,
                margins,
                extra,
            })
        });
    let background = (
        arb_named::<Pattern>(unknown),
        arb_size(),
        arb_color(),
        any::<bool>(),
        proptest::option::of(arb_id()),
    )
        .prop_flat_map(move |(pattern, spacing, color, margin_line, template)| {
            arb_extra(unknown).prop_map(move |extra| Background {
                pattern: pattern.clone(),
                spacing,
                color: color.clone(),
                margin_line,
                template,
                extra,
            })
        });
    let rest = (
        arb_named::<Layout>(unknown),
        arb_named::<ViewMode>(unknown),
        proptest::option::of(arb_size()),
    );
    (rest, paper, background, arb_extra(unknown)).prop_map(
        |((layout, mode, content_width), paper, background, extra)| PageView {
            layout,
            mode,
            paper,
            background,
            content_width,
            extra,
        },
    )
}

/// An asset table entry with a valid file name.
pub fn arb_asset(id: AssetId, unknown: bool) -> impl Strategy<Value = Asset> {
    let mime = proptest::sample::select(&["image/png", "image/jpeg", "application/pdf", "audio/ogg"][..]);
    let size = || proptest::option::of(1u32..10_000);
    (
        arb_text(20),
        mime,
        0u64..(1 << 40),
        any::<[u8; 32]>(),
        size(),
        size(),
        arb_timestamp(),
        arb_extra(unknown),
    )
        .prop_map(
            move |(name, mime, bytes, sha256, width, height, created, extra)| Asset {
                id,
                file: asset_file_name(id, &name, mime),
                mime: mime.to_owned(),
                bytes,
                sha256,
                name,
                width,
                height,
                created,
                extra,
            },
        )
}

/// A revision with a device.
pub fn arb_revision(unknown: bool) -> impl Strategy<Value = Revision> {
    let ids = || vec(arb_id().prop_map(RevisionId), 0..3);
    (
        arb_id(),
        ids(),
        ids(),
        arb_timestamp(),
        arb_id(),
        arb_text(12),
        arb_text(12),
        arb_extra(unknown),
    )
        .prop_map(
            |(id, parents, ancestors, saved_at, device, label, writer, extra)| Revision {
                id: RevisionId(id),
                parents,
                ancestors,
                saved_at,
                device: DeviceRef {
                    id: DeviceId(device),
                    label,
                },
                writer,
                extra,
            },
        )
}

/// A segment list entry.
pub fn arb_segment_ref(unknown: bool) -> impl Strategy<Value = SegmentRef> {
    (
        arb_id(),
        72u64..(1 << 30),
        0u32..100_000,
        any::<u32>(),
        arb_extra(unknown),
    )
        .prop_map(|(id, bytes, records, crc32, extra)| SegmentRef {
            id: SegmentId(id),
            bytes,
            records,
            crc32,
            extra,
        })
}

mod page;

pub use page::arb_page;

/// Queues every live stroke of a page as a pending record, as if it were drawn since the last save.
pub fn pend_all_strokes(page: &mut Page) {
    let strokes: Vec<Arc<Stroke>> = page.ink.strokes().cloned().collect();
    for stroke in strokes {
        page.ink.push_pending(InkRecord::Stroke(stroke));
    }
}

/// A page ID for tests that don't care which.
pub fn some_page_id() -> PageId {
    PageId(unique_id(9, 0, 0))
}

#[cfg(test)]
mod tests;
