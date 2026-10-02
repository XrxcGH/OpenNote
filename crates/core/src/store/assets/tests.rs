#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::arithmetic_side_effects)]

use std::cell::RefCell;

use super::*;
use crate::testing::sample::test_clock;
use crate::testing::MemFs;

fn page_dir() -> PathBuf {
    PathBuf::from("/notebooks/Biology/01m3s9v8ym7yt5c8yb61tthbwt/01m3sa12426sg32pmtyffjaqcf")
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[0; 20]);
    bytes
}

#[test]
fn imports_bytes_durably_and_reuses_the_same_file() {
    let fs = MemFs::new();
    fs.mkdir_all(&page_dir());
    let clock = test_clock();
    let seen = RefCell::new(Vec::new());
    let progress = |done, total| seen.borrow_mut().push((done, total));
    let mut table = BTreeMap::new();
    let source = AssetSource::bytes("Leaf section.png", "image/png", png(1600, 1200));
    let ctx = ImportCtx {
        existing: &table,
        clock: &clock,
        progress: &progress,
    };
    let asset = import_asset(&fs, &page_dir(), source.clone(), &ctx).unwrap();
    assert!(asset.file.ends_with("-leaf-section.png"), "{}", asset.file);
    assert_eq!((asset.width, asset.height), (Some(1600), Some(1200)));
    assert_eq!(asset.bytes, png(1600, 1200).len() as u64);
    assert_eq!(asset.created, clock.now());
    assert_eq!(read_asset(&fs, &page_dir(), &asset, None).unwrap(), png(1600, 1200));
    assert_eq!(read_asset(&fs, &page_dir(), &asset, Some(1..4)).unwrap(), b"PNG");
    assert_eq!(seen.borrow().last(), Some(&(asset.bytes, asset.bytes)));
    table.insert(asset.id, asset.clone());
    let ctx = ImportCtx {
        existing: &table,
        clock: &clock,
        progress: &progress,
    };
    assert_eq!(
        import_asset(&fs, &page_dir(), source.clone(), &ctx).unwrap(),
        asset,
        "same hash"
    );
    let path = NotebookLayout::asset_path(&page_dir(), &asset).unwrap();
    fs.remove_file(&path).unwrap();
    assert_eq!(import_asset(&fs, &page_dir(), source, &ctx).unwrap(), asset);
    assert!(fs.exists(&path), "a missing file of a reused asset is written again");
}

#[test]
fn imports_files_from_disk_in_chunks() {
    let fs = MemFs::new();
    fs.mkdir_all(&page_dir());
    let source = PathBuf::from("/home/sam/Lecture notes.pdf");
    let content: Vec<u8> = (0..(2 * CHUNK + 10)).map(|i| (i % 251) as u8).collect();
    fs.put(&source, &content);
    let clock = test_clock();
    let seen = RefCell::new(Vec::new());
    let progress = |done, total| seen.borrow_mut().push((done, total));
    let ctx = ImportCtx {
        existing: &BTreeMap::new(),
        clock: &clock,
        progress: &progress,
    };
    let asset = import_asset(&fs, &page_dir(), AssetSource::path(source), &ctx).unwrap();
    assert_eq!(asset.mime, "application/pdf");
    assert_eq!(asset.name, "Lecture notes.pdf");
    assert_eq!((asset.width, asset.height), (None, None));
    let total = content.len() as u64;
    assert_eq!(*seen.borrow(), [(CHUNK, total), (2 * CHUNK, total), (total, total)]);
    assert_eq!(read_asset(&fs, &page_dir(), &asset, None).unwrap(), content);
    let missing = ImportCtx {
        existing: &BTreeMap::new(),
        clock: &clock,
        progress: &|_, _| {},
    };
    assert!(import_asset(&fs, &page_dir(), AssetSource::path("/nope.png"), &missing).is_err());
}

#[test]
fn a_bad_file_name_is_a_missing_file() {
    let fs = MemFs::new();
    let clock = test_clock();
    let mut asset = import_asset(
        &fs,
        &{
            fs.mkdir_all(&page_dir());
            page_dir()
        },
        AssetSource::bytes("a.txt", "text/plain", b"hello".to_vec()),
        &ImportCtx {
            existing: &BTreeMap::new(),
            clock: &clock,
            progress: &|_, _| {},
        },
    )
    .unwrap();
    asset.file = "../../escape.txt".into();
    let err = read_asset(&fs, &page_dir(), &asset, None).unwrap_err();
    assert_eq!(err.kind, FsErrorKind::NotFound);
}

