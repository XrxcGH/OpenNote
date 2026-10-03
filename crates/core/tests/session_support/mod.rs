//! Crash scenarios for tree changes (plan 13.4): notebooks on a disk that crashes at a chosen call, recovery
//! after the crash, and the checks that must hold after it. `tests/session_tree_crashes.rs` runs them.

// Each test file uses a different subset of these helpers.
#![allow(dead_code)]

pub mod disk;
pub mod scenarios;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::error::CoreError;
use opennote_core::id::{Id, PageId, SectionId};
use opennote_core::model::{Named, PageNodeState, TrashOrigin, TrashReason};
use opennote_core::store::cache::PageCache;
use opennote_core::store::fs::Fs;
use opennote_core::store::layout::SECTION_JSON;
use opennote_core::store::notebook_store::kit::env_on;
use opennote_core::store::notebook_store::{create_notebook, read_page_files, NotebookStore, TreeEnv};
use opennote_core::store::tree_log::MemIntentLog;
use opennote_core::testing::{sample, RegistryCodec};
use opennote_core::{Limits, TestClock};

use disk::{CrashLog, Disk};

/// Notebooks on one disk, with the codec, clock, and tree journals that survive a crash.
pub struct World {
    /// The disk.
    pub disk: Arc<dyn Disk>,
    /// The codec. Its registry plays the part of the bytes on disk, so it survives a crash.
    pub codec: RegistryCodec,
    /// The clock.
    pub clock: Arc<TestClock>,
    /// Each notebook's folder.
    pub roots: Vec<PathBuf>,
    /// Each notebook's tree journal.
    pub logs: Vec<MemIntentLog>,
}

impl World {
    /// Creates `notebooks` notebooks on `disk`.
    pub fn new(disk: Arc<dyn Disk>, notebooks: usize) -> Result<World, CoreError> {
        let codec = RegistryCodec::new();
        let clock = Arc::new(sample::test_clock());
        let env = env_on(disk.fs(), &codec, &clock);
        let titles = ["Biology", "Chemistry", "Physics"];
        let mut roots = Vec::new();
        for title in titles.iter().take(notebooks) {
            roots.push(create_notebook(&env, Path::new("/notes"), title)?);
        }
        let logs = roots.iter().map(|_| MemIntentLog::new()).collect();
        Ok(World {
            disk,
            codec,
            clock,
            roots,
            logs,
        })
    }

    /// The tree code's settings on this world's disk.
    pub fn env(&self) -> Arc<TreeEnv> {
        env_on(self.disk.fs(), &self.codec, &self.clock)
    }

    /// Opens every notebook's tree, as the app does before rolling forward and scanning.
    pub fn open(&self) -> Result<Vec<NotebookStore>, CoreError> {
        let env = self.env();
        self.roots
            .iter()
            .zip(&self.logs)
            .map(|(root, log)| {
                let log = CrashLog {
                    log: log.clone(),
                    disk: self.disk.clone(),
                };
                NotebookStore::open(env.clone(), root, PageCache::detached(), Box::new(log))
            })
            .collect()
    }

    /// The same notebooks on the disk as the next start finds it.
    pub fn reboot(&self) -> World {
        World {
            disk: self.disk.reboot(),
            codec: self.codec.clone(),
            clock: self.clock.clone(),
            roots: self.roots.clone(),
            logs: self.logs.clone(),
        }
    }

    /// Opens every notebook as the app does after a crash: read the tree, roll unfinished intents forward,
    /// and then scan each notebook.
    pub fn recover(&self) -> Result<Vec<NotebookStore>, CoreError> {
        let mut stores = self.open()?;
        for store in &mut stores {
            store.roll_forward()?;
        }
        for store in &mut stores {
            store.scan()?;
        }
        Ok(stores)
    }

    /// Every file on the disk and its bytes, read through the file system.
    pub fn snapshot(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        snapshot(self.disk.fs().as_ref(), Path::new("/"))
    }
}

/// Every file under `root` and its bytes.
pub fn snapshot(fs: &dyn Fs, root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs.read_dir(&dir).unwrap_or_default() {
            let path = dir.join(&entry.name);
            if entry.is_dir {
                pending.push(path);
            } else {
                files.insert(path.clone(), fs.read(&path, u64::MAX).unwrap_or_default());
            }
        }
    }
    files
}

