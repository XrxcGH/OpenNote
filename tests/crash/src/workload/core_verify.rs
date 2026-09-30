//! The checks after each kill of a core writer (plan 13.6, step 3). A fresh core recovers the notebook, and
//! `verify_notebook` must find nothing wrong. Every page must equal the replayed script at a step no lower than
//! its last acknowledgment, nothing may be lost or duplicated, and a second recovery must change nothing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::format::CanonicalCodec;
use opennote_core::id::{ClientId, PageId};
use opennote_core::model::Page;
use opennote_core::session::core::Core;
use opennote_core::session::notebook::NotebookHandle;
use opennote_core::session::page::read_page_dir;
use opennote_core::store::layout::NotebookLayout;
use opennote_core::store::std_fs::StdFs;
use opennote_core::store::verify::verify_notebook;
use opennote_core::testing::oracle::Oracle;
use opennote_core::{Limits, SystemClock, Timings};

use super::core::start_core;
use super::core_script::{self as script, Action, Manifest, Model, CLIENT, STEP};
use super::{Paths, Verified};
use crate::markers::Markers;

/// What the verifier remembers between iterations.
pub struct VerifyState {
    paths: Paths,
    seed: u64,
    /// The edited pages as the last check left them, which is where the next writer starts.
    start: Vec<Page>,
    /// Scratch pages that must exist: `None` in the tree, or the Trash item they were deleted into.
    expected: BTreeMap<String, Option<String>>,
}

impl VerifyState {
    /// Loads the pages the setup made.
    pub fn new(paths: &Paths, seed: u64) -> Result<VerifyState, String> {
        let manifest = Manifest::load(&paths.data)?;
        Ok(VerifyState {
            paths: paths.clone(),
            seed,
            start: load_pages(&manifest)?,
            expected: BTreeMap::new(),
        })
    }

    /// Checks the notebook after iteration `iteration`.
    pub fn verify(&mut self, iteration: u64, markers: &Markers) -> Result<Verified, String> {
        let manifest = Manifest::load(&self.paths.data)?;
        let (core, notebook) = recover(&self.paths.data, &manifest)?;
        notebook.close().map_err(|e| format!("close: {e}"))?;
        drop(core);
        let fs = StdFs::new(&Timings::for_crash_tests());
        let report = verify_notebook(&fs, &CanonicalCodec, &manifest.notebook, &Limits::default())
            .map_err(|e| format!("verify_notebook: {e}"))?;
        if !report.is_clean() {
            return Err(format!("verify_notebook found problems (I1): {:?}", report.problems));
        }
        let pages = load_pages(&manifest)?;
        self.check_pages(iteration, markers, &pages)?;
        let before = snapshot(&manifest.notebook);
        let (core, notebook) = recover(&self.paths.data, &manifest)?;
        self.check_tree(&notebook, &manifest, markers)?;
        notebook.close().map_err(|e| format!("close: {e}"))?;
        drop(core);
        if snapshot(&manifest.notebook) != before {
            return Err("a second recovery changed the notebook".into());
        }
        self.start = pages;
        Ok(Verified {
            pages: u32::try_from(self.start.len()).unwrap_or(0),
            ..Verified::default()
        })
    }

    /// Every edited page equals the script's page at some step from its last acknowledgment on (I2).
    fn check_pages(&self, iteration: u64, markers: &Markers, pages: &[Page]) -> Result<(), String> {
        let models = replay(
            crate::harness::writer_seed(self.seed, iteration),
            iteration,
            &self.start,
        )?;
        for (index, (model, page)) in models.into_iter().zip(pages).enumerate() {
            let start = self.start.get(index).cloned().ok_or("no start page")?;
            let mut oracle = Oracle::new(start);
            for txn in &model.steps {
                oracle
                    .push(txn)
                    .map_err(|e| format!("p{index}: the oracle refused a step: {e:?}"))?;
            }
            let acked = markers.acks.get(&format!("p{index}")).copied().unwrap_or(0);
            let from = usize::try_from(acked).unwrap_or(usize::MAX);
            if oracle.matches_some_step(page, from).is_none() {
                return Err(format!(
                    "p{index}: the page matches no step from acknowledged step {acked} on (I2)"
                ));
            }
        }
        Ok(())
    }

