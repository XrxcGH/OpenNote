//! Devices that sync through shared storage, and real note-format files to sync.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::format::page_json::write_page;
use opennote_core::format::tree_json::write_section;
use opennote_core::id::{DeviceId, Id, PageId, RevisionId, SectionId, SegmentId};
use opennote_core::model::ink::SegmentRef;
use opennote_core::model::{DeviceRef, Page, PageEntry, Revision, SectionFile};
use opennote_core::{OrderKey, Timestamp};
use opennote_sync::crypto::QUICK;
use opennote_sync::vault::{self, VaultKeys};
use opennote_sync::{Backend, Engine};

pub const PASS: &str = "correct horse battery";

/// One device: its notes folder and its engine.
pub struct Device {
    pub dir: tempfile::TempDir,
    pub engine: Engine,
    pub tag: String,
}

impl Device {
    pub fn root(&self) -> PathBuf {
        self.dir.path().join("notes")
    }

    pub fn write(&self, rel: &str, bytes: &[u8]) {
        let path = self.root().join(rel);
        fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
        fs::write(path, bytes).expect("write");
    }

    pub fn read(&self, rel: &str) -> Option<Vec<u8>> {
        fs::read(self.root().join(rel)).ok()
    }

    pub fn remove(&self, rel: &str) {
        let _ = fs::remove_file(self.root().join(rel));
    }

    /// Every file under the notes folder, by relative path.
    pub fn files(&self) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        collect(&self.root(), "", &mut out);
        out
    }

    /// The same device after a restart: a new engine over the same folder and state.
    pub fn restart(&mut self, backend: Arc<dyn Backend>) {
        let keys = keys_for(backend.as_ref());
        self.engine = Engine::new(
            self.root(),
            backend,
            keys,
            self.tag.clone(),
            self.dir.path().join("state.json"),
        );
    }
}

fn collect(dir: &Path, rel: &str, out: &mut BTreeMap<String, Vec<u8>>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if entry.file_type().expect("type").is_dir() {
            collect(&entry.path(), &child, out);
        } else {
            out.insert(child, fs::read(entry.path()).expect("read"));
        }
    }
}

pub fn keys_for(backend: &dyn Backend) -> VaultKeys {
    vault::unlock_passphrase(backend, PASS).expect("unlocks")
}

/// A vault in `backend` and `count` devices joined to it.
pub fn devices(backend: Arc<dyn Backend>, count: usize) -> Vec<Device> {
    let (keys, _) = vault::create_with(backend.as_ref(), PASS, QUICK).expect("creates");
    drop(keys);
    (0..count).map(|i| join(backend.clone(), &format!("d{i}"))).collect()
}

/// One more device.
pub fn join(backend: Arc<dyn Backend>, tag: &str) -> Device {
    let dir = tempfile::tempdir().expect("temp");
    fs::create_dir_all(dir.path().join("notes")).expect("notes");
    let keys = keys_for(backend.as_ref());
    let (_, secret) = vault::new_device().expect("device");
    vault::add_device(backend.as_ref(), &keys, tag, &secret, tag, 0).expect("adds");
    let engine = Engine::new(
        dir.path().join("notes"),
        backend,
        keys,
        tag,
        dir.path().join("state.json"),
    );
    Device {
        dir,
        engine,
        tag: tag.to_owned(),
    }
}

pub fn id(n: u128) -> Id {
    Id::from_parts(1_760_000_000_000, n)
}

pub fn rev(n: u128) -> RevisionId {
    RevisionId(id(1000 + n))
}

/// A real `page.json`.
pub fn page(page: u128, title: &str, revision: u128, ancestors: &[u128], saved_ms: i64, segments: &[u128]) -> Vec<u8> {
    let at = Timestamp::from_unix_ms(saved_ms);
    let revision = Revision {
        id: rev(revision),
        parents: ancestors.first().map(|a| vec![rev(*a)]).unwrap_or_default(),
        ancestors: ancestors.iter().map(|a| rev(*a)).collect(),
        saved_at: at,
        device: DeviceRef {
            id: DeviceId(id(9)),
            label: "Windows device TEST".into(),
        },
        writer: "OpenNote test".into(),
        extra: Default::default(),
    };
    let mut p = Page::new(PageId(id(page)), Timestamp::from_unix_ms(1_760_000_000_000), revision);
    p.title = title.to_owned();
    p.modified = at;
    let refs = segments
        .iter()
        .map(|s| SegmentRef {
            id: SegmentId(id(5000 + s)),
            bytes: 10,
            records: 1,
            crc32: 0,
            extra: Default::default(),
        })
        .collect();
    p.ink.commit(0, refs, 0);
    write_page(&p)
}

pub fn segment_name(s: u128) -> String {
    format!("ink/{}.onk", SegmentId(id(5000 + s)))
}

pub fn page_dir(page: u128) -> String {
    format!("Bio/{}/{}", SectionId(id(1)), PageId(id(page)))
}

/// A real `section.json` that lists pages by ID, title, and change time.
pub fn section(pages: &[(u128, &str, i64)], changed_ms: i64) -> Vec<u8> {
    let mut order = None;
    let entries = pages
        .iter()
        .map(|(p, title, changed)| {
            let key = OrderKey::between(order.as_ref(), None).expect("order");
            order = Some(key.clone());
            PageEntry {
                id: PageId(id(*p)),
                title: (*title).to_owned(),
                parent: None,
                order: key,
                pinned: false,
                color: None,
                changed: Timestamp::from_unix_ms(*changed),
                moving: None,
                extra: Default::default(),
            }
        })
        .collect();
    write_section(&SectionFile {
        id: SectionId(id(1)),
        title: "Cells".into(),
        color: None,
        group: None,
        order: OrderKey::between(None, None).expect("order"),
        created: Timestamp::from_unix_ms(1_760_000_000_000),
        changed: Timestamp::from_unix_ms(changed_ms),
        defaults: None,
        encryption: None,
        pages: entries,
        extra: Default::default(),
        format: Default::default(),
    })
}

pub fn section_path() -> String {
    format!("Bio/{}/section.json", SectionId(id(1)))
}

/// Syncs every device until nothing changes, at most `rounds` times each.
pub fn settle(devices: &[Device], rounds: usize) {
    for _ in 0..rounds {
        let mut quiet = true;
        for device in devices {
            let report = device.engine.sync().expect("syncs");
            quiet &= report.summary.is_empty() && report.generation.is_none();
        }
        if quiet {
            return;
        }
    }
}
