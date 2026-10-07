//! Files that travel with an asset: a recording track's `.timeline` file sits beside its audio as
//! `assets/<asset ID>-mic.timeline` (crates/media, audio/README.md). It begins with the asset's ID, so garbage
//! collection keeps and removes it with the asset. Copying a page copies it too, so its stamps stay intact.

use std::path::Path;

use crate::error::{CoreError, FsErrorKind};
use crate::format::names::check_asset_file_name;
use crate::model::Page;
use crate::store::fs::Fs;
use crate::store::layout::ASSETS_DIR;

/// The largest companion file copied. A timeline holds 16 bytes for each stretch of a recording.
pub(crate) const MAX_COMPANION: u64 = 64 * 1024 * 1024;

/// Copies the files in `src/assets` that belong to one of the page's assets but are not the asset's own file,
/// such as a track's timeline, to `dst/assets`. A file whose name doesn't pass the asset name check for that
/// asset's ID is left alone, so no name from the folder can leave `assets/`.
pub(crate) fn copy_companions(fs: &dyn Fs, src: &Path, dst: &Path, page: &Page) -> Result<u32, CoreError> {
    if page.assets.is_empty() {
        return Ok(0);
    }
    let from_dir = src.join(ASSETS_DIR);
    let entries = match fs.read_dir(&from_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind == FsErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    let to_dir = dst.join(ASSETS_DIR);
    let mut copied = 0u32;
    for entry in entries.iter().filter(|entry| !entry.is_dir) {
        let belongs = page
            .assets
            .values()
            .any(|asset| entry.name != asset.file && check_asset_file_name(asset.id, &entry.name));
        if !belongs || entry.len > MAX_COMPANION {
            continue;
        }
        let bytes = fs.read(&from_dir.join(&entry.name), MAX_COMPANION)?;
        crate::store::lock::ensure_dir_all(fs, &to_dir)?;
        // A retry after a crash finds the same bytes, which counts as copied.
        fs.create_durable(&to_dir.join(&entry.name), &bytes)?;
        copied = copied.saturating_add(1);
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use sha2::{Digest, Sha256};

    use super::super::kit::Kit;
    use super::super::pages::{read_page_files, write_page_files};
    use crate::id::{AssetId, PageId, RevisionId, SectionId};
    use crate::limits::Limits;
    use crate::model::{Asset, JsonMap, Revision};
    use crate::store::layout::ASSETS_DIR;
    use crate::store::PageFiles;
    use crate::time::Clock;

    /// A timeline file: the `ONTIMEL2` header with the clock anchor, then one 16-byte record.
    fn timeline_bytes() -> Vec<u8> {
        let mut bytes = b"ONTIMEL2".to_vec();
        bytes.extend_from_slice(&1_790_000_000_000i64.to_le_bytes());
        bytes.extend_from_slice(&5_000_000u64.to_le_bytes());
        bytes.extend_from_slice(&48_000u64.to_le_bytes());
        bytes.extend_from_slice(&1_005_000_000u64.to_le_bytes());
        bytes
    }

    /// Gives page `page` a finished recording track with its timeline beside it.
    fn record(kit: &Kit, section: SectionId, page: PageId) -> (String, String) {
        let fs = kit.env.fs.as_ref();
        let dir = kit.root.join(section.to_string()).join(page.to_string());
        let mut loaded = read_page_files(fs, &kit.codec, &dir, &Limits::default()).unwrap().page;
        let id = AssetId::generate(kit.clock.as_ref());
        let audio = b"OggS fake audio".to_vec();
        let asset = Asset {
            id,
            file: format!("{id}-mic.ogg"),
            mime: "audio/ogg".into(),
            bytes: audio.len() as u64,
            sha256: Sha256::digest(&audio).into(),
            name: "Recording".into(),
            width: None,
            height: None,
            created: kit.clock.now(),
            extra: JsonMap::new(),
        };
        fs.create_dir_durable(&dir.join(ASSETS_DIR)).unwrap();
        fs.create_durable(&dir.join(ASSETS_DIR).join(&asset.file), &audio)
            .unwrap();
        let timeline = format!("{id}-mic.timeline");
        fs.create_durable(&dir.join(ASSETS_DIR).join(&timeline), &timeline_bytes())
            .unwrap();
        // A stray file that belongs to no asset stays behind.
        fs.create_durable(&dir.join(ASSETS_DIR).join("notes.txt"), b"stray")
            .unwrap();
        loaded.assets.insert(id, asset.clone());
        let files = PageFiles {
            fs,
            codec: &kit.codec,
            dir: &dir,
        };
        let revision = Revision::new(
            RevisionId::generate(kit.clock.as_ref()),
            kit.clock.now(),
            kit.env.device.clone(),
            kit.env.writer.clone(),
        );
        write_page_files(&files, kit.clock.as_ref(), &loaded, revision).unwrap();
        (asset.file, timeline)
    }

    #[test]
    fn a_duplicated_page_keeps_its_recording_timeline_and_stamps() {
        let kit = Kit::new();
        let mut store = kit.open().unwrap();
        let section = store.create_section("Lectures", None, None).unwrap();
        let page = store.create_page(section, None, None, "Week 1").unwrap();
        let (audio, timeline) = record(&kit, section, page);

        let copy = store.duplicate(page).unwrap();
        let fs = kit.env.fs.as_ref();
        let assets = kit
            .root
            .join(section.to_string())
            .join(copy.to_string())
            .join(ASSETS_DIR);
        assert_eq!(
            fs.read(&assets.join(&timeline), u64::MAX).unwrap(),
            timeline_bytes(),
            "stamps intact"
        );
        assert!(fs.metadata(&assets.join(&audio)).is_ok());
        assert!(
            fs.metadata(&assets.join("notes.txt")).is_err(),
            "only an asset's own companions travel"
        );
    }
}
