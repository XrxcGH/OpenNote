//! A picture the person cropped is trimmed in the `.tex` file and kept whole in `images/`.

use std::collections::BTreeMap;
use std::fs;
use std::sync::Arc;

use opennote_core::model::{BlockData, Crop, ImageData, JsonMap, NotebookFile, Page};
use opennote_core::testing::sample::{sample_asset_id, sample_page};
use opennote_core::NotebookId;
use opennote_interop::testing::{at, png_bytes, unzip, TestEnv};
use opennote_interop::tree::{section_orders, SectionBuilder};
use opennote_interop::{export_latex, ImportedPage, LatexOptions, MemorySource, Scope};

/// Gives the page's picture this crop, as fractions of the picture.
fn crop_image(page: &mut Page, x: f64, y: f64, w: f64, h: f64) {
    let first = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::Image(_)))
        .expect("an image block")
        .clone();
    let BlockData::Image(image) = &first.data else {
        unreachable!()
    };
    let mut block = (*first).clone();
    block.data = BlockData::Image(ImageData {
        crop: Some(Crop {
            x,
            y,
            w,
            h,
            extra: JsonMap::new(),
        }),
        ..image.clone()
    });
    page.blocks.replace(Arc::new(block)).expect("replaces");
}

/// Exports the sample page with this crop on its picture. Returns the `.tex` text and the picture file.
fn export_with_crop(crop: Option<(f64, f64, f64, f64)>) -> (String, Vec<u8>, String) {
    let world = TestEnv::new();
    let env = world.env();
    let created = at("2026-03-04T10:00:00Z");
    let mut source = MemorySource::new(NotebookFile::new(NotebookId::generate(env.clock), "Chemistry", created));
    let mut page = sample_page();
    if let Some((x, y, w, h)) = crop {
        crop_image(&mut page, x, y, w, h);
    }
    let id = page.id;
    let mut section = SectionBuilder::new(&env, "Notes", created);
    section.add_page(&page, None);
    source.add_page(ImportedPage {
        page,
        asset_bytes: BTreeMap::from([(sample_asset_id(), png_bytes())]),
    });
    let order = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(order).expect("the section builds"));
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_latex(&source, Scope::Page(id), &LatexOptions::default(), out.path()).expect("exports");
    let files = unzip(&fs::read(&exported.files[0]).expect("reads"));
    let text = |suffix: &str| {
        files
            .iter()
            .find(|(n, _)| n.ends_with(suffix))
            .expect("a file")
            .1
            .clone()
    };
    let tex = String::from_utf8(text(".tex")).expect("UTF-8");
    (tex, text(".png"), exported.report.to_markdown())
}

#[test]
fn a_cropped_picture_is_trimmed_in_the_tex_file_and_kept_whole_in_images() {
    let (tex, picture, report) = export_with_crop(Some((0.1, 0.2, 0.5, 0.3)));
    assert_eq!(picture, png_bytes(), "the file in images/ is the whole picture");
    // Trimmed from each edge: left 0.1; bottom 1 - 0.2 - 0.3 = 0.5; right 1 - 0.1 - 0.5 = 0.4; top 0.2.
    assert!(
        tex.contains("% cropped in OpenNote: the part from 10% to 60% across and 20% to 50% down"),
        "{tex}"
    );
    let wanted = concat!(
        r"\adjustbox{trim={0.1000\width 0.5000\height 0.4000\width 0.2000\height},clip,",
        r"max size={\linewidth}{0.55\textheight}}",
        r"{\includegraphics[width=!,height=!]{images/Leaf-section.png}}"
    );
    assert!(tex.contains(wanted), "{tex}");
    assert!(tex.contains(r"\usepackage{adjustbox}"), "{tex}");
    assert!(!report.contains("shown whole"), "{report}");
}

#[test]
fn a_picture_without_a_crop_is_written_whole() {
    let (tex, _, _) = export_with_crop(None);
    assert!(tex.contains(r"\includegraphics{images/Leaf-section.png}"), "{tex}");
    assert!(!tex.contains("cropped in OpenNote"), "{tex}");
}

#[test]
fn a_crop_that_shows_the_whole_picture_is_not_written() {
    let (tex, _, _) = export_with_crop(Some((0.0, 0.0, 1.0, 1.0)));
    assert!(tex.contains(r"\includegraphics{images/Leaf-section.png}"), "{tex}");
    assert!(!tex.contains("adjustbox{"), "{tex}");
}