/// Where each page and section is after recovery: how often each shows in a tree or in Trash.
#[derive(Debug, Default)]
pub struct Census {
    /// How often each page shows.
    pub pages: HashMap<PageId, u32>,
    /// How often each section shows.
    pub sections: HashMap<SectionId, u32>,
    /// Problems found on the way, such as a shown page whose folder doesn't load.
    pub problems: Vec<String>,
}

impl Census {
    /// Counts every page and section of `stores`, in their trees and in their Trash.
    pub fn take(stores: &[NotebookStore]) -> Census {
        let mut census = Census::default();
        for store in stores {
            census.count_tree(store);
            census.count_trash(store);
            if !store.pending.is_empty() || !store.hidden.is_empty() {
                census
                    .problems
                    .push(format!("{} still has pending changes", store.layout.root.display()));
            }
        }
        census
    }

    fn count_tree(&mut self, store: &NotebookStore) {
        let fs = store.env.fs.as_ref();
        let codec = store.env.codec.as_ref();
        for section in store.tree().sections {
            *self.sections.entry(section.id).or_default() += 1;
            for page in section.pages {
                *self.pages.entry(page.id).or_default() += 1;
                if page.state != PageNodeState::Normal {
                    self.problems.push(format!("page {} is {:?}", page.id, page.state));
                    continue;
                }
                let loads = store
                    .page_dir(page.id)
                    .is_some_and(|dir| read_page_files(fs, codec, &dir, &Limits::default()).is_ok());
                if !loads {
                    self.problems.push(format!("page {} doesn't load", page.id));
                }
            }
        }
    }

    /// Counts what is in Trash. Items with the reason `moved` hold the originals of a move to another
    /// notebook, kept for 30 days, so the copy in the other notebook is the one that counts.
    fn count_trash(&mut self, store: &NotebookStore) {
        for (id, entry) in &store.trash {
            if entry.file.reason == Named::Known(TrashReason::Moved) {
                continue;
            }
            match &entry.file.origin {
                TrashOrigin::Pages { entries, .. } => {
                    for e in entries {
                        *self.pages.entry(e.id).or_default() += 1;
                    }
                }
                TrashOrigin::Section { .. } | TrashOrigin::Group { .. } => {
                    let dir = store.layout.trash_item_dir(*id);
                    for content in &entry.file.contents {
                        self.count_trashed_section(store, &dir, *content);
                    }
                }
            }
        }
    }

    fn count_trashed_section(&mut self, store: &NotebookStore, item_dir: &Path, section: Id) {
        *self.sections.entry(SectionId(section)).or_default() += 1;
        let path = item_dir.join(section.to_string()).join(SECTION_JSON);
        let file = store
            .env
            .fs
            .read(&path, u64::MAX)
            .ok()
            .and_then(|bytes| store.env.codec.read_section(&bytes, &Limits::default()).ok());
        match file {
            Some(file) => {
                for e in file.pages {
                    *self.pages.entry(e.id).or_default() += 1;
                }
            }
            None => self.problems.push(format!("Trash section {section} doesn't load")),
        }
    }

    /// Checks that each page in `once` shows exactly once, each in `at_most_once` at most once, and that
    /// at most `new` other pages show, each once.
    pub fn check_pages(&self, once: &[PageId], at_most_once: &[PageId], new: u32) -> Result<(), String> {
        check_counts(&self.pages, once, at_most_once, new, "page")
    }

    /// The same check for sections.
    pub fn check_sections(&self, once: &[SectionId], at_most_once: &[SectionId], new: u32) -> Result<(), String> {
        check_counts(&self.sections, once, at_most_once, new, "section")
    }
}

fn check_counts<K: Copy + Eq + std::hash::Hash + std::fmt::Display>(
    counts: &HashMap<K, u32>,
    once: &[K],
    at_most_once: &[K],
    new: u32,
    what: &str,
) -> Result<(), String> {
    for id in once {
        let n = counts.get(id).copied().unwrap_or(0);
        if n != 1 {
            return Err(format!("{what} {id} shows {n} times, not once"));
        }
    }
    let mut others = 0;
    for (id, n) in counts {
        if *n > 1 {
            return Err(format!("{what} {id} shows {n} times"));
        }
        if !once.contains(id) && !at_most_once.contains(id) {
            others += 1;
        }
    }
    if others > new {
        return Err(format!("{others} new {what}s show, at most {new} may"));
    }
    Ok(())
}
