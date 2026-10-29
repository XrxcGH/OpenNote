#![allow(clippy::unwrap_used)]

use std::path::Path;

use super::*;

#[test]
fn a_repair_only_writes_inside_the_notebook() {
    let root = Path::new("/notebooks/Biology");
    assert!(inside(root, &root.join("a").join("page.json")).is_ok());
    for outside in [
        root.to_path_buf(),
        root.join("..").join("Other").join("page.json"),
        root.join("a").join("..").join("..").join("x"),
        Path::new("/notebooks/Biology2/page.json").to_path_buf(),
        Path::new("/elsewhere").to_path_buf(),
    ] {
        assert!(inside(root, &outside).is_err(), "{}", outside.display());
    }
}

#[test]
fn undo_takes_back_a_file_that_was_not_there() {
    let fs = crate::testing::mem_fs::MemFs::new();
    let root = Path::new("/n");
    let path = root.join("s").join("f.bin");
    fs.put(&root.join("s").join("other.bin"), b"x");
    let done = replace(&fs, root, &path, b"new").unwrap();
    assert_eq!(done.previous, None);
    undo(&fs, root, &done).unwrap();
    assert!(current(&fs, &path).unwrap().is_none());
}
