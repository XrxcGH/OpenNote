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
    let source = AssetSource::Bytes {
        name: "Leaf section.png".into(),
        mime: "image/png".into(),
        bytes: png(1600, 1200),
    };
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
    let asset = import_asset(&fs, &page_dir(), AssetSource::Path(source), &ctx).unwrap();
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
    assert!(import_asset(&fs, &page_dir(), AssetSource::Path("/nope.png".into()), &missing).is_err());
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
        AssetSource::Bytes {
            name: "a.txt".into(),
            mime: "text/plain".into(),
            bytes: b"hello".to_vec(),
        },
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