fn import_with(fs: &MemFs, source: AssetSource) -> Result<Asset, CoreError> {
    fs.mkdir_all(&page_dir());
    let clock = test_clock();
    let ctx = ImportCtx {
        existing: &BTreeMap::new(),
        clock: &clock,
        progress: &|_, _| {},
    };
    import_asset(fs, &page_dir(), source, &ctx)
}

fn webp() -> Vec<u8> {
    let mut bytes = b"RIFF\x20\0\0\0WEBPVP8 ".to_vec();
    bytes.extend_from_slice(&[0; 24]);
    bytes
}

fn sized(width: u32, height: u32) -> Option<ImageSize> {
    Some(ImageSize { width, height })
}

#[test]
fn the_size_the_interface_measured_fills_in_what_the_headers_cannot_give() {
    let fs = MemFs::new();
    let source = AssetSource::Bytes {
        name: "Diagram.webp".into(),
        mime: "image/webp".into(),
        bytes: webp(),
        image: sized(640, 480),
    };
    let asset = import_with(&fs, source).unwrap();
    assert_eq!((asset.width, asset.height), (Some(640), Some(480)));
    // From a file on disk too.
    let path = PathBuf::from("/home/sam/Diagram.webp");
    fs.put(&path, &webp());
    let from_disk = AssetSource::Path {
        path,
        image: sized(300, 200),
    };
    let asset = import_with(&fs, from_disk).unwrap();
    assert_eq!((asset.width, asset.height), (Some(300), Some(200)));
}

#[test]
fn headers_win_over_a_claimed_size_and_claims_that_make_no_sense_are_ignored() {
    let fs = MemFs::new();
    let png_source = AssetSource::Bytes {
        name: "a.png".into(),
        mime: "image/png".into(),
        bytes: png(1600, 1200),
        image: sized(10, 10),
    };
    let asset = import_with(&fs, png_source).unwrap();
    assert_eq!(
        (asset.width, asset.height),
        (Some(1600), Some(1200)),
        "the file knows best"
    );
    for claim in [sized(0, 10), sized(10, 0), sized(2_000_000, 10)] {
        let source = AssetSource::Bytes {
            name: "b.webp".into(),
            mime: "image/webp".into(),
            bytes: webp(),
            image: claim,
        };
        let asset = import_with(&fs, source).unwrap();
        assert_eq!((asset.width, asset.height), (None, None), "{claim:?}");
    }
    let pdf = AssetSource::Bytes {
        name: "c.pdf".into(),
        mime: "application/pdf".into(),
        bytes: b"%PDF-1.7".to_vec(),
        image: sized(10, 10),
    };
    let asset = import_with(&fs, pdf).unwrap();
    assert_eq!((asset.width, asset.height), (None, None), "only pictures have a size");
}

#[test]
fn an_image_must_start_with_the_bytes_of_its_type() {
    let fs = MemFs::new();
    let refused = import_with(
        &fs,
        AssetSource::bytes("leaf.png", "image/png", b"<html>nope</html>".to_vec()),
    );
    assert!(matches!(&refused, Err(CoreError::Edit(EditError::Invalid(m))) if m.starts_with("assetType")));
    assert!(
        !fs.exists(&page_dir().join("assets")),
        "nothing is written for a refused import"
    );
    let wrong_type = import_with(&fs, AssetSource::bytes("leaf.jpg", "image/jpeg", png(2, 2)));
    assert!(wrong_type.is_err(), "a PNG declared as a JPEG");
    let path = PathBuf::from("/home/sam/fake.gif");
    fs.put(&path, b"MZ executable");
    assert!(
        import_with(&fs, AssetSource::path(&path)).is_err(),
        "the type comes from the name"
    );
    assert!(import_with(&fs, AssetSource::bytes("a.png", "image/png", png(2, 2))).is_ok());
    assert!(import_with(&fs, AssetSource::bytes("x.xyz", "image/x-unknown", vec![1, 2, 3])).is_ok());
    assert!(import_with(&fs, AssetSource::bytes("a.txt", "text/plain", b"hello".to_vec())).is_ok());
}
