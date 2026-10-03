//! Properties of the formats (plan 13.2): P1 JSON round trips, P3 the ink codec half, P10 merges, and P12
//! escaping. They run 256 cases on every pull request and more nightly through `PROPTEST_CASES`.

mod common;

use std::collections::BTreeSet;
use std::sync::Arc;

use opennote_core::format::history_json::{merge_versions, read_versions, write_versions};
use opennote_core::format::markdown::{escape_text, unescape_text};
use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::format::segment::{decode_records, decode_segment, encode_records, encode_segment};
use opennote_core::format::trash_json::{read_trash_item, write_trash_item};
use opennote_core::format::tree_json::{
    merge_notebooks, merge_sections, read_notebook, read_section, sorted_groups, sorted_pages, write_notebook,
    write_section,
};
use opennote_core::format::{segment_footer_crc, SegmentHeader};
use opennote_core::id::{BlockId, SegmentId, StrokeId};
use opennote_core::model::{
    Affine, FormatInfo, InkRecord, NotebookFile, Page, SectionFile, SegmentRef, StrokeProps, StrokeStyle, VersionsFile,
};
use opennote_core::testing::gen::{
    arb_id, arb_notebook_file, arb_page, arb_section_file, arb_stroke, arb_timestamp, arb_trash_item,
    arb_versions_file, PageGen,
};
use opennote_core::{Limits, PageId};
use proptest::prelude::*;

fn limits() -> Limits {
    Limits::default()
}

/// A section as the canonical writer orders it.
fn canonical_section(mut file: SectionFile) -> SectionFile {
    file.pages = sorted_pages(&file.pages).into_iter().cloned().collect();
    file.format = FormatInfo::default();
    file
}

fn canonical_notebook(mut file: NotebookFile) -> NotebookFile {
    file.groups = sorted_groups(&file.groups).into_iter().cloned().collect();
    file.format = FormatInfo::default();
    file
}

fn without_format_page(mut page: Page) -> Page {
    page.format = FormatInfo::default();
    page
}

fn without_format_versions(mut file: VersionsFile) -> VersionsFile {
    file.format = FormatInfo::default();
    file
}

