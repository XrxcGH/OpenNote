use std::collections::HashSet;

use super::*;
use crate::format::names::check_asset_file_name;
use crate::model::BlockData;

/// The stroke of spec 9.7 encodes to the 20 bytes the spec lists.
#[test]
fn test_encoder_matches_the_worked_example() {
    let points = [
        Point {
            x: 640,
            y: 1_280,
            pressure: 32_768,
            t: 0,
            ..Point::default()
        },
        Point {
            x: 672,
            y: 1_344,
            pressure: 34_078,
            t: 42,
            ..Point::default()
        },
        Point {
            x: 720,
            y: 1_440,
            pressure: 36_044,
            t: 83,
            ..Point::default()
        },
    ];
    let (bytes, bbox) = encode_test_points(&points, Channels(Channels::PRESSURE | Channels::TIME));
    let expected = [
        0x80, 0x0a, 0x80, 0x14, 0x80, 0x80, 0x02, 0x00, 0x40, 0x80, 0x01, 0xbc, 0x14, 0x2a, 0x60, 0xc0, 0x01, 0xdc,
        0x1e, 0x29,
    ];
    assert_eq!(bytes, expected);
    assert_eq!(
        bbox,
        BBox {
            min_x: 640,
            min_y: 1_280,
            max_x: 720,
            max_y: 1_440
        }
    );
}

/// Checks the rules generated pages promise.
fn check_page(page: &Page) -> Result<(), TestCaseError> {
    let mut ids = HashSet::new();
    for block in page.blocks.iter() {
        prop_assert!(ids.insert(block.id.0), "block IDs are unique");
        match &block.data {
            BlockData::Text(text) => {
                for element in &text.ids {
                    prop_assert!(ids.insert(element.0), "element IDs share the page's ID space");
                }
            }
            BlockData::Ink(ink) => prop_assert_eq!(ink.stroke_count, page.ink.count_in_block(block.id)),
            BlockData::Image(image) => prop_assert!(page.assets.contains_key(&image.asset)),
            BlockData::File(file) => prop_assert!(page.assets.contains_key(&file.asset)),
            BlockData::Table(_) => {}
            BlockData::Other(_) => prop_assert!(block.fallback.is_some(), "extension types carry a fallback"),
        }
        if let Some(frame) = &block.frame {
            for v in [frame.x, frame.y, frame.w, frame.h, frame.rotate].into_iter().flatten() {
                prop_assert_eq!((v * 100.0).round() / 100.0, v, "geometry is rounded to 0.01");
            }
        }
    }
    for (id, asset) in &page.assets {
        prop_assert!(check_asset_file_name(*id, &asset.file), "{}", asset.file);
    }
    for stroke in page.ink.strokes() {
        prop_assert!(page
            .blocks
            .get(stroke.block)
            .is_some_and(|b| matches!(b.data, BlockData::Ink(_))));
    }
    prop_assert!(page.reading_order.iter().all(|id| page.blocks.contains(*id)));
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn generated_pages_keep_the_rules(page in arb_page(PageGen::default())) {
        check_page(&page)?;
        prop_assert_eq!(page.ink.pending().len(), page.ink.len(), "live strokes are pending");
    }

    #[test]
    fn json_only_pages_list_segments_without_strokes(page in arb_page(PageGen::json_only())) {
        check_page(&page)?;
        prop_assert!(page.ink.is_empty());
        prop_assert!(page.ink.pending().is_empty());
    }

    #[test]
    fn generated_tree_files_have_unique_ids(
        notebook in arb_notebook_file(true),
        section in arb_section_file(true),
        versions in arb_versions_file(true),
        item in arb_trash_item(true),
    ) {
        let groups: HashSet<_> = notebook.groups.iter().map(|g| g.id).collect();
        prop_assert_eq!(groups.len(), notebook.groups.len());
        prop_assert!(notebook.groups.iter().all(|g| g.parent.is_none_or(|p| groups.contains(&p))));
        let pages: HashSet<_> = section.pages.iter().map(|p| p.id).collect();
        prop_assert_eq!(pages.len(), section.pages.len());
        let revisions: HashSet<_> = versions.versions.iter().map(|v| v.revision).collect();
        prop_assert_eq!(revisions.len(), versions.versions.len());
        prop_assert!(!item.contents.is_empty());
    }

    #[test]
    fn order_keys_are_fractional(key in arb_order_key()) {
        prop_assert!(key.is_fractional());
    }
}