    /// Scratch pages are neither lost nor duplicated, whether a tree change was cut short or not.
    fn check_tree(&mut self, notebook: &NotebookHandle, manifest: &Manifest, markers: &Markers) -> Result<(), String> {
        for words in &markers.tree {
            match words.as_slice() {
                [op, page] if op == "create" || op == "restore" => {
                    self.expected.insert(page.clone(), None);
                }
                [op, page, item] if op == "delete" => {
                    self.expected.insert(page.clone(), Some(item.clone()));
                }
                [op, item] if op == "purge" => self.expected.retain(|_, trash| trash.as_ref() != Some(item)),
                _ => return Err(format!("an unknown tree marker: {words:?}")),
            }
        }
        let tree = notebook.tree();
        let mut counts: BTreeMap<String, u32> = BTreeMap::new();
        for page in tree.sections.iter().flat_map(|s| &s.pages) {
            *counts.entry(page.id.to_string()).or_default() += 1;
        }
        if let Some((page, _)) = counts.iter().find(|(_, &n)| n > 1) {
            return Err(format!("page {page} is in the tree twice"));
        }
        let trash = notebook.trash().map_err(|e| format!("trash: {e}"))?;
        let trashed: BTreeSet<String> = trash
            .iter()
            .flat_map(|item| &item.contents)
            .map(|id| id.to_string())
            .collect();
        let edited = manifest.pages.iter().map(|page| (page, true));
        let scratch = self.expected.keys().map(|page| (page, false));
        for (page, must_be_in_tree) in edited.chain(scratch) {
            let in_tree = counts.contains_key(page);
            if !in_tree && (must_be_in_tree || !trashed.contains(page)) {
                return Err(format!("page {page} is lost: it is in neither the tree nor Trash"));
            }
        }
        Ok(())
    }
}

/// Starts a core, recovers the notebook, and opens it.
fn recover(data: &Path, manifest: &Manifest) -> Result<(Core, NotebookHandle), String> {
    let core = start_core(data, Arc::new(SystemClock::new()))?;
    core.recover_pending(Some(&manifest.notebook))
        .map_err(|e| format!("recover_pending: {e}"))?;
    let notebook = core
        .open_notebook(&manifest.notebook)
        .map_err(|e| format!("open_notebook: {e}"))?;
    Ok((core, notebook))
}

/// The edited pages as they are on disk.
fn load_pages(manifest: &Manifest) -> Result<Vec<Page>, String> {
    let fs = StdFs::new(&Timings::for_crash_tests());
    let section = manifest.section_id()?;
    let mut pages = Vec::new();
    for page in manifest.page_ids()? {
        let dir = page_dir(manifest, section, page);
        let loaded = read_page_dir(&fs, &CanonicalCodec, &dir, &Limits::default())
            .map_err(|e| format!("page {page} can't be read (I1): {e:?}"))?;
        pages.push(loaded.page);
    }
    Ok(pages)
}

fn page_dir(manifest: &Manifest, section: opennote_core::id::SectionId, page: PageId) -> PathBuf {
    NotebookLayout::new(&manifest.notebook).page_dir(section, page)
}

/// Replays an iteration's script on the model, as the writer did.
fn replay(seed: u64, iteration: u64, start: &[Page]) -> Result<Vec<Model>, String> {
    let clock = script::clock_for(iteration);
    let client = ClientId::parse(CLIENT).map_err(|e| format!("{e:?}"))?;
    let mut models: Vec<Model> = start.iter().cloned().map(Model::new).collect();
    for action in script::script(seed, iteration)? {
        clock.advance(STEP);
        match action {
            Action::Edit(page, edit) => {
                let model = models.get_mut(page).ok_or("no such page")?;
                if let Some(request) = model.request(&edit, &client) {
                    model.apply(&request, &clock)?;
                }
            }
            Action::Undo(page) | Action::Redo(page) => {
                let model = models.get_mut(page).ok_or("no such page")?;
                model.undo_or_redo(matches!(action, Action::Redo(_)), &clock, &client)?;
            }
            Action::Save(_) | Action::Tree(_) => {}
        }
    }
    Ok(models)
}

/// The tree files and segments of a notebook, and their bytes.
fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    crate::hostile::list_files(root)
        .into_iter()
        .filter(|path| path.extension().is_some_and(|ext| ext == "json" || ext == "onk"))
        .filter_map(|path| Some((path.clone(), std::fs::read(&path).ok()?)))
        .collect()
}