proptest! {
    #![proptest_config(common::cases(256))]

    /// P1 for `page.json`: `read(write(x)) == x`, unknown keys and blocks included, and writing again gives the
    /// same bytes.
    #[test]
    fn p1_pages_round_trip(page in arb_page(PageGen::json_only())) {
        let bytes = write_page(&page);
        let read = read_page(&bytes, &limits()).unwrap();
        prop_assert_eq!(without_format_page(read.page.clone()), page);
        prop_assert_eq!(write_page(&read.page), bytes);
    }

    /// P1 for `section.json`.
    #[test]
    fn p1_sections_round_trip(file in arb_section_file(true)) {
        let bytes = write_section(&file);
        let read = read_section(&bytes, &limits()).unwrap();
        prop_assert_eq!(canonical_section(read.clone()), canonical_section(file));
        prop_assert_eq!(write_section(&read), bytes);
    }

    /// P1 for `notebook.json`.
    #[test]
    fn p1_notebooks_round_trip(file in arb_notebook_file(true)) {
        let bytes = write_notebook(&file);
        let read = read_notebook(&bytes, &limits()).unwrap();
        prop_assert_eq!(canonical_notebook(read.clone()), canonical_notebook(file));
        prop_assert_eq!(write_notebook(&read), bytes);
    }

    /// P1 for Trash items.
    #[test]
    fn p1_trash_items_round_trip(file in arb_trash_item(true)) {
        let bytes = write_trash_item(&file);
        let mut read = read_trash_item(&bytes, &limits()).unwrap();
        prop_assert_eq!(write_trash_item(&read), bytes.clone());
        read.format = FormatInfo::default();
        prop_assert_eq!(read, file);
    }

    /// P1 for `versions.json`.
    #[test]
    fn p1_versions_round_trip(file in arb_versions_file(true)) {
        let bytes = write_versions(&file);
        let read = read_versions(&bytes, &limits()).unwrap();
        prop_assert_eq!(write_versions(&read), bytes);
        prop_assert_eq!(without_format_versions(read), file);
    }

    /// P3, the codec half: segments and record blobs decode to what was encoded, and re-encoding what was
    /// decoded gives the same bytes.
    #[test]
    fn p3_segments_round_trip(records in arb_records(), id in arb_id(), page in arb_id(), created in arb_timestamp()) {
        let header = SegmentHeader { id: SegmentId(id), page: PageId(page), created };
        let bytes = encode_segment(&header, &records);
        let expect = SegmentRef {
            id: header.id,
            bytes: bytes.len() as u64,
            records: records.len() as u32,
            crc32: segment_footer_crc(&bytes).unwrap(),
            extra: Default::default(),
        };
        let decoded = decode_segment(&bytes, &expect, header.page, &limits()).unwrap();
        prop_assert!(decoded.footer_ok && decoded.damaged.is_empty() && decoded.unknown_records == 0);
        prop_assert_eq!(&decoded.records, &records);
        prop_assert_eq!(encode_segment(&decoded.header, &decoded.records), bytes);
        let blob = encode_records(&records);
        prop_assert_eq!(decode_records(&blob, &limits()).unwrap(), records);
    }

    /// P10 for sections: merging never loses an entry, and gives the same result in either order and when
    /// repeated.
    #[test]
    fn p10_section_merges(a in arb_section_file(true), b in arb_section_file(true)) {
        let merged = merge_sections(&a, &b);
        let ids = |f: &SectionFile| f.pages.iter().map(|p| p.id).collect::<BTreeSet<_>>();
        let all: BTreeSet<_> = ids(&a).union(&ids(&b)).copied().collect();
        prop_assert_eq!(ids(&merged), all);
        prop_assert_eq!(canonical_section(merge_sections(&b, &a)), canonical_section(merged.clone()));
        prop_assert_eq!(canonical_section(merge_sections(&merged, &b)), canonical_section(merged.clone()));
        prop_assert_eq!(canonical_section(merge_sections(&a, &merged)), canonical_section(merged.clone()));
        prop_assert_eq!(canonical_section(merge_sections(&a, &a)), canonical_section(a));
    }

    /// P10 for notebooks.
    #[test]
    fn p10_notebook_merges(a in arb_notebook_file(true), b in arb_notebook_file(true)) {
        let merged = merge_notebooks(&a, &b);
        let ids = |f: &NotebookFile| f.groups.iter().map(|g| g.id).collect::<BTreeSet<_>>();
        let all: BTreeSet<_> = ids(&a).union(&ids(&b)).copied().collect();
        prop_assert_eq!(ids(&merged), all);
        prop_assert_eq!(canonical_notebook(merge_notebooks(&b, &a)), canonical_notebook(merged.clone()));
        prop_assert_eq!(canonical_notebook(merge_notebooks(&merged, &b)), canonical_notebook(merged.clone()));
        prop_assert_eq!(canonical_notebook(merge_notebooks(&a, &a)), canonical_notebook(a));
    }

    /// P10 for page history.
    #[test]
    fn p10_version_merges(a in arb_versions_file(true), b in arb_versions_file(true)) {
        let merged = merge_versions(&a, &b);
        let ids = |f: &VersionsFile| f.versions.iter().map(|v| v.revision).collect::<BTreeSet<_>>();
        let all: BTreeSet<_> = ids(&a).union(&ids(&b)).copied().collect();
        prop_assert_eq!(ids(&merged), all);
        let kept = |f: &VersionsFile| {
            f.versions.iter().filter(|v| v.keep).map(|v| v.revision).collect::<BTreeSet<_>>()
        };
        prop_assert!(kept(&a).is_subset(&kept(&merged)));
        let plain = without_format_versions;
        prop_assert_eq!(plain(merge_versions(&b, &a)), plain(merged.clone()));
        prop_assert_eq!(plain(merge_versions(&merged, &b)), plain(merged.clone()));
        prop_assert_eq!(plain(merge_versions(&merged, &merged)), plain(merged));
    }

    /// P12: escaped text unescapes to the original text. Text never holds a carriage return, and a zero
    /// character becomes U+FFFD (spec 7.6).
    #[test]
    fn p12_escaping_is_lossless(text in "[^\r]{0,40}", at_line_start in any::<bool>()) {
        let escaped = escape_text(&text, at_line_start);
        prop_assert_eq!(unescape_text(&escaped), text.replace('\0', "\u{fffd}"));
        prop_assert!(!escaped.contains('\t'));
    }

    /// P12 on the characters escaping cares about most.
    #[test]
    fn p12_escaping_is_lossless_for_syntax(
        text in "[-+=_*#&;.)0-9a-z <>\\[\\]{}|`~$\\\\\n\t]{0,40}",
        at_line_start in any::<bool>(),
    ) {
        let escaped = escape_text(&text, at_line_start);
        prop_assert_eq!(unescape_text(&escaped), text);
    }
}

/// Stroke, property, and removal records for one block.
fn arb_records() -> impl Strategy<Value = Vec<InkRecord>> {
    let block = BlockId(opennote_core::Id::from_parts(1, 1));
    let strokes = (0usize..6).prop_flat_map(move |n| {
        (0..n)
            .map(|i| arb_stroke(StrokeId(opennote_core::Id::from_parts(2, i as u128)), vec![block], 40))
            .collect::<Vec<_>>()
    });
    let props = proptest::collection::vec(arb_props(), 0..4);
    let removes = proptest::collection::vec(arb_id().prop_map(|id| InkRecord::Remove(StrokeId(id))), 0..3);
    (strokes, props, removes).prop_map(|(strokes, props, removes)| {
        let mut records: Vec<InkRecord> = strokes.into_iter().map(|s| InkRecord::Stroke(Arc::new(s))).collect();
        records.extend(props);
        records.extend(removes);
        records
    })
}

fn arb_props() -> impl Strategy<Value = InkRecord> {
    let style =
        (any::<u8>(), any::<u8>(), any::<[u8; 4]>(), 0.1f32..100.0).prop_map(|(tool, palette, color, width)| {
            StrokeStyle {
                tool,
                palette,
                color,
                width,
            }
        });
    let transform = prop_oneof![
        Just(None),
        Just(Some(None)),
        proptest::array::uniform6(-10f32..10.0)
            .prop_filter("not the identity", |t| Affine(*t) != Affine::IDENTITY)
            .prop_map(|t| Some(Some(Affine(t)))),
    ];
    let block = proptest::option::of(arb_id().prop_map(BlockId));
    (arb_id(), proptest::option::of(style), transform, block).prop_map(|(id, style, transform, block)| {
        InkRecord::Props(StrokeProps {
            id: StrokeId(id),
            style,
            transform,
            block,
        })
    })
}
